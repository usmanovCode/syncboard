package com.syncboard.realtime;

import static com.syncboard.realtime.StompTestClient.assertQuiet;
import static com.syncboard.realtime.StompTestClient.next;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.auth.JwtService;
import com.syncboard.board.Board;
import com.syncboard.board.BoardCanvas;
import com.syncboard.board.BoardCanvasRepository;
import com.syncboard.board.BoardMember;
import com.syncboard.board.BoardMemberRepository;
import com.syncboard.board.BoardRepository;
import com.syncboard.board.BoardRole;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

/** Drawing ops over a real WebSocket: broadcast, permissions, validation and persistence. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.realtime.flush-interval=PT0.5S")
@ActiveProfiles("test")
class BoardSyncIntegrationTest {

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private UserRepository users;

    @Autowired
    private BoardRepository boards;

    @Autowired
    private BoardCanvasRepository canvases;

    @Autowired
    private BoardMemberRepository members;

    @Autowired
    private JwtService jwtService;

    private final List<StompTestClient> clients = new ArrayList<>();
    private User owner;
    private User editor;
    private User viewer;
    private long boardId;

    /** A connected client that has joined the board. */
    private record Joined(StompTestClient client, BlockingQueue<JsonNode> ops, BlockingQueue<JsonNode> errors,
            JsonNode join) {
    }

    @BeforeEach
    void setUp() {
        boards.deleteAll();
        users.deleteAll();
        owner = users.saveAndFlush(new User("ali@example.com", "unused-hash", "Ali"));
        editor = users.saveAndFlush(new User("vali@example.com", "unused-hash", "Vali"));
        viewer = users.saveAndFlush(new User("gani@example.com", "unused-hash", "G'ani"));
        boardId = boards.saveAndFlush(new Board(owner.getId(), "Doska")).getId();
        canvases.saveAndFlush(new BoardCanvas(boardId));
        members.saveAndFlush(new BoardMember(boardId, editor.getId(), BoardRole.EDITOR));
        members.saveAndFlush(new BoardMember(boardId, viewer.getId(), BoardRole.VIEWER));
    }

    @AfterEach
    void closeClients() {
        clients.forEach(StompTestClient::close);
    }

    @Test
    void opsAreBroadcastToEveryoneInSeqOrder() throws Exception {
        Joined ali = join(owner, null);
        Joined vali = join(editor, null);
        assertThat(ali.join().get("seq").asLong()).isZero();
        assertThat(ali.join().get("shapes")).isEmpty();

        ali.client().send(ops(), op("c1", "add", rect("s1", 10)));
        JsonNode first = next(vali.ops());
        assertThat(first.get("seq").asLong()).isEqualTo(1);
        assertThat(first.get("userId").asLong()).isEqualTo(owner.getId());
        assertThat(first.get("clientOpId").asText()).isEqualTo("c1");
        assertThat(first.at("/op/shape/x").asDouble()).isEqualTo(10);
        assertThat(next(ali.ops()).get("seq").asLong()).isEqualTo(1); // the sender gets its echo (ack)

        // Like the real client: one op in flight, the next after the echo (see WebSocketConfig).
        vali.client().send(ops(), op("v1", "update", rect("s1", 50)));
        assertThat(next(vali.ops()).get("clientOpId").asText()).isEqualTo("v1");
        vali.client().send(ops(), Map.of("clientOpId", "v2", "op", Map.of("type", "remove", "id", "s1")));
        assertThat(next(ali.ops()).get("seq").asLong()).isEqualTo(2);
        JsonNode removed = next(ali.ops());
        assertThat(removed.get("seq").asLong()).isEqualTo(3);
        assertThat(removed.at("/op/type").asText()).isEqualTo("remove");
        assertThat(removed.at("/op/id").asText()).isEqualTo("s1");
    }

    @Test
    void joiningLaterGetsTheCurrentDrawing() throws Exception {
        Joined ali = join(owner, null);
        ali.client().send(ops(), op("c1", "add", rect("s1", 10)));
        next(ali.ops());
        ali.client().send(ops(), op("c2", "add", rect("s2", 20)));
        next(ali.ops());

        Joined vali = join(editor, null);

        assertThat(vali.join().get("seq").asLong()).isEqualTo(2);
        assertThat(vali.join().get("shapes")).hasSize(2);
        assertThat(vali.join().at("/shapes/1/id").asText()).isEqualTo("s2");
    }

    @Test
    void viewersCannotDraw() throws Exception {
        Joined ali = join(owner, null);
        Joined gani = join(viewer, null);

        gani.client().send(ops(), op("g1", "add", rect("s1", 10)));

        JsonNode error = next(gani.errors());
        assertThat(error.get("code").asText()).isEqualTo("READ_ONLY_BOARD");
        assertThat(error.get("clientOpId").asText()).isEqualTo("g1");
        assertQuiet(ali.ops());
    }

    @Test
    void removedMembersLoseWriteAccessImmediately() throws Exception {
        Joined vali = join(editor, null);
        members.deleteById(new BoardMember.Key(boardId, editor.getId()));

        vali.client().send(ops(), op("v1", "add", rect("s1", 10)));

        assertThat(next(vali.errors()).get("code").asText()).isEqualTo("BOARD_NOT_FOUND");
        assertQuiet(vali.ops());
    }

    @Test
    void invalidOpsAreRejectedInTheSendersLanguage() throws Exception {
        Joined ali = join(owner, "ko");

        Map<String, Object> bad = op("c1", "add", rect("s1", 10));
        @SuppressWarnings("unchecked")
        Map<String, Object> shape = (Map<String, Object>) ((Map<String, Object>) bad.get("op")).get("shape");
        shape.put("stroke", "javascript:alert(1)");
        ali.client().send(ops(), bad);

        JsonNode error = next(ali.errors());
        assertThat(error.get("code").asText()).isEqualTo("INVALID_OP");
        assertThat(error.get("message").asText()).isEqualTo("이 변경 사항을 적용할 수 없습니다");
        assertQuiet(ali.ops());
    }

    @Test
    void sendingWithoutJoiningIsRejected() throws Exception {
        StompTestClient c = StompTestClient.connect(port, json, jwtService.issueAccessToken(owner));
        clients.add(c);
        BlockingQueue<JsonNode> errors = c.subscribe("/user/queue/errors");
        Thread.sleep(200); // let the subscription register

        c.send(ops(), op("c1", "add", rect("s1", 10)));

        assertThat(next(errors).get("code").asText()).isEqualTo("NOT_JOINED");
    }

    @Test
    void theDrawingIsSavedWhenTheLastUserLeaves() throws Exception {
        Joined ali = join(owner, null);
        ali.client().send(ops(), op("c1", "add", rect("s1", 10)));
        next(ali.ops());

        ali.client().close();

        JsonNode saved = awaitStored(1);
        assertThat(saved.at("/shapes/0/id").asText()).isEqualTo("s1");
        Joined again = join(owner, null);
        assertThat(again.join().get("seq").asLong()).isEqualTo(1);
        assertThat(again.join().get("shapes")).hasSize(1);
    }

    @Test
    void theDrawingIsSavedPeriodicallyWhileOpen() throws Exception {
        Joined ali = join(owner, null);
        ali.client().send(ops(), op("c1", "add", rect("s1", 10)));
        next(ali.ops());

        JsonNode saved = awaitStored(1); // flush interval is 0.5 s in this test
        assertThat(saved.get("shapes")).hasSize(1);
        assertThat(ali.client().isConnected()).isTrue();
    }

    private Joined join(User user, String language) throws Exception {
        StompTestClient c = StompTestClient.connect(port, json, jwtService.issueAccessToken(user), language);
        clients.add(c);
        BlockingQueue<JsonNode> ops = c.subscribe(ops("/topic"));
        BlockingQueue<JsonNode> errors = c.subscribe("/user/queue/errors");
        JsonNode join = next(c.subscribe("/app/boards/" + boardId + "/join"));
        return new Joined(c, ops, errors, join);
    }

    private String ops() {
        return ops("/app");
    }

    private String ops(String prefix) {
        return prefix + "/boards/" + boardId + "/ops";
    }

    private static Map<String, Object> rect(String id, double x) {
        return new java.util.HashMap<>(Map.of("id", id, "type", "rect", "x", x, "y", 0, "width", 10, "height", 10,
                "stroke", "#1e293b", "strokeWidth", 2));
    }

    private static Map<String, Object> op(String clientOpId, String type, Map<String, Object> shape) {
        return Map.of("clientOpId", clientOpId, "op", Map.of("type", type, "shape", shape));
    }

    /** Waits until the stored canvas reaches {@code version}, then returns its content. */
    private JsonNode awaitStored(long version) throws Exception {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            BoardCanvas canvas = canvases.findById(boardId).orElseThrow();
            if (canvas.getVersion() >= version) {
                return json.readTree(canvas.getContent());
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Canvas was not saved");
    }
}

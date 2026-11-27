package com.syncboard.realtime;

import static com.syncboard.realtime.StompTestClient.next;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.SyncboardApplication;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;

/**
 * Two backend instances sharing one database and one Redis: clients connected to different instances
 * must see each other's ops, cursors, presence, chat and typing. The first instance is the test's own
 * context; the second is started next to it.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class MultiInstanceIntegrationTest {

    /** Second instance. It never heartbeats again after starting, so a test can declare it dead. */
    private static ServletWebServerApplicationContext second;

    @LocalServerPort
    private int port1;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private UserRepository users;

    @Autowired
    private BoardRepository boards;

    @Autowired
    private BoardMemberRepository members;

    @Autowired
    private BoardCanvasRepository canvases;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private ClusterPresence presence1;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private RealtimeKeys keys;

    private final List<StompTestClient> clients = new ArrayList<>();
    private User owner;
    private User editor;
    private User viewer;
    private long boardId;

    /** A client that has joined the board, with its topic queues. */
    private record Joined(StompTestClient client, Map<String, BlockingQueue<JsonNode>> topics, JsonNode join) {

        BlockingQueue<JsonNode> topic(String name) {
            return topics.get(name);
        }
    }

    @BeforeAll
    static void startSecondInstance() {
        second = (ServletWebServerApplicationContext) new SpringApplicationBuilder(SyncboardApplication.class)
                .profiles("test")
                .properties("server.port=0", "app.realtime.heartbeat-interval=PT1H")
                .run();
    }

    @AfterAll
    static void stopSecondInstance() {
        if (second != null) {
            second.close();
        }
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

    private int port2() {
        return second.getWebServer().getPort();
    }

    @Test
    void presenceSpansInstances() throws Exception {
        Joined ali = join(owner, port1);
        assertThat(names(next(ali.topic("presence")))).containsExactly("Ali");

        Joined vali = join(editor, port2());

        assertThat(names(vali.join().get("online"))).containsExactly("Ali", "Vali");
        assertThat(names(next(ali.topic("presence")))).containsExactly("Ali", "Vali");

        vali.client().close();
        assertThat(names(next(ali.topic("presence")))).containsExactly("Ali");
    }

    @Test
    void opsReachEveryoneInTheSameSeqOrder() throws Exception {
        Joined ali = join(owner, port1);
        Joined vali = join(editor, port2());

        ali.client().send(ops(), op("a1", "add", rect("s1", 10)));
        JsonNode first = next(vali.topic("ops"));
        assertThat(first.get("seq").asLong()).isEqualTo(1);
        assertThat(first.get("userId").asLong()).isEqualTo(owner.getId());
        assertThat(first.get("clientOpId").asText()).isEqualTo("a1");
        assertThat(first.at("/op/shape/x").asDouble()).isEqualTo(10);
        assertThat(next(ali.topic("ops")).get("seq").asLong()).isEqualTo(1); // the sender's echo

        // Both draw at once, on different instances: everyone gets both ops, in one seq order.
        ali.client().send(ops(), op("a2", "add", rect("s2", 20)));
        vali.client().send(ops(), op("v1", "add", rect("s3", 30)));
        List<String> aliSees = List.of(opLabel(next(ali.topic("ops"))), opLabel(next(ali.topic("ops"))));
        List<String> valiSees = List.of(opLabel(next(vali.topic("ops"))), opLabel(next(vali.topic("ops"))));
        assertThat(aliSees).isEqualTo(valiSees).isIn(List.of("2:a2", "3:v1"), List.of("2:v1", "3:a2"));

        Joined gani = join(viewer, port2()); // joins later, on the second instance
        assertThat(gani.join().get("seq").asLong()).isEqualTo(3);
        assertThat(gani.join().get("shapes")).hasSize(3);
        assertThat(gani.join().at("/shapes/0/id").asText()).isEqualTo("s1");
    }

    @Test
    void cursorsChatAndTypingReachTheOtherInstance() throws Exception {
        Joined ali = join(owner, port1);
        Joined gani = join(viewer, port2());

        gani.client().send("/app/boards/" + boardId + "/cursor", Map.of("x", 12.5, "y", -3));
        JsonNode cursor = next(ali.topic("cursors"));
        assertThat(cursor.get("userId").asLong()).isEqualTo(viewer.getId());
        assertThat(cursor.get("x").asDouble()).isEqualTo(12.5);

        gani.client().send("/app/boards/" + boardId + "/typing", Map.of("typing", true));
        assertThat(next(ali.topic("typing")).get("typing").asBoolean()).isTrue();

        gani.client().send("/app/boards/" + boardId + "/chat", Map.of("clientMessageId", "m1", "text", "Salom"));
        JsonNode message = next(ali.topic("chat"));
        assertThat(message.get("text").asText()).isEqualTo("Salom");
        assertThat(message.get("userName").asText()).isEqualTo("G'ani");
        assertThat(next(gani.topic("chat")).get("clientMessageId").asText()).isEqualTo("m1");
        assertThat(next(ali.topic("typing")).get("typing").asBoolean()).isFalse(); // sending stops typing

        String cursorId = cursor.get("cursorId").asText();
        gani.client().close();
        JsonNode gone = next(ali.topic("cursors"));
        assertThat(gone.get("cursorId").asText()).isEqualTo(cursorId);
        assertThat(gone.get("gone").asBoolean()).isTrue();
    }

    @Test
    void aDeadInstancesUsersAreRemovedByTheOthers() throws Exception {
        Joined ali = join(owner, port1);
        next(ali.topic("presence"));
        Joined vali = join(editor, port2());
        assertThat(names(next(ali.topic("presence")))).containsExactly("Ali", "Vali");
        vali.client().send("/app/boards/" + boardId + "/cursor", Map.of("x", 1, "y", 1));
        next(ali.topic("cursors"));

        // The second instance stops heartbeating (as if it crashed); its key expires.
        redis.delete(keys.instanceAlive(second.getBean(RealtimeKeys.class).instanceId()));
        presence1.sweepDeadInstances();

        assertThat(names(next(ali.topic("presence")))).containsExactly("Ali");
        assertThat(next(ali.topic("cursors")).get("gone").asBoolean()).isTrue();
    }

    private Joined join(User user, int port) throws Exception {
        StompTestClient c = StompTestClient.connect(port, json, jwtService.issueAccessToken(user));
        clients.add(c);
        Map<String, BlockingQueue<JsonNode>> topics = new HashMap<>();
        for (String name : List.of("presence", "ops", "cursors", "chat", "typing")) {
            topics.put(name, c.subscribe("/topic/boards/" + boardId + "/" + name));
        }
        JsonNode join = next(c.subscribe("/app/boards/" + boardId + "/join"));
        return new Joined(c, topics, join);
    }

    private String ops() {
        return "/app/boards/" + boardId + "/ops";
    }

    private static String opLabel(JsonNode op) {
        return op.get("seq").asLong() + ":" + op.get("clientOpId").asText();
    }

    private static Map<String, Object> rect(String id, double x) {
        return new HashMap<>(Map.of("id", id, "type", "rect", "x", x, "y", 0, "width", 10, "height", 10,
                "stroke", "#1e293b", "strokeWidth", 2));
    }

    private static Map<String, Object> op(String clientOpId, String type, Map<String, Object> shape) {
        return Map.of("clientOpId", clientOpId, "op", Map.of("type", type, "shape", shape));
    }

    private static List<String> names(JsonNode online) {
        List<String> names = new ArrayList<>();
        online.forEach(u -> names.add(u.get("name").asText()));
        return names;
    }
}

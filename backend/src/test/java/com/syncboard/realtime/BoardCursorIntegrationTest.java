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

/** Live cursors over a real WebSocket. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class BoardCursorIntegrationTest {

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
    private User viewer;
    private long boardId;

    @BeforeEach
    void setUp() {
        boards.deleteAll();
        users.deleteAll();
        owner = users.saveAndFlush(new User("ali@example.com", "unused-hash", "Ali"));
        viewer = users.saveAndFlush(new User("gani@example.com", "unused-hash", "G'ani"));
        boardId = boards.saveAndFlush(new Board(owner.getId(), "Doska")).getId();
        canvases.saveAndFlush(new BoardCanvas(boardId));
        members.saveAndFlush(new BoardMember(boardId, viewer.getId(), BoardRole.VIEWER));
    }

    @AfterEach
    void closeClients() {
        clients.forEach(StompTestClient::close);
    }

    @Test
    void viewersCursorsAreRelayedToOthers() throws Exception {
        StompTestClient ali = client(owner);
        BlockingQueue<JsonNode> aliCursors = ali.subscribe(cursors());
        join(ali);
        StompTestClient gani = client(viewer);
        join(gani);

        gani.send(cursorDestination(), Map.of("x", 10.5, "y", 20));

        JsonNode cursor = next(aliCursors);
        assertThat(cursor.get("userId").asLong()).isEqualTo(viewer.getId());
        assertThat(cursor.get("x").asDouble()).isEqualTo(10.5);
        assertThat(cursor.get("y").asDouble()).isEqualTo(20);
        assertThat(cursor.get("cursorId").asText()).isNotBlank();
        assertThat(cursor.has("gone")).isFalse();
    }

    @Test
    void leavingTheCanvasAndClosingTheTabRemoveTheCursor() throws Exception {
        StompTestClient ali = client(owner);
        BlockingQueue<JsonNode> aliCursors = ali.subscribe(cursors());
        join(ali);
        StompTestClient gani = client(viewer);
        join(gani);

        gani.send(cursorDestination(), Map.of("x", 1, "y", 2));
        String cursorId = next(aliCursors).get("cursorId").asText();
        gani.send(cursorDestination(), Map.of("gone", true)); // pointer left the canvas, sent right away
        JsonNode gone = next(aliCursors);
        assertThat(gone.get("gone").asBoolean()).isTrue();
        assertThat(gone.get("cursorId").asText()).isEqualTo(cursorId);
        assertThat(gone.has("x")).isFalse();

        gani.close();
        JsonNode closed = next(aliCursors);
        assertThat(closed.get("gone").asBoolean()).isTrue();
        assertThat(closed.get("cursorId").asText()).isEqualTo(cursorId);
    }

    @Test
    void eachTabHasItsOwnCursor() throws Exception {
        StompTestClient ali = client(owner);
        BlockingQueue<JsonNode> aliCursors = ali.subscribe(cursors());
        join(ali);
        StompTestClient tab1 = client(viewer);
        join(tab1);
        StompTestClient tab2 = client(viewer);
        join(tab2);

        tab1.send(cursorDestination(), Map.of("x", 1, "y", 1));
        String first = next(aliCursors).get("cursorId").asText();
        tab2.send(cursorDestination(), Map.of("x", 2, "y", 2));
        String second = next(aliCursors).get("cursorId").asText();

        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void cursorsFromOutsideTheRoomOrOutOfRangeAreDropped() throws Exception {
        StompTestClient ali = client(owner);
        BlockingQueue<JsonNode> aliCursors = ali.subscribe(cursors());
        join(ali);
        StompTestClient notJoined = client(viewer);

        notJoined.send(cursorDestination(), Map.of("x", 1, "y", 1));
        StompTestClient gani = client(viewer);
        join(gani);
        gani.send(cursorDestination(), Map.of("x", 1e9, "y", 1));

        assertQuiet(aliCursors);
        assertThat(gani.isConnected()).isTrue(); // dropped silently, not an error
    }

    private StompTestClient client(User user) throws Exception {
        StompTestClient c = StompTestClient.connect(port, json, jwtService.issueAccessToken(user));
        clients.add(c);
        return c;
    }

    private void join(StompTestClient client) throws Exception {
        next(client.subscribe("/app/boards/" + boardId + "/join"));
    }

    private String cursors() {
        return "/topic/boards/" + boardId + "/cursors";
    }

    private String cursorDestination() {
        return "/app/boards/" + boardId + "/cursor";
    }
}

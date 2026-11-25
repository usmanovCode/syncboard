package com.syncboard.realtime;

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
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

/** STOMP authentication, subscription authorization and presence, over a real WebSocket. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class BoardPresenceIntegrationTest {

    @LocalServerPort
    private int port;

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

    private final List<StompTestClient> clients = new ArrayList<>();
    private User owner;
    private User viewer;
    private User stranger;
    private long boardId;

    @BeforeEach
    void setUp() {
        boards.deleteAll();
        users.deleteAll();
        owner = users.saveAndFlush(new User("ali@example.com", "unused-hash", "Ali"));
        viewer = users.saveAndFlush(new User("vali@example.com", "unused-hash", "Vali"));
        stranger = users.saveAndFlush(new User("sobir@example.com", "unused-hash", "Sobir"));
        boardId = boards.saveAndFlush(new Board(owner.getId(), "Doska")).getId();
        canvases.saveAndFlush(new BoardCanvas(boardId));
        members.saveAndFlush(new BoardMember(boardId, viewer.getId(), BoardRole.VIEWER));
    }

    @AfterEach
    void closeClients() {
        clients.forEach(StompTestClient::close);
    }

    @Test
    void connectRequiresAValidToken() throws Exception {
        assertThat(StompTestClient.connectExpectingError(port, json, null)).contains("UNAUTHORIZED");
        assertThat(StompTestClient.connectExpectingError(port, json, "not.a.jwt")).contains("UNAUTHORIZED");
    }

    @Test
    void joinReturnsTheOnlineListAndOthersSeeArrivalsAndDepartures() throws Exception {
        StompTestClient ali = client(owner);
        BlockingQueue<JsonNode> aliPresence = ali.subscribe(topic("presence"));
        JsonNode joined = next(ali.subscribe("/app/boards/" + boardId + "/join"));

        assertThat(joined.get("userId").asLong()).isEqualTo(owner.getId());
        assertThat(names(joined.get("online"))).containsExactly("Ali");
        assertThat(joined.get("online").get(0).get("role").asText()).isEqualTo("OWNER");
        assertThat(joined.get("online").get(0).get("color").asText()).isEqualTo(PresenceRegistry.colorOf(owner.getId()));
        assertThat(names(next(aliPresence))).containsExactly("Ali");

        StompTestClient vali = client(viewer);
        vali.subscribe(topic("presence"));
        next(vali.subscribe("/app/boards/" + boardId + "/join"));
        JsonNode both = next(aliPresence);
        assertThat(names(both)).containsExactly("Ali", "Vali");
        assertThat(both.get(1).get("role").asText()).isEqualTo("VIEWER");

        vali.close();
        assertThat(names(next(aliPresence))).containsExactly("Ali");
    }

    @Test
    void aUserWithSeveralTabsIsListedOnce() throws Exception {
        StompTestClient tab1 = client(owner);
        BlockingQueue<JsonNode> presence = tab1.subscribe(topic("presence"));
        next(tab1.subscribe("/app/boards/" + boardId + "/join"));
        next(presence);

        StompTestClient tab2 = client(owner);
        next(tab2.subscribe("/app/boards/" + boardId + "/join"));
        assertThat(names(next(presence))).containsExactly("Ali");

        tab2.close();
        assertThat(names(next(presence))).containsExactly("Ali"); // still open in tab 1
    }

    @Test
    void strangersCannotSubscribeToTheBoard() throws Exception {
        StompTestClient sobir = client(stranger);

        sobir.subscribe(topic("presence"));

        String error = sobir.errors.poll(5, TimeUnit.SECONDS);
        assertThat(error).contains("BOARD_NOT_FOUND");
    }

    @Test
    void clientsCannotPublishToBrokerTopicsDirectly() throws Exception {
        StompTestClient ali = client(owner);
        BlockingQueue<JsonNode> presence = ali.subscribe(topic("presence"));
        StompTestClient vali = client(viewer);

        vali.send(topic("presence"), Map.of("forged", true));

        assertThat(vali.errors.poll(5, TimeUnit.SECONDS)).contains("FORBIDDEN_DESTINATION");
        StompTestClient.assertQuiet(presence);
    }

    @Test
    void unknownDestinationsAreRejected() throws Exception {
        StompTestClient ali = client(owner);

        ali.subscribe("/topic/boards/" + boardId + "/secret");

        assertThat(ali.errors.poll(5, TimeUnit.SECONDS)).contains("FORBIDDEN_DESTINATION");
    }

    private StompTestClient client(User user) throws Exception {
        StompTestClient c = StompTestClient.connect(port, json, jwtService.issueAccessToken(user));
        clients.add(c);
        return c;
    }

    private String topic(String name) {
        return "/topic/boards/" + boardId + "/" + name;
    }

    private static List<String> names(JsonNode online) {
        List<String> names = new ArrayList<>();
        online.forEach(u -> names.add(u.get("name").asText()));
        return names;
    }
}

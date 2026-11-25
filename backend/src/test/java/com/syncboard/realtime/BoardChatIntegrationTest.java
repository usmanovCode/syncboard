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
import com.syncboard.chat.ChatMessage;
import com.syncboard.chat.ChatMessageRepository;
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

/** Board chat and the "typing…" indicator over a real WebSocket. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class BoardChatIntegrationTest {

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
    private ChatMessageRepository messages;

    @Autowired
    private JwtService jwtService;

    private record Joined(StompTestClient client, BlockingQueue<JsonNode> chat, BlockingQueue<JsonNode> typing,
            BlockingQueue<JsonNode> errors, JsonNode join) {
    }

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
        viewer = users.saveAndFlush(new User("gani@example.com", "unused-hash", "G'ani"));
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
    void viewersMessagesAreStoredAndSentToEveryone() throws Exception {
        Joined ali = join(owner, null);
        Joined gani = join(viewer, null);

        gani.client().send(chat(), Map.of("clientMessageId", "m1", "text", "  Salom!\nQalaysiz?  "));

        JsonNode received = next(ali.chat());
        assertThat(received.get("userId").asLong()).isEqualTo(viewer.getId());
        assertThat(received.get("userName").asText()).isEqualTo("G'ani");
        assertThat(received.get("color").asText()).isEqualTo(PresenceRegistry.colorOf(viewer.getId()));
        assertThat(received.get("text").asText()).isEqualTo("Salom!\nQalaysiz?");
        assertThat(received.get("clientMessageId").asText()).isEqualTo("m1");
        assertThat(received.get("createdAt").isTextual()).isTrue();
        assertThat(next(gani.chat()).get("id").asLong()).isEqualTo(received.get("id").asLong()); // sender too

        List<ChatMessage> stored = messages.findAll();
        assertThat(stored).singleElement().satisfies(m -> {
            assertThat(m.getId()).isEqualTo(received.get("id").asLong());
            assertThat(m.getBody()).isEqualTo("Salom!\nQalaysiz?");
            assertThat(m.getBoardId()).isEqualTo(boardId);
        });
    }

    @Test
    void theJoinReplyCarriesTheNewestMessages() throws Exception {
        for (int i = 1; i <= 55; i++) {
            messages.save(new ChatMessage(boardId, i % 2 == 0 ? owner.getId() : viewer.getId(), "xabar " + i, "c" + i));
        }

        JsonNode chat = join(viewer, null).join().get("chat");

        assertThat(chat.get("hasMore").asBoolean()).isTrue();
        JsonNode page = chat.get("messages");
        assertThat(page).hasSize(50);
        assertThat(page.get(0).get("text").asText()).isEqualTo("xabar 6"); // oldest first
        assertThat(page.get(49).get("text").asText()).isEqualTo("xabar 55");
        assertThat(page.get(49).get("userName").asText()).isEqualTo("G'ani");
    }

    @Test
    void anEmptyBoardHasNoMessages() throws Exception {
        JsonNode chat = join(owner, null).join().get("chat");

        assertThat(chat.get("messages")).isEmpty();
        assertThat(chat.get("hasMore").asBoolean()).isFalse();
    }

    @Test
    void resendingAMessageDoesNotStoreItTwice() throws Exception {
        Joined ali = join(owner, null);

        ali.client().send(chat(), Map.of("clientMessageId", "m1", "text", "Bir marta"));
        long id = next(ali.chat()).get("id").asLong();
        ali.client().send(chat(), Map.of("clientMessageId", "m1", "text", "Bir marta"));

        assertThat(next(ali.chat()).get("id").asLong()).isEqualTo(id); // confirmed again, same message
        assertThat(messages.count()).isEqualTo(1);
    }

    @Test
    void invalidMessagesAreRejectedInTheSendersLanguage() throws Exception {
        Joined ali = join(owner, "ko");

        ali.client().send(chat(), Map.of("clientMessageId", "blank", "text", "   "));
        JsonNode blank = next(ali.errors());
        assertThat(blank.get("code").asText()).isEqualTo("INVALID_CHAT_MESSAGE");
        assertThat(blank.get("clientMessageId").asText()).isEqualTo("blank");
        assertThat(blank.get("message").asText()).isEqualTo("메시지는 1~2000자여야 합니다");
        assertThat(blank.has("clientOpId")).isFalse();

        ali.client().send(chat(), Map.of("clientMessageId", "long", "text", "a".repeat(2001)));
        assertThat(next(ali.errors()).get("clientMessageId").asText()).isEqualTo("long");

        ali.client().send(chat(), Map.of("text", "no id"));
        assertThat(next(ali.errors()).get("code").asText()).isEqualTo("INVALID_CHAT_MESSAGE");

        assertQuiet(ali.chat());
        assertThat(messages.count()).isZero();
        assertThat(ali.client().isConnected()).isTrue();
    }

    @Test
    void theLongestMessageIsAccepted() throws Exception {
        Joined ali = join(owner, null);

        ali.client().send(chat(), Map.of("clientMessageId", "m1", "text", "a".repeat(2000)));

        assertThat(next(ali.chat()).get("text").asText()).hasSize(2000);
    }

    @Test
    void aRemovedMemberCannotKeepWriting() throws Exception {
        Joined gani = join(viewer, null);
        members.deleteById(new BoardMember.Key(boardId, viewer.getId()));

        gani.client().send(chat(), Map.of("clientMessageId", "m1", "text", "Hali shu yerdaman"));

        JsonNode error = next(gani.errors());
        assertThat(error.get("code").asText()).isEqualTo("BOARD_NOT_FOUND");
        assertThat(error.get("clientMessageId").asText()).isEqualTo("m1");
        assertThat(messages.count()).isZero();
    }

    @Test
    void sendingNeedsAJoinedSession() throws Exception {
        StompTestClient c = client(owner, null);
        BlockingQueue<JsonNode> errors = c.subscribe("/user/queue/errors");

        c.send(chat(), Map.of("clientMessageId", "m1", "text", "Salom"));

        JsonNode error = next(errors);
        assertThat(error.get("code").asText()).isEqualTo("NOT_JOINED");
        assertThat(error.get("clientMessageId").asText()).isEqualTo("m1");
    }

    @Test
    void strangersCannotSubscribeToTheChat() throws Exception {
        StompTestClient sobir = client(stranger, null);

        sobir.subscribe(topic("chat"));

        assertThat(sobir.errors.poll(5, TimeUnit.SECONDS)).contains("BOARD_NOT_FOUND");
    }

    @Test
    void typingIsRelayedAndEndsWhenTheTabCloses() throws Exception {
        Joined ali = join(owner, null);
        Joined gani = join(viewer, null);

        gani.client().send(typing(), Map.of("typing", true));
        JsonNode started = next(ali.typing());
        assertThat(started.get("userId").asLong()).isEqualTo(viewer.getId());
        assertThat(started.get("typing").asBoolean()).isTrue();

        gani.client().send(typing(), Map.of("typing", true)); // repeated too soon: dropped
        assertQuiet(ali.typing());

        gani.client().send(typing(), Map.of("typing", false)); // stopping is never dropped
        assertThat(next(ali.typing()).get("typing").asBoolean()).isFalse();
        gani.client().send(typing(), Map.of("typing", true)); // a new burst starts at once
        assertThat(next(ali.typing()).get("typing").asBoolean()).isTrue();

        gani.client().close();
        JsonNode closed = next(ali.typing());
        assertThat(closed.get("userId").asLong()).isEqualTo(viewer.getId());
        assertThat(closed.get("typing").asBoolean()).isFalse();
    }

    @Test
    void sendingAMessageEndsTyping() throws Exception {
        Joined ali = join(owner, null);
        Joined gani = join(viewer, null);
        gani.client().send(typing(), Map.of("typing", true));
        next(ali.typing());

        gani.client().send(chat(), Map.of("clientMessageId", "m1", "text", "Tayyor"));

        next(ali.chat());
        assertThat(next(ali.typing()).get("typing").asBoolean()).isFalse();
    }

    @Test
    void typingFromOutsideTheRoomIsDropped() throws Exception {
        Joined ali = join(owner, null);
        StompTestClient notJoined = client(viewer, null);

        notJoined.send(typing(), Map.of("typing", true));

        assertQuiet(ali.typing());
        assertThat(notJoined.isConnected()).isTrue();
    }

    private StompTestClient client(User user, String language) throws Exception {
        StompTestClient c = StompTestClient.connect(port, json, jwtService.issueAccessToken(user), language);
        clients.add(c);
        return c;
    }

    private Joined join(User user, String language) throws Exception {
        StompTestClient c = client(user, language);
        BlockingQueue<JsonNode> chat = c.subscribe(topic("chat"));
        BlockingQueue<JsonNode> typing = c.subscribe(topic("typing"));
        BlockingQueue<JsonNode> errors = c.subscribe("/user/queue/errors");
        JsonNode join = next(c.subscribe("/app/boards/" + boardId + "/join"));
        return new Joined(c, chat, typing, errors, join);
    }

    private String topic(String name) {
        return "/topic/boards/" + boardId + "/" + name;
    }

    private String chat() {
        return "/app/boards/" + boardId + "/chat";
    }

    private String typing() {
        return "/app/boards/" + boardId + "/typing";
    }
}

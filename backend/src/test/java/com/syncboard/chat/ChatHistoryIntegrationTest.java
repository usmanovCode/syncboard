package com.syncboard.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.syncboard.auth.JwtService;
import com.syncboard.board.Board;
import com.syncboard.board.BoardMember;
import com.syncboard.board.BoardMemberRepository;
import com.syncboard.board.BoardRepository;
import com.syncboard.board.BoardRole;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** GET /api/boards/{id}/messages: older chat history, paged by id. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChatHistoryIntegrationTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private UserRepository users;

    @Autowired
    private BoardRepository boards;

    @Autowired
    private BoardMemberRepository members;

    @Autowired
    private ChatMessageRepository messages;

    @Autowired
    private JwtService jwtService;

    private User owner;
    private User viewer;
    private User stranger;
    private long boardId;
    private final List<Long> ids = new ArrayList<>();

    @BeforeEach
    void setUp() {
        boards.deleteAll();
        users.deleteAll();
        owner = users.saveAndFlush(new User("ali@example.com", "unused-hash", "Ali"));
        viewer = users.saveAndFlush(new User("gani@example.com", "unused-hash", "G'ani"));
        stranger = users.saveAndFlush(new User("sobir@example.com", "unused-hash", "Sobir"));
        boardId = boards.saveAndFlush(new Board(owner.getId(), "Doska")).getId();
        members.saveAndFlush(new BoardMember(boardId, viewer.getId(), BoardRole.VIEWER));
        ids.clear();
        for (int i = 1; i <= 5; i++) {
            ids.add(messages.save(new ChatMessage(boardId, owner.getId(), "xabar " + i, "c" + i)).getId());
        }
    }

    @Test
    void viewersPageBackwardsThroughTheHistory() throws Exception {
        history(viewer, "?limit=2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(2))
                .andExpect(jsonPath("$.messages[0].text").value("xabar 4"))
                .andExpect(jsonPath("$.messages[1].text").value("xabar 5"))
                .andExpect(jsonPath("$.messages[1].userName").value("Ali"))
                .andExpect(jsonPath("$.hasMore").value(true));

        history(viewer, "?limit=2&before=" + ids.get(3))
                .andExpect(jsonPath("$.messages[0].text").value("xabar 2"))
                .andExpect(jsonPath("$.messages[1].text").value("xabar 3"))
                .andExpect(jsonPath("$.hasMore").value(true));

        history(viewer, "?limit=2&before=" + ids.get(1))
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].text").value("xabar 1"))
                .andExpect(jsonPath("$.hasMore").value(false));
    }

    @Test
    void theDefaultPageHasEverythingWhenThereIsLittle() throws Exception {
        history(owner, "")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(5))
                .andExpect(jsonPath("$.hasMore").value(false));
    }

    @Test
    void outOfRangeLimitsAreClamped() throws Exception {
        history(owner, "?limit=0").andExpect(jsonPath("$.messages.length()").value(1));
        history(owner, "?limit=100000").andExpect(jsonPath("$.messages.length()").value(5));
    }

    @Test
    void strangersGetNotFound() throws Exception {
        history(stranger, "").andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("BOARD_NOT_FOUND"));
    }

    @Test
    void requiresAuthentication() throws Exception {
        mvc.perform(get("/api/boards/" + boardId + "/messages")).andExpect(status().isUnauthorized());
    }

    @Test
    void deletingTheBoardDeletesItsMessages() {
        boards.deleteById(boardId);

        assertThat(messages.count()).isZero();
    }

    private ResultActions history(User user, String query) throws Exception {
        return mvc.perform(get("/api/boards/" + boardId + "/messages" + query)
                .header("Authorization", "Bearer " + jwtService.issueAccessToken(user)));
    }
}

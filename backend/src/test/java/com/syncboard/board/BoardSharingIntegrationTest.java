package com.syncboard.board;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.auth.JwtService;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Sharing and roles (owner / editor / viewer) against the real test database. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BoardSharingIntegrationTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private UserRepository users;

    @Autowired
    private BoardRepository boards;

    @Autowired
    private BoardMemberRepository members;

    @Autowired
    private JwtService jwtService;

    private User owner;
    private User editor;
    private User viewer;
    private User stranger;
    private long boardId;

    @BeforeEach
    void setUp() throws Exception {
        boards.deleteAll();
        users.deleteAll();
        owner = users.saveAndFlush(new User("ali@example.com", "unused-hash", "Ali Valiyev"));
        editor = users.saveAndFlush(new User("vali@example.com", "unused-hash", "Vali"));
        viewer = users.saveAndFlush(new User("gani@example.com", "unused-hash", "G'ani"));
        stranger = users.saveAndFlush(new User("sobir@example.com", "unused-hash", "Sobir"));
        String body = authed(post("/api/boards"), owner, "{\"name\":\"Umumiy doska\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("OWNER"))
                .andExpect(jsonPath("$.ownerName").value("Ali Valiyev"))
                .andReturn().getResponse().getContentAsString();
        boardId = json.readTree(body).get("id").asLong();
    }

    @Test
    void ownerSharesWithEditorAndViewer() throws Exception {
        share(" VALI@example.com ", "EDITOR")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userId").value(editor.getId()))
                .andExpect(jsonPath("$.role").value("EDITOR"));
        share("gani@example.com", "VIEWER").andExpect(status().isCreated());

        // Everyone with access sees the member list, owner first.
        authed(get(members()), viewer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].role").value("OWNER"))
                .andExpect(jsonPath("$[0].fullName").value("Ali Valiyev"))
                .andExpect(jsonPath("$[1].email").value("vali@example.com"))
                .andExpect(jsonPath("$[2].role").value("VIEWER"));

        // Shared boards appear on the members' dashboards with their role and the owner's name.
        authed(get("/api/boards"), editor)
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(boardId))
                .andExpect(jsonPath("$[0].role").value("EDITOR"))
                .andExpect(jsonPath("$[0].ownerName").value("Ali Valiyev"));
        authed(get("/api/boards/" + boardId), viewer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.board.role").value("VIEWER"));
        authed(get("/api/boards"), stranger).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void editorsCannotManage() throws Exception {
        // Drawing permissions are enforced on the realtime channel (BoardSyncIntegrationTest).
        share("vali@example.com", "EDITOR");

        authed(patch("/api/boards/" + boardId), editor, "{\"name\":\"Boshqa\"}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_BOARD_OWNER"));
        authed(delete("/api/boards/" + boardId), editor).andExpect(status().isForbidden());
        authed(post(members()), editor, "{\"email\":\"sobir@example.com\",\"role\":\"VIEWER\"}")
                .andExpect(status().isForbidden());
    }

    @Test
    void ownerChangesRolesAndRemovesMembers() throws Exception {
        share("vali@example.com", "EDITOR");

        authed(patch(members() + "/" + editor.getId()), owner, "{\"role\":\"VIEWER\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("VIEWER"));
        authed(get("/api/boards/" + boardId), editor).andExpect(jsonPath("$.board.role").value("VIEWER"));

        authed(delete(members() + "/" + editor.getId()), owner).andExpect(status().isNoContent());
        authed(get("/api/boards/" + boardId), editor)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOARD_NOT_FOUND"));
    }

    @Test
    void membersCanLeaveButNotRemoveOthers() throws Exception {
        share("vali@example.com", "EDITOR");
        share("gani@example.com", "VIEWER");

        authed(delete(members() + "/" + editor.getId()), viewer).andExpect(status().isForbidden());
        authed(delete(members() + "/" + viewer.getId()), viewer).andExpect(status().isNoContent());

        assertThat(members.findAllByBoardIdOrderByCreatedAtAsc(boardId))
                .extracting(BoardMember::getUserId).containsExactly(editor.getId());
    }

    @Test
    void invalidSharesAreRejected() throws Exception {
        share("nobody@example.com", "EDITOR")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MEMBER_USER_NOT_FOUND"));
        share("ali@example.com", "EDITOR")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("CANNOT_SHARE_WITH_OWNER"));
        share("vali@example.com", "OWNER")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ROLE"));
        share("vali@example.com", "ADMIN")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        share("not-an-email", "EDITOR")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.email").exists());

        share("vali@example.com", "EDITOR").andExpect(status().isCreated());
        share("vali@example.com", "VIEWER")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_MEMBER"));
    }

    @Test
    void strangersSeeNothing() throws Exception {
        authed(get(members()), stranger).andExpect(status().isNotFound());
        authed(delete(members() + "/" + stranger.getId()), stranger).andExpect(status().isNotFound());
    }

    @Test
    void deletingTheBoardRemovesItsMemberships() throws Exception {
        share("vali@example.com", "EDITOR");

        authed(delete("/api/boards/" + boardId), owner).andExpect(status().isNoContent());

        assertThat(members.count()).isZero();
    }

    private String members() {
        return "/api/boards/" + boardId + "/members";
    }

    private ResultActions share(String email, String role) throws Exception {
        return authed(post(members()), owner,
                json.writeValueAsString(json.createObjectNode().put("email", email).put("role", role)));
    }

    private ResultActions authed(MockHttpServletRequestBuilder request, User user, String body) throws Exception {
        return authed(request.contentType(MediaType.APPLICATION_JSON).content(body), user);
    }

    private ResultActions authed(MockHttpServletRequestBuilder request, User user) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + jwtService.issueAccessToken(user)));
    }
}

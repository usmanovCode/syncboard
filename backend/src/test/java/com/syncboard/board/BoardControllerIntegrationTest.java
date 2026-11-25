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

/** Runs against the real PostgreSQL test database configured in application-test.yml. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BoardControllerIntegrationTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private UserRepository users;

    @Autowired
    private BoardRepository boards;

    @Autowired
    private JwtService jwtService;

    private User ali;
    private User vali;

    @BeforeEach
    void setUp() {
        boards.deleteAll();
        users.deleteAll();
        ali = users.saveAndFlush(new User("ali@example.com", "unused-hash", "Ali"));
        vali = users.saveAndFlush(new User("vali@example.com", "unused-hash", "Vali"));
    }

    @Test
    void createListRenameAndDelete() throws Exception {
        long id = createBoard(ali, "  Birinchi doska  ")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Birinchi doska"))
                .andExpect(jsonPath("$.ownerId").value(ali.getId()))
                .andExpect(jsonPath("$.createdAt").exists())
                .andExpect(jsonPath("$.updatedAt").exists())
                .andReturn().getResponse().getContentAsString()
                .transform(this::readId);
        createBoard(ali, "Ikkinchi doska").andExpect(status().isCreated());

        // Most recently changed first.
        authed(get("/api/boards"), ali)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].name").value("Ikkinchi doska"))
                .andExpect(jsonPath("$[1].name").value("Birinchi doska"));

        authed(withName(patch("/api/boards/" + id), "Yangi nom"), ali)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.name").value("Yangi nom"));
        authed(get("/api/boards"), ali).andExpect(jsonPath("$[0].name").value("Yangi nom"));

        authed(delete("/api/boards/" + id), ali).andExpect(status().isNoContent());
        authed(get("/api/boards"), ali)
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Ikkinchi doska"));
    }

    @Test
    void invalidNameReturnsFieldError() throws Exception {
        createBoard(ali, "   ")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors.name").value("Board name is required"));

        createBoard(ali, "x".repeat(101))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.name").exists());
    }

    @Test
    void otherUsersBoardsAreInvisibleAndUntouchable() throws Exception {
        long id = readId(createBoard(ali, "Alining doskasi").andReturn().getResponse().getContentAsString());

        authed(get("/api/boards"), vali).andExpect(jsonPath("$.length()").value(0));
        authed(withName(patch("/api/boards/" + id), "Buzildi"), vali)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOARD_NOT_FOUND"));
        authed(delete("/api/boards/" + id), vali)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOARD_NOT_FOUND"));

        authed(get("/api/boards"), ali).andExpect(jsonPath("$[0].name").value("Alining doskasi"));
    }

    @Test
    void missingBoardIsNotFound() throws Exception {
        authed(delete("/api/boards/999999"), ali)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOARD_NOT_FOUND"));
    }

    @Test
    void boardsRequireToken() throws Exception {
        mvc.perform(get("/api/boards")).andExpect(status().isUnauthorized());
        mvc.perform(withName(post("/api/boards"), "Doska")).andExpect(status().isUnauthorized());
    }

    @Test
    void deletingUserDeletesTheirBoards() throws Exception {
        createBoard(ali, "Doska").andExpect(status().isCreated());

        users.delete(ali);

        assertThat(boards.count()).isZero();
    }

    @Test
    void tokenOfDeletedUserCannotCreateBoards() throws Exception {
        String token = jwtService.issueAccessToken(vali);
        users.delete(vali);

        mvc.perform(withName(post("/api/boards"), "Doska").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
    }

    private ResultActions createBoard(User user, String name) throws Exception {
        return authed(withName(post("/api/boards"), name), user);
    }

    private MockHttpServletRequestBuilder withName(MockHttpServletRequestBuilder request, String name)
            throws Exception {
        return request.contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(json.createObjectNode().put("name", name)));
    }

    private ResultActions authed(MockHttpServletRequestBuilder request, User user) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + jwtService.issueAccessToken(user)));
    }

    private long readId(String body) {
        try {
            return json.readTree(body).get("id").asLong();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}

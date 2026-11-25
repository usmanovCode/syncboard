package com.syncboard.board;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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

/**
 * GET /api/boards/{id}: the board and its stored drawing. Writing happens over the realtime channel
 * (see BoardSyncIntegrationTest); there is no REST write for the drawing.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BoardCanvasIntegrationTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private UserRepository users;

    @Autowired
    private BoardRepository boards;

    @Autowired
    private CanvasStore store;

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
    void newBoardHasAnEmptyCanvasAtVersionZero() throws Exception {
        long id = createBoard("Doska");

        authed(get("/api/boards/" + id), ali)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.board.id").value(id))
                .andExpect(jsonPath("$.board.name").value("Doska"))
                .andExpect(jsonPath("$.board.role").value("OWNER"))
                .andExpect(jsonPath("$.canvas.version").value(0))
                .andExpect(jsonPath("$.canvas.content.schemaVersion").value(1))
                .andExpect(jsonPath("$.canvas.content.shapes.length()").value(0));
    }

    @Test
    void returnsTheStoredDrawing() throws Exception {
        long id = createBoard("Doska");
        store.save(id, "{\"schemaVersion\":1,\"shapes\":[{\"id\":\"s1\",\"type\":\"rect\",\"x\":1,\"y\":2,"
                + "\"width\":3,\"height\":4,\"stroke\":\"#1e293b\",\"strokeWidth\":2}]}", 5);

        authed(get("/api/boards/" + id), ali)
                .andExpect(jsonPath("$.canvas.version").value(5))
                .andExpect(jsonPath("$.canvas.content.shapes[0].type").value("rect"))
                .andExpect(jsonPath("$.canvas.content.shapes[0].width").value(3));
    }

    @Test
    void savingMovesTheBoardToTheTopOfTheDashboard() throws Exception {
        long older = createBoard("Eski");
        createBoard("Yangi");

        store.save(older, "{\"schemaVersion\":1,\"shapes\":[]}", 1);

        authed(get("/api/boards"), ali).andExpect(jsonPath("$[0].name").value("Eski"));
    }

    @Test
    void otherUsersCannotReadTheCanvas() throws Exception {
        long id = createBoard("Alining doskasi");

        authed(get("/api/boards/" + id), vali)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOARD_NOT_FOUND"));
    }

    @Test
    void thereIsNoRestWriteForTheDrawing() throws Exception {
        long id = createBoard("Doska");

        authed(put("/api/boards/" + id + "/canvas").contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":{\"schemaVersion\":1,\"shapes\":[]},\"version\":0}"), ali)
                .andExpect(status().is4xxClientError());
    }

    private long createBoard(String name) throws Exception {
        String response = authed(post("/api/boards").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(json.createObjectNode().put("name", name))), ali)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(response).get("id").asLong();
    }

    private ResultActions authed(MockHttpServletRequestBuilder request, User user) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + jwtService.issueAccessToken(user)));
    }
}

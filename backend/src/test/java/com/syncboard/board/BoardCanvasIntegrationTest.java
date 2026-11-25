package com.syncboard.board;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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

/** GET /api/boards/{id} and PUT /api/boards/{id}/canvas against the real test database. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class BoardCanvasIntegrationTest {

    private static final String RECT =
            "{\"id\":\"s1\",\"type\":\"rect\",\"x\":10,\"y\":20,\"width\":30,\"height\":40,"
                    + "\"stroke\":\"#1e293b\",\"strokeWidth\":4}";

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
    void newBoardHasAnEmptyCanvasAtVersionZero() throws Exception {
        long id = createBoard("Doska");

        authed(get("/api/boards/" + id), ali)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.board.id").value(id))
                .andExpect(jsonPath("$.board.name").value("Doska"))
                .andExpect(jsonPath("$.canvas.version").value(0))
                .andExpect(jsonPath("$.canvas.content.schemaVersion").value(1))
                .andExpect(jsonPath("$.canvas.content.shapes.length()").value(0));
    }

    @Test
    void saveStoresContentAndBumpsVersion() throws Exception {
        long id = createBoard("Doska");

        save(id, ali, canvas(RECT), 0)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.updatedAt").exists());
        save(id, ali, canvas(RECT + "," + RECT.replace("s1", "s2")), 1)
                .andExpect(jsonPath("$.version").value(2));

        authed(get("/api/boards/" + id), ali)
                .andExpect(jsonPath("$.canvas.version").value(2))
                .andExpect(jsonPath("$.canvas.content.shapes.length()").value(2))
                .andExpect(jsonPath("$.canvas.content.shapes[0].type").value("rect"))
                .andExpect(jsonPath("$.canvas.content.shapes[0].width").value(30));
    }

    @Test
    void staleVersionIsConflictAndKeepsStoredContent() throws Exception {
        long id = createBoard("Doska");
        save(id, ali, canvas(RECT), 0).andExpect(status().isOk());

        // A second tab that still thinks the board is at version 0.
        save(id, ali, canvas(""), 0)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CANVAS_CONFLICT"));

        authed(get("/api/boards/" + id), ali).andExpect(jsonPath("$.canvas.content.shapes.length()").value(1));
    }

    @Test
    void savingMovesTheBoardToTheTopOfTheDashboard() throws Exception {
        long older = createBoard("Eski");
        createBoard("Yangi");

        save(older, ali, canvas(RECT), 0).andExpect(status().isOk());

        authed(get("/api/boards"), ali).andExpect(jsonPath("$[0].name").value("Eski"));
    }

    @Test
    void malformedCanvasIsRejected() throws Exception {
        long id = createBoard("Doska");

        saveRaw(id, ali, "{\"content\":{\"shapes\":\"nope\",\"schemaVersion\":1},\"version\":0}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CANVAS"));
        saveRaw(id, ali, "{\"content\":[],\"version\":0}")
                .andExpect(jsonPath("$.code").value("INVALID_CANVAS"));
        saveRaw(id, ali, "{\"content\":{\"schemaVersion\":1,\"shapes\":[]}}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors.version").exists());
    }

    @Test
    void oversizedCanvasIsRejected() throws Exception {
        long id = createBoard("Doska");
        String big = "{\"id\":\"big\",\"type\":\"text\",\"text\":\"" + "x".repeat(BoardService.MAX_CANVAS_BYTES)
                + "\"}";

        save(id, ali, canvas(big), 0)
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("CANVAS_TOO_LARGE"));
    }

    @Test
    void otherUsersCannotReadOrWriteTheCanvas() throws Exception {
        long id = createBoard("Alining doskasi");

        authed(get("/api/boards/" + id), vali)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOARD_NOT_FOUND"));
        save(id, vali, canvas(RECT), 0).andExpect(status().isNotFound());

        authed(get("/api/boards/" + id), ali).andExpect(jsonPath("$.canvas.version").value(0));
    }

    @Test
    void conflictMessageIsLocalized() throws Exception {
        long id = createBoard("Doska");
        save(id, ali, canvas(RECT), 0).andExpect(status().isOk());

        mvc.perform(put("/api/boards/" + id + "/canvas")
                        .header("Authorization", "Bearer " + jwtService.issueAccessToken(ali))
                        .header("Accept-Language", "ko")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(canvas(""), 0)))
                .andExpect(jsonPath("$.detail").value("다른 곳에서 이 보드가 변경되었습니다. 최신 버전을 보려면 새로고침하세요."));
    }

    private static String canvas(String shapes) {
        return "{\"schemaVersion\":1,\"shapes\":[" + shapes + "]}";
    }

    private String body(String content, int version) throws Exception {
        ObjectNode body = json.createObjectNode();
        body.set("content", json.readTree(content));
        body.put("version", version);
        return json.writeValueAsString(body);
    }

    private ResultActions save(long id, User user, String content, int version) throws Exception {
        return saveRaw(id, user, body(content, version));
    }

    private ResultActions saveRaw(long id, User user, String body) throws Exception {
        return authed(put("/api/boards/" + id + "/canvas").contentType(MediaType.APPLICATION_JSON).content(body), user);
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

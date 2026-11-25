package com.syncboard.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** Runs against the real PostgreSQL test database configured in application-test.yml. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthControllerIntegrationTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private UserRepository users;

    @BeforeEach
    void cleanDatabase() {
        users.deleteAll();
    }

    @Test
    void registerLoginAndFetchCurrentUser() throws Exception {
        register("Ali@Example.com", "password123", "Ali Valiyev")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("ali@example.com"))
                .andExpect(jsonPath("$.passwordHash").doesNotExist());

        String body = login("ali@example.com", "password123")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andReturn().getResponse().getContentAsString();
        String token = json.readTree(body).get("accessToken").asText();

        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("ali@example.com"))
                .andExpect(jsonPath("$.fullName").value("Ali Valiyev"));
    }

    @Test
    void duplicateEmailIsConflict() throws Exception {
        register("ali@example.com", "password123", "Ali").andExpect(status().isCreated());

        register("ALI@example.com", "password456", "Boshqa Ali")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }

    @Test
    void wrongPasswordIsUnauthorized() throws Exception {
        register("ali@example.com", "password123", "Ali").andExpect(status().isCreated());

        login("ali@example.com", "not-the-password")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.detail").value("Incorrect email or password"));
    }

    @Test
    void errorsFollowAcceptLanguage() throws Exception {
        mvc.perform(post("/api/auth/login").header("Accept-Language", "ko-KR,ko;q=0.9")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"nobody@example.com\",\"password\":\"whatever\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("이메일 또는 비밀번호가 올바르지 않습니다"));

        // Validation messages, including Bean Validation's {min}/{max} placeholders.
        mvc.perform(post("/api/auth/register").header("Accept-Language", "ko")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"\",\"password\":\"short\",\"fullName\":\"Ali\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("입력값이 올바르지 않습니다"))
                .andExpect(jsonPath("$.errors.email").value("이메일을 입력하세요"))
                .andExpect(jsonPath("$.errors.password").value("비밀번호는 8~72자여야 합니다"));

        // Unsupported languages fall back to English.
        mvc.perform(post("/api/auth/register").header("Accept-Language", "uz")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"\",\"password\":\"short\",\"fullName\":\"Ali\"}"))
                .andExpect(jsonPath("$.errors.email").value("Email is required"))
                .andExpect(jsonPath("$.errors.password").value("Password must be 8 to 72 characters"));
    }

    @Test
    void invalidRegisterBodyReturnsFieldErrors() throws Exception {
        register("not-an-email", "short", "")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors.email").exists())
                .andExpect(jsonPath("$.errors.password").exists())
                .andExpect(jsonPath("$.errors.fullName").exists());
    }

    @Test
    void meRequiresValidToken() throws Exception {
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer not.a.jwt"))
                .andExpect(status().isUnauthorized());
    }

    private org.springframework.test.web.servlet.ResultActions register(String email, String password, String name)
            throws Exception {
        return postJson("/api/auth/register", json.createObjectNode()
                .put("email", email).put("password", password).put("fullName", name));
    }

    private org.springframework.test.web.servlet.ResultActions login(String email, String password) throws Exception {
        return postJson("/api/auth/login", json.createObjectNode().put("email", email).put("password", password));
    }

    private org.springframework.test.web.servlet.ResultActions postJson(String url, JsonNode body) throws Exception {
        return mvc.perform(post(url).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)));
    }
}

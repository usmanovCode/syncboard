package com.syncboard.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.common.ApiException;
import org.junit.jupiter.api.Test;

/** Validation of ops from clients (applying them is covered by {@link BoardRoomsTest}). */
class BoardOpTest {

    private final ObjectMapper json = new ObjectMapper();

    private JsonNode rect(String id, double x) throws Exception {
        return json.readTree("""
                {"id":"%s","type":"rect","x":%s,"y":0,"width":10,"height":10,"stroke":"#1e293b","strokeWidth":2}
                """.formatted(id, x));
    }

    private BoardOp op(String type, JsonNode shape) {
        return BoardOp.validate(new BoardOp(type, shape, null));
    }

    @Test
    void normalizesShapesToKnownFields() throws Exception {
        JsonNode shape = json.readTree("""
                {"id":"p","type":"pen","x":0,"y":0,"points":[1,2,3,4],"stroke":"#EF4444","strokeWidth":4,
                 "evil":"<script>"}
                """);

        JsonNode normalized = op("add", shape).shape();

        assertThat(normalized.has("evil")).isFalse();
        assertThat(normalized.get("points")).hasSize(4);
    }

    @Test
    void rejectsInvalidOps() throws Exception {
        String[] invalid = {
            "{\"id\":\"a\",\"type\":\"star\",\"x\":0,\"y\":0,\"stroke\":\"#000000\",\"strokeWidth\":2}",
            "{\"id\":\"a\",\"type\":\"rect\",\"x\":0,\"y\":0,\"width\":1,\"height\":1,\"stroke\":\"red\",\"strokeWidth\":2}",
            "{\"id\":\"a\",\"type\":\"rect\",\"x\":0,\"y\":0,\"width\":-1,\"height\":1,\"stroke\":\"#000000\",\"strokeWidth\":2}",
            "{\"id\":\"a\",\"type\":\"line\",\"x\":0,\"y\":0,\"points\":[1,2,3],\"stroke\":\"#000000\",\"strokeWidth\":2}",
            "{\"id\":\"\",\"type\":\"rect\",\"x\":0,\"y\":0,\"width\":1,\"height\":1,\"stroke\":\"#000000\",\"strokeWidth\":2}",
            "{\"id\":\"a\",\"type\":\"text\",\"x\":0,\"y\":0,\"text\":5,\"fontSize\":12,\"stroke\":\"#000000\",\"strokeWidth\":2}",
            "{\"id\":\"a\",\"type\":\"rect\",\"x\":\"0\",\"y\":0,\"width\":1,\"height\":1,\"stroke\":\"#000000\",\"strokeWidth\":2}",
        };
        for (String shape : invalid) {
            assertThatThrownBy(() -> op("add", json.readTree(shape)))
                    .as(shape)
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("INVALID_OP"));
        }
        assertThatThrownBy(() -> BoardOp.validate(new BoardOp("explode", rect("a", 0), null)))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> BoardOp.validate(new BoardOp("remove", null, null))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> BoardOp.validate(null)).isInstanceOf(ApiException.class);
    }
}

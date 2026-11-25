package com.syncboard.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import com.syncboard.common.ApiException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class BoardRoomTest {

    private final ObjectMapper json = new ObjectMapper();

    private JsonNode rect(String id, double x) throws Exception {
        return json.readTree("""
                {"id":"%s","type":"rect","x":%s,"y":0,"width":10,"height":10,"stroke":"#1e293b","strokeWidth":2}
                """.formatted(id, x));
    }

    private BoardOp op(String type, JsonNode shape) {
        return BoardOp.validate(new BoardOp(type, shape, null));
    }

    private BoardOp remove(String id) {
        return BoardOp.validate(new BoardOp("remove", null, TextNode.valueOf(id)));
    }

    private List<String> ids(BoardRoom room) {
        List<String> ids = new ArrayList<>();
        room.snapshot().forEach(s -> ids.add(s.get("id").asText() + "@" + s.get("x").asInt()));
        return ids;
    }

    @Test
    void appliesOpsInOrderAndNumbersThem() throws Exception {
        BoardRoom room = new BoardRoom(1, null, 7);

        assertThat(room.apply(op("add", rect("a", 0)))).isEqualTo(8);
        assertThat(room.apply(op("add", rect("b", 0)))).isEqualTo(9);
        room.apply(op("update", rect("a", 5)));

        assertThat(ids(room)).containsExactly("a@5", "b@0"); // update keeps z-order
        assertThat(room.seq()).isEqualTo(10);
        assertThat(room.isDirty()).isTrue();
    }

    @Test
    void opsAreIdempotentAndDeleteWins() throws Exception {
        BoardRoom room = new BoardRoom(1, null, 0);
        room.apply(op("add", rect("a", 0)));
        room.apply(op("add", rect("a", 3))); // re-sent add replaces in place
        assertThat(ids(room)).containsExactly("a@3");

        room.apply(remove("a"));
        room.apply(remove("a"));
        room.apply(op("update", rect("a", 9))); // update after delete: nothing
        assertThat(ids(room)).isEmpty();
        assertThat(room.seq()).isEqualTo(5); // still numbered, so every client applies the same sequence
    }

    @Test
    void loadsStoredShapesInOrder() throws Exception {
        BoardRoom room = new BoardRoom(1, json.readTree("[" + rect("x", 1) + "," + rect("y", 2) + "]"), 4);

        assertThat(ids(room)).containsExactly("x@1", "y@2");
        assertThat(room.isDirty()).isFalse();
    }

    @Test
    void limitsTheNumberOfShapes() throws Exception {
        BoardRoom room = new BoardRoom(1, null, 0);
        for (int i = 0; i < BoardRoom.MAX_SHAPES; i++) {
            room.apply(op("add", rect("s" + i, 0)));
        }

        assertThatThrownBy(() -> room.apply(op("add", rect("one-more", 0))))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("CANVAS_TOO_LARGE"));
        room.apply(op("add", rect("s0", 4))); // replacing an existing one is still fine
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

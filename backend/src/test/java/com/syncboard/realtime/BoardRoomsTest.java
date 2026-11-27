package com.syncboard.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import com.syncboard.board.Board;
import com.syncboard.board.BoardCanvas;
import com.syncboard.board.BoardCanvasRepository;
import com.syncboard.board.BoardRepository;
import com.syncboard.board.CanvasStore;
import com.syncboard.common.ApiException;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.StringJoiner;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.ActiveProfiles;

/**
 * The op rules in Redis ({@link RedisScripts#APPLY}); they must match frontend/src/canvas/ops.ts, whose
 * tests cover the same cases. Also loading, saving and evicting rooms.
 */
@SpringBootTest
@ActiveProfiles("test")
class BoardRoomsTest {

    @Autowired
    private BoardRooms rooms;

    @Autowired
    private CanvasStore store;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private RealtimeKeys keys;

    @Autowired
    private ObjectMapper json;

    @Autowired
    private UserRepository users;

    @Autowired
    private BoardRepository boards;

    @Autowired
    private BoardCanvasRepository canvases;

    private long boardId;

    @BeforeEach
    void setUp() {
        boards.deleteAll();
        users.deleteAll();
        User owner = users.saveAndFlush(new User("ali@example.com", "unused-hash", "Ali"));
        boardId = boards.saveAndFlush(new Board(owner.getId(), "Doska")).getId();
        canvases.saveAndFlush(new BoardCanvas(boardId));
    }

    private JsonNode rect(String id, double x) throws Exception {
        return json.readTree("""
                {"id":"%s","type":"rect","x":%s,"y":0,"width":10,"height":10,"stroke":"#1e293b","strokeWidth":2}
                """.formatted(id, x));
    }

    private void apply(String type, JsonNode shape) {
        rooms.apply(boardId, new BoardOp(type, shape, null), 1, "c");
    }

    private void remove(String id) {
        rooms.apply(boardId, new BoardOp("remove", null, TextNode.valueOf(id)), 1, "c");
    }

    private List<String> ids() {
        List<String> ids = new ArrayList<>();
        rooms.snapshot(boardId).shapes().forEach(s -> ids.add(s.get("id").asText() + "@" + s.get("x").asInt()));
        return ids;
    }

    private void storeShapes(long version, JsonNode... shapes) {
        StringJoiner list = new StringJoiner(",", "{\"schemaVersion\":1,\"shapes\":[", "]}");
        for (JsonNode shape : shapes) {
            list.add(shape.toString());
        }
        store.save(boardId, list.toString(), version);
    }

    @Test
    void appliesOpsInOrderAndNumbersThem() throws Exception {
        storeShapes(7);

        apply("add", rect("a", 0));
        apply("add", rect("b", 0));
        assertThat(rooms.snapshot(boardId).seq()).isEqualTo(9);
        apply("update", rect("a", 5));

        assertThat(ids()).containsExactly("a@5", "b@0"); // update keeps z-order
        assertThat(rooms.snapshot(boardId).seq()).isEqualTo(10);
    }

    @Test
    void opsAreIdempotentAndDeleteWins() throws Exception {
        apply("add", rect("a", 0));
        apply("add", rect("b", 0));
        apply("add", rect("a", 3)); // re-sent add replaces in place
        assertThat(ids()).containsExactly("a@3", "b@0");

        remove("a");
        remove("a");
        apply("update", rect("a", 9)); // update after delete: nothing
        assertThat(ids()).containsExactly("b@0");
        apply("add", rect("a", 1)); // added again: on top
        assertThat(ids()).containsExactly("b@0", "a@1");
        assertThat(rooms.snapshot(boardId).seq()).isEqualTo(7); // still numbered, so every client applies the same sequence
    }

    @Test
    void loadsStoredShapesInOrder() throws Exception {
        storeShapes(4, rect("x", 1), rect("y", 2));

        assertThat(ids()).containsExactly("x@1", "y@2");
        assertThat(rooms.snapshot(boardId).seq()).isEqualTo(4);
        apply("add", rect("z", 3));
        assertThat(ids()).containsExactly("x@1", "y@2", "z@3");
    }

    @Test
    void limitsTheNumberOfShapes() throws Exception {
        JsonNode[] shapes = new JsonNode[BoardRooms.MAX_SHAPES];
        for (int i = 0; i < shapes.length; i++) {
            shapes[i] = rect("s" + i, 0);
        }
        storeShapes(1, shapes);

        assertThatThrownBy(() -> apply("add", rect("one-more", 0)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("CANVAS_TOO_LARGE"));
        apply("add", rect("s0", 4)); // replacing an existing one is still fine
        assertThat(rooms.snapshot(boardId).seq()).isEqualTo(2);
    }

    @Test
    void closingSavesAndEvictsTheRoomAndItReloadsFromTheDatabase() throws Exception {
        apply("add", rect("a", 1));

        rooms.close(boardId);

        assertThat(redis.hasKey(keys.board(boardId, "room"))).isFalse();
        assertThat(redis.opsForSet().isMember(keys.rooms(), Long.toString(boardId))).isFalse();
        BoardCanvas saved = canvases.findById(boardId).orElseThrow();
        assertThat(saved.getVersion()).isEqualTo(1);
        assertThat(json.readTree(saved.getContent()).at("/shapes/0/id").asText()).isEqualTo("a");

        apply("add", rect("b", 2)); // loads it again
        assertThat(ids()).containsExactly("a@1", "b@2");
        assertThat(rooms.snapshot(boardId).seq()).isEqualTo(2);
    }

    @Test
    void anOlderDatabaseCopyCannotReplaceAJustEvictedRoom() throws Exception {
        apply("add", rect("a", 1));
        apply("add", rect("b", 1));
        rooms.close(boardId); // database and floor are now at seq 2

        // Another instance that read the database before the save tries to load its copy (seq 0).
        Long loaded = redis.execute(RedisScripts.LOAD, keys.room(boardId), Long.toString(boardId), "0");

        assertThat(loaded).isEqualTo(RedisScripts.NOT_LOADED);
        assertThat(rooms.snapshot(boardId).seq()).isEqualTo(2); // reads the database again
    }

    @Test
    void anOlderVersionNeverOverwritesTheStoredDrawing() throws Exception {
        storeShapes(5, rect("new", 0));

        assertThat(store.save(boardId, "{\"schemaVersion\":1,\"shapes\":[]}", 3)).isTrue();

        BoardCanvas canvas = canvases.findById(boardId).orElseThrow();
        assertThat(canvas.getVersion()).isEqualTo(5);
        assertThat(json.readTree(canvas.getContent()).get("shapes")).hasSize(1);
    }

    @Test
    void roomsOfDeletedBoardsAreDropped() throws Exception {
        apply("add", rect("a", 1));
        boards.deleteById(boardId);

        rooms.flushDirtyRooms();

        assertThat(redis.hasKey(keys.board(boardId, "room"))).isFalse();
        assertThat(store.save(boardId, "{}", 99)).isFalse();
    }
}

package com.syncboard.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.syncboard.common.ApiException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * The live drawing of one board: shapes in z-order (insertion order) and the sequence number of the
 * last applied op. Not thread-safe by itself; {@link BoardRooms} serializes access per room.
 */
final class BoardRoom {

    /** Keeps a single board's document (and every snapshot sent on join) bounded. */
    static final int MAX_SHAPES = 5_000;

    final long boardId;
    private final Map<String, ObjectNode> shapes = new LinkedHashMap<>();
    private long seq;
    private long persistedSeq;
    /** Set once evicted; ops must then go to a freshly loaded room. */
    boolean closed;

    BoardRoom(long boardId, JsonNode storedShapes, long seq) {
        this.boardId = boardId;
        this.seq = seq;
        this.persistedSeq = seq;
        if (storedShapes != null && storedShapes.isArray()) {
            for (JsonNode shape : storedShapes) {
                if (shape.isObject() && shape.path("id").isTextual()) {
                    shapes.put(shape.get("id").asText(), (ObjectNode) shape);
                }
            }
        }
    }

    /** Applies a validated op and returns its sequence number. */
    long apply(BoardOp op) {
        String id = op.targetId();
        switch (op.type()) {
            case "add" -> {
                if (!shapes.containsKey(id) && shapes.size() >= MAX_SHAPES) {
                    throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "CANVAS_TOO_LARGE", "error.canvasTooLarge");
                }
                shapes.put(id, (ObjectNode) op.shape()); // replaces in place if present
            }
            case "update" -> shapes.computeIfPresent(id, (key, old) -> (ObjectNode) op.shape());
            case "remove" -> shapes.remove(id);
            default -> throw new IllegalArgumentException(op.type());
        }
        return ++seq;
    }

    long seq() {
        return seq;
    }

    ArrayNode snapshot() {
        ArrayNode out = JsonNodeFactory.instance.arrayNode(shapes.size());
        shapes.values().forEach(out::add);
        return out;
    }

    boolean isDirty() {
        return seq != persistedSeq;
    }

    void markPersisted(long seq) {
        persistedSeq = seq;
    }
}

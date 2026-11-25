package com.syncboard.realtime;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;

/**
 * A change to a board's drawing. Every op carries the complete new state of one shape, so applying an
 * op twice is harmless (re-sending after a reconnect is safe) and everyone who applies the same ops in
 * the same order (by server seq) ends with the same drawing:
 * <ul>
 *   <li>{@code add}: put the shape; an existing id is replaced in place, a new one goes on top.</li>
 *   <li>{@code update}: replace the shape if it still exists; otherwise nothing (delete wins).</li>
 *   <li>{@code remove}: delete the shape if it exists.</li>
 * </ul>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record BoardOp(String type, JsonNode shape, JsonNode id) {

    /** Checks and normalizes an op from a client. */
    static BoardOp validate(BoardOp op) {
        if (op == null || op.type() == null) {
            throw ShapeValidator.invalid();
        }
        return switch (op.type()) {
            case "add", "update" -> {
                ObjectNode shape = ShapeValidator.validate(op.shape());
                yield new BoardOp(op.type(), shape, null);
            }
            case "remove" -> new BoardOp("remove", null, TextNode.valueOf(ShapeValidator.validateId(op.id())));
            default -> throw ShapeValidator.invalid();
        };
    }

    /** The shape id this op targets. */
    String targetId() {
        return "remove".equals(type) ? id.asText() : shape.get("id").asText();
    }
}

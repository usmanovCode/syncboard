package com.syncboard.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.syncboard.common.ApiException;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * Server-side copy of the frontend shape format (frontend/src/canvas/types.ts). Keep the two in sync.
 * Returns a normalized copy that contains only known fields, so stored documents stay clean.
 */
final class ShapeValidator {

    static final int MAX_ID_LENGTH = 64;
    static final int MAX_PEN_POINTS = 20_000; // numbers, i.e. 10 000 points
    static final int MAX_TEXT_LENGTH = 5_000;
    private static final double MAX_COORDINATE = 1_000_000;
    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

    private ShapeValidator() {
    }

    static ObjectNode validate(JsonNode shape) {
        if (shape == null || !shape.isObject()) {
            throw invalid();
        }
        ObjectNode out = NODES.objectNode();
        String id = text(shape, "id", MAX_ID_LENGTH);
        if (id.isEmpty()) {
            throw invalid();
        }
        out.put("id", id);
        String type = text(shape, "type", 16);
        out.put("type", type);
        out.put("x", coordinate(shape, "x"));
        out.put("y", coordinate(shape, "y"));
        String stroke = text(shape, "stroke", 7);
        if (!COLOR.matcher(stroke).matches()) {
            throw invalid();
        }
        out.put("stroke", stroke);
        out.put("strokeWidth", number(shape, "strokeWidth", 0.5, 64));

        switch (type) {
            case "pen" -> out.set("points", points(shape, 2, MAX_PEN_POINTS));
            case "line" -> out.set("points", points(shape, 4, 4));
            case "rect" -> {
                out.put("width", number(shape, "width", 0, MAX_COORDINATE));
                out.put("height", number(shape, "height", 0, MAX_COORDINATE));
            }
            case "ellipse" -> {
                out.put("radiusX", number(shape, "radiusX", 0, MAX_COORDINATE));
                out.put("radiusY", number(shape, "radiusY", 0, MAX_COORDINATE));
            }
            case "text" -> {
                out.put("text", text(shape, "text", MAX_TEXT_LENGTH));
                out.put("fontSize", number(shape, "fontSize", 1, 400));
            }
            default -> throw invalid();
        }
        return out;
    }

    /** A shape id in a remove op. */
    static String validateId(JsonNode id) {
        if (id == null || !id.isTextual() || id.asText().isEmpty() || id.asText().length() > MAX_ID_LENGTH) {
            throw invalid();
        }
        return id.asText();
    }

    private static String text(JsonNode shape, String field, int maxLength) {
        JsonNode value = shape.get(field);
        if (value == null || !value.isTextual() || value.asText().length() > maxLength) {
            throw invalid();
        }
        return value.asText();
    }

    private static double coordinate(JsonNode shape, String field) {
        return number(shape, field, -MAX_COORDINATE, MAX_COORDINATE);
    }

    private static double number(JsonNode shape, String field, double min, double max) {
        JsonNode value = shape.get(field);
        if (value == null || !value.isNumber()) {
            throw invalid();
        }
        double n = value.asDouble();
        if (!Double.isFinite(n) || n < min || n > max) {
            throw invalid();
        }
        return n;
    }

    private static ArrayNode points(JsonNode shape, int min, int max) {
        JsonNode value = shape.get("points");
        if (value == null || !value.isArray() || value.size() < min || value.size() > max || value.size() % 2 != 0) {
            throw invalid();
        }
        ArrayNode out = NODES.arrayNode(value.size());
        for (JsonNode n : value) {
            if (!n.isNumber() || !Double.isFinite(n.asDouble()) || Math.abs(n.asDouble()) > MAX_COORDINATE) {
                throw invalid();
            }
            out.add(n.asDouble());
        }
        return out;
    }

    static ApiException invalid() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OP", "error.invalidOp");
    }
}

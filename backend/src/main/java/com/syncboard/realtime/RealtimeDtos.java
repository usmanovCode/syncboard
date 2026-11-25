package com.syncboard.realtime;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.syncboard.board.BoardRole;
import java.util.List;

/** Payloads of the board WebSocket channels. Mirrored in frontend/src/realtime/types.ts. */
public final class RealtimeDtos {

    private RealtimeDtos() {
    }

    /** Someone who has the board open (deduplicated across their tabs). {@code color} is stable per user. */
    public record OnlineUser(long userId, String name, String color, BoardRole role) {
    }

    /**
     * Reply to subscribing to {@code /app/boards/{id}/join}: the drawing as of op {@code seq}. Ops with a
     * higher seq arrive on {@code /topic/boards/{id}/ops}.
     */
    public record JoinResponse(long boardId, long userId, List<OnlineUser> online, ArrayNode shapes, long seq) {
    }

    /** Client → {@code /app/boards/{id}/ops}. {@code clientOpId} lets the sender recognize its own op. */
    public record OpRequest(String clientOpId, BoardOp op) {
    }

    /** Server → {@code /topic/boards/{id}/ops}: an accepted op, in seq order, sent to everyone (sender too). */
    public record OpBroadcast(long seq, long userId, String clientOpId, BoardOp op) {
    }

    /** Sent to {@code /user/queue/errors} when a message is rejected; {@code clientOpId} if it was an op. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ErrorMessage(String code, String message, String clientOpId) {
    }
}

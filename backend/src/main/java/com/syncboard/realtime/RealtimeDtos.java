package com.syncboard.realtime;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.syncboard.board.BoardRole;
import com.syncboard.chat.ChatDtos.ChatPage;
import java.util.List;

/** Payloads of the board WebSocket channels. Mirrored in frontend/src/realtime/types.ts. */
public final class RealtimeDtos {

    private RealtimeDtos() {
    }

    /** Someone who has the board open (deduplicated across their tabs). {@code color} is stable per user. */
    public record OnlineUser(long userId, String name, String color, BoardRole role) {
    }

    /**
     * Reply to subscribing to {@code /app/boards/{id}/join}: the drawing as of op {@code seq}, and the
     * newest chat messages. Ops with a higher seq arrive on {@code /topic/boards/{id}/ops}, new messages
     * on {@code /topic/boards/{id}/chat}.
     */
    public record JoinResponse(long boardId, long userId, List<OnlineUser> online, ArrayNode shapes, long seq,
            ChatPage chat) {
    }

    /** Client → {@code /app/boards/{id}/ops}. {@code clientOpId} lets the sender recognize its own op. */
    public record OpRequest(String clientOpId, BoardOp op) {
    }

    /**
     * Server → {@code /topic/boards/{id}/ops}: an accepted op, in seq order, sent to everyone (sender too).
     * On the wire it also has {@code seq} (first), which the Redis script that numbers the op adds
     * ({@link RedisScripts#APPLY}): {@code { seq, userId, clientOpId, op }}.
     */
    public record OpBroadcast(long userId, String clientOpId, BoardOp op) {
    }

    /**
     * Client → {@code /app/boards/{id}/cursor}: pointer position in canvas coordinates, or
     * {@code gone: true} when it left the canvas (an empty payload would be rejected by Spring).
     */
    public record CursorRequest(Double x, Double y, Boolean gone) {
    }

    /**
     * Server → {@code /topic/boards/{id}/cursors}. {@code cursorId} is per tab. {@code gone} means the
     * pointer left the canvas or the tab closed; then x/y are absent. Name and color come from the
     * online list.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CursorBroadcast(String cursorId, long userId, Double x, Double y, Boolean gone) {

        static CursorBroadcast at(String cursorId, long userId, double x, double y) {
            return new CursorBroadcast(cursorId, userId, x, y, null);
        }

        static CursorBroadcast gone(String cursorId, long userId) {
            return new CursorBroadcast(cursorId, userId, null, null, true);
        }
    }

    /**
     * Client → {@code /app/boards/{id}/chat}. Broadcast as a {@code ChatMessageResponse} to
     * {@code /topic/boards/{id}/chat} once stored; {@code clientMessageId} makes re-sending safe.
     */
    public record ChatRequest(String clientMessageId, String text) {
    }

    /** Client → {@code /app/boards/{id}/typing}: started (repeated while typing) or stopped typing. */
    public record TypingRequest(Boolean typing) {
    }

    /** Server → {@code /topic/boards/{id}/typing}. Not stored; a user who disconnects stops typing. */
    public record TypingBroadcast(long userId, boolean typing) {
    }

    /**
     * Sent to {@code /user/queue/errors} when a message is rejected; {@code clientOpId} if it was an op,
     * {@code clientMessageId} if it was a chat message.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ErrorMessage(String code, String message, String clientOpId, String clientMessageId) {

        static ErrorMessage forOp(String code, String message, String clientOpId) {
            return new ErrorMessage(code, message, clientOpId, null);
        }

        static ErrorMessage forChat(String code, String message, String clientMessageId) {
            return new ErrorMessage(code, message, null, clientMessageId);
        }
    }
}

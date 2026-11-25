package com.syncboard.realtime;

import com.syncboard.board.BoardRole;
import java.util.List;

/** Payloads of the board WebSocket channels. */
public final class RealtimeDtos {

    private RealtimeDtos() {
    }

    /** Someone who has the board open (deduplicated across their tabs). {@code color} is stable per user. */
    public record OnlineUser(long userId, String name, String color, BoardRole role) {
    }

    /** Reply to subscribing to {@code /app/boards/{id}/join}. */
    public record JoinResponse(long boardId, long userId, List<OnlineUser> online) {
    }

    /** Sent to {@code /user/queue/errors} when a message is rejected. */
    public record ErrorMessage(String code, String message) {
    }
}

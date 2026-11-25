package com.syncboard.chat;

import java.time.Instant;
import java.util.List;

/** Chat payloads, over REST and STOMP. Mirrored in frontend/src/chat/types.ts. */
public final class ChatDtos {

    private ChatDtos() {
    }

    /**
     * A stored message. {@code color} is the author's presence color; {@code clientMessageId} lets the
     * sending tab recognize its own message.
     */
    public record ChatMessageResponse(long id, long userId, String userName, String color, String text,
            Instant createdAt, String clientMessageId) {
    }

    /** Messages oldest first; {@code hasMore}: older ones exist (load them with {@code before}). */
    public record ChatPage(List<ChatMessageResponse> messages, boolean hasMore) {
    }
}

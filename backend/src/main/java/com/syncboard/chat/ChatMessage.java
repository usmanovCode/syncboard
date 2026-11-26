package com.syncboard.chat;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** A chat message on a board. Immutable once written. */
@Entity
@Table(name = "messages")
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "board_id", nullable = false, updatable = false)
    private Long boardId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Column(nullable = false, updatable = false, length = ChatService.MAX_LENGTH)
    private String body;

    @Column(name = "client_message_id", nullable = false, updatable = false, length = ChatService.MAX_CLIENT_MESSAGE_ID)
    private String clientMessageId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected ChatMessage() {
    }

    public ChatMessage(Long boardId, Long userId, String body, String clientMessageId) {
        this.boardId = boardId;
        this.userId = userId;
        this.body = body;
        this.clientMessageId = clientMessageId;
        // PostgreSQL keeps microseconds: the value broadcast now equals the one read back later.
        this.createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    public Long getId() {
        return id;
    }

    public Long getBoardId() {
        return boardId;
    }

    public Long getUserId() {
        return userId;
    }

    public String getBody() {
        return body;
    }

    public String getClientMessageId() {
        return clientMessageId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

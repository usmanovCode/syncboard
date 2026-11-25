package com.syncboard.board;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import org.hibernate.annotations.CreationTimestamp;

/** A user a board is shared with, as EDITOR or VIEWER. */
@Entity
@Table(name = "board_members")
@IdClass(BoardMember.Key.class)
public class BoardMember {

    /** Composite primary key (board_id, user_id). */
    public static class Key implements Serializable {

        private Long boardId;
        private Long userId;

        protected Key() {
        }

        public Key(Long boardId, Long userId) {
            this.boardId = boardId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Key key && Objects.equals(boardId, key.boardId) && Objects.equals(userId, key.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(boardId, userId);
        }
    }

    @Id
    @Column(name = "board_id")
    private Long boardId;

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private BoardRole role;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected BoardMember() {
    }

    public BoardMember(Long boardId, Long userId, BoardRole role) {
        if (!role.isMemberRole()) {
            throw new IllegalArgumentException("Members are EDITOR or VIEWER");
        }
        this.boardId = boardId;
        this.userId = userId;
        this.role = role;
    }

    public Long getBoardId() {
        return boardId;
    }

    public Long getUserId() {
        return userId;
    }

    public BoardRole getRole() {
        return role;
    }

    public void changeRole(BoardRole role) {
        if (!role.isMemberRole()) {
            throw new IllegalArgumentException("Members are EDITOR or VIEWER");
        }
        this.role = role;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}

package com.syncboard.board;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The drawing on a board, stored as an opaque JSON document ({@code { schemaVersion, shapes }}) that
 * the frontend owns. Created together with its board; written only through
 * {@link BoardCanvasRepository#saveIfVersionMatches}, never by dirty checking.
 */
@Entity
@Table(name = "board_canvases")
public class BoardCanvas {

    @Id
    @Column(name = "board_id")
    private Long boardId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb", insertable = false, updatable = false)
    private String content;

    @Column(nullable = false, insertable = false, updatable = false)
    private int version;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected BoardCanvas() {
    }

    /** A new canvas; the database fills in the empty content, version 0 and the timestamp. */
    public BoardCanvas(Long boardId) {
        this.boardId = boardId;
    }

    public Long getBoardId() {
        return boardId;
    }

    public String getContent() {
        return content;
    }

    public int getVersion() {
        return version;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}

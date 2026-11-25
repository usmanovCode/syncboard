package com.syncboard.board;

import com.fasterxml.jackson.annotation.JsonRawValue;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** Request/response bodies for {@link BoardController}. Keep the name rules in sync with the frontend. */
public final class BoardDtos {

    private BoardDtos() {
    }

    /** Used for both create and rename. */
    public record BoardRequest(
            @NotBlank(message = "{validation.boardName.required}")
            @Size(max = 100, message = "{validation.boardName.tooLong}")
            String name) {
    }

    /**
     * {@code ownerId} lets the client tell its own boards from boards shared with it (coming with
     * board_members), e.g. to show rename/delete only to the owner.
     */
    public record BoardResponse(Long id, String name, Long ownerId, Instant createdAt, Instant updatedAt) {

        static BoardResponse from(Board board) {
            return new BoardResponse(
                    board.getId(), board.getName(), board.getOwnerId(), board.getCreatedAt(), board.getUpdatedAt());
        }
    }

    /** GET /api/boards/{id}: the board plus its drawing. */
    public record BoardDetailResponse(BoardResponse board, CanvasResponse canvas) {
    }

    /** {@code content} is the stored JSON document, passed through without parsing. */
    public record CanvasResponse(@JsonRawValue String content, int version, Instant updatedAt) {

        static CanvasResponse from(BoardCanvas canvas) {
            return new CanvasResponse(canvas.getContent(), canvas.getVersion(), canvas.getUpdatedAt());
        }
    }

    /** {@code version} is the version the client's content is based on (from the last GET or save). */
    public record CanvasSaveRequest(
            @NotNull(message = "{validation.canvas.required}") JsonNode content,
            @NotNull(message = "{validation.canvas.required}") @PositiveOrZero Integer version) {
    }

    public record CanvasSaveResponse(int version, Instant updatedAt) {
    }
}

package com.syncboard.board;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** Request/response bodies for {@link BoardController}. Keep the name rules in sync with the frontend. */
public final class BoardDtos {

    private BoardDtos() {
    }

    /** Used for both create and rename. */
    public record BoardRequest(
            @NotBlank(message = "Doska nomi kiritilishi shart")
            @Size(max = 100, message = "Doska nomi 100 belgidan oshmasligi kerak")
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
}

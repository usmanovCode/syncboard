package com.syncboard.board;

import com.fasterxml.jackson.annotation.JsonRawValue;
import com.fasterxml.jackson.databind.JsonNode;
import com.syncboard.user.User;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** Request/response bodies for the board endpoints. Keep the validation rules in sync with the frontend. */
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
     * {@code role} is the caller's role on this board; the frontend uses it to show owner-only
     * actions and to make the canvas read-only for viewers.
     */
    public record BoardResponse(
            Long id, String name, Long ownerId, String ownerName, BoardRole role, Instant createdAt, Instant updatedAt) {

        static BoardResponse from(Board board, BoardRole role, String ownerName) {
            return new BoardResponse(board.getId(), board.getName(), board.getOwnerId(), ownerName, role,
                    board.getCreatedAt(), board.getUpdatedAt());
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

    /** POST /api/boards/{id}/members. {@code role} must be EDITOR or VIEWER. */
    public record AddMemberRequest(
            @NotBlank(message = "{validation.email.required}")
            @Email(message = "{validation.email.invalid}")
            @Size(max = 255, message = "{validation.email.tooLong}")
            String email,

            @NotNull(message = "{validation.role.required}")
            BoardRole role) {

        /** Trimmed before validation, so a pasted " ali@example.com " is accepted. */
        public AddMemberRequest {
            email = email == null ? null : email.trim();
        }
    }

    /** PATCH /api/boards/{id}/members/{userId}. */
    public record ChangeRoleRequest(@NotNull(message = "{validation.role.required}") BoardRole role) {
    }

    /** Someone with access to a board; the owner is listed too, with role OWNER. */
    public record MemberResponse(Long userId, String email, String fullName, BoardRole role) {

        static MemberResponse from(User user, BoardRole role) {
            return new MemberResponse(user.getId(), user.getEmail(), user.getFullName(), role);
        }
    }
}

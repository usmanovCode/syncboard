package com.syncboard.board;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.board.BoardDtos.BoardDetailResponse;
import com.syncboard.board.BoardDtos.BoardRequest;
import com.syncboard.board.BoardDtos.BoardResponse;
import com.syncboard.board.BoardDtos.CanvasResponse;
import com.syncboard.board.BoardDtos.CanvasSaveRequest;
import com.syncboard.board.BoardDtos.CanvasSaveResponse;
import com.syncboard.common.ApiException;
import com.syncboard.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BoardService {

    /** Upper bound for one canvas document, as serialized JSON. */
    static final int MAX_CANVAS_BYTES = 2 * 1024 * 1024;

    private final BoardRepository boards;
    private final BoardCanvasRepository canvases;
    private final UserRepository users;
    private final ObjectMapper json;

    public BoardService(
            BoardRepository boards, BoardCanvasRepository canvases, UserRepository users, ObjectMapper json) {
        this.boards = boards;
        this.canvases = canvases;
        this.users = users;
        this.json = json;
    }

    @Transactional(readOnly = true)
    public List<BoardResponse> list(long userId) {
        return boards.findDashboardBoards(userId).stream().map(BoardResponse::from).toList();
    }

    @Transactional
    public BoardResponse create(long userId, BoardRequest request) {
        // A valid token can outlive its user; fail like /api/auth/me instead of hitting the FK.
        if (!users.existsById(userId)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "error.userNotFound");
        }
        Board board = boards.saveAndFlush(new Board(userId, request.name().trim()));
        canvases.saveAndFlush(new BoardCanvas(board.getId()));
        return BoardResponse.from(board);
    }

    @Transactional(readOnly = true)
    public BoardDetailResponse get(long userId, long boardId) {
        Board board = findAccessible(userId, boardId);
        BoardCanvas canvas = canvases.findById(boardId).orElseThrow(BoardService::boardNotFound);
        return new BoardDetailResponse(BoardResponse.from(board), CanvasResponse.from(canvas));
    }

    @Transactional
    public BoardResponse rename(long userId, long boardId, BoardRequest request) {
        Board board = findOwned(userId, boardId);
        board.rename(request.name().trim());
        return BoardResponse.from(boards.saveAndFlush(board));
    }

    @Transactional
    public void delete(long userId, long boardId) {
        boards.delete(findOwned(userId, boardId)); // the canvas goes with it (ON DELETE CASCADE)
    }

    /**
     * Replaces the whole drawing. The request names the version it was based on; if another save
     * happened since, nothing is written and the client gets 409 CANVAS_CONFLICT.
     */
    @Transactional
    public CanvasSaveResponse saveCanvas(long userId, long boardId, CanvasSaveRequest request) {
        findAccessible(userId, boardId);
        String content = serializeValidCanvas(request.content());
        // Postgres keeps microseconds; truncate so the returned timestamp equals the stored one.
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (canvases.saveIfVersionMatches(boardId, request.version(), content, now) == 0) {
            throw new ApiException(HttpStatus.CONFLICT, "CANVAS_CONFLICT", "error.canvasConflict");
        }
        boards.touch(boardId, now);
        return new CanvasSaveResponse(request.version() + 1, now);
    }

    /** The backend doesn't interpret shapes, but the document must have the frontend's top-level shape. */
    private String serializeValidCanvas(JsonNode content) {
        if (!content.isObject() || !content.path("schemaVersion").isInt() || !content.path("shapes").isArray()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CANVAS", "error.invalidCanvas");
        }
        String serialized;
        try {
            serialized = json.writeValueAsString(content);
        } catch (JsonProcessingException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CANVAS", "error.invalidCanvas");
        }
        if (serialized.getBytes(StandardCharsets.UTF_8).length > MAX_CANVAS_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "CANVAS_TOO_LARGE", "error.canvasTooLarge");
        }
        return serialized;
    }

    /**
     * Boards the user may open and draw on. Only the owner for now; board_members will extend this
     * (and may split it into view vs. edit access).
     */
    private Board findAccessible(long userId, long boardId) {
        return boards.findByIdAndOwnerId(boardId, userId).orElseThrow(BoardService::boardNotFound);
    }

    /**
     * Rename and delete are owner-only, also once sharing exists. Someone else's board gets the same
     * 404 as a missing one, so ids of other users' boards are not revealed.
     */
    private Board findOwned(long userId, long boardId) {
        return boards.findByIdAndOwnerId(boardId, userId).orElseThrow(BoardService::boardNotFound);
    }

    private static ApiException boardNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "BOARD_NOT_FOUND", "error.boardNotFound");
    }
}

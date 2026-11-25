package com.syncboard.board;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.board.BoardAccessService.Access;
import com.syncboard.board.BoardDtos.BoardDetailResponse;
import com.syncboard.board.BoardDtos.BoardRequest;
import com.syncboard.board.BoardDtos.BoardResponse;
import com.syncboard.board.BoardDtos.CanvasResponse;
import com.syncboard.board.BoardDtos.CanvasSaveRequest;
import com.syncboard.board.BoardDtos.CanvasSaveResponse;
import com.syncboard.common.ApiException;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BoardService {

    /** Upper bound for one canvas document, as serialized JSON. */
    static final int MAX_CANVAS_BYTES = 2 * 1024 * 1024;

    private final BoardRepository boards;
    private final BoardCanvasRepository canvases;
    private final BoardMemberRepository members;
    private final BoardAccessService access;
    private final UserRepository users;
    private final ObjectMapper json;

    public BoardService(BoardRepository boards, BoardCanvasRepository canvases, BoardMemberRepository members,
            BoardAccessService access, UserRepository users, ObjectMapper json) {
        this.boards = boards;
        this.canvases = canvases;
        this.members = members;
        this.access = access;
        this.users = users;
        this.json = json;
    }

    /** Owned and shared boards, each with the caller's role and the owner's name. */
    @Transactional(readOnly = true)
    public List<BoardResponse> list(long userId) {
        List<Board> list = boards.findDashboardBoards(userId);
        Map<Long, BoardRole> sharedRoles = members.findAllByUserId(userId).stream()
                .collect(Collectors.toMap(BoardMember::getBoardId, BoardMember::getRole));
        Map<Long, String> ownerNames = users.findAllById(list.stream().map(Board::getOwnerId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, User::getFullName));
        return list.stream()
                .map(board -> BoardResponse.from(board,
                        board.getOwnerId() == userId ? BoardRole.OWNER : sharedRoles.get(board.getId()),
                        ownerNames.get(board.getOwnerId())))
                .toList();
    }

    @Transactional
    public BoardResponse create(long userId, BoardRequest request) {
        // A valid token can outlive its user; fail like /api/auth/me instead of hitting the FK.
        User owner = users.findById(userId).orElseThrow(
                () -> new ApiException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "error.userNotFound"));
        Board board = boards.saveAndFlush(new Board(userId, request.name().trim()));
        canvases.saveAndFlush(new BoardCanvas(board.getId()));
        return BoardResponse.from(board, BoardRole.OWNER, owner.getFullName());
    }

    @Transactional(readOnly = true)
    public BoardDetailResponse get(long userId, long boardId) {
        Access a = access.requireView(userId, boardId);
        BoardCanvas canvas = canvases.findById(boardId).orElseThrow(BoardAccessService::boardNotFound);
        return new BoardDetailResponse(response(a), CanvasResponse.from(canvas));
    }

    @Transactional
    public BoardResponse rename(long userId, long boardId, BoardRequest request) {
        Access a = access.requireOwner(userId, boardId);
        a.board().rename(request.name().trim());
        return response(new Access(boards.saveAndFlush(a.board()), a.role()));
    }

    @Transactional
    public void delete(long userId, long boardId) {
        // The canvas and memberships go with it (ON DELETE CASCADE).
        boards.delete(access.requireOwner(userId, boardId).board());
    }

    /**
     * Replaces the whole drawing. The request names the version it was based on; if another save
     * happened since, nothing is written and the client gets 409 CANVAS_CONFLICT.
     */
    @Transactional
    public CanvasSaveResponse saveCanvas(long userId, long boardId, CanvasSaveRequest request) {
        access.requireEdit(userId, boardId);
        String content = serializeValidCanvas(request.content());
        // Postgres keeps microseconds; truncate so the returned timestamp equals the stored one.
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (canvases.saveIfVersionMatches(boardId, request.version(), content, now) == 0) {
            throw new ApiException(HttpStatus.CONFLICT, "CANVAS_CONFLICT", "error.canvasConflict");
        }
        boards.touch(boardId, now);
        return new CanvasSaveResponse(request.version() + 1, now);
    }

    private BoardResponse response(Access a) {
        String ownerName = users.findById(a.board().getOwnerId()).map(User::getFullName).orElse(null);
        return BoardResponse.from(a.board(), a.role(), ownerName);
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
}

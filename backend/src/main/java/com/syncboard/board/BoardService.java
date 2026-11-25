package com.syncboard.board;

import com.syncboard.board.BoardAccessService.Access;
import com.syncboard.board.BoardDtos.BoardDetailResponse;
import com.syncboard.board.BoardDtos.BoardRequest;
import com.syncboard.board.BoardDtos.BoardResponse;
import com.syncboard.board.BoardDtos.CanvasResponse;
import com.syncboard.common.ApiException;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BoardService {

    private final BoardRepository boards;
    private final BoardCanvasRepository canvases;
    private final BoardMemberRepository members;
    private final BoardAccessService access;
    private final UserRepository users;

    /** The drawing itself is changed only through the realtime rooms (com.syncboard.realtime). */
    public BoardService(BoardRepository boards, BoardCanvasRepository canvases, BoardMemberRepository members,
            BoardAccessService access, UserRepository users) {
        this.boards = boards;
        this.canvases = canvases;
        this.members = members;
        this.access = access;
        this.users = users;
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

    private BoardResponse response(Access a) {
        String ownerName = users.findById(a.board().getOwnerId()).map(User::getFullName).orElse(null);
        return BoardResponse.from(a.board(), a.role(), ownerName);
    }
}

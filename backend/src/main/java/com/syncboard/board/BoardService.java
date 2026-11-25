package com.syncboard.board;

import com.syncboard.board.BoardDtos.BoardRequest;
import com.syncboard.board.BoardDtos.BoardResponse;
import com.syncboard.common.ApiException;
import com.syncboard.user.UserRepository;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BoardService {

    private final BoardRepository boards;
    private final UserRepository users;

    public BoardService(BoardRepository boards, UserRepository users) {
        this.boards = boards;
        this.users = users;
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
        return BoardResponse.from(boards.saveAndFlush(new Board(userId, request.name().trim())));
    }

    @Transactional
    public BoardResponse rename(long userId, long boardId, BoardRequest request) {
        Board board = findOwned(userId, boardId);
        board.rename(request.name().trim());
        return BoardResponse.from(boards.saveAndFlush(board));
    }

    @Transactional
    public void delete(long userId, long boardId) {
        boards.delete(findOwned(userId, boardId));
    }

    /**
     * Rename and delete are owner-only, also once sharing exists. Someone else's board gets the same
     * 404 as a missing one, so ids of other users' boards are not revealed.
     */
    private Board findOwned(long userId, long boardId) {
        return boards.findByIdAndOwnerId(boardId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOARD_NOT_FOUND", "error.boardNotFound"));
    }
}

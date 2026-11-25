package com.syncboard.board;

import com.syncboard.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The single place that decides who may do what on a board (REST and, later, WebSocket).
 * Users without any access get the same 404 as for a missing board, so board ids are not revealed;
 * users who can see the board but lack the role get 403.
 */
@Service
public class BoardAccessService {

    /** A board together with the caller's role on it. */
    public record Access(Board board, BoardRole role) {
    }

    private final BoardRepository boards;
    private final BoardMemberRepository members;

    public BoardAccessService(BoardRepository boards, BoardMemberRepository members) {
        this.boards = boards;
        this.members = members;
    }

    /** Any role: owner, editor or viewer. */
    @Transactional(readOnly = true)
    public Access requireView(long userId, long boardId) {
        Board board = boards.findById(boardId).orElseThrow(BoardAccessService::boardNotFound);
        if (board.getOwnerId() == userId) {
            return new Access(board, BoardRole.OWNER);
        }
        return members.findById(new BoardMember.Key(boardId, userId))
                .map(member -> new Access(board, member.getRole()))
                .orElseThrow(BoardAccessService::boardNotFound);
    }

    /** Owner or editor: may change the drawing. */
    @Transactional(readOnly = true)
    public Access requireEdit(long userId, long boardId) {
        Access access = requireView(userId, boardId);
        if (!access.role().canEdit()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "READ_ONLY_BOARD", "error.readOnlyBoard");
        }
        return access;
    }

    /** Owner only: rename, delete, manage members. */
    @Transactional(readOnly = true)
    public Access requireOwner(long userId, long boardId) {
        Access access = requireView(userId, boardId);
        if (access.role() != BoardRole.OWNER) {
            throw new ApiException(HttpStatus.FORBIDDEN, "NOT_BOARD_OWNER", "error.notBoardOwner");
        }
        return access;
    }

    public static ApiException boardNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "BOARD_NOT_FOUND", "error.boardNotFound");
    }
}

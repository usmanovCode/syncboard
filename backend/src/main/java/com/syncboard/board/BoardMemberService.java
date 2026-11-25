package com.syncboard.board;

import com.syncboard.auth.AuthService;
import com.syncboard.board.BoardDtos.AddMemberRequest;
import com.syncboard.board.BoardDtos.MemberResponse;
import com.syncboard.common.ApiException;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sharing a board. Only the owner manages members; any member may see who has access and may
 * leave the board. Inviting is by email of an existing account (there are no pending invitations).
 */
@Service
public class BoardMemberService {

    private final BoardMemberRepository members;
    private final BoardAccessService access;
    private final UserRepository users;

    public BoardMemberService(BoardMemberRepository members, BoardAccessService access, UserRepository users) {
        this.members = members;
        this.access = access;
        this.users = users;
    }

    /** The owner first, then members in the order they were added. */
    @Transactional(readOnly = true)
    public List<MemberResponse> list(long userId, long boardId) {
        Board board = access.requireView(userId, boardId).board();
        List<BoardMember> shared = members.findAllByBoardIdOrderByCreatedAtAsc(boardId);
        List<Long> ids = new ArrayList<>(List.of(board.getOwnerId()));
        shared.forEach(m -> ids.add(m.getUserId()));
        Map<Long, User> byId = users.findAllById(ids).stream().collect(Collectors.toMap(User::getId, Function.identity()));

        List<MemberResponse> result = new ArrayList<>();
        result.add(MemberResponse.from(byId.get(board.getOwnerId()), BoardRole.OWNER));
        shared.forEach(m -> result.add(MemberResponse.from(byId.get(m.getUserId()), m.getRole())));
        return result;
    }

    @Transactional
    public MemberResponse add(long userId, long boardId, AddMemberRequest request) {
        Board board = access.requireOwner(userId, boardId).board();
        requireMemberRole(request.role());
        User user = users.findByEmail(AuthService.normalizeEmail(request.email())).orElseThrow(
                () -> new ApiException(HttpStatus.NOT_FOUND, "MEMBER_USER_NOT_FOUND", "error.memberUserNotFound"));
        if (user.getId().equals(board.getOwnerId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CANNOT_SHARE_WITH_OWNER", "error.cannotShareWithOwner");
        }
        if (members.existsById(new BoardMember.Key(boardId, user.getId()))) {
            throw new ApiException(HttpStatus.CONFLICT, "ALREADY_MEMBER", "error.alreadyMember");
        }
        members.saveAndFlush(new BoardMember(boardId, user.getId(), request.role()));
        return MemberResponse.from(user, request.role());
    }

    @Transactional
    public MemberResponse changeRole(long userId, long boardId, long memberId, BoardRole role) {
        access.requireOwner(userId, boardId);
        requireMemberRole(role);
        BoardMember member = findMember(boardId, memberId);
        member.changeRole(role);
        members.saveAndFlush(member);
        return MemberResponse.from(users.getReferenceById(memberId), role);
    }

    /** The owner removes anyone; a member may remove themselves (leave the board). */
    @Transactional
    public void remove(long userId, long boardId, long memberId) {
        if (userId == memberId) {
            access.requireView(userId, boardId);
        } else {
            access.requireOwner(userId, boardId);
        }
        members.delete(findMember(boardId, memberId));
    }

    private BoardMember findMember(long boardId, long memberId) {
        return members.findById(new BoardMember.Key(boardId, memberId)).orElseThrow(
                () -> new ApiException(HttpStatus.NOT_FOUND, "MEMBER_NOT_FOUND", "error.memberNotFound"));
    }

    private static void requireMemberRole(BoardRole role) {
        if (!role.isMemberRole()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ROLE", "error.invalidRole");
        }
    }
}

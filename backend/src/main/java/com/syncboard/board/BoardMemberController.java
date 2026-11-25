package com.syncboard.board;

import com.syncboard.board.BoardDtos.AddMemberRequest;
import com.syncboard.board.BoardDtos.ChangeRoleRequest;
import com.syncboard.board.BoardDtos.MemberResponse;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/boards/{boardId}/members")
public class BoardMemberController {

    private final BoardMemberService memberService;

    public BoardMemberController(BoardMemberService memberService) {
        this.memberService = memberService;
    }

    @GetMapping
    public List<MemberResponse> list(@AuthenticationPrincipal Jwt jwt, @PathVariable long boardId) {
        return memberService.list(userId(jwt), boardId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public MemberResponse add(
            @AuthenticationPrincipal Jwt jwt, @PathVariable long boardId, @Valid @RequestBody AddMemberRequest request) {
        return memberService.add(userId(jwt), boardId, request);
    }

    @PatchMapping("/{memberId}")
    public MemberResponse changeRole(@AuthenticationPrincipal Jwt jwt, @PathVariable long boardId,
            @PathVariable long memberId, @Valid @RequestBody ChangeRoleRequest request) {
        return memberService.changeRole(userId(jwt), boardId, memberId, request.role());
    }

    @DeleteMapping("/{memberId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@AuthenticationPrincipal Jwt jwt, @PathVariable long boardId, @PathVariable long memberId) {
        memberService.remove(userId(jwt), boardId, memberId);
    }

    private static long userId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}

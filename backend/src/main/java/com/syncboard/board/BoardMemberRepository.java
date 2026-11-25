package com.syncboard.board;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BoardMemberRepository extends JpaRepository<BoardMember, BoardMember.Key> {

    List<BoardMember> findAllByBoardIdOrderByCreatedAtAsc(Long boardId);

    List<BoardMember> findAllByUserId(Long userId);
}

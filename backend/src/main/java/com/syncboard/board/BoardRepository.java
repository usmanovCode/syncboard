package com.syncboard.board;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BoardRepository extends JpaRepository<Board, Long> {

    /** Boards on the user's dashboard (owned or shared with them), most recently changed first. */
    @Query("""
            select b from Board b
             where b.ownerId = :userId
                or exists (select 1 from BoardMember m where m.boardId = b.id and m.userId = :userId)
             order by b.updatedAt desc, b.id desc
            """)
    List<Board> findDashboardBoards(@Param("userId") Long userId);

    /** Marks the board as changed (e.g. its canvas was saved) so it moves up on the dashboard. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update Board b set b.updatedAt = :now where b.id = :id")
    void touch(@Param("id") long id, @Param("now") Instant now);
}

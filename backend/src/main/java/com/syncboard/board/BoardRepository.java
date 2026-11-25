package com.syncboard.board;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BoardRepository extends JpaRepository<Board, Long> {

    /**
     * Boards shown on the user's dashboard, most recently changed first. Only owned boards for now;
     * when board_members exists, this query also returns boards shared with the user.
     */
    @Query("select b from Board b where b.ownerId = :userId order by b.updatedAt desc, b.id desc")
    List<Board> findDashboardBoards(@Param("userId") Long userId);

    Optional<Board> findByIdAndOwnerId(Long id, Long ownerId);

    /** Marks the board as changed (e.g. its canvas was saved) so it moves up on the dashboard. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update Board b set b.updatedAt = :now where b.id = :id")
    void touch(@Param("id") long id, @Param("now") Instant now);
}

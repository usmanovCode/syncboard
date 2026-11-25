package com.syncboard.board;

import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BoardCanvasRepository extends JpaRepository<BoardCanvas, Long> {

    /**
     * Writes the live room state (the realtime room is the only writer). {@code version} is the room's
     * op sequence number. Returns 0 if the canvas no longer exists (board deleted).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            update board_canvases
               set content = cast(:content as jsonb), version = :version, updated_at = :now
             where board_id = :boardId
            """, nativeQuery = true)
    int overwrite(
            @Param("boardId") long boardId,
            @Param("content") String content,
            @Param("version") long version,
            @Param("now") Instant now);
}

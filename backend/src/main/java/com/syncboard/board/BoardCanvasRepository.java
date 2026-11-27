package com.syncboard.board;

import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BoardCanvasRepository extends JpaRepository<BoardCanvas, Long> {

    /**
     * Writes the live room state (the realtime room is the only writer). {@code version} is the room's
     * op sequence number; an older or equal version never replaces a newer one, so instances writing
     * the same room concurrently can't go backwards. Returns 0 if nothing was written.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            update board_canvases
               set content = cast(:content as jsonb), version = :version, updated_at = :now
             where board_id = :boardId and version < :version
            """, nativeQuery = true)
    int overwrite(
            @Param("boardId") long boardId,
            @Param("content") String content,
            @Param("version") long version,
            @Param("now") Instant now);
}

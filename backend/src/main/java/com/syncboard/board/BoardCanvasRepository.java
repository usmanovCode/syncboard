package com.syncboard.board;

import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BoardCanvasRepository extends JpaRepository<BoardCanvas, Long> {

    /**
     * Compare-and-set save: writes only if the stored version is still {@code version}, and bumps it.
     * Returns the number of updated rows: 0 means someone else saved first (or the canvas is gone).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            update board_canvases
               set content = cast(:content as jsonb), version = version + 1, updated_at = :now
             where board_id = :boardId and version = :version
            """, nativeQuery = true)
    int saveIfVersionMatches(
            @Param("boardId") long boardId,
            @Param("version") int version,
            @Param("content") String content,
            @Param("now") Instant now);
}

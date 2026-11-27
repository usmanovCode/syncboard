package com.syncboard.board;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Loads and stores canvas documents for the realtime rooms. */
@Service
public class CanvasStore {

    public record StoredCanvas(String content, long version) {
    }

    private final BoardCanvasRepository canvases;
    private final BoardRepository boards;

    public CanvasStore(BoardCanvasRepository canvases, BoardRepository boards) {
        this.canvases = canvases;
        this.boards = boards;
    }

    @Transactional(readOnly = true)
    public Optional<StoredCanvas> load(long boardId) {
        return canvases.findById(boardId).map(c -> new StoredCanvas(c.getContent(), c.getVersion()));
    }

    /**
     * Saves the document and bumps the board on the dashboard, unless a newer version is already stored.
     * False if the board is gone.
     */
    @Transactional
    public boolean save(long boardId, String content, long version) {
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (canvases.overwrite(boardId, content, version, now) == 0) {
            return canvases.existsById(boardId);
        }
        boards.touch(boardId, now);
        return true;
    }
}

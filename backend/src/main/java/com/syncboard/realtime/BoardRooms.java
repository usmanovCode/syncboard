package com.syncboard.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.syncboard.board.BoardAccessService;
import com.syncboard.board.CanvasStore;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Live board rooms, loaded from the database on first use and written back periodically, when the
 * last user leaves, and on shutdown. In memory: one backend instance only (see {@link WebSocketConfig}).
 * <p>
 * Locking: the rooms map is guarded by {@code this}; each room by itself. Ops are applied and
 * broadcast while holding the room's lock, so seq order equals publish order.
 */
@Component
public class BoardRooms {

    private static final Logger log = LoggerFactory.getLogger(BoardRooms.class);

    /** The state a joining client starts from. */
    public record Snapshot(ArrayNode shapes, long seq) {
    }

    private final CanvasStore store;
    private final ObjectMapper json;
    private final Map<Long, BoardRoom> rooms = new HashMap<>();

    public BoardRooms(CanvasStore store, ObjectMapper json) {
        this.store = store;
        this.json = json;
    }

    public Snapshot snapshot(long boardId) {
        while (true) {
            BoardRoom room = room(boardId);
            synchronized (room) {
                if (!room.closed) {
                    return new Snapshot(room.snapshot(), room.seq());
                }
            }
        }
    }

    /**
     * Validates and applies an op, then hands its seq and normalized form to {@code broadcast} (still
     * under the room lock, so broadcasts leave in seq order).
     */
    public void apply(long boardId, BoardOp op, BiConsumer<Long, BoardOp> broadcast) {
        BoardOp valid = BoardOp.validate(op);
        while (true) {
            BoardRoom room = room(boardId);
            synchronized (room) {
                if (room.closed) {
                    continue; // evicted meanwhile: retry on a freshly loaded room
                }
                broadcast.accept(room.apply(valid), valid);
                return;
            }
        }
    }

    /** Writes the room back and forgets it (nobody is on the board any more). */
    public void close(long boardId) {
        BoardRoom room;
        synchronized (this) {
            room = rooms.remove(boardId);
        }
        if (room != null) {
            synchronized (room) {
                room.closed = true;
                persist(room);
            }
        }
    }

    @Scheduled(fixedDelayString = "${app.realtime.flush-interval:PT2S}")
    public void flushDirtyRooms() {
        for (BoardRoom room : openRooms()) {
            synchronized (room) {
                if (!room.closed && room.isDirty()) {
                    persist(room);
                }
            }
        }
    }

    @PreDestroy
    public void flushAll() {
        flushDirtyRooms();
    }

    private synchronized BoardRoom room(long boardId) {
        return rooms.computeIfAbsent(boardId, this::load);
    }

    private synchronized List<BoardRoom> openRooms() {
        return new ArrayList<>(rooms.values());
    }

    private BoardRoom load(long boardId) {
        CanvasStore.StoredCanvas stored = store.load(boardId).orElseThrow(BoardAccessService::boardNotFound);
        JsonNode shapes = null;
        try {
            shapes = json.readTree(stored.content()).get("shapes");
        } catch (JsonProcessingException e) {
            log.warn("Unreadable canvas for board {}; starting empty", boardId, e);
        }
        return new BoardRoom(boardId, shapes, stored.version());
    }

    /** Caller holds the room lock. */
    private void persist(BoardRoom room) {
        if (!room.isDirty()) {
            return;
        }
        ObjectNode document = json.createObjectNode().put("schemaVersion", 1);
        document.set("shapes", room.snapshot());
        long seq = room.seq();
        try {
            if (store.save(room.boardId, json.writeValueAsString(document), seq)) {
                room.markPersisted(seq);
            } else {
                // The board was deleted: drop the room so nothing keeps writing to it.
                room.closed = true;
                synchronized (this) {
                    rooms.remove(room.boardId, room);
                }
            }
        } catch (JsonProcessingException | RuntimeException e) {
            log.error("Saving canvas of board {} failed; will retry", room.boardId, e);
        }
    }
}

package com.syncboard.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.syncboard.board.BoardAccessService;
import com.syncboard.board.CanvasStore;
import com.syncboard.common.ApiException;
import com.syncboard.realtime.RealtimeDtos.OpBroadcast;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Live board rooms, shared by all backend instances through Redis (layout in {@link RealtimeKeys}, rules
 * in {@link RedisScripts}). A room is loaded from the database on first use and written back
 * periodically, when the last user leaves (on any instance), and on shutdown. Idle rooms are evicted
 * from Redis once they are saved.
 * <p>
 * Ops are numbered and published by one Lua script, so seq order is the order everyone receives them in,
 * whichever instance the sender is connected to.
 */
@Component
public class BoardRooms {

    private static final Logger log = LoggerFactory.getLogger(BoardRooms.class);

    /** Keeps a single board's document (and every snapshot sent on join) bounded. */
    static final int MAX_SHAPES = 5_000;

    /** How long an evicted room's seq blocks loading an older copy (see {@link RedisScripts#LOAD}). */
    private static final Duration EVICTED_FLOOR_TTL = Duration.ofMinutes(1);
    /** Upper bound for one database write; the lock is released as soon as it's done. */
    private static final Duration FLUSH_LOCK_TTL = Duration.ofSeconds(30);
    private static final int MAX_LOAD_ATTEMPTS = 5;
    /** Closing waits briefly for a flush in progress (up to ~0.5 s) instead of leaving it to the next one. */
    private static final int CLOSE_LOCK_ATTEMPTS = 10;

    /** The state a joining client starts from. */
    public record Snapshot(ArrayNode shapes, long seq) {
    }

    private final CanvasStore store;
    private final ObjectMapper json;
    private final StringRedisTemplate redis;
    private final RealtimeKeys keys;
    private final RealtimeBus bus;

    public BoardRooms(CanvasStore store, ObjectMapper json, StringRedisTemplate redis, RealtimeKeys keys,
            RealtimeBus bus) {
        this.store = store;
        this.json = json;
        this.redis = redis;
        this.keys = keys;
        this.bus = bus;
    }

    public Snapshot snapshot(long boardId) {
        for (int attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
            List<String> room = redis.execute(RedisScripts.SNAPSHOT, keys.room(boardId));
            if (isLoaded(room)) {
                ArrayNode shapes = json.createArrayNode();
                for (String shape : room.subList(2, room.size())) {
                    shapes.add(parse(shape));
                }
                return new Snapshot(shapes, Long.parseLong(room.get(0)));
            }
            load(boardId);
        }
        throw new IllegalStateException("Board " + boardId + " could not be loaded");
    }

    /**
     * Validates and applies an op, and broadcasts it to {@code /topic/boards/{id}/ops} on every instance
     * as an {@link OpBroadcast} with its seq.
     */
    public void apply(long boardId, BoardOp op, long userId, String clientOpId) {
        BoardOp valid = BoardOp.validate(op);
        String broadcast = bus.toJson(new OpBroadcast(userId, clientOpId, valid));
        String shape = valid.shape() == null ? "" : valid.shape().toString();
        String channel = keys.channel("/topic/boards/" + boardId + "/ops");
        for (int attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
            long seq = redis.execute(RedisScripts.APPLY, keys.room(boardId), valid.type(), valid.targetId(), shape,
                    Integer.toString(MAX_SHAPES), channel, broadcast);
            if (seq == RedisScripts.TOO_LARGE) {
                throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "CANVAS_TOO_LARGE", "error.canvasTooLarge");
            }
            if (seq != RedisScripts.NOT_LOADED) {
                return;
            }
            load(boardId);
        }
        throw new IllegalStateException("Board " + boardId + " could not be loaded");
    }

    /** Nobody is on the board any more: write it back now and forget it. */
    public void close(long boardId) {
        persist(boardId, true, CLOSE_LOCK_ATTEMPTS);
    }

    /** Saves changed rooms, and saves and evicts rooms nobody has open (e.g. left over by a crash). */
    @Scheduled(fixedDelayString = "${app.realtime.flush-interval:PT2S}")
    public void flushDirtyRooms() {
        Set<String> boardIds = redis.opsForSet().members(keys.rooms());
        if (boardIds == null) {
            return;
        }
        for (String id : boardIds) {
            long boardId = Long.parseLong(id);
            Long online = redis.opsForZSet().zCard(keys.board(boardId, "presence"));
            persist(boardId, online == null || online == 0, 1);
        }
    }

    @PreDestroy
    public void flushAll() {
        flushDirtyRooms();
    }

    private void load(long boardId) {
        CanvasStore.StoredCanvas stored = store.load(boardId).orElseThrow(BoardAccessService::boardNotFound);
        List<String> args = new ArrayList<>();
        args.add(Long.toString(boardId));
        args.add(Long.toString(stored.version()));
        try {
            JsonNode shapes = json.readTree(stored.content()).get("shapes");
            if (shapes != null && shapes.isArray()) {
                for (JsonNode shape : shapes) {
                    if (shape.isObject() && shape.path("id").isTextual()) {
                        args.add(shape.get("id").asText());
                        args.add(shape.toString());
                    }
                }
            }
        } catch (JsonProcessingException e) {
            log.warn("Unreadable canvas for board {}; starting empty", boardId, e);
        }
        // NOT_LOADED here means the copy was older than a room that was just evicted: the caller retries.
        redis.execute(RedisScripts.LOAD, keys.room(boardId), args.toArray());
    }

    /**
     * Writes the room to the database if it changed, then evicts it if asked and no op arrived meanwhile.
     * Skipped if another flush of it (on any instance) is still running after {@code lockAttempts} tries;
     * the next periodic flush catches up.
     */
    private void persist(long boardId, boolean evict, int lockAttempts) {
        String lock = keys.board(boardId, "flushing");
        if (!lock(lock, lockAttempts)) {
            return;
        }
        try {
            List<String> room = redis.execute(RedisScripts.SNAPSHOT, keys.room(boardId));
            if (!isLoaded(room)) {
                redis.opsForSet().remove(keys.rooms(), Long.toString(boardId));
                return;
            }
            String seq = room.get(0);
            if (!seq.equals(room.get(1))) {
                String document = "{\"schemaVersion\":1,\"shapes\":[" + String.join(",", room.subList(2, room.size()))
                        + "]}";
                if (!store.save(boardId, document, Long.parseLong(seq))) {
                    // The board was deleted: drop the room so nothing keeps writing to it.
                    evict(boardId, "");
                    return;
                }
                redis.execute(RedisScripts.MARK_PERSISTED, keys.room(boardId), seq);
            }
            if (evict) {
                evict(boardId, seq);
            }
        } catch (RuntimeException e) {
            log.error("Saving canvas of board {} failed; will retry", boardId, e);
        } finally {
            redis.delete(lock);
        }
    }

    private boolean lock(String lock, int attempts) {
        for (int i = 0; i < attempts; i++) {
            if (Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lock, keys.instanceId(), FLUSH_LOCK_TTL))) {
                return true;
            }
            if (i + 1 < attempts) {
                try {
                    Thread.sleep(50);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
        }
        return false;
    }

    private void evict(long boardId, String expectedSeq) {
        redis.execute(RedisScripts.EVICT, keys.room(boardId), Long.toString(boardId), expectedSeq,
                Long.toString(EVICTED_FLOOR_TTL.toMillis()));
    }

    /** A {@link RedisScripts#SNAPSHOT} result of a loaded room. */
    private static boolean isLoaded(List<String> room) {
        return room != null && room.size() >= 2;
    }

    private JsonNode parse(String shape) {
        try {
            return json.readTree(shape);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}

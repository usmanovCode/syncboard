package com.syncboard.realtime;

import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Names of the Redis keys and Pub/Sub channels shared by all backend instances, and the identity of
 * this instance. Every name starts with {@code app.realtime.redis-prefix}.
 * <p>
 * Per board ({@code <prefix>:board:<id>:...}):
 * <ul>
 *   <li>{@code room} hash: {@code seq} (last op), {@code persisted} (seq stored in Postgres), {@code next}
 *       (z-order counter). Exists while the room is loaded.</li>
 *   <li>{@code shapes} hash: shape id → shape JSON; {@code order} sorted set: shape id → z-order.</li>
 *   <li>{@code floor}: the seq of a room that was just evicted, so a slow instance can't load an older
 *       copy from the database (expires after a minute).</li>
 *   <li>{@code flushing}: short lock, so only one instance writes a room to the database at a time.</li>
 *   <li>{@code presence} sorted set: session key → join order; {@code entries} hash: session key →
 *       {@code "<userId>\n<online user JSON>"}.</li>
 * </ul>
 * Global: {@code rooms} (set of loaded board ids), {@code instances} (set of instance ids),
 * {@code instance:<id>:alive} (heartbeat with a TTL), {@code instance:<id>:sessions} (set of
 * {@code "<boardId> <session key>"}), {@code join-order} (counter).
 * <p>
 * Channels: {@code <prefix>:ws:<destination>}, e.g. {@code syncboard:ws:/topic/boards/5/ops}.
 */
@Component
public class RealtimeKeys {

    private final String prefix;
    private final String instanceId = UUID.randomUUID().toString().substring(0, 8);

    public RealtimeKeys(@Value("${app.realtime.redis-prefix:syncboard}") String prefix) {
        this.prefix = prefix;
    }

    /** Random per process start: STOMP session ids are only unique within one instance. */
    public String instanceId() {
        return instanceId;
    }

    /** Identifies a STOMP session across instances. */
    public String sessionKey(String sessionId) {
        return instanceId + ":" + sessionId;
    }

    String channel(String destination) {
        return channelPrefix() + destination;
    }

    String channelPrefix() {
        return prefix + ":ws:";
    }

    String board(long boardId, String part) {
        return prefix + ":board:" + boardId + ":" + part;
    }

    /** The keys of a board's drawing, in the order the room scripts expect. */
    List<String> room(long boardId) {
        return List.of(board(boardId, "room"), board(boardId, "shapes"), board(boardId, "order"), rooms(),
                board(boardId, "floor"));
    }

    /** The keys of a board's online list, in the order the presence scripts expect. */
    List<String> presence(long boardId, String instanceId) {
        return List.of(board(boardId, "presence"), board(boardId, "entries"), instanceSessions(instanceId),
                prefix + ":join-order");
    }

    String rooms() {
        return prefix + ":rooms";
    }

    String instances() {
        return prefix + ":instances";
    }

    String instanceAlive(String instanceId) {
        return prefix + ":instance:" + instanceId + ":alive";
    }

    String instanceSessions(String instanceId) {
        return prefix + ":instance:" + instanceId + ":sessions";
    }
}

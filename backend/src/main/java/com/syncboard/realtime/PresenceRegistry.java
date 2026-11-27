package com.syncboard.realtime;

import com.syncboard.board.BoardRole;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Which board each STOMP session <em>of this instance</em> has joined, plus per-session rate limits. A
 * session lives on one instance, so this stays in memory; the online lists across all instances are in
 * Redis ({@link ClusterPresence}). Methods are synchronized: traffic is small and correctness simple.
 */
@Component
public class PresenceRegistry {

    /** Cursor colors: distinct from each other and readable on white. */
    static final List<String> COLORS = List.of(
            "#e11d48", "#d97706", "#16a34a", "#0891b2", "#2563eb",
            "#7c3aed", "#c026d3", "#db2777", "#059669", "#ea580c");

    /** A session of this instance that has joined a board. */
    public record LocalSession(String sessionId, long boardId, BoardPrincipal user, BoardRole role) {
    }

    private record Entry(BoardPrincipal user, BoardRole role) {
    }

    /** Cursor updates closer together than this are dropped (clients send at most ~20/s). */
    static final long MIN_CURSOR_INTERVAL_MS = 30;

    /** "Typing" updates closer together than this are dropped (clients repeat it every few seconds). */
    static final long MIN_TYPING_INTERVAL_MS = 1000;

    /** sessionId -> (boardId -> entry). */
    private final Map<String, Map<Long, Entry>> sessions = new LinkedHashMap<>();
    private final Map<String, Long> lastCursorAt = new HashMap<>();
    private final Map<String, Long> lastTypingAt = new HashMap<>();

    /** The same user always gets the same color, on every board and in every tab. */
    public static String colorOf(long userId) {
        return COLORS.get(Math.floorMod(Long.hashCode(userId * 0x9E3779B97F4A7C15L), COLORS.size()));
    }

    /** Records that the session has joined the board. */
    public synchronized void join(String sessionId, long boardId, BoardPrincipal user, BoardRole role) {
        sessions.computeIfAbsent(sessionId, id -> new HashMap<>()).put(boardId, new Entry(user, role));
    }

    /** Removes the session everywhere and returns the boards it was on. */
    public synchronized Set<Long> leaveAll(String sessionId) {
        lastCursorAt.remove(sessionId);
        lastTypingAt.remove(sessionId);
        Map<Long, Entry> boards = sessions.remove(sessionId);
        return boards == null ? Set.of() : Set.copyOf(boards.keySet());
    }

    /**
     * Whether a cursor update from this session should be relayed: the session must be on the board
     * and not sending faster than {@link #MIN_CURSOR_INTERVAL_MS}.
     */
    public synchronized boolean acceptCursor(String sessionId, long boardId, long nowMillis) {
        if (!isJoined(sessionId, boardId)) {
            return false;
        }
        Long last = lastCursorAt.get(sessionId);
        if (last != null && nowMillis - last < MIN_CURSOR_INTERVAL_MS) {
            return false;
        }
        lastCursorAt.put(sessionId, nowMillis);
        return true;
    }

    /**
     * Whether a "typing" update from this session should be relayed: the session must be on the board
     * and not repeating it faster than {@link #MIN_TYPING_INTERVAL_MS}.
     */
    public synchronized boolean acceptTyping(String sessionId, long boardId, long nowMillis) {
        if (!isJoined(sessionId, boardId)) {
            return false;
        }
        Long last = lastTypingAt.get(sessionId);
        if (last != null && nowMillis - last < MIN_TYPING_INTERVAL_MS) {
            return false;
        }
        lastTypingAt.put(sessionId, nowMillis);
        return true;
    }

    /** Ends a "typing" burst, so the next start is relayed at once. */
    public synchronized void stopTyping(String sessionId) {
        lastTypingAt.remove(sessionId);
    }

    /**
     * Identifies one tab's cursor to other clients (a user with two tabs has two cursors). Derived from
     * the session key ({@link RealtimeKeys#sessionKey}, unique across instances) so it is stable for the
     * connection, without exposing the key itself.
     */
    public static String cursorId(String sessionKey) {
        return Integer.toHexString(sessionKey.hashCode());
    }

    public synchronized boolean isJoined(String sessionId, long boardId) {
        return sessions.getOrDefault(sessionId, Map.of()).containsKey(boardId);
    }

    /** Every joined board of every session of this instance. */
    public synchronized List<LocalSession> localSessions() {
        List<LocalSession> out = new ArrayList<>();
        sessions.forEach((sessionId, boards) -> boards.forEach(
                (boardId, entry) -> out.add(new LocalSession(sessionId, boardId, entry.user(), entry.role()))));
        return out;
    }
}

package com.syncboard.realtime;

import com.syncboard.board.BoardRole;
import com.syncboard.realtime.RealtimeDtos.OnlineUser;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Who has which board open, per STOMP session. In memory, so it covers this backend instance only
 * (see {@link WebSocketConfig}). Methods are synchronized: traffic is small and correctness simple.
 */
@Component
public class PresenceRegistry {

    /** Cursor colors: distinct from each other and readable on white. */
    static final List<String> COLORS = List.of(
            "#e11d48", "#d97706", "#16a34a", "#0891b2", "#2563eb",
            "#7c3aed", "#c026d3", "#db2777", "#059669", "#ea580c");

    private record Entry(BoardPrincipal user, BoardRole role) {
    }

    /** sessionId -> (boardId -> entry). Joining order is kept for a stable online list. */
    private final Map<String, Map<Long, Entry>> sessions = new LinkedHashMap<>();

    /** The same user always gets the same color, on every board and in every tab. */
    public static String colorOf(long userId) {
        return COLORS.get(Math.floorMod(Long.hashCode(userId * 0x9E3779B97F4A7C15L), COLORS.size()));
    }

    /** Registers the session on the board and returns the board's online list. */
    public synchronized List<OnlineUser> join(String sessionId, long boardId, BoardPrincipal user, BoardRole role) {
        sessions.computeIfAbsent(sessionId, id -> new HashMap<>()).put(boardId, new Entry(user, role));
        return online(boardId);
    }

    /** Removes the session everywhere and returns the boards it was on. */
    public synchronized Set<Long> leaveAll(String sessionId) {
        Map<Long, Entry> boards = sessions.remove(sessionId);
        return boards == null ? Set.of() : Set.copyOf(boards.keySet());
    }

    public synchronized boolean isJoined(String sessionId, long boardId) {
        return sessions.getOrDefault(sessionId, Map.of()).containsKey(boardId);
    }

    /** Online users of a board, one entry per user even with several tabs open. */
    public synchronized List<OnlineUser> online(long boardId) {
        Map<Long, OnlineUser> byUser = new LinkedHashMap<>();
        for (Map<Long, Entry> boards : sessions.values()) {
            Entry entry = boards.get(boardId);
            if (entry != null) {
                long userId = entry.user().userId();
                byUser.putIfAbsent(userId,
                        new OnlineUser(userId, entry.user().fullName(), colorOf(userId), entry.role()));
            }
        }
        return new ArrayList<>(byUser.values());
    }
}

package com.syncboard.realtime;

import java.util.List;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;

/**
 * Lua scripts for the shared room and presence state (key layout in {@link RealtimeKeys}). Redis runs
 * each script atomically, one at a time, which is what makes these safe across backend instances:
 * <ul>
 *   <li>ops get their seq and are published inside the same script, so every instance receives them in
 *       seq order;</li>
 *   <li>online lists are computed and published inside the script that changed them, so a stale list
 *       can never overtake a newer one.</li>
 * </ul>
 * All values are passed and returned as strings.
 */
final class RedisScripts {

    private RedisScripts() {
    }

    /** Returned by {@link #APPLY} when the room isn't loaded, and by {@link #LOAD} for a stale copy. */
    static final long NOT_LOADED = -1;
    /** Returned by {@link #APPLY} when an add would exceed the shape limit. */
    static final long TOO_LARGE = -2;

    // Room scripts. KEYS: 1 room, 2 shapes, 3 order, 4 rooms, 5 floor (RealtimeKeys#room).

    /**
     * Loads a room from the database copy unless it is already loaded. ARGV: boardId, seq, then shape
     * id and JSON pairs in z-order. Returns 1 if loaded, 0 if it already was, -1 if the copy is older
     * than a room that was just evicted (read the database again).
     */
    static final RedisScript<Long> LOAD = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
            local floor = redis.call('GET', KEYS[5])
            if floor and tonumber(ARGV[2]) < tonumber(floor) then return -1 end
            redis.call('DEL', KEYS[2], KEYS[3])
            local n = 0
            for i = 3, #ARGV, 2 do
              -- A repeated id keeps its first position and its last value.
              if redis.call('HSET', KEYS[2], ARGV[i], ARGV[i + 1]) == 1 then
                n = n + 1
                redis.call('ZADD', KEYS[3], n, ARGV[i])
              end
            end
            redis.call('HSET', KEYS[1], 'seq', ARGV[2], 'persisted', ARGV[2], 'next', n)
            redis.call('SADD', KEYS[4], ARGV[1])
            return 1
            """, Long.class);

    /**
     * Applies a validated op and publishes its broadcast. The rules must match
     * frontend/src/canvas/ops.ts {@code applyOp}: add puts the shape (an existing id is replaced in
     * place, a new one goes on top), update replaces it only if it exists (delete wins), remove deletes
     * it; every op gets the next seq, even one that changes nothing.
     * <p>
     * ARGV: type, shape id, shape JSON (empty for remove), max shapes, channel, broadcast JSON without
     * seq (an object; the script prepends {@code "seq":n}). Returns the seq, {@link #NOT_LOADED} or
     * {@link #TOO_LARGE}.
     */
    static final RedisScript<Long> APPLY = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
            local t, id = ARGV[1], ARGV[2]
            if t == 'add' then
              if redis.call('HEXISTS', KEYS[2], id) == 0 then
                if redis.call('HLEN', KEYS[2]) >= tonumber(ARGV[4]) then return -2 end
                redis.call('ZADD', KEYS[3], redis.call('HINCRBY', KEYS[1], 'next', 1), id)
              end
              redis.call('HSET', KEYS[2], id, ARGV[3])
            elseif t == 'update' then
              if redis.call('HEXISTS', KEYS[2], id) == 1 then redis.call('HSET', KEYS[2], id, ARGV[3]) end
            elseif t == 'remove' then
              redis.call('HDEL', KEYS[2], id)
              redis.call('ZREM', KEYS[3], id)
            else
              return redis.error_reply('unknown op type')
            end
            local seq = redis.call('HINCRBY', KEYS[1], 'seq', 1)
            redis.call('PUBLISH', ARGV[5], '{"seq":' .. seq .. ',' .. string.sub(ARGV[6], 2))
            return seq
            """, Long.class);

    /**
     * Returns [seq, persisted, shape JSON...] in z-order, or an empty list if the room isn't loaded (a
     * nil reply would reach Java as a list holding one null).
     */
    @SuppressWarnings({"rawtypes", "unchecked"})
    static final RedisScript<List<String>> SNAPSHOT = new DefaultRedisScript("""
            local meta = redis.call('HMGET', KEYS[1], 'seq', 'persisted')
            if not meta[1] then return {} end
            local out = {meta[1], meta[2]}
            for _, id in ipairs(redis.call('ZRANGE', KEYS[3], 0, -1)) do
              local shape = redis.call('HGET', KEYS[2], id)
              if shape then out[#out + 1] = shape end
            end
            return out
            """, List.class);

    /** Records that the database holds the room as of seq ARGV[1] (never moves backwards). */
    static final RedisScript<Long> MARK_PERSISTED = new DefaultRedisScript<>("""
            local p = redis.call('HGET', KEYS[1], 'persisted')
            if p and tonumber(p) < tonumber(ARGV[1]) then redis.call('HSET', KEYS[1], 'persisted', ARGV[1]) end
            return 0
            """, Long.class);

    /**
     * Forgets a room. ARGV: boardId, the seq it must still have (empty: unconditionally), floor TTL in
     * ms. Returns 1 if evicted (or not loaded), 0 if an op arrived meanwhile.
     */
    static final RedisScript<Long> EVICT = new DefaultRedisScript<>("""
            local seq = redis.call('HGET', KEYS[1], 'seq')
            if not seq then
              redis.call('SREM', KEYS[4], ARGV[1])
              return 1
            end
            if ARGV[2] ~= '' and seq ~= ARGV[2] then return 0 end
            redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
            redis.call('SREM', KEYS[4], ARGV[1])
            redis.call('SET', KEYS[5], seq, 'PX', ARGV[3])
            return 1
            """, Long.class);

    // Presence scripts. KEYS: 1 presence, 2 entries, 3 instance sessions, 4 join order
    // (RealtimeKeys#presence). Entries are "<userId>\n<online user JSON>".

    /** The board's online list as a JSON array: one entry per user, in join order of their first tab. */
    private static final String ONLINE = """
            local function online()
              local seen, out = {}, {}
              for _, s in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
                local e = redis.call('HGET', KEYS[2], s)
                if e then
                  local nl = string.find(e, '\\n', 1, true)
                  local uid = string.sub(e, 1, nl - 1)
                  if not seen[uid] then
                    seen[uid] = true
                    out[#out + 1] = string.sub(e, nl + 1)
                  end
                end
              end
              return '[' .. table.concat(out, ',') .. ']'
            end
            """;

    /**
     * Adds a session to the board (joining again keeps its place) and publishes the new online list.
     * ARGV: session key, entry, instance sessions member, presence channel. Returns the list.
     */
    static final RedisScript<String> JOIN = new DefaultRedisScript<>(ONLINE + """
            if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then
              redis.call('ZADD', KEYS[1], redis.call('INCR', KEYS[4]), ARGV[1])
            end
            redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
            redis.call('SADD', KEYS[3], ARGV[3])
            local list = online()
            redis.call('PUBLISH', ARGV[4], list)
            return list
            """, String.class);

    /**
     * Removes a session from the board and, if anyone is left, publishes the new online list. ARGV:
     * session key, instance sessions member, presence channel. Returns how many sessions are left.
     */
    static final RedisScript<Long> LEAVE = new DefaultRedisScript<>(ONLINE + """
            redis.call('ZREM', KEYS[1], ARGV[1])
            redis.call('HDEL', KEYS[2], ARGV[1])
            redis.call('SREM', KEYS[3], ARGV[2])
            local left = redis.call('ZCARD', KEYS[1])
            if left > 0 then redis.call('PUBLISH', ARGV[3], online()) end
            return left
            """, Long.class);

    /** Returns the online list without changing anything. */
    static final RedisScript<String> ONLINE_LIST = new DefaultRedisScript<>(ONLINE + "return online()\n",
            String.class);
}

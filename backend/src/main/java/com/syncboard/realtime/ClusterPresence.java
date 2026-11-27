package com.syncboard.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.syncboard.board.BoardRole;
import com.syncboard.realtime.PresenceRegistry.LocalSession;
import com.syncboard.realtime.RealtimeDtos.CursorBroadcast;
import com.syncboard.realtime.RealtimeDtos.OnlineUser;
import com.syncboard.realtime.RealtimeDtos.TypingBroadcast;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The online lists of all boards across all backend instances, in Redis (layout in {@link RealtimeKeys}).
 * Joining and leaving publish the new list to {@code /topic/boards/{id}/presence} from inside the Redis
 * script that changed it, so lists arrive in the order they changed.
 * <p>
 * Each instance refreshes a heartbeat key every {@code app.realtime.heartbeat-interval}. When one stops
 * (crash, network split), another removes its sessions after {@code app.realtime.instance-ttl}, as if
 * they had disconnected. If the instance was only stalled, it notices on its next heartbeat and puts
 * its sessions back.
 */
@Component
public class ClusterPresence {

    private static final Logger log = LoggerFactory.getLogger(ClusterPresence.class);

    private final StringRedisTemplate redis;
    private final RealtimeKeys keys;
    private final RealtimeBus bus;
    private final PresenceRegistry local;
    private final BoardRooms rooms;
    private final ObjectMapper json;
    private final Duration instanceTtl;
    private boolean registered;

    public ClusterPresence(StringRedisTemplate redis, RealtimeKeys keys, RealtimeBus bus, PresenceRegistry local,
            BoardRooms rooms, ObjectMapper json, @Value("${app.realtime.instance-ttl:PT15S}") Duration instanceTtl) {
        this.redis = redis;
        this.keys = keys;
        this.bus = bus;
        this.local = local;
        this.rooms = rooms;
        this.json = json;
        this.instanceTtl = instanceTtl;
    }

    /** Registers this instance before it accepts connections. */
    @PostConstruct
    void register() {
        heartbeat();
    }

    /** Puts the session on the board, here and in the shared list, and returns the board's online list. */
    public List<OnlineUser> join(String sessionId, long boardId, BoardPrincipal user, BoardRole role) {
        local.join(sessionId, boardId, user, role);
        return parseList(joinShared(sessionId, boardId, user, role));
    }

    /**
     * The session disconnected: takes it off every board it was on and tells the others (cursor gone, not
     * typing, new online list). The last one out of a board writes the drawing back.
     */
    public void leaveAll(String sessionId, long userId) {
        for (long boardId : local.leaveAll(sessionId)) {
            leave(boardId, keys.sessionKey(sessionId), keys.instanceId(), userId);
        }
    }

    public List<OnlineUser> online(long boardId) {
        return parseList(redis.execute(RedisScripts.ONLINE_LIST, keys.presence(boardId, keys.instanceId())));
    }

    /** Refreshes this instance's heartbeat, then cleans up after instances whose heartbeat expired. */
    @Scheduled(fixedRateString = "${app.realtime.heartbeat-interval:PT5S}")
    public synchronized void heartbeat() {
        redis.opsForValue().set(keys.instanceAlive(keys.instanceId()), "1", instanceTtl);
        Long added = redis.opsForSet().add(keys.instances(), keys.instanceId());
        if (registered && added != null && added == 1) {
            // Another instance thought we were dead and removed our sessions: put them back.
            log.warn("Instance {} was considered dead; re-registering its sessions", keys.instanceId());
            for (LocalSession s : local.localSessions()) {
                joinShared(s.sessionId(), s.boardId(), s.user(), s.role());
            }
        }
        registered = true;
        sweepDeadInstances();
    }

    /** Removes the sessions of instances whose heartbeat expired. Each dead instance is swept once. */
    void sweepDeadInstances() {
        Set<String> instances = redis.opsForSet().members(keys.instances());
        if (instances == null) {
            return;
        }
        for (String instance : instances) {
            if (instance.equals(keys.instanceId()) || Boolean.TRUE.equals(redis.hasKey(keys.instanceAlive(instance)))) {
                continue;
            }
            Long removed = redis.opsForSet().remove(keys.instances(), instance);
            if (removed == null || removed == 0) {
                continue; // another instance is sweeping it
            }
            log.warn("Instance {} stopped sending heartbeats; removing its sessions", instance);
            removeSessionsOf(instance);
        }
    }

    /** On shutdown: leave like a disconnect, so the others see us go at once rather than after the TTL. */
    @PreDestroy
    void shutdown() {
        try {
            for (LocalSession s : local.localSessions()) {
                local.leaveAll(s.sessionId());
                leave(s.boardId(), keys.sessionKey(s.sessionId()), keys.instanceId(), s.user().userId());
            }
            redis.opsForSet().remove(keys.instances(), keys.instanceId());
            redis.delete(List.of(keys.instanceAlive(keys.instanceId()), keys.instanceSessions(keys.instanceId())));
        } catch (RuntimeException e) {
            log.warn("Could not unregister instance {}; others will after its heartbeat expires",
                    keys.instanceId(), e);
        }
    }

    private void removeSessionsOf(String instance) {
        Set<String> members = redis.opsForSet().members(keys.instanceSessions(instance));
        for (String member : members == null ? Set.<String>of() : members) {
            int space = member.indexOf(' ');
            long boardId = Long.parseLong(member.substring(0, space));
            String sessionKey = member.substring(space + 1);
            Object entry = redis.opsForHash().get(keys.board(boardId, "entries"), sessionKey);
            long userId = entry == null ? 0 : Long.parseLong(entry.toString().substring(0, entry.toString().indexOf('\n')));
            leave(boardId, sessionKey, instance, userId);
        }
        redis.delete(keys.instanceSessions(instance));
    }

    private String joinShared(String sessionId, long boardId, BoardPrincipal user, BoardRole role) {
        String sessionKey = keys.sessionKey(sessionId);
        OnlineUser online = new OnlineUser(user.userId(), user.fullName(), PresenceRegistry.colorOf(user.userId()), role);
        return redis.execute(RedisScripts.JOIN, keys.presence(boardId, keys.instanceId()), sessionKey,
                user.userId() + "\n" + bus.toJson(online), boardId + " " + sessionKey, presenceChannel(boardId));
    }

    private void leave(long boardId, String sessionKey, String instance, long userId) {
        bus.publish("/topic/boards/" + boardId + "/cursors",
                CursorBroadcast.gone(PresenceRegistry.cursorId(sessionKey), userId));
        bus.publish("/topic/boards/" + boardId + "/typing", new TypingBroadcast(userId, false));
        Long left = redis.execute(RedisScripts.LEAVE, keys.presence(boardId, instance), sessionKey,
                boardId + " " + sessionKey, presenceChannel(boardId));
        if (left != null && left == 0) {
            rooms.close(boardId); // last one out: write the drawing back now
        }
    }

    private String presenceChannel(long boardId) {
        return keys.channel("/topic/boards/" + boardId + "/presence");
    }

    private List<OnlineUser> parseList(String list) {
        try {
            return json.readValue(list, new TypeReference<>() {
            });
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}

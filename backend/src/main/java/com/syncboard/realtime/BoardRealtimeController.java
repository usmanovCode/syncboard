package com.syncboard.realtime;

import com.syncboard.board.BoardAccessService;
import com.syncboard.common.ApiException;
import com.syncboard.realtime.RealtimeDtos.ErrorMessage;
import com.syncboard.realtime.RealtimeDtos.JoinResponse;
import com.syncboard.realtime.RealtimeDtos.OnlineUser;
import java.security.Principal;
import java.util.List;
import org.springframework.context.MessageSource;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

/**
 * Board rooms over STOMP. A client opens one connection per board page:
 * <ol>
 *   <li>subscribes to {@code /topic/boards/{id}/presence} (and later ops/cursors),</li>
 *   <li>subscribes to {@code /app/boards/{id}/join}, whose one-off reply is the current state,</li>
 *   <li>disconnects when leaving the page, which removes it from the online list.</li>
 * </ol>
 */
@Controller
public class BoardRealtimeController {

    private final BoardAccessService access;
    private final PresenceRegistry presence;
    private final SimpMessagingTemplate messaging;
    private final MessageSource messages;

    public BoardRealtimeController(
            BoardAccessService access, PresenceRegistry presence, SimpMessagingTemplate messaging,
            MessageSource messages) {
        this.access = access;
        this.presence = presence;
        this.messaging = messaging;
        this.messages = messages;
    }

    @SubscribeMapping("/boards/{boardId}/join")
    public JoinResponse join(@DestinationVariable long boardId, Principal principal, SimpMessageHeaderAccessor headers) {
        BoardPrincipal user = (BoardPrincipal) principal;
        BoardAccessService.Access a = access.requireView(user.userId(), boardId);
        List<OnlineUser> online = presence.join(headers.getSessionId(), boardId, user, a.role());
        broadcastPresence(boardId, online);
        return new JoinResponse(boardId, user.userId(), online);
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        for (long boardId : presence.leaveAll(event.getSessionId())) {
            broadcastPresence(boardId, presence.online(boardId));
        }
    }

    /** Rejected messages are reported to the sender only, in their language. */
    @MessageExceptionHandler(ApiException.class)
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorMessage handleApiException(ApiException ex, Principal principal) {
        BoardPrincipal user = (BoardPrincipal) principal;
        String text = messages.getMessage(ex.getMessageKey(), null, ex.getMessageKey(), user.locale());
        return new ErrorMessage(ex.getCode(), text);
    }

    private void broadcastPresence(long boardId, List<OnlineUser> online) {
        messaging.convertAndSend("/topic/boards/" + boardId + "/presence", online);
    }
}

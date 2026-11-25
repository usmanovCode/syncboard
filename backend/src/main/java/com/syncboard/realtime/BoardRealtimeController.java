package com.syncboard.realtime;

import com.syncboard.board.BoardAccessService;
import com.syncboard.common.ApiException;
import com.syncboard.realtime.RealtimeDtos.ErrorMessage;
import com.syncboard.realtime.RealtimeDtos.JoinResponse;
import com.syncboard.realtime.RealtimeDtos.OnlineUser;
import com.syncboard.realtime.RealtimeDtos.OpBroadcast;
import com.syncboard.realtime.RealtimeDtos.OpRequest;
import java.security.Principal;
import java.util.List;
import org.springframework.context.MessageSource;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.converter.MessageConversionException;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

/**
 * Board rooms over STOMP. A client opens one connection per board page:
 * <ol>
 *   <li>subscribes to {@code /topic/boards/{id}/(presence|ops)},</li>
 *   <li>subscribes to {@code /app/boards/{id}/join}, whose one-off reply is the current drawing and
 *       online list,</li>
 *   <li>sends ops to {@code /app/boards/{id}/ops}; accepted ops are broadcast with a seq to everyone,</li>
 *   <li>disconnects when leaving the page, which removes it from the online list.</li>
 * </ol>
 */
@Controller
public class BoardRealtimeController {

    private static final int MAX_CLIENT_OP_ID = 64;

    private final BoardAccessService access;
    private final PresenceRegistry presence;
    private final BoardRooms rooms;
    private final SimpMessagingTemplate messaging;
    private final MessageSource messages;

    public BoardRealtimeController(BoardAccessService access, PresenceRegistry presence, BoardRooms rooms,
            SimpMessagingTemplate messaging, MessageSource messages) {
        this.access = access;
        this.presence = presence;
        this.rooms = rooms;
        this.messaging = messaging;
        this.messages = messages;
    }

    @SubscribeMapping("/boards/{boardId}/join")
    public JoinResponse join(@DestinationVariable long boardId, Principal principal, SimpMessageHeaderAccessor headers) {
        BoardPrincipal user = (BoardPrincipal) principal;
        BoardAccessService.Access a = access.requireView(user.userId(), boardId);
        BoardRooms.Snapshot snapshot = rooms.snapshot(boardId);
        List<OnlineUser> online = presence.join(headers.getSessionId(), boardId, user, a.role());
        broadcastPresence(boardId, online);
        return new JoinResponse(boardId, user.userId(), online, snapshot.shapes(), snapshot.seq());
    }

    @MessageMapping("/boards/{boardId}/ops")
    public void op(@DestinationVariable long boardId, @Payload OpRequest request, Principal principal,
            SimpMessageHeaderAccessor headers) {
        BoardPrincipal user = (BoardPrincipal) principal;
        String clientOpId = request == null ? null : request.clientOpId();
        try {
            if (clientOpId == null || clientOpId.isEmpty() || clientOpId.length() > MAX_CLIENT_OP_ID) {
                throw ShapeValidator.invalid();
            }
            if (!presence.isJoined(headers.getSessionId(), boardId)) {
                throw new ApiException(HttpStatus.CONFLICT, "NOT_JOINED", "error.notJoined");
            }
            // Re-checked on every op, so a role change or removal takes effect immediately.
            access.requireEdit(user.userId(), boardId);
            rooms.apply(boardId, request.op(), (seq, op) -> messaging.convertAndSend(
                    "/topic/boards/" + boardId + "/ops", new OpBroadcast(seq, user.userId(), clientOpId, op)));
        } catch (ApiException e) {
            sendError(user, e.getCode(), e.getMessageKey(), clientOpId);
        }
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        for (long boardId : presence.leaveAll(event.getSessionId())) {
            List<OnlineUser> online = presence.online(boardId);
            if (online.isEmpty()) {
                rooms.close(boardId); // last one out: write the drawing back now
            } else {
                broadcastPresence(boardId, online);
            }
        }
    }

    @MessageExceptionHandler(ApiException.class)
    public void handleApiException(ApiException ex, Principal principal) {
        sendError((BoardPrincipal) principal, ex.getCode(), ex.getMessageKey(), null);
    }

    /** Payloads that aren't valid JSON for the destination. */
    @MessageExceptionHandler(MessageConversionException.class)
    public void handleUnreadable(Principal principal) {
        sendError((BoardPrincipal) principal, "INVALID_OP", "error.invalidOp", null);
    }

    /** Rejections go to the sender's error queue, in their language. */
    private void sendError(BoardPrincipal user, String code, String messageKey, String clientOpId) {
        String text = messages.getMessage(messageKey, null, messageKey, user.locale());
        messaging.convertAndSendToUser(user.getName(), "/queue/errors", new ErrorMessage(code, text, clientOpId));
    }

    private void broadcastPresence(long boardId, List<OnlineUser> online) {
        messaging.convertAndSend("/topic/boards/" + boardId + "/presence", online);
    }
}

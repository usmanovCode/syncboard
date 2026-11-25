package com.syncboard.realtime;

import com.syncboard.board.BoardAccessService;
import com.syncboard.chat.ChatDtos.ChatMessageResponse;
import com.syncboard.chat.ChatService;
import com.syncboard.common.ApiException;
import com.syncboard.realtime.RealtimeDtos.ChatRequest;
import com.syncboard.realtime.RealtimeDtos.CursorBroadcast;
import com.syncboard.realtime.RealtimeDtos.CursorRequest;
import com.syncboard.realtime.RealtimeDtos.ErrorMessage;
import com.syncboard.realtime.RealtimeDtos.JoinResponse;
import com.syncboard.realtime.RealtimeDtos.OnlineUser;
import com.syncboard.realtime.RealtimeDtos.OpBroadcast;
import com.syncboard.realtime.RealtimeDtos.OpRequest;
import com.syncboard.realtime.RealtimeDtos.TypingBroadcast;
import com.syncboard.realtime.RealtimeDtos.TypingRequest;
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
 *   <li>sends its pointer to {@code /app/boards/{id}/cursor} (viewers too); relayed to the others,</li>
 *   <li>sends chat messages to {@code /app/boards/{id}/chat} and "typing" to {@code /app/boards/{id}/typing}
 *       (viewers too); messages are stored and broadcast, typing is only relayed,</li>
 *   <li>disconnects when leaving the page, which removes it from the online list.</li>
 * </ol>
 */
@Controller
public class BoardRealtimeController {

    private static final int MAX_CLIENT_OP_ID = 64;
    private static final double MAX_COORDINATE = 1_000_000;

    private final BoardAccessService access;
    private final PresenceRegistry presence;
    private final BoardRooms rooms;
    private final ChatService chat;
    private final SimpMessagingTemplate messaging;
    private final MessageSource messages;

    public BoardRealtimeController(BoardAccessService access, PresenceRegistry presence, BoardRooms rooms,
            ChatService chat, SimpMessagingTemplate messaging, MessageSource messages) {
        this.access = access;
        this.presence = presence;
        this.rooms = rooms;
        this.chat = chat;
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
        return new JoinResponse(boardId, user.userId(), online, snapshot.shapes(), snapshot.seq(),
                chat.latest(boardId));
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
            sendError(user, ErrorMessage.forOp(e.getCode(), text(user, e.getMessageKey()), clientOpId));
        }
    }

    /**
     * Chat, open to every role. Access is re-checked on every message (by {@link ChatService#post}), like
     * ops, so a removed member can't keep writing. The message is stored before it is broadcast; clients
     * order messages by id, so concurrent senders may be broadcast slightly out of order.
     */
    @MessageMapping("/boards/{boardId}/chat")
    public void chat(@DestinationVariable long boardId, @Payload ChatRequest request, Principal principal,
            SimpMessageHeaderAccessor headers) {
        BoardPrincipal user = (BoardPrincipal) principal;
        String clientMessageId = request == null ? null : request.clientMessageId();
        try {
            if (!presence.isJoined(headers.getSessionId(), boardId)) {
                throw new ApiException(HttpStatus.CONFLICT, "NOT_JOINED", "error.chatNotJoined");
            }
            ChatMessageResponse message = chat.post(user.userId(), user.fullName(), boardId, clientMessageId,
                    request == null ? null : request.text());
            presence.stopTyping(headers.getSessionId());
            messaging.convertAndSend("/topic/boards/" + boardId + "/chat", message);
            messaging.convertAndSend(typingTopic(boardId), new TypingBroadcast(user.userId(), false));
        } catch (ApiException e) {
            sendError(user, ErrorMessage.forChat(e.getCode(), text(user, e.getMessageKey()), clientMessageId));
        }
    }

    /** "Is typing…". Not stored; like cursors, invalid or too frequent updates are dropped silently. */
    @MessageMapping("/boards/{boardId}/typing")
    public void typing(@DestinationVariable long boardId, @Payload TypingRequest request, Principal principal,
            SimpMessageHeaderAccessor headers) {
        BoardPrincipal user = (BoardPrincipal) principal;
        String sessionId = headers.getSessionId();
        boolean typing = request != null && Boolean.TRUE.equals(request.typing());
        if (typing) {
            if (!presence.acceptTyping(sessionId, boardId, System.currentTimeMillis())) {
                return;
            }
        } else {
            // Never rate-limited, or the indicator would linger.
            if (!presence.isJoined(sessionId, boardId)) {
                return;
            }
            presence.stopTyping(sessionId);
        }
        messaging.convertAndSend(typingTopic(boardId), new TypingBroadcast(user.userId(), typing));
    }

    /**
     * Live cursors. Not stored, not checked against the database (joining already was), and invalid or
     * too frequent updates are dropped silently: a lost cursor frame is harmless, errors would be noise.
     */
    @MessageMapping("/boards/{boardId}/cursor")
    public void cursor(@DestinationVariable long boardId, @Payload CursorRequest request, Principal principal,
            SimpMessageHeaderAccessor headers) {
        BoardPrincipal user = (BoardPrincipal) principal;
        String sessionId = headers.getSessionId();
        String cursorId = PresenceRegistry.cursorId(sessionId);
        boolean gone = request == null || Boolean.TRUE.equals(request.gone());
        CursorBroadcast cursor;
        if (gone) {
            // Never rate-limited: dropping it would leave a stale cursor on everyone's screen.
            if (!presence.isJoined(sessionId, boardId)) {
                return;
            }
            cursor = CursorBroadcast.gone(cursorId, user.userId());
        } else if (request.x() != null && request.y() != null && isCoordinate(request.x()) && isCoordinate(request.y())
                && presence.acceptCursor(sessionId, boardId, System.currentTimeMillis())) {
            cursor = CursorBroadcast.at(cursorId, user.userId(), request.x(), request.y());
        } else {
            return;
        }
        messaging.convertAndSend("/topic/boards/" + boardId + "/cursors", cursor);
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        String cursorId = PresenceRegistry.cursorId(event.getSessionId());
        long userId = event.getUser() instanceof BoardPrincipal user ? user.userId() : 0;
        for (long boardId : presence.leaveAll(event.getSessionId())) {
            messaging.convertAndSend("/topic/boards/" + boardId + "/cursors", CursorBroadcast.gone(cursorId, userId));
            messaging.convertAndSend(typingTopic(boardId), new TypingBroadcast(userId, false));
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
        BoardPrincipal user = (BoardPrincipal) principal;
        sendError(user, ErrorMessage.forOp(ex.getCode(), text(user, ex.getMessageKey()), null));
    }

    /** Payloads that aren't valid JSON for the destination. */
    @MessageExceptionHandler(MessageConversionException.class)
    public void handleUnreadable(Principal principal) {
        BoardPrincipal user = (BoardPrincipal) principal;
        sendError(user, ErrorMessage.forOp("INVALID_OP", text(user, "error.invalidOp"), null));
    }

    /** Rejections go to the sender's error queue. */
    private void sendError(BoardPrincipal user, ErrorMessage error) {
        messaging.convertAndSendToUser(user.getName(), "/queue/errors", error);
    }

    /** In the user's language. */
    private String text(BoardPrincipal user, String messageKey) {
        return messages.getMessage(messageKey, null, messageKey, user.locale());
    }

    private static String typingTopic(long boardId) {
        return "/topic/boards/" + boardId + "/typing";
    }

    private static boolean isCoordinate(double value) {
        return Double.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
    }

    private void broadcastPresence(long boardId, List<OnlineUser> online) {
        messaging.convertAndSend("/topic/boards/" + boardId + "/presence", online);
    }
}

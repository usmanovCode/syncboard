package com.syncboard.realtime;

import com.syncboard.board.BoardAccessService;
import com.syncboard.user.User;
import com.syncboard.user.UserRepository;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;

/**
 * Authentication and authorization for every inbound STOMP frame (the HTTP security chain only sees
 * the handshake, which browsers cannot attach a token to).
 * <ul>
 *   <li>CONNECT must carry {@code Authorization: Bearer <jwt>}; the user becomes the session principal.</li>
 *   <li>SUBSCRIBE is allowed only to a board's topics / join for users who can view the board, and to
 *       the user's own error queue.</li>
 *   <li>SEND is allowed only to {@code /app/...}; a client must never publish to a broker topic directly.
 *       What each {@code /app} destination may do is checked by its handler.</li>
 * </ul>
 * Throwing here makes Spring answer with a STOMP ERROR frame.
 */
@Component
public class StompAuthInterceptor implements ChannelInterceptor {

    private static final Pattern BOARD_SUBSCRIPTION =
            Pattern.compile("^/(?:topic|app)/boards/(\\d+)/(?:ops|presence|cursors|join)$");
    private static final List<Locale> LOCALES = List.of(Locale.ENGLISH, Locale.KOREAN);

    private final JwtDecoder jwtDecoder;
    private final UserRepository users;
    private final BoardAccessService access;

    public StompAuthInterceptor(JwtDecoder jwtDecoder, UserRepository users, BoardAccessService access) {
        this.jwtDecoder = jwtDecoder;
        this.users = users;
        this.access = access;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor stomp = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (stomp == null || stomp.getCommand() == null) {
            return message;
        }
        switch (stomp.getCommand()) {
            case CONNECT -> stomp.setUser(authenticate(stomp));
            case SUBSCRIBE -> authorizeSubscribe(stomp);
            case SEND -> {
                requireUser(stomp);
                String destination = String.valueOf(stomp.getDestination());
                if (!destination.startsWith("/app/")) {
                    throw new MessageDeliveryException("FORBIDDEN_DESTINATION");
                }
            }
            default -> {
                // DISCONNECT, UNSUBSCRIBE, ACK...: nothing to check.
            }
        }
        return message;
    }

    private BoardPrincipal authenticate(StompHeaderAccessor stomp) {
        String header = stomp.getFirstNativeHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            throw new MessageDeliveryException("UNAUTHORIZED");
        }
        Jwt jwt;
        try {
            jwt = jwtDecoder.decode(header.substring("Bearer ".length()));
        } catch (JwtException e) {
            throw new MessageDeliveryException("UNAUTHORIZED");
        }
        User user = users.findById(Long.parseLong(jwt.getSubject()))
                .orElseThrow(() -> new MessageDeliveryException("UNAUTHORIZED"));
        return new BoardPrincipal(user.getId(), user.getFullName(), locale(stomp.getFirstNativeHeader("accept-language")));
    }

    private void authorizeSubscribe(StompHeaderAccessor stomp) {
        BoardPrincipal user = requireUser(stomp);
        String destination = String.valueOf(stomp.getDestination());
        if (destination.equals("/user/queue/errors")) {
            return;
        }
        Matcher board = BOARD_SUBSCRIPTION.matcher(destination);
        if (!board.matches()) {
            throw new MessageDeliveryException("FORBIDDEN_DESTINATION");
        }
        try {
            access.requireView(user.userId(), Long.parseLong(board.group(1)));
        } catch (RuntimeException e) {
            throw new MessageDeliveryException("BOARD_NOT_FOUND");
        }
    }

    private static BoardPrincipal requireUser(StompHeaderAccessor stomp) {
        if (stomp.getUser() instanceof BoardPrincipal user) {
            return user;
        }
        throw new MessageDeliveryException("UNAUTHORIZED");
    }

    private static Locale locale(String acceptLanguage) {
        if (acceptLanguage == null || acceptLanguage.isBlank()) {
            return Locale.ENGLISH;
        }
        try {
            Locale match = Locale.lookup(Locale.LanguageRange.parse(acceptLanguage), LOCALES);
            return match == null ? Locale.ENGLISH : match;
        } catch (IllegalArgumentException e) {
            return Locale.ENGLISH;
        }
    }
}

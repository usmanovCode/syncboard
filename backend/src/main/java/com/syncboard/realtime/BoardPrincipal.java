package com.syncboard.realtime;

import java.security.Principal;
import java.util.Locale;

/**
 * The authenticated user of a STOMP session, set on CONNECT by {@link StompAuthInterceptor}.
 * {@link #getName()} is the user id, so {@code /user/...} destinations reach all of a user's sessions.
 * {@code locale} comes from the CONNECT frame's accept-language header, for localized error messages.
 */
public record BoardPrincipal(long userId, String fullName, Locale locale) implements Principal {

    @Override
    public String getName() {
        return Long.toString(userId);
    }
}

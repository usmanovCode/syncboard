package com.syncboard.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.syncboard.board.BoardRole;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class PresenceRegistryTest {

    private final PresenceRegistry presence = new PresenceRegistry();
    private final BoardPrincipal ali = new BoardPrincipal(1, "Ali", Locale.ENGLISH);

    @Test
    void cursorsAreRateLimitedPerSession() {
        presence.join("s1", 7, ali, BoardRole.OWNER);

        assertThat(presence.acceptCursor("s1", 7, 1_000)).isTrue();
        assertThat(presence.acceptCursor("s1", 7, 1_010)).isFalse();
        assertThat(presence.acceptCursor("s1", 7, 1_000 + PresenceRegistry.MIN_CURSOR_INTERVAL_MS)).isTrue();
    }

    @Test
    void cursorsNeedAJoinedSession() {
        assertThat(presence.acceptCursor("s1", 7, 1_000)).isFalse();

        presence.join("s1", 7, ali, BoardRole.OWNER);
        assertThat(presence.acceptCursor("s1", 8, 1_000)).isFalse(); // other board

        presence.leaveAll("s1");
        assertThat(presence.acceptCursor("s1", 7, 5_000)).isFalse();
    }

    @Test
    void colorsAndCursorIdsAreStable() {
        assertThat(PresenceRegistry.colorOf(42)).isEqualTo(PresenceRegistry.colorOf(42));
        assertThat(PresenceRegistry.COLORS).contains(PresenceRegistry.colorOf(42));
        assertThat(PresenceRegistry.cursorId("abc")).isEqualTo(PresenceRegistry.cursorId("abc"));
        assertThat(PresenceRegistry.cursorId("abc")).isNotEqualTo("abc");
    }
}

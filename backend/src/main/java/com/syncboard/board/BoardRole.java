package com.syncboard.board;

/**
 * What a user may do on a board. OWNER comes from boards.owner_id; EDITOR and VIEWER from
 * board_members. Viewers see the drawing (and others see their cursor) but cannot change it.
 */
public enum BoardRole {
    OWNER,
    EDITOR,
    VIEWER;

    public boolean canEdit() {
        return this != VIEWER;
    }

    /** Roles that can be given to a member; ownership is not transferable this way. */
    public boolean isMemberRole() {
        return this != OWNER;
    }
}

-- Users a board is shared with. The owner is boards.owner_id and is never stored here, so a board
-- always has exactly one owner.
CREATE TABLE board_members (
    board_id   BIGINT      NOT NULL,
    user_id    BIGINT      NOT NULL,
    role       VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_board_members PRIMARY KEY (board_id, user_id),
    CONSTRAINT fk_board_members_board FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE,
    CONSTRAINT fk_board_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_board_members_role CHECK (role IN ('EDITOR', 'VIEWER'))
);

-- "Boards shared with me" for the dashboard.
CREATE INDEX idx_board_members_user_id ON board_members (user_id);

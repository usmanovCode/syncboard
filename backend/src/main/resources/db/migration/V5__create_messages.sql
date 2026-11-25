-- Chat messages of a board. Written once, never edited.
CREATE TABLE messages (
    id                BIGSERIAL     PRIMARY KEY,
    board_id          BIGINT        NOT NULL,
    user_id           BIGINT        NOT NULL,
    body              VARCHAR(2000) NOT NULL,
    -- Chosen by the sending tab. A message re-sent after a reconnect finds the stored one instead of
    -- being inserted twice.
    client_message_id VARCHAR(64)   NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT fk_messages_board FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE,
    CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uk_messages_client_id UNIQUE (board_id, user_id, client_message_id),
    CONSTRAINT ck_messages_body CHECK (length(btrim(body)) > 0)
);

-- Newest messages of a board first, paged by id.
CREATE INDEX idx_messages_board_id_id ON messages (board_id, id DESC);

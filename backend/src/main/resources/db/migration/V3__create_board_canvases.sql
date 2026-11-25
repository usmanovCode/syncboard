-- Drawing content of a board, kept out of `boards` so the dashboard list never loads it.
-- `version` is bumped on every save; a save must name the version it was based on (optimistic locking).
CREATE TABLE board_canvases (
    board_id   BIGINT      PRIMARY KEY,
    content    JSONB       NOT NULL DEFAULT '{"schemaVersion": 1, "shapes": []}',
    version    INT         NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_board_canvases_board FOREIGN KEY (board_id) REFERENCES boards (id) ON DELETE CASCADE
);

-- Every board has exactly one canvas; backfill the boards created before this migration.
INSERT INTO board_canvases (board_id) SELECT id FROM boards;

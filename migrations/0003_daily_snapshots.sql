-- 0003: 往期归档 — one front-page snapshot per Beijing day, written by the
-- independent daily digest schedule (09:05). Payload is a compact JSON document
-- (stats + lead top10 + trending top5), so a day's edition survives the
-- 500-item rolling cap that eventually deletes the underlying rows.
CREATE TABLE IF NOT EXISTS daily_snapshots (
  date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

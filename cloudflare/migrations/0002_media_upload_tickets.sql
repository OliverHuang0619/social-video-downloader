CREATE TABLE IF NOT EXISTS media_upload_tickets (
  id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, expires_at TEXT NOT NULL
);

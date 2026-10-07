CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY, file TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, source_url TEXT, platform TEXT,
  uploader TEXT, duration REAL, thumbnail TEXT, published_at TEXT, processing_state TEXT NOT NULL DEFAULT 'unprocessed',
  analysis_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, asset_ids TEXT NOT NULL, progress REAL NOT NULL,
  message TEXT NOT NULL, error TEXT, output_dir TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS publish_batches (id TEXT PRIMARY KEY, dispatch_mode TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES publish_batches(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES media_assets(id), platform TEXT NOT NULL DEFAULT 'douyin', title TEXT NOT NULL, topics TEXT NOT NULL,
  summary TEXT, publish_at TEXT, execute_at TEXT, submit_at TEXT, aigc INTEGER NOT NULL, wait_for_covers INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, error TEXT, screenshot TEXT
);
CREATE TABLE IF NOT EXISTS download_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS remake_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS creator_subscriptions (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, source_url TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  auto_download INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  last_polled_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscription_seen_items (
  subscription_id TEXT NOT NULL REFERENCES creator_subscriptions(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL, PRIMARY KEY (subscription_id, media_key)
);
CREATE TABLE IF NOT EXISTS subscription_notifications (
  id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES creator_subscriptions(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT NOT NULL, thumbnail TEXT,
  download_job_id TEXT, read_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  label TEXT NOT NULL, created_at TEXT NOT NULL, last_sent_at TEXT
);

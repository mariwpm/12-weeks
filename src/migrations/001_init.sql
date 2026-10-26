CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  login         TEXT NOT NULL UNIQUE CHECK (length(login) BETWEEN 3 AND 64),
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user', 'admin'))
);

CREATE TABLE IF NOT EXISTS resources (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  location    TEXT NOT NULL CHECK (length(location) BETWEEN 1 AND 120),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS bookings (
  id            TEXT PRIMARY KEY,
  resource_id   TEXT NOT NULL REFERENCES resources(id),
  owner_id      TEXT NOT NULL REFERENCES users(id),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  purpose       TEXT NOT NULL CHECK (length(purpose) BETWEEN 5 AND 300),
  status        TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at    TIMESTAMPTZ NOT NULL,
  cancelled_at  TIMESTAMPTZ,
  cancelled_by  TEXT REFERENCES users(id),
  cancel_reason TEXT,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_bookings_owner_starts
  ON bookings(owner_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_resource_interval
  ON bookings(resource_id, status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS booking_slots (
  resource_id TEXT NOT NULL,
  slot_start  TIMESTAMPTZ NOT NULL,
  booking_id  TEXT NOT NULL REFERENCES bookings(id),
  PRIMARY KEY (resource_id, slot_start)
);
CREATE INDEX IF NOT EXISTS idx_slots_booking ON booking_slots(booking_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id             TEXT NOT NULL REFERENCES users(id),
  key                 TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  booking_id          TEXT NOT NULL REFERENCES bookings(id),
  created_at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id   TEXT,
  result      TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  details     JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_events(at DESC);
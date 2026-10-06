-- Normalize stored emails (SQLite UNIQUE on email is case-sensitive by default).
UPDATE users SET email = lower(trim(email));

-- Remove duplicate accounts that only differed by casing; keep oldest rowid.
DELETE FROM users
WHERE rowid NOT IN (
  SELECT min(rowid) FROM users GROUP BY lower(email)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

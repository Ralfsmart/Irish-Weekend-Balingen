CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  besucher INTEGER NOT NULL,
  optionen TEXT NOT NULL DEFAULT '',
  gesamtpreis REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'bestaetigt',
  erstellt_am TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin-Passwörter liegen (gehasht) in D1 statt als Worker-Secret, damit sie
-- zur Laufzeit über das Admin-Tool geändert werden können. Es gibt genau
-- eine Zeile (id = 1).
CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  view_password_hash TEXT NOT NULL,
  admin_password_hash TEXT NOT NULL
);

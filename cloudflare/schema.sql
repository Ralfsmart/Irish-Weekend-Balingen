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

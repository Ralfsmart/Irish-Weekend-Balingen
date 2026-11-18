# Irish Weekend Balingen – CLAUDE.md

Anmeldeseite für ein Set-Dance-Wochenende. Statisch gehostet auf GitHub
Pages, mit einem Cloudflare Worker + D1-Datenbank als einzigem Backend.

**`README.md` ist veraltet** – sie beschreibt noch einen älteren Stand
(Anmeldungen als GitHub Issues, ein einziges `ADMIN_PASSWORD`-Secret). Das
stimmt nicht mehr mit `cloudflare/worker.js` überein (siehe unten). Für
Backend-Fragen gilt der Code, nicht die README.

## Architektur

- **Statische Seite**: `index.html` (Anmelde-Assistent: Optionen →
  Übersicht → Senden), `admin.html` (Admin-Bereich), `css/`, `js/app.js`,
  `js/admin.js`, `js/legal.js`. Läuft komplett im Browser, kein Build-Step.
- **Inhalte**: `data/config.json` – Überschriften, Texte (als HTML von
  Quill), Optionen/Preise, `maxBesucher` (Kapazität), `targetEmail`,
  `apiBase` (Worker-URL). Wird per `fetch` beim Laden eingelesen.
- **Cloudflare Worker** (`cloudflare/worker.js`, deployt per `wrangler`,
  Konfiguration in `cloudflare/wrangler.toml`) ist das gesamte Backend:
  - **D1-Datenbank** (`env.DB`, Schema in `cloudflare/schema.sql`):
    - Tabelle `registrations` – jede Anmeldung eine Zeile (Name, E-Mail,
      Besucherzahl, Optionen-Text, Gesamtpreis, Status
      `bestaetigt`/`warteliste`). **Keine GitHub Issues mehr.**
    - Tabelle `admin_settings` (genau eine Zeile, `id = 1`) –
      `view_password_hash` und `admin_password_hash`, SHA-256 von
      `"set-dance-balingen::" + Passwort`. **Kein `ADMIN_PASSWORD`-Secret
      mehr** – die Passwörter liegen gehasht in D1 und sind zur Laufzeit
      über `/change-passwords` änderbar (Admin-Bereich → Passwörter
      ändern).
  - **Zwei Zugriffslevel**: `view` (nur lesen: Anmeldungen ansehen) und
    `admin` (zusätzlich: Inhalte/Optionen speichern, Passwörter ändern,
    Logo/Anfahrtsplan hochladen, Anmeldungen bearbeiten/löschen).
  - **GitHub-Anbindung** (Secrets `GITHUB_TOKEN`, `GITHUB_OWNER`,
    `GITHUB_REPO`) wird für drei Dinge gebraucht, alle über die GitHub
    Contents API:
    - `maxBesucher` aus `data/config.json` lesen, um die Kapazität zu
      prüfen (`ermittleBelegung`/`fetchConfig`).
    - `POST /admin-save` committet die aktualisierte `data/config.json`
      ins Repo (inkl. Sanitizing der Rich-Text-Felder serverseitig).
    - `POST /upload-logo` / `POST /upload-anfahrtsplan` committen ein
      neues PNG (`img/icons/logo.png` bzw. `img/anfahrtsplan.png`, max.
      2 MB, PNG-Signatur-Check).
  - Endpunkte im Überblick: `GET /registration-status` (öffentlich),
    `POST /submit-registration` (öffentlich), `POST /verify-password`
    (öffentlich), `GET /registrations` (view/admin), `PATCH|DELETE
    /registrations/:id` (admin), `POST /admin-save` (admin), `POST
    /change-passwords` (admin), `POST /upload-logo` / `upload-anfahrtsplan`
    (admin).
- **Fallback**: Der "Anmeldung senden"-Button öffnet zusätzlich ein
  vorausgefülltes `mailto:` an `targetEmail` – funktioniert auch wenn der
  Worker down ist.

## Wichtige Besonderheiten

- **Zwei getrennte Deploy-Wege** – leicht zu vergessen, welcher gerade
  nötig ist:
  - Inhalte (`data/config.json`, Bilder, HTML/CSS/JS) → normaler Git-Commit
    + Push reicht, GitHub Pages baut automatisch. Inhalte lassen sich aber
    auch *ohne* Git-Commit über `/admin.html` ändern – der Worker committet
    dann selbst ins Repo (`admin-save`, `upload-logo`,
    `upload-anfahrtsplan`). `git pull` nicht vergessen, falls das passiert
    ist, während lokal am selben Stand gearbeitet wird.
  - Logik-Änderungen in `cloudflare/worker.js` oder `wrangler.toml` →
    brauchen `wrangler deploy` aus `cloudflare/`. Es gibt **keine
    GitHub-Action/CI**, die das automatisch macht – ein reiner Push ohne
    `wrangler deploy` ändert am Worker gar nichts.
  - Schema-Änderungen in `cloudflare/schema.sql` → müssen manuell per
    `wrangler d1 execute` gegen die echte D1-Datenbank ausgeführt werden
    (Datei wird nicht automatisch angewendet).
- **Admin-Login ist kein Mock-Flag**: `js/admin.js` hält das eingegebene
  Passwort nur in der JS-Variable `aktuellesPasswort` (kein
  `sessionStorage`-Trick zum Umgehen des Logins). Um den Admin-Bereich zu
  testen, muss `/verify-password` tatsächlich mit „admin“ antworten –
  entweder gegen den echten Worker, oder gegen einen lokalen `wrangler dev`
  mit passend geseedeter `admin_settings`-Zeile (siehe Testen unten).
- **Capacity-Check degradiert ohne GitHub-Zugriff auf „unbegrenzt“**:
  Wenn der Worker `data/config.json` nicht lesen kann (z. B. kein/falscher
  `GITHUB_TOKEN`), wird `maxBesucher` als `0` behandelt, was im Code als
  „keine Kapazitätsgrenze“ gilt → Anmeldungen landen dann immer als
  `bestaetigt`, nie auf der Warteliste. Nützlich zu wissen, wenn beim
  Testen ohne echtes Token plötzlich nie eine Warteliste entsteht.
- **Rich-Text-Felder** (`infoText1/2`, `zusatzText1/2`, `impressum`,
  `datenschutz`) werden serverseitig in `handleAdminSave` gegen eine feste
  Tag-Allowlist sanitisiert (siehe `sanitizeRichText` in `worker.js`) –
  Änderungen an der Allowlist nur dort, nicht im Frontend.
- `.claude/` ist komplett in `.gitignore` – `.claude/launch.json` und
  dieser Skill sind lokal, werden nie committet.

## Obsidian-Spiegelung

Diese Datei hat eine Kopie in Obsidian:
`C:\Users\ralfs\OneDrive\Documents\Claude\Obsidian\Set Dance Balingen\CLAUDE.md`.
**Nach jeder inhaltlichen Änderung an dieser CLAUDE.md die Kopie dort ebenfalls aktualisieren**
(reine Dateikopie reicht). Kein Hook, keine Automatik — der Nutzer arbeitet von mehreren Geräten,
ein lokaler Git-Hook würde nur auf einem davon greifen.

## Testen

### 1. Statische Seite ohne Worker

```bash
python -m http.server 8123
```

(entspricht der `set-dance-static`-Konfiguration in `.claude/launch.json`,
per `preview_start` nutzbar). Testet den Anmelde-Assistenten und das
Layout von `admin.html`. Ohne erreichbaren Worker schlagen
Registrierung, Kapazitätsanzeige und Admin-Login fehl (die Seite fängt
das ab, zeigt aber entsprechende Fehlermeldungen/leere Zustände).

### 2. Worker lokal, ohne echtes GitHub-Repo oder echte Anmeldungen zu berühren

```bash
cd cloudflare
wrangler d1 execute set-dance-balingen-db --local --file=schema.sql
wrangler d1 execute set-dance-balingen-db --local --command \
  "INSERT INTO admin_settings (id, view_password_hash, admin_password_hash) VALUES (1, '<view-hash>', '<admin-hash>')"
wrangler dev
```

Die Hashes dafür (SHA-256 von `"set-dance-balingen::" + Passwort"`, siehe
`hashPasswort` in `worker.js`), z. B. mit Node erzeugen:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('set-dance-balingen::testpw').digest('hex'))"
```

`wrangler dev` legt die lokale D1-Datenbank unter `cloudflare/.wrangler/`
ab (persistiert zwischen Läufen) – die obigen zwei Befehle nur beim ersten
Mal bzw. nach einem Reset nötig.

**Kein `GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO` als lokale Secrets
setzen** (kein `.dev.vars` anlegen) – das ist hier Absicht, nicht eine
Lücke:
- `/registration-status`, `/submit-registration`, `/verify-password`,
  `/change-passwords`, `/registrations` (GET/PATCH/DELETE) laufen rein
  gegen D1 und funktionieren lokal vollständig, ohne GitHub-Zugriff.
- `/admin-save`, `/upload-logo`, `/upload-anfahrtsplan` schlagen ohne
  gültiges Token absichtlich mit 401/502 fehl – das verhindert, dass ein
  Testlauf versehentlich das echte Repo committet. Für diese drei
  Endpunkte lässt sich nur die Fehlerbehandlung im Frontend testen, nicht
  der echte Commit.

Um `admin.html` gegen diesen lokalen Worker laufen zu lassen (Default-URL
`http://localhost:8787`), **nicht** `data/config.json` committen/ändern,
sondern das `apiBase`-Feld im Admin-Formular nach dem Entsperren einmal
auf `http://localhost:8787` umstellen (oder vorher per Browser-Konsole
`document.getElementById('apiBase').value = 'http://localhost:8787'`
setzen) und erst dann speichern/testen.

### 3. Live-Deployment prüfen

```bash
curl -s "https://set-dance-balingen.ralfsmart.workers.dev/registration-status"
curl -s "https://<username>.github.io/Irish-Weekend-Balingen/data/config.json?v=$(date +%s)"
```

Der zweite Aufruf mit Cache-Busting-Query-Parameter, weil GitHub
Pages/CDN alte Inhalte sonst länger cachen kann als erwartet.

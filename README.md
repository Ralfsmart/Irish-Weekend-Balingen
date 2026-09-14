# Irish Weekend Balingen

Anmeldeseite für den Set Dance Termin im Haus des Volkstanzens, Balingen –
inklusive Options-Auswahl mit Preisen, Übersichtsseite und Admin-Bereich.

## Architektur

- **Statische Seite** (`index.html`, `admin.html`, `css/`, `js/`) – gehostet
  über **GitHub Pages**. Der komplette Anmelde-Assistent (Optionen
  auswählen, Übersicht, Zurück) läuft rein im Browser.
- **Inhalte** (Überschrift, Texte, Optionen, Ziel-E-Mail) liegen in
  [`data/config.json`](data/config.json) und werden beim Laden der Seite
  per `fetch` eingelesen.
- **Ein Cloudflare Worker** ([`cloudflare/worker.js`](cloudflare/worker.js))
  ist der einzige "Backend"-Teil, weil GitHub Pages selbst keinen
  serverseitigen Code ausführen kann. Er übernimmt zwei Aufgaben:
  - `POST /submit-registration` – nimmt eine Anmeldung entgegen und legt
    sie als **GitHub Issue** im Repo ab (Label `anmeldung`). Das ist die
    "eine Tabelle" für Anmeldedaten – die Issues-Liste des Repos.
  - `POST /admin-save` – prüft das Admin-Passwort serverseitig und
    schreibt die aktualisierte `data/config.json` per Commit ins Repo.

  Das GitHub-Token liegt ausschließlich als Worker-Secret vor und landet
  nie im Browser – nur so ist es sicher, diese Funktionen öffentlich
  erreichbar zu machen.

- Der "Anmeldung senden"-Button öffnet zusätzlich eine vorausgefüllte
  E-Mail (`mailto:`) an die in `data/config.json` hinterlegte Adresse –
  das funktioniert auch, falls der Worker mal nicht erreichbar ist.

## Einrichtung

### 1. GitHub Pages aktivieren

Repository-Einstellungen auf GitHub → **Pages** → Branch `main`, Ordner
`/ (root)` → Speichern. Die Seite ist danach unter
`https://<benutzername>.github.io/<repo-name>/` erreichbar.

### 2. Cloudflare Worker deployen

```bash
npm install -g wrangler
cd cloudflare
wrangler login
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_OWNER
wrangler secret put GITHUB_REPO
wrangler secret put ADMIN_PASSWORD
wrangler deploy
```

- `GITHUB_TOKEN`: ein [Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new)
  mit **Repository-Zugriff nur auf dieses Repo** und den Rechten
  „Contents: Read and write" sowie „Issues: Read and write".
- `GITHUB_OWNER` / `GITHUB_REPO`: z. B. `Ralfsmart` / `Irish-Weekend-Balingen`
- `ADMIN_PASSWORD`: frei wählbares Passwort für die Admin-Seite

Nach `wrangler deploy` bekommst du eine URL wie
`https://set-dance-balingen.<dein-cloudflare-name>.workers.dev`.

### 3. Worker-URL in der Seite hinterlegen

Beim allerersten Mal noch kein Passwort nötig – dafür `data/config.json`
direkt über den GitHub-Web-Editor bearbeiten und das Feld `apiBase` auf
die Worker-URL aus Schritt 2 setzen, dann committen. Ab jetzt lässt sich
dieses Feld (und alle anderen Inhalte) bequem über `/admin.html` pflegen.

## Inhalte bearbeiten

Über die Admin-Seite (`/admin.html`): Überschrift, Subtext, die zwei
Info-Texte, Ziel-E-Mail-Adresse, Worker-URL und die Options-Liste
(hinzufügen/entfernen/Preis ändern). Speichern erstellt automatisch einen
Commit in `data/config.json`.

## Anmeldungen einsehen

Jede Anmeldung erzeugt ein GitHub Issue mit Label `anmeldung` im Repo –
das ist die zentrale Übersicht aller Anmeldungen (Name, E-Mail,
Besucherzahl, gewählte Optionen, Gesamtpreis).

## Lokal ansehen

Die statische Seite lässt sich lokal ohne Worker testen (Admin-Speichern
und die GitHub-Issue-Erstellung funktionieren dann nicht):

```bash
python -m http.server 8123
```

Den Worker lokal testen:

```bash
cd cloudflare
wrangler dev
```

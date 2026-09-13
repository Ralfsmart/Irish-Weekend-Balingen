# Set Dance Balingen

Anmeldeseite für den Set Dance Termin im Haus des Volkstanzens, Balingen –
inklusive Options-Auswahl mit Preisen, Übersichtsseite und Admin-Bereich.

## Architektur

- **Statische Seite** (`index.html`, `admin.html`, `css/`, `js/`) – läuft auf
  jedem Static-Hosting (GitHub Pages, Netlify, Vercel, Cloudflare Pages, …).
  Der komplette Anmelde-Assistent (Optionen auswählen, Übersicht, Zurück)
  läuft rein im Browser, es wird nichts serverseitig zwischengespeichert.
- **Inhalte** (Überschrift, Texte, Optionen, Ziel-E-Mail) liegen in
  [`data/config.json`](data/config.json) und werden beim Laden der Seite
  per `fetch` eingelesen.
- **Zwei kleine Serverless-Functions** unter `netlify/functions/` sind der
  einzige "Backend"-Teil:
  - `submit-registration` – nimmt eine Anmeldung entgegen und legt sie als
    **GitHub Issue** im Repo ab (Label `anmeldung`). Das ist die "eine
    Tabelle" für Anmeldedaten – die Issues-Liste des Repos.
  - `admin-save` – prüft das Admin-Passwort serverseitig und schreibt die
    aktualisierte `data/config.json` per Commit ins Repo.

  Beide Functions benötigen ein GitHub-Token als Umgebungsvariable auf dem
  Hosting-Anbieter. **Dieses Token landet nie im Browser** – nur so ist es
  sicher, es öffentlich zugänglich zu machen.

- Der "Anmeldung senden"-Button öffnet zusätzlich eine vorausgefüllte
  E-Mail (`mailto:`) an die in `data/config.json` hinterlegte Adresse – das
  ist der direkte, garantiert funktionierende Weg, falls die Function mal
  nicht erreichbar ist.

## Deployment (Netlify, empfohlen)

1. Repository bei [netlify.com](https://app.netlify.com) importieren
   („Add new site" → „Import an existing project" → GitHub-Repo auswählen).
   Netlify erkennt `netlify.toml` automatisch (Publish-Verzeichnis `.`,
   Functions-Verzeichnis `netlify/functions`).
2. Unter **Site settings → Environment variables** folgende Variablen setzen:
   - `GITHUB_TOKEN` – ein [Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new)
     mit **Repository-Zugriff nur auf dieses Repo** und den Rechten
     „Issues: Read and write" sowie „Contents: Read and write".
   - `GITHUB_OWNER` – z. B. `Ralfsmart`
   - `GITHUB_REPO` – z. B. `Set-Dance-Balingen`
   - `ADMIN_PASSWORD` – das Passwort für die Admin-Seite (frei wählbar)
3. Deploy auslösen. Die Seite ist danach unter der von Netlify vergebenen
   URL erreichbar (eigene Domain optional in den Netlify-Einstellungen).

### Andere Cloud-Anbieter

Die statischen Dateien laufen unverändert auf jedem Static-Hoster. Die
beiden Functions in `netlify/functions/` sind einfache
`(event) => { statusCode, body }`-Handler ohne Netlify-spezifische
Abhängigkeiten – für Vercel oder Cloudflare Pages Functions müssen sie
nur in das jeweils erwartete Dateiformat/Verzeichnis übertragen werden
(Logik bleibt identisch).

## Inhalte bearbeiten

Alles außer dem Admin-Passwort lässt sich direkt über die Admin-Seite
(`/admin.html`) bearbeiten: Überschrift, Subtext, die zwei Info-Texte,
Ziel-E-Mail-Adresse und die Options-Liste (hinzufügen/entfernen/Preis
ändern). Speichern erstellt automatisch einen Commit in `data/config.json`.

## Anmeldungen einsehen

Jede Anmeldung erzeugt ein GitHub Issue mit Label `anmeldung` im Repo –
das ist die zentrale Übersicht aller Anmeldungen (Name, E-Mail,
Besucherzahl, gewählte Optionen, Gesamtpreis).

## Lokal ansehen

Die statische Seite lässt sich lokal ohne Backend testen (Admin-Speichern
und die GitHub-Issue-Erstellung funktionieren dann nicht, da sie die
Netlify-Functions brauchen):

```bash
python -m http.server 8123
```

Für einen vollständigen lokalen Test inklusive Functions:

```bash
npm install -g netlify-cli
netlify dev
```

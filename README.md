# Set Dance Balingen

Anmeldeseite für den Set Dance Termin im Haus des Volkstanzens, Balingen.

Statische Website (HTML/CSS/JS, kein Build-Schritt), gedacht für GitHub Pages.

## Platzhalter anpassen

In [`index.html`](index.html) im Abschnitt "Termin & Ort" folgende Platzhalter durch die echten Angaben ersetzen:

- `data-placeholder="datum"` – Datum und Uhrzeit (aktuell: "voraussichtlich April 2027, langes Wochenende – evtl. Kommunion-Wochenende")
- `data-placeholder="adresse"` – genaue Adresse des Hauses des Volkstanzens
- `data-placeholder="preis"` – Teilnahmebeitrag
- `data-placeholder="anmeldeschluss"` – Anmeldeschluss

## Anmeldeformular

Das Formular ([`js/script.js`](js/script.js)) erzeugt beim Absenden eine vorausgefüllte E-Mail
(`mailto:`) an die im Skript hinterlegte Adresse. Es wird kein Server und kein
Formular-Dienst benötigt. Zieladresse in `ZIEL_EMAIL` in `js/script.js` anpassen, falls nötig.

## Lokal ansehen

`index.html` direkt im Browser öffnen, oder z. B. mit:

```bash
npx serve .
```

## Deployment über GitHub Pages

1. Repository-Einstellungen auf GitHub öffnen → **Pages**
2. Branch `main`, Ordner `/ (root)` auswählen
3. Speichern – die Seite ist danach unter `https://<benutzername>.github.io/<repo-name>/` erreichbar

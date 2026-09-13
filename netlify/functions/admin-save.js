// Admin-Function: prüft das Admin-Passwort serverseitig und schreibt die
// aktualisierte Konfiguration per GitHub Contents API in data/config.json.
// Das GitHub-Token bleibt serverseitig (Umgebungsvariable) und wird nie an
// den Browser ausgeliefert.

const GITHUB_API = "https://api.github.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, ADMIN_PASSWORD } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO || !ADMIN_PASSWORD) {
    return { statusCode: 500, body: "Server ist nicht konfiguriert (Umgebungsvariablen fehlen)." };
  }

  let daten;
  try {
    daten = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Ungültiges JSON." };
  }

  const { password, config } = daten;

  if (password !== ADMIN_PASSWORD) {
    return { statusCode: 401, body: "Falsches Admin-Passwort." };
  }

  if (!config || typeof config !== "object") {
    return { statusCode: 400, body: "Keine gültige Konfiguration übergeben." };
  }

  const path = "data/config.json";
  const headers = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const bestehendeDatei = await fetch(
    `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
    { headers }
  );

  if (!bestehendeDatei.ok) {
    const fehler = await bestehendeDatei.text();
    return { statusCode: 502, body: `GitHub-Fehler beim Lesen: ${fehler}` };
  }

  const { sha } = await bestehendeDatei.json();

  const neuerInhalt = Buffer.from(JSON.stringify(config, null, 2) + "\n", "utf-8").toString("base64");

  const res = await fetch(`${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "Inhalte über Admin-Seite aktualisiert",
      content: neuerInhalt,
      sha,
    }),
  });

  if (!res.ok) {
    const fehler = await res.text();
    return { statusCode: 502, body: `GitHub-Fehler beim Schreiben: ${fehler}` };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};

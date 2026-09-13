// Öffentliche Function: nimmt eine Anmeldung entgegen und legt sie als
// GitHub Issue im Repo ab. Das ist die "eine Tabelle" für Benutzerdaten -
// kein Datenbank-Zugriffstoken landet dabei im Browser der Besucher.

const GITHUB_API = "https://api.github.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { statusCode: 500, body: "Server ist nicht konfiguriert (GitHub-Umgebungsvariablen fehlen)." };
  }

  let daten;
  try {
    daten = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Ungültiges JSON." };
  }

  const { name, email, besucher, optionen, gesamtpreis } = daten;

  if (!name || !email || !besucher) {
    return { statusCode: 400, body: "Name, E-Mail und Besucheranzahl sind erforderlich." };
  }

  const optionenListe = Array.isArray(optionen) && optionen.length
    ? optionen.map((o) => `- ${o.label}: ${o.price.toFixed(2)} €`).join("\n")
    : "- (keine Optionen ausgewählt)";

  const body = [
    `**Name:** ${name}`,
    `**E-Mail:** ${email}`,
    `**Anzahl Besucher:** ${besucher}`,
    "",
    "**Ausgewählte Optionen:**",
    optionenListe,
    "",
    `**Gesamtpreis:** ${Number(gesamtpreis || 0).toFixed(2)} €`,
  ].join("\n");

  const res = await fetch(`${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `Anmeldung: ${name}`,
      body,
      labels: ["anmeldung"],
    }),
  });

  if (!res.ok) {
    const fehler = await res.text();
    return { statusCode: 502, body: `GitHub-Fehler: ${fehler}` };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};

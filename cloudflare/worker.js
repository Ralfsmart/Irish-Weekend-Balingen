// Cloudflare Worker: übernimmt die serverseitigen Aufgaben, die eine rein
// statische GitHub-Pages-Seite nicht selbst erledigen kann.
//
// - GET  /registration-status  -> öffentlich, liefert freie Plätze (Kapazität)
// - POST /submit-registration  -> legt eine Anmeldung als GitHub Issue an
//                                  (Status "bestaetigt" oder "warteliste")
// - GET  /registrations        -> admin-only, liefert alle Anmeldungen für
//                                  die Tabelle im Admin-Tool
// - POST /admin-save           -> admin-only, committet data/config.json
//
// Das GitHub-Token liegt ausschließlich hier als Worker-Secret (env.GITHUB_TOKEN)
// und wird nie an den Browser ausgeliefert.

const GITHUB_API = "https://api.github.com";

function githubHeaders(env) {
  return {
    Authorization: `token ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "set-dance-balingen-worker",
  };
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
  };
}

async function fetchConfig(env) {
  const res = await fetch(
    `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/main/data/config.json`,
    { headers: { "User-Agent": "set-dance-balingen-worker" }, cf: { cacheTtl: 0 } }
  );
  if (!res.ok) return null;
  return res.json();
}

async function fetchAnmeldungIssues(env) {
  const issues = [];
  let page = 1;
  while (page <= 10) {
    const res = await fetch(
      `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues?labels=anmeldung&state=all&per_page=100&page=${page}`,
      { headers: githubHeaders(env) }
    );
    if (!res.ok) break;
    const seite = await res.json();
    issues.push(...seite);
    if (seite.length < 100) break;
    page += 1;
  }
  return issues;
}

function parseIssue(issue) {
  const body = issue.body || "";
  const besucherMatch = body.match(/\*\*Anzahl Besucher:\*\*\s*(\d+)/);
  const emailMatch = body.match(/\*\*E-Mail:\*\*\s*(.+)/);
  const nameMatch = body.match(/\*\*Name:\*\*\s*(.+)/);
  const gesamtpreisMatch = body.match(/\*\*Gesamtpreis:\*\*\s*([\d.,]+)\s*€/);
  const optionenMatch = body.match(/\*\*Ausgewählte Optionen:\*\*\n([\s\S]*?)\n\n\*\*Gesamtpreis/);
  const labelNamen = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));

  return {
    name: nameMatch ? nameMatch[1].trim() : "",
    email: emailMatch ? emailMatch[1].trim() : "",
    besucher: besucherMatch ? parseInt(besucherMatch[1], 10) : 0,
    optionen: optionenMatch ? optionenMatch[1].trim() : "",
    gesamtpreis: gesamtpreisMatch ? gesamtpreisMatch[1] : "",
    status: labelNamen.includes("warteliste") ? "warteliste" : "bestaetigt",
    datum: issue.created_at,
    issueUrl: issue.html_url,
  };
}

async function berechneBelegung(env) {
  const config = await fetchConfig(env);
  const maxBesucher = Number(config && config.maxBesucher) || 0;
  const issues = await fetchAnmeldungIssues(env);
  const bestaetigt = issues
    .map(parseIssue)
    .filter((a) => a.status === "bestaetigt");
  const aktuellBelegt = bestaetigt.reduce((summe, a) => summe + a.besucher, 0);
  return { maxBesucher, aktuellBelegt };
}

async function handleRegistrationStatus(request, env) {
  const { maxBesucher, aktuellBelegt } = await berechneBelegung(env);
  const verbleibend = maxBesucher > 0 ? Math.max(0, maxBesucher - aktuellBelegt) : null;

  return new Response(JSON.stringify({ maxBesucher, aktuellBelegt, verbleibend }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleSubmitRegistration(request, env) {
  const daten = await request.json().catch(() => null);
  if (!daten) return new Response("Ungültiges JSON.", { status: 400 });

  const { name, email, besucher, optionen, gesamtpreis } = daten;
  if (!name || !email || !besucher) {
    return new Response("Name, E-Mail und Besucheranzahl sind erforderlich.", { status: 400 });
  }

  const { maxBesucher, aktuellBelegt } = await berechneBelegung(env);
  const passtNochRein = maxBesucher === 0 || aktuellBelegt + Number(besucher) <= maxBesucher;
  const status = passtNochRein ? "bestaetigt" : "warteliste";

  const optionenListe = Array.isArray(optionen) && optionen.length
    ? optionen.map((o) => `- ${o.label}: ${Number(o.price).toFixed(2)} €`).join("\n")
    : "- (keine Optionen ausgewählt)";

  const body = [
    `**Status:** ${status === "bestaetigt" ? "Bestätigt" : "Warteliste"}`,
    `**Name:** ${name}`,
    `**E-Mail:** ${email}`,
    `**Anzahl Besucher:** ${besucher}`,
    "",
    "**Ausgewählte Optionen:**",
    optionenListe,
    "",
    `**Gesamtpreis:** ${Number(gesamtpreis || 0).toFixed(2)} €`,
  ].join("\n");

  const titelPrefix = status === "bestaetigt" ? "Anmeldung" : "Warteliste";

  const res = await fetch(`${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      title: `${titelPrefix}: ${name}`,
      body,
      labels: ["anmeldung", status],
    }),
  });

  if (!res.ok) {
    return new Response(`GitHub-Fehler: ${await res.text()}`, { status: 502 });
  }

  const neuBelegt = status === "bestaetigt" ? aktuellBelegt + Number(besucher) : aktuellBelegt;
  const verbleibend = maxBesucher > 0 ? Math.max(0, maxBesucher - neuBelegt) : null;

  return new Response(JSON.stringify({ ok: true, status, verbleibend }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleRegistrations(request, env) {
  const password = request.headers.get("X-Admin-Password");
  if (password !== env.ADMIN_PASSWORD) {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }

  const issues = await fetchAnmeldungIssues(env);
  const anmeldungen = issues
    .map(parseIssue)
    .sort((a, b) => new Date(a.datum) - new Date(b.datum));

  return new Response(JSON.stringify({ anmeldungen }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleAdminSave(request, env) {
  const daten = await request.json().catch(() => null);
  if (!daten) return new Response("Ungültiges JSON.", { status: 400 });

  const { password, config } = daten;
  if (password !== env.ADMIN_PASSWORD) {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }
  if (!config || typeof config !== "object") {
    return new Response("Keine gültige Konfiguration übergeben.", { status: 400 });
  }

  const path = "data/config.json";
  const bestehendeDatei = await fetch(
    `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    { headers: githubHeaders(env) }
  );
  if (!bestehendeDatei.ok) {
    return new Response(`GitHub-Fehler beim Lesen: ${await bestehendeDatei.text()}`, { status: 502 });
  }
  const { sha } = await bestehendeDatei.json();

  const neuerInhalt = btoa(unescape(encodeURIComponent(JSON.stringify(config, null, 2) + "\n")));

  const res = await fetch(`${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message: "Inhalte über Admin-Seite aktualisiert",
      content: neuerInhalt,
      sha,
    }),
  });

  if (!res.ok) {
    return new Response(`GitHub-Fehler beim Schreiben: ${await res.text()}`, { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);
    let response;

    if (url.pathname === "/registration-status" && request.method === "GET") {
      response = await handleRegistrationStatus(request, env);
    } else if (url.pathname === "/submit-registration" && request.method === "POST") {
      response = await handleSubmitRegistration(request, env);
    } else if (url.pathname === "/registrations" && request.method === "GET") {
      response = await handleRegistrations(request, env);
    } else if (url.pathname === "/admin-save" && request.method === "POST") {
      response = await handleAdminSave(request, env);
    } else {
      response = new Response("Not found", { status: 404 });
    }

    const responseHeaders = new Headers(response.headers);
    Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  },
};

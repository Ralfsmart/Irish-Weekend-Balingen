// Cloudflare Worker: übernimmt die beiden serverseitigen Aufgaben, die eine
// rein statische GitHub-Pages-Seite nicht selbst erledigen kann.
//
// - POST /submit-registration  -> legt eine Anmeldung als GitHub Issue an
// - POST /admin-save           -> prüft das Admin-Passwort und committet
//                                  die aktualisierte data/config.json
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function handleSubmitRegistration(request, env) {
  const daten = await request.json().catch(() => null);
  if (!daten) return new Response("Ungültiges JSON.", { status: 400 });

  const { name, email, besucher, optionen, gesamtpreis } = daten;
  if (!name || !email || !besucher) {
    return new Response("Name, E-Mail und Besucheranzahl sind erforderlich.", { status: 400 });
  }

  const optionenListe = Array.isArray(optionen) && optionen.length
    ? optionen.map((o) => `- ${o.label}: ${Number(o.price).toFixed(2)} €`).join("\n")
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

  const res = await fetch(`${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({ title: `Anmeldung: ${name}`, body, labels: ["anmeldung"] }),
  });

  if (!res.ok) {
    return new Response(`GitHub-Fehler: ${await res.text()}`, { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
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

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers });
    }

    const url = new URL(request.url);
    let response;

    if (url.pathname === "/submit-registration") {
      response = await handleSubmitRegistration(request, env);
    } else if (url.pathname === "/admin-save") {
      response = await handleAdminSave(request, env);
    } else {
      response = new Response("Not found", { status: 404 });
    }

    const responseHeaders = new Headers(response.headers);
    Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  },
};

// Cloudflare Worker: übernimmt die serverseitigen Aufgaben, die eine rein
// statische GitHub-Pages-Seite nicht selbst erledigen kann.
//
// - GET    /registration-status  -> öffentlich, liefert freie Plätze (Kapazität)
// - POST   /submit-registration  -> speichert eine Anmeldung in D1
//                                    (Status "bestaetigt" oder "warteliste")
// - GET    /registrations        -> admin-only, alle Anmeldungen für die
//                                    Tabelle im Admin-Tool
// - PATCH  /registrations/:id    -> admin-only, Felder/Status einer
//                                    Anmeldung bearbeiten
// - DELETE /registrations/:id    -> admin-only, Anmeldung ganz löschen
// - POST   /admin-save           -> admin-only, committet data/config.json
//                                    auf GitHub
//
// Anmeldungen liegen in der D1-Datenbank (env.DB) - kein Umweg mehr über
// GitHub Issues. Inhalte (data/config.json) bleiben weiterhin ein GitHub-
// Commit, dafür wird das GitHub-Token als Worker-Secret gebraucht.

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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
  };
}

function pruefeAdminPasswort(request, env) {
  return request.headers.get("X-Admin-Password") === env.ADMIN_PASSWORD;
}

// raw.githubusercontent.com liegt hinter einem CDN, das Cache-Busting per
// Query-Parameter teils ignoriert - deshalb die GitHub Contents API nutzen,
// die immer den aktuellen Stand liefert (Rate-Limit ist dank Token unkritisch).
async function fetchConfig(env) {
  const res = await fetch(
    `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/config.json`,
    { headers: githubHeaders(env) }
  );
  if (!res.ok) return null;
  const { content } = await res.json();
  return JSON.parse(decodeURIComponent(escape(atob(content))));
}

async function ermittleBelegung(env) {
  const config = await fetchConfig(env);
  const maxBesucher = Number(config && config.maxBesucher) || 0;
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(SUM(besucher), 0) AS summe FROM registrations WHERE status = 'bestaetigt'"
  ).all();
  const aktuellBelegt = (results[0] && results[0].summe) || 0;
  return { maxBesucher, aktuellBelegt };
}

async function handleRegistrationStatus(request, env) {
  const { maxBesucher, aktuellBelegt } = await ermittleBelegung(env);
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

  const { maxBesucher, aktuellBelegt } = await ermittleBelegung(env);
  const passtNochRein = maxBesucher === 0 || aktuellBelegt + Number(besucher) <= maxBesucher;
  const status = passtNochRein ? "bestaetigt" : "warteliste";

  const optionenText = Array.isArray(optionen) && optionen.length
    ? optionen.map((o) => `${o.label}: ${Number(o.price).toFixed(2)} €`).join("; ")
    : "(keine Optionen ausgewählt)";

  await env.DB.prepare(
    "INSERT INTO registrations (name, email, besucher, optionen, gesamtpreis, status) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(name, email, Number(besucher), optionenText, Number(gesamtpreis || 0), status)
    .run();

  const neuBelegt = status === "bestaetigt" ? aktuellBelegt + Number(besucher) : aktuellBelegt;
  const verbleibend = maxBesucher > 0 ? Math.max(0, maxBesucher - neuBelegt) : null;

  return new Response(JSON.stringify({ ok: true, status, verbleibend }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleListRegistrations(request, env) {
  if (!pruefeAdminPasswort(request, env)) {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }

  const { results } = await env.DB.prepare(
    "SELECT id, name, email, besucher, optionen, gesamtpreis, status, erstellt_am FROM registrations ORDER BY erstellt_am ASC"
  ).all();

  return new Response(JSON.stringify({ anmeldungen: results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleUpdateRegistration(request, env, id) {
  if (!pruefeAdminPasswort(request, env)) {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }

  const daten = await request.json().catch(() => null);
  if (!daten) return new Response("Ungültiges JSON.", { status: 400 });

  const erlaubteFelder = ["name", "email", "besucher", "optionen", "gesamtpreis", "status"];
  const updates = Object.entries(daten).filter(([feld]) => erlaubteFelder.includes(feld));
  if (!updates.length) {
    return new Response("Keine gültigen Felder zum Aktualisieren übergeben.", { status: 400 });
  }

  const setClause = updates.map(([feld]) => `${feld} = ?`).join(", ");
  const werte = updates.map(([, wert]) => wert);

  await env.DB.prepare(`UPDATE registrations SET ${setClause} WHERE id = ?`)
    .bind(...werte, id)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleDeleteRegistration(request, env, id) {
  if (!pruefeAdminPasswort(request, env)) {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }

  await env.DB.prepare("DELETE FROM registrations WHERE id = ?").bind(id).run();

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

    const url = new URL(request.url);
    const registrationIdMatch = url.pathname.match(/^\/registrations\/(\d+)$/);
    let response;

    if (url.pathname === "/registration-status" && request.method === "GET") {
      response = await handleRegistrationStatus(request, env);
    } else if (url.pathname === "/submit-registration" && request.method === "POST") {
      response = await handleSubmitRegistration(request, env);
    } else if (url.pathname === "/registrations" && request.method === "GET") {
      response = await handleListRegistrations(request, env);
    } else if (registrationIdMatch && request.method === "PATCH") {
      response = await handleUpdateRegistration(request, env, registrationIdMatch[1]);
    } else if (registrationIdMatch && request.method === "DELETE") {
      response = await handleDeleteRegistration(request, env, registrationIdMatch[1]);
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

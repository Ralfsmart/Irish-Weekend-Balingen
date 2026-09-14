// Cloudflare Worker: übernimmt die serverseitigen Aufgaben, die eine rein
// statische GitHub-Pages-Seite nicht selbst erledigen kann.
//
// - GET    /registration-status  -> öffentlich, liefert freie Plätze (Kapazität)
// - POST   /submit-registration  -> speichert eine Anmeldung in D1
//                                    (Status "bestaetigt" oder "warteliste")
// - POST   /verify-password      -> öffentlich, prüft ein Passwort und liefert
//                                    das Zugriffslevel ("admin" | "view" | "none")
// - GET    /registrations        -> Level "view" oder "admin", alle Anmeldungen
// - PATCH  /registrations/:id    -> Level "admin", Felder/Status bearbeiten
// - DELETE /registrations/:id    -> Level "admin", Anmeldung löschen
// - POST   /admin-save           -> Level "admin", committet data/config.json
// - POST   /change-passwords     -> Level "admin", ändert die Passwörter
// - POST   /upload-logo          -> Level "admin", ersetzt img/icons/logo.png
//                                    (Header-Logo, Favicon, Social-Share-Bild)
//
// Anmeldungen und die beiden (gehashten) Admin-Passwörter liegen in der
// D1-Datenbank (env.DB) - beides ist von außen nie direkt erreichbar, nur
// über diesen Worker. data/config.json bleibt ein GitHub-Commit, dafür wird
// das GitHub-Token als Worker-Secret gebraucht.

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

async function hashPasswort(text) {
  const data = new TextEncoder().encode("set-dance-balingen::" + text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function holeSettings(env) {
  const { results } = await env.DB.prepare(
    "SELECT view_password_hash, admin_password_hash FROM admin_settings WHERE id = 1"
  ).all();
  return results[0] || null;
}

// Liefert das Zugriffslevel für ein eingegebenes Passwort: "admin", "view"
// oder "none". Wird von allen geschützten Endpunkten genutzt.
async function ermittleLevel(env, passwort) {
  if (!passwort) return "none";
  const settings = await holeSettings(env);
  if (!settings) return "none";
  const hash = await hashPasswort(passwort);
  if (hash === settings.admin_password_hash) return "admin";
  if (hash === settings.view_password_hash) return "view";
  return "none";
}

function passwortAusRequest(request, daten) {
  return request.headers.get("X-Admin-Password") || (daten && daten.password) || null;
}

// Sehr eingeschränkter HTML-Allowlist-Sanitizer für die formatierbaren
// Textfelder (infoText1/infoText2). Läuft server-seitig beim Speichern, da
// dieser HTML-Code später ungefiltert auf der öffentlichen Seite per
// innerHTML angezeigt wird - erlaubt sind nur einfache Textformatierungen,
// keine Skripte, Links, Bilder oder Event-Handler.
const ERLAUBTE_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "span"]);

function sanitizeRichText(html) {
  if (typeof html !== "string") return "";
  // Kompletten Inhalt gefährlicher Tags entfernen (inkl. verschachtelter Inhalte)
  let clean = html.replace(/<(script|style|iframe|object|embed|link|meta|form)[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // Übrige Tags gegen die Allowlist prüfen, alle Attribute außer einer engen
  // "color"-Style-Angabe bei <span> verwerfen.
  clean = clean.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!ERLAUBTE_TAGS.has(lower)) return "";
    const istEndTag = match.startsWith("</");
    if (istEndTag) return `</${lower}>`;
    if (lower === "span") {
      const farbe = attrs.match(/style\s*=\s*"[^"]*color:\s*(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))[^"]*"/i);
      if (farbe) return `<span style="color:${farbe[1]}">`;
    }
    return `<${lower}>`;
  });
  return clean;
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

async function handleVerifyPassword(request, env) {
  const daten = await request.json().catch(() => null);
  const level = await ermittleLevel(env, daten && daten.password);
  return new Response(JSON.stringify({ level }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleChangePasswords(request, env) {
  const daten = await request.json().catch(() => null);
  if (!daten) return new Response("Ungültiges JSON.", { status: 400 });

  const level = await ermittleLevel(env, daten.password);
  if (level !== "admin") {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }

  const settings = await holeSettings(env);
  const neuesAnzeigePasswort = daten.newViewPassword ? await hashPasswort(daten.newViewPassword) : settings.view_password_hash;
  const neuesAdminPasswort = daten.newAdminPassword ? await hashPasswort(daten.newAdminPassword) : settings.admin_password_hash;

  await env.DB.prepare(
    "UPDATE admin_settings SET view_password_hash = ?, admin_password_hash = ? WHERE id = 1"
  )
    .bind(neuesAnzeigePasswort, neuesAdminPasswort)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleListRegistrations(request, env) {
  const level = await ermittleLevel(env, passwortAusRequest(request, null));
  if (level === "none") {
    return new Response("Falsches Passwort.", { status: 401 });
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
  const daten = await request.json().catch(() => null);
  if (!daten) return new Response("Ungültiges JSON.", { status: 400 });

  const level = await ermittleLevel(env, passwortAusRequest(request, daten));
  if (level !== "admin") {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }

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
  const level = await ermittleLevel(env, passwortAusRequest(request, null));
  if (level !== "admin") {
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
  const level = await ermittleLevel(env, password);
  if (level !== "admin") {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }
  if (!config || typeof config !== "object") {
    return new Response("Keine gültige Konfiguration übergeben.", { status: 400 });
  }

  if (typeof config.infoText1 === "string") config.infoText1 = sanitizeRichText(config.infoText1);
  if (typeof config.infoText2 === "string") config.infoText2 = sanitizeRichText(config.infoText2);

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

const PNG_SIGNATUR = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function istGueltigesPng(bytes) {
  return PNG_SIGNATUR.every((b, i) => bytes[i] === b);
}

// Prüft die Base64-Länge grob gegen ein Byte-Limit, ohne vorher zu dekodieren.
function base64LaengeUeberschreitetLimit(base64, maxBytes) {
  const geschaetzteBytes = (base64.length * 3) / 4;
  return geschaetzteBytes > maxBytes;
}

async function handleUploadLogo(request, env) {
  const daten = await request.json().catch(() => null);
  if (!daten) return new Response("Ungültiges JSON.", { status: 400 });

  const level = await ermittleLevel(env, daten.password);
  if (level !== "admin") {
    return new Response("Falsches Admin-Passwort.", { status: 401 });
  }

  const { imageBase64 } = daten;
  if (typeof imageBase64 !== "string" || !imageBase64) {
    return new Response("Kein Bild übergeben.", { status: 400 });
  }

  const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
  const MAX_BYTES = 2 * 1024 * 1024;

  if (base64LaengeUeberschreitetLimit(base64Data, MAX_BYTES)) {
    return new Response("Bild ist zu groß (max. 2 MB).", { status: 400 });
  }

  let bytes;
  try {
    bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  } catch {
    return new Response("Ungültige Bilddaten.", { status: 400 });
  }

  if (bytes.length > MAX_BYTES) {
    return new Response("Bild ist zu groß (max. 2 MB).", { status: 400 });
  }
  if (!istGueltigesPng(bytes)) {
    return new Response("Nur PNG-Bilder werden unterstützt.", { status: 400 });
  }

  const path = "img/icons/logo.png";
  const headers = githubHeaders(env);

  const bestehendeDatei = await fetch(
    `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    { headers }
  );
  const sha = bestehendeDatei.ok ? (await bestehendeDatei.json()).sha : undefined;

  const res = await fetch(`${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "Logo/Icon über Admin-Seite aktualisiert",
      content: base64Data,
      ...(sha ? { sha } : {}),
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
    } else if (url.pathname === "/verify-password" && request.method === "POST") {
      response = await handleVerifyPassword(request, env);
    } else if (url.pathname === "/change-passwords" && request.method === "POST") {
      response = await handleChangePasswords(request, env);
    } else if (url.pathname === "/upload-logo" && request.method === "POST") {
      response = await handleUploadLogo(request, env);
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

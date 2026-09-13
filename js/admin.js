document.getElementById("jahr").textContent = new Date().getFullYear();

let optionenState = [];

function renderOptionen() {
  const container = document.getElementById("options-editor");
  container.innerHTML = "";

  optionenState.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option-editor-row";
    row.innerHTML = `
      <input type="text" class="option-label-input" placeholder="Bezeichnung" value="${option.label}" />
      <input type="number" class="option-price-input" placeholder="Preis (€)" step="0.01" min="0" value="${option.price}" />
      <button type="button" class="btn btn-secondary option-entfernen">Entfernen</button>
    `;

    row.querySelector(".option-label-input").addEventListener("input", (e) => {
      optionenState[index].label = e.target.value;
    });
    row.querySelector(".option-price-input").addEventListener("input", (e) => {
      optionenState[index].price = parseFloat(e.target.value) || 0;
    });
    row.querySelector(".option-entfernen").addEventListener("click", () => {
      optionenState.splice(index, 1);
      renderOptionen();
    });

    container.appendChild(row);
  });
}

document.getElementById("option-hinzufuegen").addEventListener("click", () => {
  optionenState.push({ id: `option-${Date.now()}`, label: "", price: 0 });
  renderOptionen();
});

async function ladeKonfiguration() {
  const res = await fetch("data/config.json", { cache: "no-store" });
  const config = await res.json();

  document.getElementById("headline").value = config.headline || "";
  document.getElementById("subheadline").value = config.subheadline || "";
  document.getElementById("infoText1").value = config.infoText1 || "";
  document.getElementById("infoText2").value = config.infoText2 || "";
  document.getElementById("targetEmail").value = config.targetEmail || "";
  document.getElementById("apiBase").value = config.apiBase || "";
  document.getElementById("maxBesucher").value = config.maxBesucher || 0;

  optionenState = (config.options || []).map((o) => ({ ...o }));
  renderOptionen();
}

document.getElementById("admin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("admin-status");
  status.textContent = "Speichere …";

  const apiBase = document.getElementById("apiBase").value.trim().replace(/\/$/, "");

  const config = {
    headline: document.getElementById("headline").value.trim(),
    subheadline: document.getElementById("subheadline").value.trim(),
    infoText1: document.getElementById("infoText1").value.trim(),
    infoText2: document.getElementById("infoText2").value.trim(),
    targetEmail: document.getElementById("targetEmail").value.trim(),
    apiBase,
    maxBesucher: parseInt(document.getElementById("maxBesucher").value, 10) || 0,
    options: optionenState
      .filter((o) => o.label.trim().length > 0)
      .map((o) => ({ id: o.id, label: o.label.trim(), price: o.price })),
  };

  const password = document.getElementById("admin-password").value;

  if (!apiBase) {
    status.textContent = "Fehler: Cloudflare-Worker-URL fehlt. Beim allerersten Mal data/config.json direkt auf GitHub bearbeiten.";
    return;
  }

  try {
    const res = await fetch(`${apiBase}/admin-save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, config }),
    });

    if (res.ok) {
      status.textContent = "Gespeichert – die Änderungen sind live.";
    } else {
      const text = await res.text();
      status.textContent = `Fehler: ${text}`;
    }
  } catch (err) {
    status.textContent = `Fehler beim Speichern: ${err.message}`;
  }
});

let geladeneAnmeldungen = [];

function csvFeld(wert) {
  const text = String(wert ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

document.getElementById("anmeldungen-laden-btn").addEventListener("click", async () => {
  const status = document.getElementById("registrations-status");
  const apiBase = document.getElementById("apiBase").value.trim().replace(/\/$/, "");
  const password = document.getElementById("admin-password").value;

  if (!apiBase) {
    status.textContent = "Fehler: Cloudflare-Worker-URL fehlt.";
    return;
  }
  if (!password) {
    status.textContent = "Bitte zuerst das Admin-Passwort oben eingeben.";
    return;
  }

  status.textContent = "Lade Anmeldungen …";

  try {
    const res = await fetch(`${apiBase}/registrations`, {
      headers: { "X-Admin-Password": password },
    });

    if (!res.ok) {
      status.textContent = `Fehler: ${await res.text()}`;
      return;
    }

    const daten = await res.json();
    geladeneAnmeldungen = daten.anmeldungen || [];

    const tbody = document.getElementById("registrations-tbody");
    tbody.innerHTML = geladeneAnmeldungen.map((a) => `
      <tr>
        <td>${a.status === "warteliste" ? "Warteliste" : "Bestätigt"}</td>
        <td>${a.offen ? "Ja" : "Nein (geschlossen)"}</td>
        <td>${a.name}</td>
        <td>${a.email}</td>
        <td>${a.besucher}</td>
        <td>${a.optionen.replace(/\n/g, ", ")}</td>
        <td>${a.gesamtpreis} €</td>
        <td>${new Date(a.datum).toLocaleDateString("de-DE")}</td>
      </tr>
    `).join("");

    document.getElementById("registrations-count").textContent = geladeneAnmeldungen.length;
    document.getElementById("registrations-panel").hidden = false;
    document.getElementById("registrations-panel").open = true;
    status.textContent = "";
  } catch (err) {
    status.textContent = `Fehler beim Laden: ${err.message}`;
  }
});

document.getElementById("csv-download-btn").addEventListener("click", () => {
  const kopfzeile = ["Status", "Zählt?", "Name", "E-Mail", "Besucher", "Optionen", "Gesamtpreis", "Datum"];
  const zeilen = geladeneAnmeldungen.map((a) => [
    a.status === "warteliste" ? "Warteliste" : "Bestätigt",
    a.offen ? "Ja" : "Nein (geschlossen)",
    a.name,
    a.email,
    a.besucher,
    a.optionen.replace(/\n/g, "; "),
    a.gesamtpreis,
    new Date(a.datum).toLocaleDateString("de-DE"),
  ]);

  const csv = [kopfzeile, ...zeilen].map((zeile) => zeile.map(csvFeld).join(",")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "anmeldungen.csv";
  a.click();
  URL.revokeObjectURL(url);
});

ladeKonfiguration();

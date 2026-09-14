document.getElementById("jahr").textContent = new Date().getFullYear();

let optionenState = [];
let geladeneAnmeldungen = [];
let aktuellesLevel = "none";
let aktuellesPasswort = "";
let quill1 = null;
let quill2 = null;
let ausgewaehltesLogo = null;

function apiBaseWert() {
  return document.getElementById("apiBase").value.trim().replace(/\/$/, "");
}

function csvFeld(wert) {
  const text = String(wert ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderOptionen() {
  const container = document.getElementById("options-editor");
  container.innerHTML = "";
  const bearbeitbar = aktuellesLevel === "admin";

  optionenState.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option-editor-row";
    row.innerHTML = `
      <input type="text" class="option-label-input" placeholder="Bezeichnung" value="${option.label}" ${bearbeitbar ? "" : "disabled"} />
      <input type="number" class="option-price-input" placeholder="Preis (€)" step="0.01" min="0" value="${option.price}" ${bearbeitbar ? "" : "disabled"} />
      <button type="button" class="btn btn-secondary option-entfernen" ${bearbeitbar ? "" : "hidden"}>Entfernen</button>
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

function initQuill() {
  const toolbarOptions = [
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["clean"],
  ];
  quill1 = new Quill("#infoText1-editor", { theme: "snow", modules: { toolbar: toolbarOptions } });
  quill2 = new Quill("#infoText2-editor", { theme: "snow", modules: { toolbar: toolbarOptions } });
}

async function ladeKonfiguration() {
  const res = await fetch("data/config.json", { cache: "no-store" });
  const config = await res.json();

  document.getElementById("headline").value = config.headline || "";
  document.getElementById("subheadline").value = config.subheadline || "";
  quill1.root.innerHTML = config.infoText1 || "";
  quill2.root.innerHTML = config.infoText2 || "";
  document.getElementById("targetEmail").value = config.targetEmail || "";
  document.getElementById("apiBase").value = config.apiBase || "";
  document.getElementById("maxBesucher").value = config.maxBesucher || 0;

  optionenState = (config.options || []).map((o) => ({ ...o }));
  renderOptionen();
}

function wendeLevelAufFormularAn() {
  const bearbeitbar = aktuellesLevel === "admin";
  const hinweis = document.getElementById("access-level-hinweis");
  hinweis.textContent = bearbeitbar
    ? "Bearbeiten-Modus: Änderungen können gespeichert werden."
    : "Anzeige-Modus (nur lesen): Inhalte und Anmeldungen sind sichtbar, aber nicht änderbar.";

  ["headline", "subheadline", "targetEmail", "apiBase", "maxBesucher"].forEach((id) => {
    document.getElementById(id).disabled = !bearbeitbar;
  });
  quill1.enable(bearbeitbar);
  quill2.enable(bearbeitbar);
  document.getElementById("option-hinzufuegen").hidden = !bearbeitbar;
  document.getElementById("save-row").hidden = !bearbeitbar;
  document.getElementById("password-section").hidden = !bearbeitbar;
  document.getElementById("logo-upload").hidden = !bearbeitbar;
  document.getElementById("logo-upload-btn").hidden = !bearbeitbar;
  renderOptionen();
}

document.getElementById("unlock-btn").addEventListener("click", async () => {
  const status = document.getElementById("unlock-status");
  const passwort = document.getElementById("unlock-password").value;
  const apiBase = apiBaseWert() || (await fetch("data/config.json", { cache: "no-store" }).then((r) => r.json()).then((c) => c.apiBase));

  if (!apiBase) {
    status.textContent = "Fehler: Cloudflare-Worker-URL ist in data/config.json nicht gesetzt.";
    return;
  }
  if (!passwort) {
    status.textContent = "Bitte ein Passwort eingeben.";
    return;
  }

  status.textContent = "Prüfe Passwort …";

  try {
    const res = await fetch(`${apiBase}/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwort }),
    });
    const { level } = await res.json();

    if (level === "none") {
      status.textContent = "Falsches Passwort.";
      return;
    }

    aktuellesLevel = level;
    aktuellesPasswort = passwort;
    status.textContent = "";

    document.getElementById("lock-screen").hidden = true;
    document.getElementById("admin-content").hidden = false;
    document.getElementById("registrations-section").hidden = false;

    initQuill();
    await ladeKonfiguration();
    wendeLevelAufFormularAn();
    await ladeAnmeldungen();
  } catch (err) {
    status.textContent = `Fehler: ${err.message}`;
  }
});

document.getElementById("admin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (aktuellesLevel !== "admin") return;

  const status = document.getElementById("admin-status");
  status.textContent = "Speichere …";

  const apiBase = apiBaseWert();

  const config = {
    headline: document.getElementById("headline").value.trim(),
    subheadline: document.getElementById("subheadline").value.trim(),
    infoText1: quill1.root.innerHTML,
    infoText2: quill2.root.innerHTML,
    targetEmail: document.getElementById("targetEmail").value.trim(),
    apiBase,
    maxBesucher: parseInt(document.getElementById("maxBesucher").value, 10) || 0,
    options: optionenState
      .filter((o) => o.label.trim().length > 0)
      .map((o) => ({ id: o.id, label: o.label.trim(), price: o.price })),
  };

  if (!apiBase) {
    status.textContent = "Fehler: Cloudflare-Worker-URL fehlt.";
    return;
  }

  try {
    const res = await fetch(`${apiBase}/admin-save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: aktuellesPasswort, config }),
    });

    if (res.ok) {
      status.textContent = "Gespeichert – die Änderungen sind live. (Rich-Text-Inhalte werden serverseitig auf erlaubte Formatierungen geprüft.)";
    } else {
      status.textContent = `Fehler: ${await res.text()}`;
    }
  } catch (err) {
    status.textContent = `Fehler beim Speichern: ${err.message}`;
  }
});

document.getElementById("change-passwords-btn").addEventListener("click", async () => {
  if (aktuellesLevel !== "admin") return;
  const status = document.getElementById("password-status");
  const apiBase = apiBaseWert();
  const neuesAnzeige = document.getElementById("new-view-password").value.trim();
  const neuesBearbeiten = document.getElementById("new-admin-password").value.trim();

  if (!neuesAnzeige && !neuesBearbeiten) {
    status.textContent = "Bitte mindestens ein neues Passwort eingeben.";
    return;
  }

  status.textContent = "Speichere Passwörter …";

  try {
    const res = await fetch(`${apiBase}/change-passwords`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: aktuellesPasswort,
        newViewPassword: neuesAnzeige || undefined,
        newAdminPassword: neuesBearbeiten || undefined,
      }),
    });

    if (res.ok) {
      status.textContent = "Passwörter gespeichert.";
      if (neuesBearbeiten) aktuellesPasswort = neuesBearbeiten;
      document.getElementById("new-view-password").value = "";
      document.getElementById("new-admin-password").value = "";
    } else {
      status.textContent = `Fehler: ${await res.text()}`;
    }
  } catch (err) {
    status.textContent = `Fehler: ${err.message}`;
  }
});

document.getElementById("logo-upload").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const status = document.getElementById("logo-status");
  if (!file) return;

  if (file.type !== "image/png") {
    status.textContent = "Bitte eine PNG-Datei auswählen.";
    e.target.value = "";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    status.textContent = "Datei ist zu groß (max. 2 MB).";
    e.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    ausgewaehltesLogo = reader.result;
    document.getElementById("logo-preview").src = reader.result;
    status.textContent = "Vorschau aktualisiert – zum Übernehmen auf \"Logo hochladen\" klicken.";
  };
  reader.readAsDataURL(file);
});

document.getElementById("logo-upload-btn").addEventListener("click", async () => {
  if (aktuellesLevel !== "admin") return;
  const status = document.getElementById("logo-status");

  if (!ausgewaehltesLogo) {
    status.textContent = "Bitte zuerst eine PNG-Datei auswählen.";
    return;
  }

  const apiBase = apiBaseWert();
  status.textContent = "Lade Logo hoch …";

  try {
    const res = await fetch(`${apiBase}/upload-logo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: aktuellesPasswort, imageBase64: ausgewaehltesLogo }),
    });

    status.textContent = res.ok
      ? "Logo gespeichert – die Änderung ist live."
      : `Fehler: ${await res.text()}`;
  } catch (err) {
    status.textContent = `Fehler beim Hochladen: ${err.message}`;
  }
});

function renderRegistrationsTable() {
  const bearbeitbar = aktuellesLevel === "admin";
  const tbody = document.getElementById("registrations-tbody");
  tbody.innerHTML = "";

  geladeneAnmeldungen.forEach((a) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <select class="reg-status" ${bearbeitbar ? "" : "disabled"}>
          <option value="bestaetigt" ${a.status === "bestaetigt" ? "selected" : ""}>Bestätigt</option>
          <option value="warteliste" ${a.status === "warteliste" ? "selected" : ""}>Warteliste</option>
        </select>
      </td>
      <td><input type="text" class="reg-name" value="${a.name}" ${bearbeitbar ? "" : "disabled"} /></td>
      <td><input type="email" class="reg-email" value="${a.email}" ${bearbeitbar ? "" : "disabled"} /></td>
      <td><input type="number" class="reg-besucher" min="1" value="${a.besucher}" style="width:4rem" ${bearbeitbar ? "" : "disabled"} /></td>
      <td><input type="text" class="reg-optionen" value="${a.optionen}" style="width:16rem" ${bearbeitbar ? "" : "disabled"} /></td>
      <td><input type="number" class="reg-gesamtpreis" step="0.01" min="0" value="${a.gesamtpreis}" style="width:5rem" ${bearbeitbar ? "" : "disabled"} /></td>
      <td>${new Date(a.erstellt_am).toLocaleDateString("de-DE")}</td>
      <td>
        <button type="button" class="btn btn-secondary reg-speichern" ${bearbeitbar ? "" : "hidden"}>Speichern</button>
        <button type="button" class="btn btn-secondary reg-loeschen" ${bearbeitbar ? "" : "hidden"}>Löschen</button>
      </td>
    `;

    row.querySelector(".reg-speichern").addEventListener("click", () => aktualisiereAnmeldung(a.id, row));
    row.querySelector(".reg-loeschen").addEventListener("click", () => loescheAnmeldung(a.id));

    tbody.appendChild(row);
  });
}

async function ladeAnmeldungen() {
  const status = document.getElementById("registrations-status");
  const apiBase = apiBaseWert();

  status.textContent = "Lade Anmeldungen …";

  try {
    const res = await fetch(`${apiBase}/registrations`, {
      headers: { "X-Admin-Password": aktuellesPasswort },
    });

    if (!res.ok) {
      status.textContent = `Fehler: ${await res.text()}`;
      return;
    }

    const daten = await res.json();
    geladeneAnmeldungen = daten.anmeldungen || [];
    renderRegistrationsTable();
    document.getElementById("registrations-count").textContent = geladeneAnmeldungen.length;
    status.textContent = "";
  } catch (err) {
    status.textContent = `Fehler beim Laden: ${err.message}`;
  }
}

async function aktualisiereAnmeldung(id, row) {
  const apiBase = apiBaseWert();
  const registrationsStatus = document.getElementById("registrations-status");

  const config = {
    status: row.querySelector(".reg-status").value,
    name: row.querySelector(".reg-name").value.trim(),
    email: row.querySelector(".reg-email").value.trim(),
    besucher: parseInt(row.querySelector(".reg-besucher").value, 10) || 1,
    optionen: row.querySelector(".reg-optionen").value.trim(),
    gesamtpreis: parseFloat(row.querySelector(".reg-gesamtpreis").value) || 0,
  };

  registrationsStatus.textContent = "Speichere Anmeldung …";

  try {
    const res = await fetch(`${apiBase}/registrations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Admin-Password": aktuellesPasswort },
      body: JSON.stringify(config),
    });

    registrationsStatus.textContent = res.ok ? "Anmeldung gespeichert." : `Fehler: ${await res.text()}`;
  } catch (err) {
    registrationsStatus.textContent = `Fehler beim Speichern: ${err.message}`;
  }
}

async function loescheAnmeldung(id) {
  if (!window.confirm("Diese Anmeldung wirklich unwiderruflich löschen?")) return;

  const apiBase = apiBaseWert();
  const registrationsStatus = document.getElementById("registrations-status");

  try {
    const res = await fetch(`${apiBase}/registrations/${id}`, {
      method: "DELETE",
      headers: { "X-Admin-Password": aktuellesPasswort },
    });

    if (res.ok) {
      geladeneAnmeldungen = geladeneAnmeldungen.filter((a) => a.id !== id);
      renderRegistrationsTable();
      document.getElementById("registrations-count").textContent = geladeneAnmeldungen.length;
      registrationsStatus.textContent = "Anmeldung gelöscht.";
    } else {
      registrationsStatus.textContent = `Fehler: ${await res.text()}`;
    }
  } catch (err) {
    registrationsStatus.textContent = `Fehler beim Löschen: ${err.message}`;
  }
}

document.getElementById("csv-download-btn").addEventListener("click", () => {
  const kopfzeile = ["Status", "Name", "E-Mail", "Besucher", "Optionen", "Gesamtpreis", "Datum"];
  const zeilen = geladeneAnmeldungen.map((a) => [
    a.status === "warteliste" ? "Warteliste" : "Bestätigt",
    a.name,
    a.email,
    a.besucher,
    a.optionen,
    a.gesamtpreis,
    new Date(a.erstellt_am).toLocaleDateString("de-DE"),
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

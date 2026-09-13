document.getElementById("jahr").textContent = new Date().getFullYear();

let config = null;
let ausgewaehlteOptionen = [];

const eur = (zahl) => zahl.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

async function ladeKonfiguration() {
  const res = await fetch("data/config.json", { cache: "no-store" });
  config = await res.json();

  document.getElementById("headline").textContent = config.headline || "";
  document.getElementById("subheadline").textContent = config.subheadline || "";
  document.getElementById("info-text-1").textContent = config.infoText1 || "";
  document.getElementById("info-text-2").textContent = config.infoText2 || "";

  const liste = document.getElementById("options-list");
  liste.innerHTML = "";
  (config.options || []).forEach((option) => {
    const id = `option-${option.id}`;
    const wrapper = document.createElement("label");
    wrapper.className = "option-item";
    wrapper.innerHTML = `
      <input type="checkbox" id="${id}" value="${option.id}" />
      <span class="option-label">${option.label}</span>
      <span class="option-price">${eur(option.price)}</span>
    `;
    liste.appendChild(wrapper);
  });

  ladeKapazitaet();
}

async function ladeKapazitaet() {
  const hinweis = document.getElementById("kapazitaet-hinweis");
  if (!config.apiBase) return;

  try {
    const res = await fetch(`${config.apiBase}/registration-status`, { cache: "no-store" });
    if (!res.ok) return;
    const { maxBesucher, verbleibend } = await res.json();

    if (!maxBesucher) return;

    hinweis.hidden = false;
    hinweis.textContent = verbleibend > 0
      ? `Noch ${verbleibend} von ${maxBesucher} Plätzen frei.`
      : "Die Veranstaltung ist ausgebucht – Anmeldungen kommen auf die Warteliste.";
  } catch {
    // Kapazitätsanzeige ist ein Komfortfeature, kein Fehler nötig.
  }
}

function ermittleAusgewaehlteOptionen() {
  const checkboxen = document.querySelectorAll('#options-list input[type="checkbox"]:checked');
  return Array.from(checkboxen).map((cb) => config.options.find((o) => o.id === cb.value));
}

function berechneGesamtpreis(optionen) {
  return optionen.reduce((summe, o) => summe + o.price, 0);
}

function formatiereRechnungsblock(optionen, gesamtpreis) {
  const gesamtLabel = "Gesamtpreis";
  const gesamtPreisText = eur(gesamtpreis);

  if (!optionen.length) {
    return `(keine Optionen ausgewählt)\n\n${gesamtLabel}: ${gesamtPreisText}`;
  }

  const eintraege = optionen.map((o) => ({ label: o.label, preis: eur(o.price) }));
  const maxLabelLaenge = Math.max(...eintraege.map((e) => e.label.length), gesamtLabel.length);
  const maxPreisLaenge = Math.max(...eintraege.map((e) => e.preis.length), gesamtPreisText.length);

  const zeile = (label, preis) => `${label.padEnd(maxLabelLaenge + 2)}${preis.padStart(maxPreisLaenge)}`;
  const trennlinie = "━".repeat(maxLabelLaenge + 2 + maxPreisLaenge);

  return [
    ...eintraege.map((e) => zeile(e.label, e.preis)),
    trennlinie,
    zeile(gesamtLabel, gesamtPreisText),
  ].join("\n");
}

function zeigeUebersicht(daten) {
  ausgewaehlteOptionen = ermittleAusgewaehlteOptionen();
  const gesamtpreis = berechneGesamtpreis(ausgewaehlteOptionen);

  const datenListe = document.getElementById("uebersicht-daten");
  datenListe.innerHTML = `
    <dt>Name</dt><dd>${daten.name}</dd>
    <dt>E-Mail</dt><dd>${daten.email}</dd>
    <dt>Anzahl Besucher</dt><dd>${daten.besucher}</dd>
  `;

  const optionenListe = document.getElementById("uebersicht-optionen");
  optionenListe.innerHTML = ausgewaehlteOptionen.length
    ? ausgewaehlteOptionen.map((o) => `<li>${o.label} – ${eur(o.price)}</li>`).join("")
    : "<li>Keine Optionen ausgewählt</li>";

  document.getElementById("gesamtpreis").textContent = eur(gesamtpreis);

  document.getElementById("step-1").hidden = true;
  document.getElementById("step-2").hidden = false;
}

document.getElementById("kontakt-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const daten = new FormData(form);
  zeigeUebersicht({
    besucher: daten.get("besucher"),
    name: daten.get("name").trim(),
    email: daten.get("email").trim(),
  });
});

document.getElementById("zurueck-btn").addEventListener("click", () => {
  document.getElementById("step-2").hidden = true;
  document.getElementById("step-1").hidden = false;
});

function formularZuruecksetzen() {
  document.getElementById("kontakt-form").reset();
  document.querySelectorAll('#options-list input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
  document.getElementById("fallback-block").hidden = true;
  document.getElementById("form-status").textContent = "";
  document.getElementById("step-2").hidden = true;
  document.getElementById("step-1").hidden = false;
}

document.getElementById("abbrechen-btn").addEventListener("click", formularZuruecksetzen);
document.getElementById("abbrechen-btn-2").addEventListener("click", formularZuruecksetzen);

document.getElementById("senden-btn").addEventListener("click", async () => {
  const status = document.getElementById("form-status");
  const sendenBtn = document.getElementById("senden-btn");
  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const besucher = document.getElementById("besucher").value;
  const gesamtpreis = berechneGesamtpreis(ausgewaehlteOptionen);

  sendenBtn.disabled = true;
  status.textContent = "Wird gesendet …";

  let registrierungsStatus = "bestaetigt";

  if (config.apiBase) {
    try {
      const res = await fetch(`${config.apiBase}/submit-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          besucher,
          optionen: ausgewaehlteOptionen,
          gesamtpreis,
        }),
      });
      if (res.ok) {
        const daten = await res.json();
        registrierungsStatus = daten.status || "bestaetigt";
      }
    } catch {
      // E-Mail bleibt der primäre Weg, falls der Worker nicht erreichbar ist.
    }
  }

  const istWarteliste = registrierungsStatus === "warteliste";
  const betreff = `${istWarteliste ? "Warteliste" : "Anmeldung"} Set Dance Balingen – ${name}`;
  const body = [
    istWarteliste ? "Hinweis: Die Veranstaltung war zum Zeitpunkt der Anmeldung bereits ausgebucht (Warteliste)." : null,
    istWarteliste ? "" : null,
    `Name: ${name}`,
    `E-Mail: ${email}`,
    `Anzahl Besucher: ${besucher}`,
    "",
    "Ausgewählte Optionen:",
    formatiereRechnungsblock(ausgewaehlteOptionen, gesamtpreis),
  ].filter((zeile) => zeile !== null).join("\n");

  const mailtoUrl = `mailto:${config.targetEmail}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoUrl;

  status.textContent = istWarteliste
    ? "Die Veranstaltung ist ausgebucht – du wurdest auf die Warteliste gesetzt. Dein E-Mail-Programm wird geöffnet, bitte die Nachricht absenden."
    : "Du bist angemeldet! Dein E-Mail-Programm wird geöffnet – bitte die Nachricht dort absenden.";

  document.getElementById("fallback-email").textContent = config.targetEmail;
  document.getElementById("fallback-text").value = `Betreff: ${betreff}\n\n${body}`;
  document.getElementById("fallback-block").hidden = false;
  sendenBtn.disabled = false;
});

document.getElementById("fallback-copy-btn").addEventListener("click", async () => {
  const text = document.getElementById("fallback-text").value;
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("fallback-copy-btn").textContent = "Kopiert!";
  } catch {
    document.getElementById("fallback-text").select();
  }
});

ladeKonfiguration();

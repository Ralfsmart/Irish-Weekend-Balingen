const ZIEL_EMAIL = "ralf.schultheiss@googlemail.com";

document.getElementById("jahr").textContent = new Date().getFullYear();

const form = document.getElementById("anmeldeformular");
const status = document.getElementById("form-status");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const daten = new FormData(form);
  const vorname = daten.get("vorname").trim();
  const nachname = daten.get("nachname").trim();
  const email = daten.get("email").trim();
  const telefon = daten.get("telefon").trim();
  const personen = daten.get("personen");
  const nachricht = daten.get("nachricht").trim();

  const betreff = `Anmeldung Set Dance Balingen – ${vorname} ${nachname}`;
  const zeilen = [
    `Name: ${vorname} ${nachname}`,
    `E-Mail: ${email}`,
    telefon ? `Telefon: ${telefon}` : null,
    `Anzahl Personen: ${personen}`,
    nachricht ? `Anmerkungen: ${nachricht}` : null,
  ].filter(Boolean);

  const body = zeilen.join("\n");
  const mailtoUrl = `mailto:${ZIEL_EMAIL}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(body)}`;

  window.location.href = mailtoUrl;
  status.textContent = "Dein E-Mail-Programm wird geöffnet – bitte die Nachricht dort absenden.";
});

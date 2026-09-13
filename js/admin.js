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

  optionenState = (config.options || []).map((o) => ({ ...o }));
  renderOptionen();
}

document.getElementById("admin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("admin-status");
  status.textContent = "Speichere …";

  const config = {
    headline: document.getElementById("headline").value.trim(),
    subheadline: document.getElementById("subheadline").value.trim(),
    infoText1: document.getElementById("infoText1").value.trim(),
    infoText2: document.getElementById("infoText2").value.trim(),
    targetEmail: document.getElementById("targetEmail").value.trim(),
    options: optionenState
      .filter((o) => o.label.trim().length > 0)
      .map((o) => ({ id: o.id, label: o.label.trim(), price: o.price })),
  };

  const password = document.getElementById("admin-password").value;

  try {
    const res = await fetch("/api/admin-save", {
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

ladeKonfiguration();

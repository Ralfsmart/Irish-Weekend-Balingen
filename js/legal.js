document.getElementById("jahr").textContent = new Date().getFullYear();

const feld = document.currentScript.dataset.feld;

(async () => {
  try {
    const res = await fetch("data/config.json", { cache: "no-store" });
    const config = await res.json();
    // Kommt bereits serverseitig sanitisiert aus data/config.json (siehe Worker) - innerHTML ist hier sicher.
    document.getElementById("legal-text").innerHTML = config[feld] || "<p>Noch kein Text hinterlegt.</p>";
  } catch {
    document.getElementById("legal-text").innerHTML = "<p>Inhalt konnte nicht geladen werden.</p>";
  }
})();

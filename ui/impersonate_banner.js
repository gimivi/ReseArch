// ui/impersonate_banner.js
// Bottone "Torna al tuo account" del banner impersonazione (ui/header.php).
// Nessun global richiesto: legge/scrive solo l'endpoint api/impersonate_tool.php.

(function () {
  "use strict";

  const btn = document.getElementById("btnImpersonateStop");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = t("header.impersonate_stopping");
    try {
      const r = await fetch("api/impersonate_tool.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const j = await r.json().catch(() => null);
      if (!j || !j.success) throw new Error((j && j.error) || `Errore HTTP ${r.status}`);
      window.location.href = j.data?.redirect || "researches.php";
    } catch (e) {
      alert(t("common.error") + ": " + (e.message || String(e)));
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-box-arrow-left" aria-hidden="true"></i>';   // pulsante a sola icona (aria-label nel PHP)
    }
  });
})();

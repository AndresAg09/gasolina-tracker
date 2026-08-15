(function () {
  "use strict";

  const {
    $, loadNum, saveNum, showToast, initSidebar, loadEntries,
    loadTankCapacity, loadOilNextKm,
    TANK_KEY, CONSERV_KEY, RESERVE_GAL_KEY, OIL_NEXT_KEY, OIL_REF_KEY
  } = window.GT;

  function init() {
    initSidebar();

    // Ajustes del vehículo (capacidad, rendimiento conservador, reserva)
    if (loadTankCapacity()) $("#in-capacidad-tanque").value = loadTankCapacity();
    if (loadNum(CONSERV_KEY)) $("#in-rendimiento-conservador").value = loadNum(CONSERV_KEY);
    if (loadNum(RESERVE_GAL_KEY)) $("#in-reserva-galones").value = loadNum(RESERVE_GAL_KEY);

    $("#btn-guardar-vehiculo").addEventListener("click", () => {
      const capIn = $("#in-capacidad-tanque").value, capV = Number(capIn);
      saveNum(TANK_KEY, capIn && capV > 0 ? capV : null);

      const consIn = $("#in-rendimiento-conservador").value, consV = Number(consIn);
      saveNum(CONSERV_KEY, consIn && consV > 0 ? consV : null);

      const resIn = $("#in-reserva-galones").value, resV = Number(resIn);
      saveNum(RESERVE_GAL_KEY, resIn && resV > 0 ? resV : null);

      showToast("Ajustes del vehículo guardados");
      window.GTSync.pushInBackground();
    });

    // Ajustes de aceite: solo se pide el próximo cambio (el número del
    // mecánico/calcomanía). El punto de partida de la barra de progreso se
    // guarda solo, usando el km más reciente que tengas registrado en ese momento.
    if (loadOilNextKm()) $("#in-aceite-proximo").value = loadOilNextKm();

    $("#btn-guardar-aceite").addEventListener("click", () => {
      const nextIn = $("#in-aceite-proximo").value, nextV = Number(nextIn);
      const previousNext = loadOilNextKm();

      if (nextIn && nextV > 0) {
        if (nextV !== previousNext) {
          const entries = loadEntries();
          const kmConocido = entries.length ? Math.max(...entries.map(e => e.odometro)) : null;
          saveNum(OIL_REF_KEY, kmConocido);
        }
        saveNum(OIL_NEXT_KEY, nextV);
      } else {
        saveNum(OIL_NEXT_KEY, null);
        saveNum(OIL_REF_KEY, null);
      }

      showToast("Recordatorio de aceite guardado");
      window.GTSync.pushInBackground();
    });

    // ── Sincronización (GitHub Gist) ────────────────────────────
    const { loadToken, saveToken, loadGistId, saveGistId, lastSyncedAt, createGist, syncNow } = window.GTSync;

    if (loadToken()) $("#in-sync-token").value = loadToken();
    if (loadGistId()) $("#in-sync-gist").value = loadGistId();

    function renderSyncStatus() {
      const last = lastSyncedAt();
      $("#sync-status").textContent = last
        ? `Última sincronización: ${last.toLocaleString("es-CR")}`
        : "Todavía no sincronizado.";
    }
    renderSyncStatus();

    function readSyncFields() {
      const token = $("#in-sync-token").value.trim();
      const gistId = $("#in-sync-gist").value.trim();
      if (token) saveToken(token);
      if (gistId) saveGistId(gistId);
      return { token, gistId };
    }

    $("#btn-sync-crear").addEventListener("click", async () => {
      const { token } = readSyncFields();
      if (!token) { showToast("Pegá primero el token de GitHub"); return; }
      if (loadGistId()) {
        showToast("Ya hay un Gist configurado — usá \"Sincronizar ahora\", o borrá el ID del Gist si querés crear uno nuevo.");
        return;
      }
      showToast("Creando Gist…");
      try {
        const id = await createGist();
        $("#in-sync-gist").value = id;
        const box = $("#sync-gist-id-result");
        box.style.display = "";
        box.innerHTML = `Gist creado: <strong style="color:var(--text); font-family:var(--mono);">${id}</strong><br>Copiá este ID y pegalo junto con el mismo token en tus otros dispositivos.`;
        renderSyncStatus();
        showToast("Gist creado y sincronizado");
      } catch (err) {
        showToast("No se pudo crear el Gist: " + err.message);
      }
    });

    $("#btn-sync-ahora").addEventListener("click", async () => {
      const { token, gistId } = readSyncFields();
      if (!token || !gistId) { showToast("Completá el token y el ID del Gist"); return; }
      showToast("Sincronizando…");
      try {
        await syncNow();
        renderSyncStatus();
        showToast("Sincronizado");
      } catch (err) {
        showToast("No se pudo sincronizar: " + err.message);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

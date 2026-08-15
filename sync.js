// Sincronización entre dispositivos usando un Gist privado de GitHub como
// almacenamiento central. Requiere un Personal Access Token con permiso
// "gist" (ver config.html). El token se guarda en localStorage de cada
// dispositivo — tratalo como una contraseña.
window.GTSync = (function () {
  "use strict";

  const {
    loadEntries, saveEntries, loadNum, saveNum,
    TANK_KEY, CONSERV_KEY, RESERVE_GAL_KEY, OIL_NEXT_KEY, OIL_REF_KEY
  } = window.GT;

  const TOKEN_KEY = "gt_gist_token_v1";
  const GIST_ID_KEY = "gt_gist_id_v1";
  const LAST_SYNC_KEY = "gt_last_sync_at_v1";
  const FILENAME = "gasolina-tracker-data.json";

  function loadToken() { return localStorage.getItem(TOKEN_KEY) || null; }
  function saveToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
  function loadGistId() { return localStorage.getItem(GIST_ID_KEY) || null; }
  function saveGistId(id) { if (id) localStorage.setItem(GIST_ID_KEY, id); else localStorage.removeItem(GIST_ID_KEY); }
  function isConfigured() { return !!(loadToken() && loadGistId()); }

  function lastSyncedAt() {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    return raw ? new Date(Number(raw)) : null;
  }
  function markSynced() { localStorage.setItem(LAST_SYNC_KEY, String(Date.now())); }

  // ── Payload: todo lo que se sincroniza ──────────────────────
  function collectPayload() {
    return {
      entries: loadEntries(),
      settings: {
        tankCapacity: loadNum(TANK_KEY),
        conservador: loadNum(CONSERV_KEY),
        reservaGalones: loadNum(RESERVE_GAL_KEY),
        oilNextKm: loadNum(OIL_NEXT_KEY),
        oilRefKm: loadNum(OIL_REF_KEY)
      }
    };
  }

  // Combina lo remoto con lo local sin perder nada:
  // - tanqueos: unión por odómetro (nunca se borran, solo se agregan los que faltan)
  // - ajustes: si el remoto trae un valor, ese gana (último que sincronizó manda)
  function applyPayload(remote) {
    const localEntries = loadEntries();
    const byOdo = new Set(localEntries.map(e => e.odometro));
    const remoteEntries = Array.isArray(remote.entries) ? remote.entries : [];
    const merged = localEntries.concat(
      remoteEntries.filter(e => e && typeof e.odometro === "number" && !byOdo.has(e.odometro))
    );
    saveEntries(merged);

    const s = remote.settings || {};
    if (s.tankCapacity != null) saveNum(TANK_KEY, s.tankCapacity);
    if (s.conservador != null) saveNum(CONSERV_KEY, s.conservador);
    if (s.reservaGalones != null) saveNum(RESERVE_GAL_KEY, s.reservaGalones);
    if (s.oilNextKm != null) saveNum(OIL_NEXT_KEY, s.oilNextKm);
    if (s.oilRefKm != null) saveNum(OIL_REF_KEY, s.oilRefKm);

    return merged;
  }

  // ── GitHub API ───────────────────────────────────────────────
  async function apiFetch(url, options) {
    const token = loadToken();
    if (!token) throw new Error("Falta el token de GitHub");
    const res = await fetch(url, Object.assign({}, options, {
      headers: Object.assign({
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github+json"
      }, (options && options.headers) || {})
    }));
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async function createGist() {
    const payload = collectPayload();
    const data = await apiFetch("https://api.github.com/gists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Datos de Tracker de Gasolina — no editar a mano",
        public: false,
        files: { [FILENAME]: { content: JSON.stringify(payload, null, 2) } }
      })
    });
    saveGistId(data.id);
    markSynced();
    return data.id;
  }

  async function pullMerge() {
    const gistId = loadGistId();
    if (!gistId) throw new Error("No hay Gist configurado");
    const data = await apiFetch(`https://api.github.com/gists/${gistId}`);
    const file = data.files && data.files[FILENAME];
    if (!file || !file.content) throw new Error("El Gist no tiene el archivo esperado");
    const remote = JSON.parse(file.content);
    return applyPayload(remote);
  }

  async function pushCurrent() {
    const gistId = loadGistId();
    if (!gistId) throw new Error("No hay Gist configurado");
    const payload = collectPayload();
    await apiFetch(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: { [FILENAME]: { content: JSON.stringify(payload, null, 2) } } })
    });
    markSynced();
  }

  // Trae lo remoto, lo combina con lo local, y sube el resultado combinado
  // para que ambos lados queden iguales.
  async function syncNow() {
    if (!isConfigured()) throw new Error("Sincronización no configurada");
    await pullMerge();
    await pushCurrent();
  }

  // Push silencioso en segundo plano después de un cambio local; no molesta
  // al usuario si falla (ej. sin internet) — solo queda desactualizado hasta
  // la próxima sincronización exitosa.
  function pushInBackground() {
    if (!isConfigured()) return;
    pushCurrent().catch(err => console.warn("[sync] push en segundo plano falló:", err));
  }

  return {
    isConfigured, loadToken, saveToken, loadGistId, saveGistId, lastSyncedAt,
    createGist, pullMerge, pushCurrent, syncNow, pushInBackground
  };
})();

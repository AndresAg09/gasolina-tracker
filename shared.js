// Utilidades y almacenamiento compartidos entre index.html y config.html
window.GT = (function () {
  "use strict";

  const STORAGE_KEY = "gt_entries_v1";
  const TANK_KEY = "gt_tank_capacity_v1";
  const CONSERV_KEY = "gt_rendimiento_conservador_v1";
  const RESERVE_GAL_KEY = "gt_reserva_galones_v1";
  const OIL_NEXT_KEY = "gt_oil_next_km_v1";
  const OIL_REF_KEY = "gt_oil_ref_km_v1";

  const $ = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("No se pudo leer el almacenamiento local", e);
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function loadNum(key) {
    const raw = localStorage.getItem(key);
    const n = Number(raw);
    return raw && isFinite(n) && n > 0 ? n : null;
  }

  function saveNum(key, v) {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  }

  const loadTankCapacity = () => loadNum(TANK_KEY);
  const loadReservaGalones = () => loadNum(RESERVE_GAL_KEY) || 1;
  const loadOilNextKm = () => loadNum(OIL_NEXT_KEY);
  const loadOilRefKm = () => loadNum(OIL_REF_KEY);

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
  }

  function fmtNum(n, decimals) {
    if (n == null || !isFinite(n)) return "—";
    return n.toLocaleString("es-CR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function fmtMoney(n) {
    if (n == null || !isFinite(n)) return "—";
    return "$" + fmtNum(n, 2);
  }

  function escHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function showToast(msg) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function initSidebar() {
    const btnMenu = $("#btn-menu");
    const sidebar = $("#sidebar");
    const backdrop = $("#sidebar-backdrop");
    const btnClose = $("#btn-close-sidebar");
    if (!btnMenu || !sidebar || !backdrop) return;

    const open = () => { sidebar.classList.add("show"); backdrop.classList.add("show"); };
    const close = () => { sidebar.classList.remove("show"); backdrop.classList.remove("show"); };

    btnMenu.addEventListener("click", open);
    backdrop.addEventListener("click", close);
    if (btnClose) btnClose.addEventListener("click", close);
  }

  return {
    STORAGE_KEY, TANK_KEY, CONSERV_KEY, RESERVE_GAL_KEY, OIL_NEXT_KEY, OIL_REF_KEY,
    $, $$, uid,
    loadEntries, saveEntries, loadNum, saveNum,
    loadTankCapacity, loadReservaGalones, loadOilNextKm, loadOilRefKm,
    fmtDate, fmtNum, fmtMoney, escHTML, showToast, initSidebar
  };
})();

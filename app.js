(function () {
  "use strict";

  const {
    $, uid, loadEntries, saveEntries: saveEntriesRaw, loadNum, saveNum,
    loadTankCapacity, loadReservaGalones, loadOilNextKm, loadOilRefKm,
    fmtDate, fmtNum, fmtMoney, escHTML, showToast, initSidebar,
    CONSERV_KEY
  } = window.GT;

  // ── State ───────────────────────────────────────────────────
  let entries = loadEntries();
  let editingId = null;
  let chart = null;
  let confirmCallback = null;

  function saveEntries() {
    saveEntriesRaw(entries);
    window.GTSync.pushInBackground();
  }

  // ── Helpers ─────────────────────────────────────────────────
  function sortedByOdometro() {
    return [...entries].sort((a, b) => a.odometro - b.odometro);
  }

  function sortedByFecha() {
    return [...entries].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.odometro - b.odometro);
  }

  // ── Calculations ────────────────────────────────────────────
  // Rendimiento por segmentos: de un tanqueo "lleno" al siguiente,
  // dividiendo el km recorrido entre TODOS los galones puestos en ese tramo
  // (así los llenados parciales intermedios no distorsionan el cálculo).
  function computeSegments() {
    const byOdo = sortedByOdometro();
    const segments = [];
    let lastFull = null;
    let galonesAcum = 0;

    for (const e of byOdo) {
      galonesAcum += Number(e.galones) || 0;
      if (e.lleno) {
        if (lastFull) {
          const km = e.odometro - lastFull.odometro;
          if (km > 0 && galonesAcum > 0) {
            segments.push({
              fechaInicio: lastFull.fecha,
              fechaFin: e.fecha,
              odometroFin: e.odometro,
              km,
              galones: galonesAcum,
              kmPorGalon: km / galonesAcum
            });
          }
        }
        lastFull = e;
        galonesAcum = 0;
      }
    }
    return segments;
  }

  function computeStats() {
    const segments = computeSegments();
    const totalKm = segments.reduce((s, x) => s + x.km, 0);
    const totalGal = segments.reduce((s, x) => s + x.galones, 0);
    const rendimientoPromedio = totalGal > 0 ? totalKm / totalGal : null;

    const totalMonto = entries.reduce((s, x) => s + (Number(x.monto) || 0), 0);
    const totalGalTodos = entries.reduce((s, x) => s + (Number(x.galones) || 0), 0);
    const precioPromedioGalon = totalGalTodos > 0 ? totalMonto / totalGalTodos : null;
    const costoPorKm = (rendimientoPromedio && precioPromedioGalon) ? precioPromedioGalon / rendimientoPromedio : null;

    const porFecha = sortedByFecha();
    let diasPromedio = null;
    if (porFecha.length >= 2) {
      const diffs = [];
      for (let i = 1; i < porFecha.length; i++) {
        const d1 = new Date(porFecha[i - 1].fecha + "T00:00:00");
        const d2 = new Date(porFecha[i].fecha + "T00:00:00");
        const diff = (d2 - d1) / 86400000;
        if (diff > 0) diffs.push(diff);
      }
      if (diffs.length) diasPromedio = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    }

    let proximaFecha = null;
    if (porFecha.length && diasPromedio) {
      const last = new Date(porFecha[porFecha.length - 1].fecha + "T00:00:00");
      proximaFecha = new Date(last.getTime() + diasPromedio * 86400000);
    }

    const lastFullEntry = [...sortedByOdometro()].reverse().find(e => e.lleno) || null;

    // Rendimiento conservador: el peor tramo registrado (para no quedarse
    // varado), salvo que el usuario haya puesto un valor propio en "Otros registros".
    const rendimientoConservadorAuto = segments.length
      ? Math.min(...segments.map(s => s.kmPorGalon))
      : null;
    const rendimientoConservadorManual = loadNum(CONSERV_KEY);
    const rendimientoConservador = rendimientoConservadorManual || rendimientoConservadorAuto || rendimientoPromedio;

    const tankCapacity = loadTankCapacity();
    const reservaGalones = loadReservaGalones();

    // Km más reciente conocido (cualquier tanqueo, no solo llenos) — se usa
    // para saber cuánto has avanzado desde el último full o el último cambio de aceite.
    const kmConocido = entries.length ? Math.max(...entries.map(e => e.odometro)) : null;

    // Autonomía desde el último tanqueo lleno. Si conocemos la capacidad del
    // tanque se usa esa (lo correcto: "lleno" = capacidad, sin importar
    // cuántos galones se hayan puesto esta vez). Si no, se aproxima con los
    // galones puestos en ese tanqueo (solo válido si venía casi vacío).
    let autonomia = null;
    if (lastFullEntry && rendimientoConservador) {
      const galonesUsables = tankCapacity != null ? tankCapacity : lastFullEntry.galones;
      const esAproximado = tankCapacity == null;
      const totalKm = galonesUsables * rendimientoConservador;
      const hastaReservaKm = Math.max(0, galonesUsables - reservaGalones) * rendimientoConservador;
      const recorridoDesdeLleno = Math.max(0, (kmConocido != null ? kmConocido : lastFullEntry.odometro) - lastFullEntry.odometro);
      autonomia = {
        esAproximado,
        totalKm,
        hastaReservaKm,
        odometroReserva: lastFullEntry.odometro + hastaReservaKm,
        odometroVacio: lastFullEntry.odometro + totalKm,
        pctHastaReserva: hastaReservaKm > 0 ? Math.max(0, Math.min(100, (recorridoDesdeLleno / hastaReservaKm) * 100)) : 100,
        pctHastaVacio: totalKm > 0 ? Math.max(0, Math.min(100, (recorridoDesdeLleno / totalKm) * 100)) : 100
      };
    }

    // Aceite: el usuario solo da el km del próximo cambio (lo que dice el
    // mecánico/calcomanía). El punto de partida de la barra es el km que
    // tenías registrado cuando guardaste ese número (gt_oil_ref_km_v1).
    const oilNextKm = loadOilNextKm();
    const oilRefKm = loadOilRefKm();
    let aceite = null;
    if (oilNextKm != null) {
      const faltanKm = kmConocido != null ? oilNextKm - kmConocido : null;
      let pct = 0;
      if (oilRefKm != null && kmConocido != null && oilNextKm > oilRefKm) {
        pct = Math.max(0, Math.min(100, ((kmConocido - oilRefKm) / (oilNextKm - oilRefKm)) * 100));
      }
      aceite = { proximoKm: oilNextKm, faltanKm, pct };
    }

    return {
      segments, rendimientoPromedio, precioPromedioGalon, costoPorKm, diasPromedio, proximaFecha,
      lastFullEntry, rendimientoConservador, rendimientoConservadorAuto, tankCapacity, reservaGalones,
      autonomia, kmConocido, aceite
    };
  }

  // ── Render: KPIs ────────────────────────────────────────────
  function renderKpis(stats) {
    $("#kpi-rendimiento").textContent = stats.rendimientoPromedio ? fmtNum(stats.rendimientoPromedio, 1) : "—";
    $("#kpi-frecuencia").textContent = stats.diasPromedio ? fmtNum(stats.diasPromedio, 0) : "—";
    $("#kpi-costokm").textContent = stats.costoPorKm ? fmtMoney(stats.costoPorKm) : "—";
    $("#kpi-costokm-sub").textContent = stats.precioPromedioGalon ? (fmtMoney(stats.precioPromedioGalon) + " / galón") : "—";

    if (stats.proximaFecha) {
      $("#kpi-proximo").textContent = stats.proximaFecha.toLocaleDateString("es-CR", { day: "2-digit", month: "short" });
      const diasRestantes = Math.round((stats.proximaFecha - new Date()) / 86400000);
      $("#kpi-proximo-sub").textContent = diasRestantes >= 0 ? `en ~${diasRestantes} días` : `hace ${-diasRestantes} días`;
    } else {
      $("#kpi-proximo").textContent = "—";
      $("#kpi-proximo-sub").textContent = "estimado";
    }

    const kpiTanqueCard = $("#kpi-card-tanque");
    if (stats.tankCapacity && stats.rendimientoPromedio) {
      kpiTanqueCard.style.display = "";
      $("#kpi-tanque").textContent = fmtNum(stats.tankCapacity * stats.rendimientoPromedio, 0);
    } else {
      kpiTanqueCard.style.display = "none";
    }

    const navSub = $("#nav-sub");
    if (entries.length === 0) {
      navSub.textContent = "Sin datos aún";
    } else {
      const last = sortedByFecha()[entries.length - 1];
      navSub.textContent = `${entries.length} tanqueo${entries.length === 1 ? "" : "s"} · último ${fmtDate(last.fecha)}`;
    }
  }

  // ── Render: autonomy check ─────────────────────────────────
  function resetAutonomyResult() {
    $("#autonomy-result").classList.remove("show");
  }

  function calcularAutonomia() {
    const stats = computeStats();
    const input = $("#in-odometro-actual");
    const actual = Number(input.value);

    if (!input.value || isNaN(actual)) {
      showToast("Ingresá el odómetro actual");
      return;
    }
    if (!stats.autonomia) {
      showToast("Necesitás al menos 2 tanqueos llenos para calcular esto");
      return;
    }

    const rangoTotal = stats.autonomia.totalKm;
    const recorridos = actual - stats.lastFullEntry.odometro;
    const restante = Math.max(0, rangoTotal - recorridos);
    const pct = rangoTotal > 0 ? Math.max(0, Math.min(100, (restante / rangoTotal) * 100)) : 0;

    $("#res-recorridos").textContent = fmtNum(recorridos, 0);
    $("#res-restante").textContent = fmtNum(restante, 0);

    const fill = $("#range-bar-fill");
    fill.style.width = pct + "%";
    fill.style.background = pct >= 40 ? "var(--green)" : (pct >= 15 ? "var(--orange)" : "var(--red)");

    $("#autonomy-result").classList.add("show");

    if (recorridos < 0) {
      showToast("Ese odómetro es menor al del último tanqueo lleno — revisá el dato");
    } else if (pct <= 0) {
      showToast("Ya deberías haber tanqueado según el estimado");
    }
  }

  // ── Render: estado actual (reserva / vacío / aceite) ────────
  function miniBarColor(pct) {
    if (pct >= 90) return "var(--red)";
    if (pct >= 70) return "var(--orange)";
    return "var(--green)";
  }

  function setMiniBar(id, pct) {
    const el = $(id);
    if (!el) return;
    el.style.width = Math.max(2, pct) + "%";
    el.style.background = miniBarColor(pct);
  }

  function renderEstado(stats) {
    const empty = $("#estado-empty");
    const content = $("#estado-content");

    if (entries.length === 0) {
      empty.style.display = "";
      content.style.display = "none";
      return;
    }
    empty.style.display = "none";
    content.style.display = "";

    // Reserva / vacío — necesitan al menos 2 tanqueos llenos
    if (stats.autonomia) {
      $("#estado-base-wrap").style.display = "";
      $("#estado-fecha").textContent = fmtDate(stats.lastFullEntry.fecha);
      $("#estado-odo").textContent = fmtNum(stats.lastFullEntry.odometro, 0);

      $("#estado-reserva-km").textContent = fmtNum(stats.autonomia.odometroReserva, 0);
      $("#estado-reserva-sub").textContent = `~${fmtNum(stats.autonomia.hastaReservaKm, 0)} km desde ese tanqueo`;
      setMiniBar("#estado-reserva-bar", stats.autonomia.pctHastaReserva);

      $("#estado-vacio-km").textContent = fmtNum(stats.autonomia.odometroVacio, 0);
      $("#estado-vacio-sub").textContent = `~${fmtNum(stats.autonomia.totalKm, 0)} km desde ese tanqueo`;
      setMiniBar("#estado-vacio-bar", stats.autonomia.pctHastaVacio);
    } else {
      $("#estado-base-wrap").style.display = "none";
      $("#estado-reserva-km").textContent = "—";
      $("#estado-reserva-sub").textContent = "Necesitás 2 tanqueos llenos";
      setMiniBar("#estado-reserva-bar", 0);
      $("#estado-vacio-km").textContent = "—";
      $("#estado-vacio-sub").textContent = "Necesitás 2 tanqueos llenos";
      setMiniBar("#estado-vacio-bar", 0);
    }

    // Aceite — independiente de los tanqueos llenos, solo necesita configuración
    if (stats.aceite) {
      $("#estado-aceite-km").textContent = fmtNum(stats.aceite.proximoKm, 0);
      setMiniBar("#estado-aceite-bar", stats.aceite.pct);
      if (stats.aceite.faltanKm != null) {
        const f = stats.aceite.faltanKm;
        const cls = f <= 0 ? "negative" : (stats.aceite.pct >= 85 ? "warning" : "positive");
        const txt = f <= 0 ? `Vencido hace ${fmtNum(-f, 0)} km` : `Faltan ${fmtNum(f, 0)} km (${fmtNum(stats.aceite.pct, 0)}% recorrido)`;
        $("#estado-aceite-sub").innerHTML = `<span class="${cls}">${txt}</span>`;
      } else {
        $("#estado-aceite-sub").textContent = "Registrá un tanqueo para saber cuánto falta";
      }
    } else {
      $("#estado-aceite-km").textContent = "—";
      setMiniBar("#estado-aceite-bar", 0);
      $("#estado-aceite-sub").innerHTML = 'Configurá el aceite en <a href="config.html" style="color:var(--blue-light);">Otros registros</a>';
    }

    const notas = [];
    if (stats.autonomia) {
      notas.push(`Rendimiento usado para la proyección: ${fmtNum(stats.rendimientoConservador, 1)} km/gal (conservador${loadNum(CONSERV_KEY) ? ", ajustado por vos" : ", el peor tramo registrado"}).`);
      if (stats.autonomia.esAproximado) {
        notas.push("No configuraste la capacidad del tanque, así que se usó lo que pusiste en ese tanqueo como si fuera el tanque completo — puede quedarse corto si no llenaste desde casi vacío. Ajustala en “Otros registros”.");
      }
    }
    $("#estado-rendimiento-nota").textContent = notas.join(" ");
  }

  // ── Render: chart ───────────────────────────────────────────
  function renderChart(stats) {
    const section = $("#section-chart");
    if (stats.segments.length < 1) {
      section.style.display = "none";
      return;
    }
    section.style.display = "";

    const labels = stats.segments.map(s => fmtDate(s.fechaFin));
    const data = stats.segments.map(s => Number(s.kmPorGalon.toFixed(1)));

    const ctx = $("#chart-rendimiento").getContext("2d");
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "km/galón",
          data,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.15)",
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: "#60a5fa"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.06)" } },
          y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(148,163,184,0.06)" }, beginAtZero: false }
        }
      }
    });
  }

  // ── Render: history table ──────────────────────────────────
  function renderHistory() {
    const wrap = $("#history-wrap");
    if (entries.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">⛽</div><div>Todavía no has registrado ningún tanqueo.</div></div>`;
      return;
    }

    const rows = sortedByFecha().slice().reverse().map(e => {
      const precioGal = e.galones ? (e.monto / e.galones) : null;
      return `
        <tr data-id="${e.id}">
          <td>${fmtDate(e.fecha)}</td>
          <td>${fmtNum(e.odometro, 0)}</td>
          <td>${fmtNum(e.galones, 3)}</td>
          <td>${fmtMoney(e.monto)}</td>
          <td>${precioGal ? fmtMoney(precioGal) : "—"}</td>
          <td><span class="pill ${e.lleno ? "full" : "partial"}">${e.lleno ? "Lleno" : "Parcial"}</span></td>
          <td>${e.nota ? escHTML(e.nota) : "—"}</td>
          <td>
            <div class="row-actions">
              <button data-action="edit" title="Editar">✎</button>
              <button data-action="delete" title="Eliminar">🗑</button>
            </div>
          </td>
        </tr>`;
    }).join("");

    wrap.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th><th>Odómetro</th><th>Galones</th><th>Monto</th>
              <th>$/gal</th><th>Tipo</th><th>Nota</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Render all ──────────────────────────────────────────────
  function renderAll() {
    const stats = computeStats();
    renderKpis(stats);
    renderEstado(stats);
    renderChart(stats);
    renderHistory();
    resetAutonomyResult();
  }

  // ── Form: add / edit ────────────────────────────────────────
  function resetForm() {
    $("#form-entry").reset();
    $("#in-lleno").checked = true;
    $("#in-fecha").value = new Date().toISOString().slice(0, 10);
    editingId = null;
    $("#btn-submit").textContent = "Guardar tanqueo";
    $("#btn-cancel-edit").style.display = "none";
  }

  function fillFormForEdit(entry) {
    editingId = entry.id;
    $("#in-fecha").value = entry.fecha;
    $("#in-odometro").value = entry.odometro;
    $("#in-galones").value = entry.galones;
    $("#in-monto").value = entry.monto;
    $("#in-nota").value = entry.nota || "";
    $("#in-lleno").checked = !!entry.lleno;
    $("#btn-submit").textContent = "Guardar cambios";
    $("#btn-cancel-edit").style.display = "";
    $("#form-entry").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleSubmit(ev) {
    ev.preventDefault();
    const fecha = $("#in-fecha").value;
    const odometro = Number($("#in-odometro").value);
    const galones = Number($("#in-galones").value);
    const monto = Number($("#in-monto").value);
    const nota = $("#in-nota").value.trim();
    const lleno = $("#in-lleno").checked;

    if (!fecha || !odometro || !galones || !monto) {
      showToast("Completá fecha, odómetro, galones y monto");
      return;
    }

    const dup = entries.find(e => e.odometro === odometro && e.id !== editingId);
    if (dup) {
      showToast("Ya existe un tanqueo con ese odómetro");
      return;
    }

    const tankCapacity = loadTankCapacity();
    const capacityWarning = (lleno && tankCapacity && galones > tankCapacity * 1.05)
      ? `Ojo: pusiste ${fmtNum(galones, 1)} gal, más que la capacidad configurada (${fmtNum(tankCapacity, 1)} gal). Se guardó igual — revisá el dato.`
      : null;

    if (editingId) {
      const idx = entries.findIndex(e => e.id === editingId);
      if (idx !== -1) entries[idx] = { ...entries[idx], fecha, odometro, galones, monto, nota, lleno };
      showToast(capacityWarning || "Tanqueo actualizado");
    } else {
      entries.push({ id: uid(), fecha, odometro, galones, monto, nota, lleno });
      showToast(capacityWarning || "Tanqueo guardado");
    }

    saveEntries();
    resetForm();
    renderAll();
  }

  // ── Modal confirm ───────────────────────────────────────────
  function openConfirm(title, body, onConfirm) {
    $("#modal-title").textContent = title;
    $("#modal-body").textContent = body;
    confirmCallback = onConfirm;
    $("#modal-confirm").classList.add("show");
  }

  function closeConfirm() {
    $("#modal-confirm").classList.remove("show");
    confirmCallback = null;
  }

  // ── History row actions ─────────────────────────────────────
  function handleHistoryClick(ev) {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    const tr = ev.target.closest("tr[data-id]");
    const id = tr.dataset.id;
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    if (btn.dataset.action === "edit") {
      fillFormForEdit(entry);
    } else if (btn.dataset.action === "delete") {
      openConfirm(
        "Eliminar tanqueo",
        `¿Eliminar el tanqueo del ${fmtDate(entry.fecha)} (${fmtNum(entry.odometro, 0)} km)? Esta acción no se puede deshacer.`,
        () => {
          entries = entries.filter(e => e.id !== id);
          saveEntries();
          renderAll();
          showToast("Tanqueo eliminado");
        }
      );
    }
  }

  // ── Export / Import ──────────────────────────────────────────
  function exportData() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gasolina-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Respaldo descargado");
  }

  // Acepta el formato propio de la app y también nombres de campo comunes
  // de otras fuentes (ej. exportes hechos con IA): kilometraje_km, km,
  // costo_usd, costo, precio, gal.
  function normalizeImportEntry(e) {
    if (!e || typeof e !== "object") return null;
    const odometro = [e.odometro, e.kilometraje_km, e.km, e.odometer].find(v => typeof v === "number");
    const galones = [e.galones, e.gal, e.gallons].find(v => typeof v === "number");
    const monto = [e.monto, e.costo_usd, e.costo, e.precio, e.amount].find(v => typeof v === "number");
    const fecha = typeof e.fecha === "string" ? e.fecha : (typeof e.date === "string" ? e.date : null);
    if (odometro == null || galones == null || monto == null || fecha == null) return null;
    return {
      id: e.id || uid(),
      fecha, odometro, galones, monto,
      nota: e.nota || "",
      lleno: e.lleno !== false
    };
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error("Formato inválido");

        // Filas sin fecha/odómetro/galones/monto completos (ej. checkpoints
        // sin datos de tanqueo real) se omiten en vez de rechazar todo el archivo.
        const normalized = parsed.map(normalizeImportEntry);
        const valid = normalized.filter(e => e !== null);
        const incompletos = normalized.length - valid.length;

        if (valid.length === 0) {
          showToast("Ningún registro del archivo tiene fecha, odómetro, galones y monto completos.");
          return;
        }

        // Se agrega a lo que ya hay (no reemplaza), evitando duplicados por odómetro.
        const odometrosExistentes = new Set(entries.map(e => e.odometro));
        const nuevos = valid.filter(e => !odometrosExistentes.has(e.odometro));
        const yaExistian = valid.length - nuevos.length;

        if (nuevos.length === 0) {
          const detalle = [];
          if (yaExistian > 0) detalle.push(`${yaExistian} ya estaban registrados`);
          if (incompletos > 0) detalle.push(`${incompletos} sin datos completos`);
          showToast(`No hay tanqueos nuevos para agregar${detalle.length ? " — " + detalle.join(", ") : ""}.`);
          return;
        }

        const detalle = [`${nuevos.length} tanqueo${nuevos.length === 1 ? "" : "s"} nuevo${nuevos.length === 1 ? "" : "s"} para agregar`];
        if (yaExistian > 0) detalle.push(`${yaExistian} ya estaban registrados (se omiten)`);
        if (incompletos > 0) detalle.push(`${incompletos} sin galones/monto completos (se omiten)`);

        openConfirm(
          "Importar y agregar",
          `${detalle.join(". ")}. Se van a sumar a tus ${entries.length} tanqueos actuales, sin borrar nada. ¿Continuar?`,
          () => {
            entries = entries.concat(nuevos);
            saveEntries();
            renderAll();
            showToast(`${nuevos.length} tanqueo${nuevos.length === 1 ? "" : "s"} agregado${nuevos.length === 1 ? "" : "s"}`);
          }
        );
      } catch (e) {
        showToast("No se pudo leer el archivo — ¿es un respaldo válido?");
      }
    };
    reader.readAsText(file);
  }

  // ── Wire up ──────────────────────────────────────────────────
  function init() {
    initSidebar();
    $("#in-fecha").value = new Date().toISOString().slice(0, 10);

    $("#form-entry").addEventListener("submit", handleSubmit);
    $("#btn-cancel-edit").addEventListener("click", resetForm);
    $("#btn-calcular").addEventListener("click", calcularAutonomia);
    $("#in-odometro-actual").addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); calcularAutonomia(); } });

    $("#history-wrap").addEventListener("click", handleHistoryClick);

    $("#btn-export").addEventListener("click", exportData);
    $("#btn-import").addEventListener("click", () => $("#file-import").click());
    $("#file-import").addEventListener("change", ev => {
      const file = ev.target.files[0];
      if (file) importData(file);
      ev.target.value = "";
    });

    $("#modal-confirm-btn").addEventListener("click", () => {
      if (confirmCallback) confirmCallback();
      closeConfirm();
    });
    $("#modal-cancel-btn").addEventListener("click", closeConfirm);
    $("#modal-confirm").addEventListener("click", ev => { if (ev.target.id === "modal-confirm") closeConfirm(); });

    $("#btn-sync").addEventListener("click", async () => {
      if (!window.GTSync.isConfigured()) {
        showToast("Configurá la sincronización en Otros registros");
        return;
      }
      showToast("Sincronizando…");
      try {
        await window.GTSync.syncNow();
        entries = loadEntries();
        renderAll();
        showToast("Sincronizado");
      } catch (err) {
        showToast("No se pudo sincronizar: " + err.message);
      }
    });

    renderAll();

    // Al abrir la página, si ya está configurada la sincronización, trae lo
    // último de otros dispositivos en silencio (sin bloquear la carga inicial).
    if (window.GTSync.isConfigured()) {
      window.GTSync.syncNow()
        .then(() => { entries = loadEntries(); renderAll(); })
        .catch(err => console.warn("[sync] auto-sync al cargar falló:", err));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

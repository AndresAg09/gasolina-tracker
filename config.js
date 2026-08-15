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
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

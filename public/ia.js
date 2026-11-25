(function () {
"use strict";
/* ============================================================================
   PRONÓSTICO IA · riesgo dentro de 15 s
   La predicción NO se hace aquí: la hace el cuaderno de Colab
   (ia/Proyecto_IA_Nodo_Rio.ipynb, sección 9). El cuaderno escucha el tópico de
   datos, predice con el modelo entrenado y publica en ucol-eq1/rio/nodo1/ia:
     {"riesgo_15s":0|1|2, "prob":[bajo,medio,alto], "riesgo_ahora":0|1|2,
      "modo":"auto"|"manual", "horizonte_s":15, "modelo":"XGBoost", "t":<s>}
   Esta tarjeta sólo lo muestra. La IA no mueve la compuerta ni el buzzer:
   la alerta real sigue en el firmware.
   app.js llama a IA.recibir() con cada mensaje de ese tópico.
   ========================================================================== */

const CONFIG = {
  msSinDatos: 5000               // sin mensajes de la IA en este tiempo, la tarjeta pasa a "esperando"
};

const $ = id => document.getElementById(id);
const dom = {
  ia: $('ia'), txt: $('iaTxt'), en: $('iaEn'), nota: $('iaNota'), origen: $('iaOrigen'), prob: $('iaProb'),
  barras: [$('iaPb'), $('iaPm'), $('iaPa')], valores: [$('iaVb'), $('iaVm'), $('iaVa')]
};
const CLASES = ['bajo', 'medio', 'alto'];

let ultimo = null;               // último pronóstico recibido
let tUltimo = 0;
let negado = false;              // el broker no deja leer el tópico de la IA

function clase(v) {
  const n = Number(v);
  return n === 0 || n === 1 || n === 2 ? n : null;
}

// ===== MENSAJE DEL CUADERNO DE COLAB =====
function recibir(d) {
  if (!d || typeof d !== 'object') return;
  const c = clase(d.riesgo_15s);
  if (c === null) return;
  let prob = Array.isArray(d.prob) && d.prob.length === 3 ? d.prob.map(Number) : null;
  if (!prob || prob.some(p => !Number.isFinite(p))) prob = CLASES.map((_, i) => (i === c ? 1 : 0));
  ultimo = {
    clase: c,
    prob: prob,
    ahora: clase(d.riesgo_ahora),
    manual: String(d.modo).toLowerCase() === 'manual',
    horizonte: Number(d.horizonte_s) || 15,
    modelo: d.modelo ? String(d.modelo) : 'IA'
  };
  tUltimo = Date.now();
  negado = false;
  pintar();
}

// ===== TARJETA =====
function pintar() {
  const vivo = ultimo && Date.now() - tUltimo < CONFIG.msSinDatos;
  dom.origen.hidden = !vivo;
  if (!vivo) {
    dom.ia.dataset.nivel = 'sin';
    dom.ia.dataset.anticipa = 'false';
    dom.txt.textContent = '—';
    dom.barras.forEach(b => b.style.setProperty('--p', 0));
    dom.valores.forEach(v => { v.textContent = '–'; });
    dom.prob.textContent = '\u00a0';
    if (negado) dom.nota.textContent = 'El broker no deja leer el tópico de la IA: revisa su ACL';
    else if (ultimo) dom.nota.textContent = 'La IA dejó de publicar: revisa el cuaderno de Colab';
    else dom.nota.textContent = 'Esperando a la IA: ejecuta la sección 9 del cuaderno de Colab';
    return;
  }
  const nombre = CLASES[ultimo.clase];
  dom.ia.dataset.nivel = nombre;
  dom.txt.textContent = nombre.toUpperCase();
  dom.en.textContent = 'En ' + ultimo.horizonte + ' s';
  dom.barras.forEach((b, i) => b.style.setProperty('--p', Math.max(0, Math.min(1, ultimo.prob[i])).toFixed(3)));
  dom.valores.forEach((v, i) => { v.textContent = Math.round(ultimo.prob[i] * 100) + ' %'; });
  // En pantallas bajas no hay barras: sólo esta línea
  dom.prob.textContent = 'Probabilidad de ALTO: ' + Math.round(ultimo.prob[2] * 100) + ' %';
  dom.origen.textContent = ultimo.manual ? 'Manual' : 'Sensores';
  dom.origen.dataset.tipo = ultimo.manual ? 'manual' : 'sensores';

  const anticipa = ultimo.ahora !== null && ultimo.clase > ultimo.ahora;
  dom.ia.dataset.anticipa = String(anticipa);
  if (anticipa) {
    dom.nota.textContent = 'Alerta anticipada: ahora es ' + CLASES[ultimo.ahora].toUpperCase() +
      ' y la IA espera ' + nombre.toUpperCase();
  } else {
    dom.nota.textContent = ultimo.modelo + (ultimo.manual ? ' · con los valores manuales' : ' · con los sensores');
  }
}

setInterval(pintar, 1000);
pintar();

window.IA = {
  recibir: recibir,
  negado: () => { negado = true; pintar(); }
};
})();

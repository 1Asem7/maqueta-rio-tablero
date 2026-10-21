(function () {
"use strict";
/* ============================================================================
   MAQUETA DIGITAL DEL RÍO · TABLERO
   Habla directo con el broker MQTT, en paralelo a Node-RED: muestra lo que el
   nodo publica y le ordena lo mismo que el dashboard de Node-RED (modo manual,
   valores simulados y compuerta).

   Reglas que sigue este archivo:
   · El riesgo NO se calcula aquí: se lee del nodo (los umbrales viven en el
     firmware). CONFIG.umbrales sólo pinta marcas y alimenta el modo demo.
   · Todo se muestra en % (0–100). El nodo trabaja el nivel en cm (0–400).
   · Ningún control asume éxito: queda "pendiente" hasta que el nodo lo
     confirma en su tópico de datos; si no confirma, vuelve atrás y avisa.
   · La escena 3D se mueve sólo a través de window.Escena (escena.js).
   ========================================================================== */

// ===== CONFIG (todo lo ajustable vive aquí) =====
const CONFIG = {
  // Tópicos del nodo: los del firmware (Practica_x.2) y del flujo de Node-RED.
  topics: {
    datos:   'ucol-eq1/rio/nodo1/datos',     // sub · QoS 0 · JSON con la lectura de cada ciclo (1 s)
    estado:  'ucol-eq1/rio/nodo1/estado',    // sub · QoS 1 · "online" retenido, "offline" como Last Will
    control: 'ucol-eq1/rio/nodo1/control'    // pub + sub · QoS 1 · retenido · JSON del modo manual
  },

  // Broker: Mosquitto por WebSocket seguro detrás de Cloudflare Tunnel, la
  // misma ruta que usa el ESP32. El usuario y la clave son los del usuario web
  // de Mosquitto; si el servidor los da en /api/config, mandan esos.
  mqtt: {
    url: 'wss://mqtt.eparedes.dev/mqtt',
    usuario: '',
    clave: '',
    keepalive: 30,                           // s; Cloudflare corta el WebSocket tras ~100 s sin tráfico
    msReconexion: 3000,                      // reconnectPeriod
    msConexion: 10000,                       // connectTimeout
    msConfig: 5000                           // espera máxima de /api/config
  },

  nivelMaxCm: 400,                           // 0–400 cm reales = 0–100 %

  // Umbrales del firmware pasados a %: marcas de sliders, cilindro y gráficas
  umbrales: {
    nivelMedio: 37.5,                        // 150 cm
    nivelAltoConLluvia: 50,                  // 200 cm con lluvia > 70 %
    nivelAlto: 62.5,                         // 250 cm
    lluviaSaturacion: 60, lluviaAlta: 70, humedadSaturacion: 80
  },

  msPublicacion: 1000,                       // el nodo publica en datos cada 1 s
  publicacionesPerdidas: 3,                  // tantas seguidas sin llegar = nodo offline
  msConfirmacion: 3000,                      // espera a que el nodo confirme una orden
  msValor: 600,                              // animación de los números y rellenos

  historial: {
    rangoInicial: 5,                         // minutos: 5, 15 o 60
    maxPuntos: 300,                          // por serie, al dibujar
    msVariacion: 5 * 60000,                  // ventana de "↑ 3 % · 5 min"
    clave: 'maqueta-rio.historial',          // localStorage: última hora
    msGuardar: 15000
  }
};

// ===== UTILIDADES =====
const $ = id => document.getElementById(id);
const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
const nada = function () {};
function num(v) {                            // número o texto numérico; si no, null
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function leerJSON(texto) { try { return JSON.parse(texto); } catch (error) { return null; } }
const dosDigitos = n => (n < 10 ? '0' : '') + n;
function hora(ms, conSegundos) {
  const d = new Date(ms);
  return dosDigitos(d.getHours()) + ':' + dosDigitos(d.getMinutes()) + (conSegundos ? ':' + dosDigitos(d.getSeconds()) : '');
}

const mqQuieto = window.matchMedia('(prefers-reduced-motion: reduce)');
const Escena = window.Escena || {
  fijarNivel: nada, fijarCompuerta: nada, fijarBuzzer: nada, fijarLluvia: nada,
  mostrarComponentes: nada, restablecerVista: nada
};
if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } });

// Colores de la paleta, leídos de los tokens de styles.css
const estilos = getComputedStyle(document.documentElement);
const token = nombre => estilos.getPropertyValue(nombre).trim();
const RGB = { bone: token('--rgb-bone'), sage: token('--rgb-sage'), fern: token('--rgb-fern'),
              mid: token('--rgb-mid'), high: token('--rgb-high'), deep: token('--rgb-deep') };
const alfa = (tripleta, a) => 'rgba(' + tripleta + ',' + a + ')';

const dom = {
  pilBroker: $('pilBroker'), brokerTxt: $('brokerTxt'), pilNodo: $('pilNodo'), nodoTxt: $('nodoTxt'),
  franja: $('franja'), franjaTxt: $('franjaTxt'),
  chipDemo: $('chipDemo'), aviso: $('aviso'),
  vNivel: $('vNivel'), dNivel: $('dNivel'), liquido: $('liquido'), liqCuerpo: $('liqCuerpo'), liqSup: $('liqSup'),
  vLluvia: $('vLluvia'), dLluvia: $('dLluvia'), rLluvia: $('rLluvia'),
  vHumedad: $('vHumedad'), dHumedad: $('dHumedad'), rHumedad: $('rHumedad'),
  riesgo: $('riesgo'), riesgoTxt: $('riesgoTxt'), riesgoNota: $('riesgoNota'),
  eModo: $('eModo'), eModoTxt: $('eModoTxt'),
  eCompuerta: $('eCompuerta'), eCompuertaTxt: $('eCompuertaTxt'),
  eBuzzer: $('eBuzzer'), eBuzzerTxt: $('eBuzzerTxt'),
  swModo: $('swModo'), swCompuerta: $('swCompuerta'), ctlCompuerta: $('ctlCompuerta'),
  cardHistorial: $('cardHistorial'), btnPlegar: $('btnPlegar')
};

/* ============================================================================
   ===== ESTADO =====
   nodo  = lo que el nodo confirma (tópico de datos).
   orden = lo que se le ordena (tópico de control, lo publique quien lo publique).
   Las claves compartidas son: manual, nivel, lluvia, humedad y compuerta.
   ========================================================================== */
const nodo = {
  hayDatos: false,
  tLectura: 0,                                  // cuándo llegó la última lectura (retenida o en vivo)
  tVivo: 0,                                     // cuándo llegó la última EN VIVO; 0 = ninguna o el nodo cayó
  retenida: false,                              // la última lectura es la que guardaba el broker
  nivel: null, lluvia: null, humedad: null,     // %
  riesgo: null,                                 // 'bajo' | 'medio' | 'alto'
  manual: false,
  compuerta: false,                             // true = abierta (90°)
  buzzer: 'apagado'                             // 'apagado' | 'intermitente' | 'sonando'
};
const orden = { manual: null, nivel: null, lluvia: null, humedad: null, compuerta: null };
const enlace = {
  broker: 'conectando',                         // 'conectando' | 'conectado' | 'sin'
  tConexion: 0,
  estadoNodo: null,                             // 'online' | 'offline' | null (tópico de estado)
  url: CONFIG.mqtt.url,
  config: 'ok',                                 // cómo llegó /api/config: 'ok' | 'sin-usuario' | 'fallo'
  conUsuario: false,                            // la página tiene usuario para el broker
  error: '',                                    // último error del cliente MQTT, en palabras
  rechazo: false,                               // el broker rechazó el usuario o la clave
  fatal: false,                                 // no se pudo ni crear el cliente: no hay reintentos
  negados: []                                   // tópicos cuya suscripción negó el broker (ACL)
};
const pendientes = {};                          // clave → { valor, local, reloj }
// Lo define el MQTT real o el nodo demo
const transporte = { publicar: nada, reconectar: nada, vigilar: nada };
const LECTURAS = ['nivel', 'lluvia', 'humedad'];
// Sin lecturas en vivo durante este tiempo, el nodo se marca offline
const msVigilancia = CONFIG.msPublicacion * CONFIG.publicacionesPerdidas;

// ===== LECTURA TOLERANTE DE LOS CAMPOS DEL NODO =====
function leerRiesgo(v) {                        // el firmware manda 0, 1 o 2
  const n = num(v);
  if (n !== null) return ['bajo', 'medio', 'alto'][n] || null;
  const s = String(v).toLowerCase();
  return s === 'bajo' || s === 'medio' || s === 'alto' ? s : null;
}
function leerBuzzer(v) {                        // el firmware manda apagado / intermitente / continuo
  const s = String(v).toLowerCase();
  if (s.indexOf('inter') >= 0) return 'intermitente';
  if (s.indexOf('contin') >= 0 || s.indexOf('sona') >= 0 || s === 'on' || s === 'encendido') return 'sonando';
  return 'apagado';
}
function leerCompuerta(v) {                     // grados: 90 abierta, 0 cerrada
  const n = num(v);
  if (n !== null) return n >= 45;
  return String(v).toLowerCase().indexOf('abiert') >= 0;
}
function leerEstadoNodo(texto) {
  const s = String(texto).trim().toLowerCase();
  if (s === 'online') return 'online';
  if (s === 'offline') return 'offline';
  return null;
}
const aPct = cm => limitar(cm / CONFIG.nivelMaxCm * 100, 0, 100);

/* ============================================================================
   ===== MENSAJES QUE LLEGAN =====
   ========================================================================== */
// retenido = el broker lo tenía guardado y lo manda al suscribirse; si no, llegó en vivo
function alLlegar(topic, texto, retenido) {
  if (retenido) console.info('[MQTT] mensaje retenido en ' + topic);
  if (topic === CONFIG.topics.datos) recibirDatos(leerJSON(texto), retenido);
  else if (topic === CONFIG.topics.estado) recibirEstado(texto);
  else if (topic === CONFIG.topics.control) recibirControl(leerJSON(texto));
}

function recibirDatos(d, retenido) {
  if (!d || typeof d !== 'object') return;
  const cm = num(d.nivel_cm), lluvia = num(d.lluvia_pct), humedad = num(d.humedad_pct);
  if (cm !== null) nodo.nivel = aPct(cm);
  if (lluvia !== null) nodo.lluvia = limitar(lluvia, 0, 100);
  if (humedad !== null) nodo.humedad = limitar(humedad, 0, 100);
  if (nodo.nivel === null || nodo.lluvia === null || nodo.humedad === null) return;
  nodo.riesgo = leerRiesgo(d.riesgo);
  nodo.manual = String(d.modo).toLowerCase() === 'manual';
  nodo.compuerta = leerCompuerta(d.compuerta);
  nodo.buzzer = leerBuzzer(d.buzzer);
  const ahora = Date.now();
  nodo.hayDatos = true;
  nodo.tLectura = ahora;
  nodo.retenida = !!retenido;
  // Una lectura retenida puede ser vieja (es la última que guardó el broker):
  // se pinta y entra al historial, pero sólo una en vivo prueba que el nodo publica.
  if (!retenido) nodo.tVivo = ahora;

  revisarPendientes();
  sincronizarOrden();
  guardarMuestra(ahora);

  LECTURAS.forEach(k => animarLectura(k, nodo[k]));
  pintarEstado();
  pintarConexion();

  Escena.fijarNivel(nodo.nivel);
  Escena.fijarLluvia(nodo.lluvia);
  Escena.fijarCompuerta(nodo.compuerta);
  Escena.fijarBuzzer(nodo.buzzer);
}

function recibirEstado(texto) {
  enlace.estadoNodo = leerEstadoNodo(texto);
  if (enlace.estadoNodo === 'offline') nodo.tVivo = 0;   // Last Will: el nodo cayó, no hace falta esperar
  pintarConexion();
}

// Alguien publicó una orden (esta página, Node-RED u otro cliente): los
// controles se mueven a ese valor y quedan pendientes hasta que el nodo confirme.
function recibirControl(c) {
  if (!c || typeof c !== 'object') return;
  const modo = String(c.modo).toLowerCase();
  if (modo !== 'manual' && modo !== 'auto') return;          // el firmware también lo ignora
  const cambios = [];
  const poner = (clave, valor) => {
    const antes = orden[clave];
    const igual = typeof valor === 'number' && antes !== null ? Math.abs(antes - valor) < 0.01 : antes === valor;
    if (!igual) { orden[clave] = valor; cambios.push(clave); }
  };
  poner('manual', modo === 'manual');
  if (modo === 'manual') {
    const cm = num(c.nivel_cm), lluvia = num(c.lluvia_pct), humedad = num(c.humedad_pct);
    if (cm !== null) poner('nivel', aPct(cm));
    if (lluvia !== null) poner('lluvia', limitar(lluvia, 0, 100));
    if (humedad !== null) poner('humedad', limitar(humedad, 0, 100));
    if (c.compuerta !== undefined) poner('compuerta', leerCompuerta(c.compuerta));
  }
  cambios.forEach(clave => { if (!confirmado(clave, orden[clave])) marcarPendiente(clave, orden[clave], false); });
  pintarControl();
}

/* ============================================================================
   ===== ÓRDENES Y CONFIRMACIÓN =====
   ========================================================================== */
function confirmado(clave, valor) {
  if (!nodo.hayDatos) return false;
  if (clave === 'manual') return nodo.manual === valor;
  if (!nodo.manual) return false;                // lo demás sólo aplica en manual
  if (clave === 'compuerta') return nodo.compuerta === valor;
  return Math.abs(nodo[clave] - valor) <= 0.5;
}
function marcarPendiente(clave, valor, local) {
  if (pendientes[clave]) clearTimeout(pendientes[clave].reloj);
  pendientes[clave] = { valor: valor, local: local, reloj: setTimeout(() => vencer(clave), CONFIG.msConfirmacion) };
}
function revisarPendientes() {
  Object.keys(pendientes).forEach(clave => {
    if (!confirmado(clave, pendientes[clave].valor)) return;
    clearTimeout(pendientes[clave].reloj);
    delete pendientes[clave];
  });
}
function vencer(clave) {                         // el nodo no confirmó a tiempo
  const p = pendientes[clave];
  delete pendientes[clave];
  sincronizarOrden();
  pintarControl();
  if (!p || !p.local) return;
  // La orden quedó retenida en el broker. Se repone la que corresponde a lo que
  // el nodo reporta, para que no la aplique por sorpresa más tarde (en manual
  // dejaría de atender a los sensores).
  if (nodo.hayDatos) enviarControl();
  avisar('El nodo no confirmó el cambio');
}
// Cuando no hay nada pendiente, la orden se alinea con lo que el nodo reporta:
// así el siguiente comando parte del estado real y no de uno que nunca aplicó.
function sincronizarOrden() {
  if (!nodo.hayDatos) return;
  if (!pendientes.manual) orden.manual = nodo.manual;
  if (!nodo.manual) return;
  LECTURAS.forEach(k => { if (!pendientes[k]) orden[k] = nodo[k]; });
  if (!pendientes.compuerta) orden.compuerta = nodo.compuerta;
}
function completarOrden() {                      // valores que nunca se han ordenado: los actuales
  LECTURAS.forEach(k => { if (orden[k] === null) orden[k] = nodo[k] === null ? 0 : Math.round(nodo[k]); });
  if (orden.compuerta === null) orden.compuerta = nodo.compuerta;
}
// El mismo JSON que arma Node-RED ("armar comando"): en manual van todos los
// valores juntos; en automático sólo el modo. QoS 1 y retenido.
function enviarControl() {
  const r1 = v => Math.round(v * 10) / 10;
  const carga = orden.manual
    ? { modo: 'manual',
        nivel_cm: r1(orden.nivel * CONFIG.nivelMaxCm / 100),
        lluvia_pct: r1(orden.lluvia),
        humedad_pct: r1(orden.humedad),
        compuerta: orden.compuerta ? 90 : 0 }
    : { modo: 'auto' };
  transporte.publicar(CONFIG.topics.control, JSON.stringify(carga));
}
function ordenar(clave, valor) {
  completarOrden();
  if (clave !== 'manual') orden.manual = true;   // sliders y compuerta sólo se usan en manual
  orden[clave] = valor;
  marcarPendiente(clave, valor, true);
  enviarControl();
  pintarControl();
}

// Lo que enseña cada control: la orden mientras está pendiente; si no, el nodo
function valorMostrado(clave) {
  if (pendientes[clave]) return pendientes[clave].valor;
  if (clave === 'manual' || clave === 'compuerta') return nodo.hayDatos ? nodo[clave] : !!orden[clave];
  if (nodo.hayDatos && nodo.manual) return nodo[clave];
  if (orden[clave] !== null) return orden[clave];
  return nodo.hayDatos ? nodo[clave] : null;
}

/* ============================================================================
   ===== CONEXIÓN: broker y nodo, cada uno con su píldora en la barra =====
   Broker: conectando / conectado / sin conexión (eventos del cliente MQTT).
   Nodo:   esperando / online / offline, o "sin verificar" si no hay broker.
   Online exige una lectura EN VIVO en los últimos msVigilancia (3 × el
   periodo de publicación); el vigilante nunca cierra la conexión al broker.
   ========================================================================== */
function estadoNodo() {
  if (enlace.broker === 'conectando') return 'esperando';
  if (enlace.broker === 'sin') return 'desconocido';
  const ahora = Date.now();
  if (nodo.tVivo && ahora - nodo.tVivo <= msVigilancia) return 'online';
  if (enlace.estadoNodo === 'offline') return 'offline';
  // Recién conectado y aún sin lecturas en vivo: se le da un margen
  if (nodo.tVivo < enlace.tConexion && ahora - enlace.tConexion <= msVigilancia) return 'esperando';
  return 'offline';
}
function enLinea() { return estadoNodo() === 'online'; }

// Por qué no hay broker, en palabras (franja y título de la píldora)
function motivoBroker() {
  if (navigator.onLine === false) return 'este equipo no tiene red';
  if (enlace.rechazo) {
    if (enlace.conUsuario) return 'el broker rechazó el usuario o la clave';
    return enlace.config === 'fallo'
      ? 'no se pudo leer /api/config y la página no tiene usuario para el broker'
      : 'el servidor no tiene MQTT_USUARIO ni MQTT_CLAVE';
  }
  if (enlace.error) return enlace.error;
  let host = enlace.url;
  try { host = new URL(enlace.url).host; } catch (error) { /* se deja la URL tal cual */ }
  return host + ' no responde';
}

function pintarPildora(pil, txt, estado, texto, titulo) {
  pil.dataset.estado = estado;
  if (txt.textContent !== texto) txt.textContent = texto;
  pil.title = titulo;
}

function pintarConexion() {
  const est = estadoNodo();
  const motivo = enlace.broker === 'sin' ? motivoBroker() : '';

  // Píldora del broker
  const TXT_BROKER = { conectando: 'conectando…', conectado: 'conectado', sin: 'sin conexión' };
  pintarPildora(dom.pilBroker, dom.brokerTxt, enlace.broker, TXT_BROKER[enlace.broker],
    enlace.url + (motivo ? ' · ' + motivo : ''));

  // Píldora del nodo, con la hora de la última lectura. De una retenida no se
  // sabe cuándo se tomó, así que no se le pone hora.
  const hLectura = hora(nodo.tLectura, true);
  const conHora = nodo.hayDatos && !nodo.retenida;
  const TXT_NODO = {
    esperando: 'esperando datos…',
    online: 'online · ' + hLectura,
    offline: conHora ? 'offline desde ' + hLectura : nodo.hayDatos ? 'offline · lectura retenida' : 'offline · sin datos',
    desconocido: 'sin verificar' + (conHora ? ' · ' + hLectura : '')
  };
  pintarPildora(dom.pilNodo, dom.nodoTxt, est, TXT_NODO[est],
    !nodo.hayDatos ? 'Aún no hay lecturas' : 'Última lectura: ' + hLectura + (nodo.retenida ? ' (retenida)' : ''));

  // Franja de aviso bajo la barra
  const conocida = nodo.hayDatos ? ' Se muestra la última lectura conocida.' : '';
  let franja = '';
  if (enlace.broker === 'sin') {
    const reintento = enlace.fatal ? 'Revisa la configuración y recarga la página.'
      : navigator.onLine === false ? 'Se reconecta al volver la red.'
      : 'Se reintenta cada ' + CONFIG.mqtt.msReconexion / 1000 + ' s.';
    franja = 'Sin conexión al broker: ' + motivo + '. ' + reintento + conocida;
  } else if (est === 'offline') {
    franja = (enlace.negados.length ? 'El broker no deja leer ' + enlace.negados.join(', ') + ': revisa su ACL.'
      : 'El nodo no responde.') + (nodo.hayDatos ? conocida : ' Aún no hay lecturas.');
  }
  if (dom.franjaTxt.textContent !== franja) dom.franjaTxt.textContent = franja;
  dom.franja.hidden = !franja;
  document.body.classList.toggle('con-franja', !!franja);

  // Tarjetas de datos: "Esperando" sin lecturas, "Última lectura" si el nodo
  // no responde y "Simulado" en manual
  const viejo = nodo.hayDatos && (est === 'offline' || est === 'desconocido');
  const TXT_CHIP = { esperando: 'Esperando', ultima: 'Última lectura', simulado: 'Simulado' };
  document.querySelectorAll('.dato').forEach(card => {
    const simulado = nodo.hayDatos && nodo.manual && card.id !== 'cardEstado';
    const tipo = !nodo.hayDatos ? 'esperando' : viejo ? 'ultima' : simulado ? 'simulado' : '';
    const chip = card.querySelector('[data-chip]');
    card.classList.toggle('viejo', viejo);
    chip.hidden = !tipo;
    chip.textContent = TXT_CHIP[tipo] || '';
    chip.dataset.tipo = tipo;
  });
  pintarControl();
}

/* ============================================================================
   ===== LECTURAS: cilindro del nivel y anillos de lluvia y humedad =====
   ========================================================================== */
const PERIMETRO = 2 * Math.PI * 46;              // del anillo (r = 46)
const TUBO = { yFondo: 222, alto: 208 };         // del cilindro, en unidades del SVG
const visto = { nivel: null, lluvia: null, humedad: null };   // valor dibujado ahora mismo
const cuadros = {};

function pintarLectura(clave, v) {
  visto[clave] = v;
  if (clave === 'nivel') {
    const y = TUBO.yFondo - TUBO.alto * v / 100;
    dom.vNivel.textContent = Math.round(v);
    dom.liqCuerpo.setAttribute('y', y.toFixed(2));
    dom.liqCuerpo.setAttribute('height', (TUBO.yFondo - y).toFixed(2));
    dom.liqSup.setAttribute('cy', y.toFixed(2));
    dom.liquido.classList.toggle('hay', v > 0.4);
    return;
  }
  const anillo = clave === 'lluvia' ? dom.rLluvia : dom.rHumedad;
  (clave === 'lluvia' ? dom.vLluvia : dom.vHumedad).textContent = Math.round(v);
  anillo.style.strokeDashoffset = (PERIMETRO * (1 - v / 100)).toFixed(2);
  anillo.classList.toggle('hay', v > 0.4);
}
// Los números cuentan y los rellenos crecen durante 600 ms
function animarLectura(clave, hasta) {
  if (cuadros[clave]) cancelAnimationFrame(cuadros[clave]);
  const desde = visto[clave];
  if (desde === null || mqQuieto.matches || document.hidden || Math.abs(hasta - desde) < 0.05) {
    cuadros[clave] = 0;
    pintarLectura(clave, hasta);
    return;
  }
  const t0 = performance.now();
  const paso = ahora => {
    const k = limitar((ahora - t0) / CONFIG.msValor, 0, 1);
    pintarLectura(clave, desde + (hasta - desde) * (1 - Math.pow(1 - k, 4)));
    cuadros[clave] = k < 1 ? requestAnimationFrame(paso) : 0;
  };
  cuadros[clave] = requestAnimationFrame(paso);
}

// "↑ 3 % · 5 min": cambio contra la muestra más vieja de los últimos 5 min
function pintarVariaciones() {
  if (!nodo.hayDatos || !hist.length) return;
  const desde = Date.now() - CONFIG.historial.msVariacion;
  let i = hist.length - 1;
  while (i > 0 && hist[i - 1].t >= desde) i--;
  const base = hist[i];
  [['nivel', 'n', dom.dNivel], ['lluvia', 'l', dom.dLluvia], ['humedad', 'h', dom.dHumedad]].forEach(par => {
    const d = Math.round(nodo[par[0]] - base[par[1]]);
    const txt = (d > 0 ? '↑ ' : d < 0 ? '↓ ' : '→ ') + Math.abs(d) + ' % · 5 min';
    if (par[2].textContent !== txt) par[2].textContent = txt;
  });
}

/* ============================================================================
   ===== ESTADO: riesgo, modo, compuerta y buzzer que el nodo confirma =====
   ========================================================================== */
const TXT_BUZZER = { apagado: 'Apagado', intermitente: 'Intermitente', sonando: 'Sonando' };
function pintarEstado() {
  const hay = nodo.hayDatos;
  dom.riesgo.dataset.nivel = hay && nodo.riesgo ? nodo.riesgo : 'sin';
  dom.riesgoTxt.textContent = hay && nodo.riesgo ? nodo.riesgo.toUpperCase() : '—';
  dom.riesgoNota.hidden = !(hay && nodo.manual);
  dom.eModo.dataset.on = String(hay && nodo.manual);
  dom.eModoTxt.textContent = hay ? (nodo.manual ? 'Manual' : 'Automático') : '—';
  dom.eCompuerta.dataset.abierta = String(hay && nodo.compuerta);
  dom.eCompuertaTxt.textContent = hay ? (nodo.compuerta ? 'Abierta' : 'Cerrada') : '—';
  dom.eBuzzer.dataset.estado = hay ? nodo.buzzer : 'sin';
  dom.eBuzzerTxt.textContent = hay ? TXT_BUZZER[nodo.buzzer] : '—';
}

/* ============================================================================
   ===== CONTROL: switches y sliders =====
   ========================================================================== */
const sliders = LECTURAS.map(clave => {
  const el = document.querySelector('.slider[data-clave="' + clave + '"]');
  return { clave: clave, el: el, input: el.querySelector('input'), salida: el.querySelector('output'),
           burbuja: el.querySelector('.burbuja'), arrastrando: false };
});

function ponerSwitch(boton, encendido, bloqueado, clave) {
  boton.setAttribute('aria-checked', String(!!encendido));
  boton.disabled = bloqueado;
  boton.classList.toggle('pendiente', !!pendientes[clave]);
}
function ponerSlider(sl, v) {
  const r = v === null ? 0 : Math.round(v);
  if (Number(sl.input.value) !== r) sl.input.value = r;
  sl.el.style.setProperty('--p', (r / 100).toFixed(3));
  sl.salida.textContent = v === null ? '–' : r;
  sl.burbuja.textContent = r + ' %';
}
function pintarControl() {
  const linea = enLinea();
  const manual = nodo.hayDatos && nodo.manual;   // el modo que el nodo confirma
  const bloqueado = !linea || !manual;
  const motivo = !linea ? 'El nodo no está en línea' : (!manual ? 'Activa el modo manual para simular' : '');

  ponerSwitch(dom.swModo, valorMostrado('manual'), !linea, 'manual');
  dom.swModo.title = linea ? '' : 'El nodo no está en línea';
  ponerSwitch(dom.swCompuerta, valorMostrado('compuerta'), bloqueado, 'compuerta');
  dom.ctlCompuerta.classList.toggle('bloqueado', bloqueado);
  dom.ctlCompuerta.title = motivo;

  sliders.forEach(sl => {
    if (bloqueado) soltar(sl);
    sl.el.classList.toggle('bloqueado', bloqueado);
    sl.el.classList.toggle('pendiente', !!pendientes[sl.clave]);
    sl.el.title = motivo;
    sl.input.disabled = bloqueado;
    if (!sl.arrastrando) ponerSlider(sl, valorMostrado(sl.clave));
  });
}
function soltar(sl) {
  sl.arrastrando = false;
  sl.el.classList.remove('arrastrando');
}

dom.swModo.addEventListener('click', () => { ordenar('manual', !valorMostrado('manual')); });
dom.swCompuerta.addEventListener('click', () => { ordenar('compuerta', !valorMostrado('compuerta')); });

sliders.forEach(sl => {
  sl.input.addEventListener('pointerdown', () => {
    sl.arrastrando = true;
    sl.el.classList.add('arrastrando');
  });
  // Mientras se arrastra sólo se mueve en pantalla; se publica al soltar
  sl.input.addEventListener('input', () => { ponerSlider(sl, Number(sl.input.value)); });
  sl.input.addEventListener('change', () => {
    soltar(sl);
    ordenar(sl.clave, Number(sl.input.value));
  });
  // Flechas ±1 % (nativo) y Shift + flechas ±10 %
  sl.input.addEventListener('keydown', e => {
    if (!e.shiftKey) return;
    const sube = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    const baja = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    if (!sube && !baja) return;
    e.preventDefault();
    sl.input.value = limitar(Number(sl.input.value) + (sube ? 10 : -10), 0, 100);
    ordenar(sl.clave, Number(sl.input.value));
  });
});
// Soltar sin haber cambiado el valor no dispara "change"
['pointerup', 'pointercancel'].forEach(tipo => window.addEventListener(tipo, () => {
  sliders.forEach(sl => { if (sl.arrastrando) { soltar(sl); ponerSlider(sl, valorMostrado(sl.clave)); } });
}));

/* ============================================================================
   ===== HISTORIAL =====
   Búfer en memoria desde que se abre la página (más la última hora guardada).
   Para dibujar, cada serie se reduce a CONFIG.historial.maxPuntos.
   ========================================================================== */
const hist = [];                                 // { t (ms), n, l, h } en %
const HORA = 3600000;
let rango = CONFIG.historial.rangoInicial;       // minutos
let graficas = null, graficasSucias = true, guardadoEn = 0;
let persistir = true;                            // el modo demo no guarda nada

function guardarMuestra(t) {
  hist.push({ t: t, n: nodo.nivel, l: nodo.lluvia, h: nodo.humedad });
  if (hist.length > 4200) { while (hist.length && hist[0].t < t - HORA) hist.shift(); }
  graficasSucias = true;
}
function cargarHistorial() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CONFIG.historial.clave) || '[]');
    const desde = Date.now() - HORA;
    guardado.forEach(m => {
      if (Array.isArray(m) && m.length === 4 && m.every(Number.isFinite) && m[0] >= desde && m[0] <= Date.now())
        hist.push({ t: m[0], n: m[1], l: m[2], h: m[3] });
    });
  } catch (error) { /* sin almacenamiento o dato dañado: se empieza vacío */ }
}
function guardarHistorial() {
  if (!persistir || !hist.length) return;
  const desde = Date.now() - HORA, compacto = [];
  let ultimo = 0;
  hist.forEach(m => {                            // una muestra cada 5 s basta para la última hora
    if (m.t < desde || m.t - ultimo < 5000) return;
    ultimo = m.t;
    compacto.push([m.t, Math.round(m.n * 10) / 10, Math.round(m.l * 10) / 10, Math.round(m.h * 10) / 10]);
  });
  try { localStorage.setItem(CONFIG.historial.clave, JSON.stringify(compacto)); } catch (error) { /* lleno o bloqueado */ }
}

// Puntos {x, y} de un campo dentro del rango, promediados por tramos si son
// demasiados y con un hueco (y = null) donde el nodo dejó de publicar.
function serie(campo, desde, hasta) {
  let i = hist.length;
  while (i > 0 && hist[i - 1].t >= desde) i--;
  const tramo = hist.slice(i), max = CONFIG.historial.maxPuntos;
  let puntos;
  if (tramo.length <= max) {
    puntos = tramo.map(m => ({ x: m.t, y: m[campo] }));
  } else {
    puntos = [];
    const paso = tramo.length / max;
    for (let b = 0; b < max; b++) {
      const a = Math.floor(b * paso), z = Math.max(a + 1, Math.floor((b + 1) * paso));
      let sx = 0, sy = 0;
      for (let j = a; j < z; j++) { sx += tramo[j].t; sy += tramo[j][campo]; }
      puntos.push({ x: sx / (z - a), y: sy / (z - a) });
    }
  }
  const hueco = Math.max(20000, (hasta - desde) / max * 4);
  const salida = [];
  puntos.forEach((p, j) => {
    if (j && p.x - puntos[j - 1].x > hueco) salida.push({ x: p.x - 1, y: null });
    salida.push(p);
  });
  return salida;
}

// Líneas de umbral, sus etiquetas y bandas tenues de cada zona (gráfica de nivel)
const pluginUmbrales = {
  id: 'umbrales',
  beforeDatasetsDraw: function (chart) {
    const ctx = chart.ctx, a = chart.chartArea, y = chart.scales.y;
    const yMedio = y.getPixelForValue(CONFIG.umbrales.nivelMedio), yAlto = y.getPixelForValue(CONFIG.umbrales.nivelAlto);
    ctx.save();
    ctx.fillStyle = alfa(RGB.sage, 0.06); ctx.fillRect(a.left, yMedio, a.width, a.bottom - yMedio);
    ctx.fillStyle = alfa(RGB.mid, 0.06);  ctx.fillRect(a.left, yAlto, a.width, yMedio - yAlto);
    ctx.fillStyle = alfa(RGB.high, 0.06); ctx.fillRect(a.left, a.top, a.width, yAlto - a.top);
    ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    [[yMedio, RGB.mid, 'Medio'], [yAlto, RGB.high, 'Alto']].forEach(u => {
      ctx.strokeStyle = alfa(u[1], 0.5);
      ctx.beginPath(); ctx.moveTo(a.left, u[0]); ctx.lineTo(a.right, u[0]); ctx.stroke();
      ctx.fillStyle = alfa(RGB.bone, 0.68);
      ctx.fillText(u[2], a.right - 4, u[0] - 2);
    });
    ctx.restore();
  }
};

function opcionesGrafica() {
  const fuente = { family: 'Inter, system-ui, sans-serif', size: 11 };
  return {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false, spanGaps: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    layout: { padding: { top: 2, right: 2 } },
    elements: {
      line: { tension: 0.35, borderWidth: 2, borderJoinStyle: 'round', borderCapStyle: 'round' },
      point: { radius: 0, hoverRadius: 2, hitRadius: 10 }
    },
    scales: {
      x: {
        type: 'linear', grid: { display: false }, border: { display: false },
        ticks: { color: alfa(RGB.bone, 0.45), font: fuente, maxRotation: 0, padding: 2, callback: v => hora(v) },
        // Marcas en minutos cerrados: cada 1, 5 o 15 min según el rango
        afterBuildTicks: function (eje) {
          const paso = (rango <= 5 ? 1 : rango <= 15 ? 5 : 15) * 60000, marcas = [];
          for (let v = Math.ceil(eje.min / paso) * paso; v <= eje.max; v += paso) marcas.push({ value: v });
          eje.ticks = marcas;
        }
      },
      y: {
        min: 0, max: 100, border: { display: false },
        grid: { color: alfa(RGB.bone, 0.08), drawTicks: false },
        ticks: { stepSize: 25, color: alfa(RGB.bone, 0.45), font: fuente, padding: 6, callback: v => v + ' %' }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: alfa(RGB.deep, 0.92), borderColor: alfa(RGB.bone, 0.14), borderWidth: 1,
        cornerRadius: 10, padding: 10, boxWidth: 8, boxHeight: 8, boxPadding: 4, usePointStyle: true,
        titleColor: alfa(RGB.bone, 0.68), bodyColor: 'rgb(' + RGB.bone + ')',
        titleFont: fuente, bodyFont: { family: fuente.family, size: 12, weight: '600' },
        callbacks: {
          title: items => items.length ? hora(items[0].parsed.x, true) : '',
          label: item => ' ' + item.dataset.label + ': ' + Math.round(item.parsed.y) + ' %'
        }
      }
    }
  };
}
function crearGraficas() {
  if (!window.Chart) {
    document.querySelectorAll('.graf-lienzo').forEach(el => { el.textContent = 'No se pudo cargar la librería de gráficas.'; });
    return;
  }
  const sage = 'rgb(' + RGB.sage + ')', bone = 'rgb(' + RGB.bone + ')';
  const degradado = contexto => {                // relleno fern 45 % → 0 %
    const a = contexto.chart.chartArea;
    if (!a) return alfa(RGB.fern, 0.2);
    const g = contexto.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, alfa(RGB.fern, 0.45)); g.addColorStop(1, alfa(RGB.fern, 0));
    return g;
  };
  graficas = {
    nivel: new Chart($('gNivel'), {
      type: 'line', plugins: [pluginUmbrales], options: opcionesGrafica(),
      data: { datasets: [{ label: 'Nivel', data: [], borderColor: sage, backgroundColor: degradado, fill: 'origin',
                           pointBackgroundColor: sage, pointBorderColor: sage }] }
    }),
    clima: new Chart($('gClima'), {
      type: 'line', options: opcionesGrafica(),
      data: { datasets: [
        { label: 'Lluvia', data: [], borderColor: bone, fill: false, pointBackgroundColor: bone, pointBorderColor: bone },
        { label: 'Humedad', data: [], borderColor: sage, backgroundColor: alfa(RGB.sage, 0.10), fill: 'origin',
          pointBackgroundColor: sage, pointBorderColor: sage }
      ] }
    })
  };
}
function actualizarGraficas() {
  graficasSucias = false;
  if (!graficas || dom.cardHistorial.classList.contains('plegado') || document.hidden) return;
  const hasta = Date.now(), desde = hasta - rango * 60000;
  graficas.nivel.data.datasets[0].data = serie('n', desde, hasta);
  graficas.clima.data.datasets[0].data = serie('l', desde, hasta);
  graficas.clima.data.datasets[1].data = serie('h', desde, hasta);
  [graficas.nivel, graficas.clima].forEach(g => {
    g.options.scales.x.min = desde;
    g.options.scales.x.max = hasta;
    g.update('none');
  });
}

document.querySelectorAll('[data-rango]').forEach(boton => boton.addEventListener('click', () => {
  rango = Number(boton.dataset.rango);
  document.querySelectorAll('[data-rango]').forEach(b => b.setAttribute('aria-pressed', String(b === boton)));
  actualizarGraficas();
}));
dom.btnPlegar.addEventListener('click', () => {
  const plegado = dom.cardHistorial.classList.toggle('plegado');
  dom.btnPlegar.setAttribute('aria-expanded', String(!plegado));
  dom.btnPlegar.setAttribute('aria-label', plegado ? 'Desplegar el historial' : 'Plegar el historial');
  if (!plegado) actualizarGraficas();
});

/* ============================================================================
   ===== BARRA SUPERIOR Y AVISOS =====
   ========================================================================== */
let relojAviso = 0;
function avisar(texto) {
  dom.aviso.textContent = texto;
  dom.aviso.classList.add('ver');
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => dom.aviso.classList.remove('ver'), 3200);
}

$('btnComponentes').addEventListener('click', function () {
  const ver = this.getAttribute('aria-pressed') !== 'true';
  this.setAttribute('aria-pressed', String(ver));
  Escena.mostrarComponentes(ver);
});
$('btnVista').addEventListener('click', () => { Escena.restablecerVista(); });
$('btnPaneles').addEventListener('click', function () {
  const ocultos = document.body.classList.toggle('sin-paneles');
  this.setAttribute('aria-pressed', String(ocultos));
  $('btnPanelesTxt').textContent = ocultos ? 'Mostrar paneles' : 'Ocultar paneles';
  if (!ocultos) actualizarGraficas();
});

/* ============================================================================
   ===== MQTT =====
   mqtt.js sobre WebSocket seguro. Conecta solo al cargar la página, se vuelve
   a suscribir a los tres tópicos en cada conexión (también al de control,
   para seguir lo que cambie Node-RED) y reintenta cada 3 s.
   ========================================================================== */
// URL y credenciales que da el servidor (variables de entorno). En un hosting
// sólo estático /api/config no existe y se usa CONFIG.mqtt. Si falla, queda
// anotado para explicarlo en la barra cuando el broker rechace la conexión.
function leerConfig() {
  const control = window.AbortController ? new AbortController() : null;
  const reloj = setTimeout(() => { if (control) control.abort(); }, CONFIG.mqtt.msConfig);
  return fetch('api/config', { cache: 'no-store', signal: control ? control.signal : undefined })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(remoto => {
      const mqtt = (remoto && remoto.mqtt) || {};
      enlace.config = mqtt.usuario ? 'ok' : 'sin-usuario';
      if (!mqtt.usuario) console.warn('[MQTT] /api/config no trae usuario: el servidor no tiene MQTT_USUARIO / MQTT_CLAVE');
      return mqtt;
    })
    .catch(error => {
      enlace.config = 'fallo';
      console.warn('[MQTT] no se pudo leer /api/config (' + error.message + '): se usa CONFIG.mqtt');
      return {};
    })
    .then(mqtt => {
      clearTimeout(reloj);
      return Object.assign({}, CONFIG.mqtt, mqtt);
    });
}

function conectarMqtt(cfg) {
  const T = CONFIG.topics;
  enlace.url = cfg.url;
  enlace.conUsuario = !!cfg.usuario;

  let cliente;
  try {
    if (!window.mqtt) throw new Error('no se cargó la librería mqtt.js');
    console.info('[MQTT] conectando a ' + cfg.url + (cfg.usuario ? ' como ' + cfg.usuario : ' sin usuario'));
    cliente = window.mqtt.connect(cfg.url, {
      clientId: 'maqueta-web-' + Math.random().toString(16).slice(2, 10),   // uno por pestaña
      username: cfg.usuario || undefined,
      password: cfg.clave || undefined,
      clean: true,
      keepalive: cfg.keepalive,
      reconnectPeriod: cfg.msReconexion,
      connectTimeout: cfg.msConexion,
      resubscribe: false,                    // la suscripción se hace a mano en cada 'connect'
      reconnectOnConnackError: true          // sin esto, un rechazo del broker detiene los reintentos para siempre
    });
  } catch (error) {                          // p. ej. una MQTT_URL mal escrita
    console.error('[MQTT] no se pudo crear el cliente: ' + error.message);
    enlace.broker = 'sin';
    enlace.error = error.message;
    enlace.fatal = true;
    pintarConexion();
    return;
  }

  // Fase del cliente: 'intentando' (hay un intento en curso), 'conectado' o
  // 'cerrado' (sin conexión, a la espera del próximo intento)
  let fase = 'intentando', tCierre = 0;
  const sinBroker = () => {
    enlace.broker = 'sin';
    pintarConexion();
  };

  cliente.on('connect', () => {
    fase = 'conectado';
    console.info('[MQTT] conectado al broker');
    enlace.broker = 'conectado';
    enlace.tConexion = Date.now();
    enlace.error = '';
    enlace.rechazo = false;
    enlace.negados = [];
    // La sesión es limpia: en cada conexión hay que volver a suscribirse a todo.
    // Al suscribirse, el broker manda enseguida lo retenido de cada tópico.
    const suscripciones = {};
    suscripciones[T.datos] = { qos: 0 };
    suscripciones[T.estado] = { qos: 1 };
    suscripciones[T.control] = { qos: 1 };
    cliente.subscribe(suscripciones, (error, concedidas) => {
      if (error) { console.error('[MQTT] no se pudo suscribir: ' + error.message); return; }
      enlace.negados = concedidas.filter(s => s.qos === 128).map(s => s.topic);
      enlace.negados.forEach(t => console.warn('[MQTT] el broker negó la suscripción a ' + t + ' (revisa el ACL)'));
      pintarConexion();
    });
    pintarConexion();
  });
  cliente.on('reconnect', () => {
    fase = 'intentando';
    console.info('[MQTT] reintentando la conexión…');
  });
  cliente.on('close', () => {
    fase = 'cerrado';
    tCierre = Date.now();
    console.warn('[MQTT] conexión cerrada');
    sinBroker();
  });
  cliente.on('offline', () => {
    console.warn('[MQTT] sin conexión al broker; mqtt.js reintenta cada ' + cfg.msReconexion / 1000 + ' s');
    sinBroker();
  });
  cliente.on('error', error => {
    console.error('[MQTT] error: ' + error.message);
    enlace.rechazo = [4, 5, 134, 135].indexOf(error.code) >= 0;   // usuario o clave mal, o no autorizado
    enlace.error = error.message === 'Keepalive timeout' ? 'el broker dejó de responder' : error.message;
    sinBroker();
  });
  cliente.on('message', (topic, carga, paquete) => alLlegar(topic, carga.toString(), paquete.retain));

  transporte.publicar = (topic, texto) => {
    cliente.publish(topic, texto, { qos: 1, retain: true }, error => {
      if (error) console.error('[MQTT] no se pudo publicar en ' + topic + ': ' + error.message);
    });
  };
  // Reconexión forzada, sólo si no hay conexión ni un intento en curso
  transporte.reconectar = motivo => {
    if (fase !== 'cerrado') return;
    console.info('[MQTT] reconexión forzada: ' + motivo);
    cliente.reconnect();
  };
  // Red de seguridad, cada segundo: si tras cerrarse no empezó otro intento en
  // dos periodos (mqtt.js no reintentó o el navegador frenó su temporizador), se fuerza
  transporte.vigilar = () => {
    if (fase === 'cerrado' && Date.now() - tCierre > 2 * cfg.msReconexion) transporte.reconectar('no hubo reintento automático');
  };
}

/* ============================================================================
   ===== MODO DEMO (?demo=1) =====
   Un nodo falso dentro de la página, sin broker: publica el mismo JSON que el
   firmware, aplica sus mismas reglas de riesgo y obedece al tópico de control.
   Sirve para revisar el diseño con el nodo apagado. Con ?demo=offline el nodo
   falso se cae a los pocos segundos, para ver ese estado.
   ========================================================================== */
function iniciarDemo(variante) {
  const T = CONFIG.topics, U = CONFIG.umbrales;
  const man = { activo: false, nivel: 0, lluvia: 0, humedad: 0, compuerta: false };
  const sensores = t => {                        // curvas lentas que recorren los tres riesgos
    const m = t / 60000;
    return {
      nivel: limitar(44 + 30 * Math.sin(m * Math.PI / 3) + 5 * Math.sin(m * 3.9), 0, 100),
      lluvia: limitar(46 + 40 * Math.sin(m * Math.PI / 3 + 0.9) + 6 * Math.sin(m * 7.1), 0, 100),
      humedad: limitar(60 + 30 * Math.sin(m * Math.PI / 4.5 + 0.4), 0, 100)
    };
  };
  const riesgo = s => {
    if (s.nivel > U.nivelAlto) return 2;
    if (s.nivel > U.nivelAltoConLluvia && s.lluvia > U.lluviaAlta) return 2;
    if (s.nivel >= U.nivelMedio) return 1;
    if (s.lluvia > U.lluviaSaturacion && s.humedad > U.humedadSaturacion) return 1;
    return 0;
  };
  const r1 = v => Math.round(v * 10) / 10;
  const lectura = t => {
    const s = man.activo ? man : sensores(t), r = riesgo(s);
    const abierta = man.activo ? man.compuerta : r === 2;
    return {
      distancia_cm: r1(13.7 - sensores(t).nivel / 100 * 5),
      nivel_cm: r1(s.nivel * CONFIG.nivelMaxCm / 100), lluvia_pct: r1(s.lluvia), humedad_pct: r1(s.humedad),
      riesgo: r, led: ['verde', 'amarillo', 'rojo'][r], buzzer: ['apagado', 'intermitente', 'continuo'][r],
      compuerta: abierta ? 90 : 0,
      modo: man.activo ? 'manual' : 'auto', compuerta_modo: man.activo ? 'manual' : 'auto'
    };
  };

  dom.chipDemo.hidden = false;
  persistir = false;
  const ahora = Date.now();
  for (let t = ahora - HORA; t < ahora; t += 5000) {       // una hora de historial para las gráficas
    const s = sensores(t);
    hist.push({ t: t, n: s.nivel, l: s.lluvia, h: s.humedad });
  }

  enlace.broker = 'conectado';
  enlace.tConexion = ahora;
  transporte.publicar = (topic, texto) => {
    if (topic !== T.control) return;
    setTimeout(() => {
      const c = leerJSON(texto) || {};
      man.activo = c.modo === 'manual';
      if (man.activo) {
        man.nivel = aPct(c.nivel_cm); man.lluvia = c.lluvia_pct; man.humedad = c.humedad_pct;
        man.compuerta = c.compuerta >= 45;
      }
      alLlegar(T.control, texto);                // el broker lo reenvía a quien esté suscrito
    }, 80);
  };
  // Como el broker: primero lo retenido de cada tópico, luego las lecturas en vivo
  alLlegar(T.estado, 'online', true);
  alLlegar(T.control, '{"modo":"auto"}', true);
  alLlegar(T.datos, JSON.stringify(lectura(Date.now())), true);
  const ciclo = setInterval(() => alLlegar(T.datos, JSON.stringify(lectura(Date.now()))), CONFIG.msPublicacion);
  if (variante === 'offline') setTimeout(() => { clearInterval(ciclo); alLlegar(T.estado, 'offline'); }, 2500);
}

/* ============================================================================
   ===== ARRANQUE =====
   ========================================================================== */
// Sólo ?demo=1 o ?demo=offline activan el nodo falso
const parametroDemo = new URLSearchParams(location.search).get('demo');
const demo = parametroDemo === '1' || parametroDemo === 'offline' ? parametroDemo : null;
if (!demo) cargarHistorial();
crearGraficas();
pintarEstado();
pintarConexion();

if (demo) iniciarDemo(demo);
else leerConfig().then(conectarMqtt);          // se conecta solo, al cargar la página

// Una vez por segundo: reintento de reserva, vigilante del nodo, variaciones y gráficas
setInterval(() => {
  transporte.vigilar();
  pintarConexion();
  pintarVariaciones();
  if (graficasSucias || rango <= 5) actualizarGraficas();
  if (Date.now() - guardadoEn > CONFIG.historial.msGuardar) { guardadoEn = Date.now(); guardarHistorial(); }
}, 1000);
pintarVariaciones();
actualizarGraficas();
window.addEventListener('pagehide', guardarHistorial);

// Al volver a la pestaña o a la red no se espera al temporizador de mqtt.js
// (el navegador lo frena en segundo plano): se reconecta enseguida.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  transporte.reconectar('la pestaña volvió al frente');
  pintarConexion();
  LECTURAS.forEach(k => { if (nodo[k] !== null) animarLectura(k, nodo[k]); });
  actualizarGraficas();
});
window.addEventListener('online', () => {
  console.info('[MQTT] el equipo recuperó la red');
  pintarConexion();
  transporte.reconectar('volvió la red');
});
window.addEventListener('offline', () => {
  console.warn('[MQTT] el equipo perdió la red');
  pintarConexion();
});
})();

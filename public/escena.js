(function () {
"use strict";
/* ============================================================================
   ESCENA 3D DE LA MAQUETA DIGITAL
   Este archivo sólo dibuja el modelo. No lee sensores ni calcula el riesgo:
   app.js recibe los datos del nodo por MQTT y mueve la escena con window.Escena
   (fijarNivel, fijarCompuerta, fijarBuzzer, fijarLed, fijarLluvia,
   mostrarComponentes, restablecerVista). La geometría es la de la maqueta
   física terminada (v3.0).
   ========================================================================== */
if (!window.THREE) {
  document.getElementById('escena').classList.add('sin-webgl');
  return;
}

/* ============================================================================
   MAQUETA VIRTUAL v3.0 · SISTEMA IoT DE ALERTA TEMPRANA POR NIVEL DE RÍO (COLIMA)
   Reconstruida a partir de las fotos de la maqueta física terminada.

   SISTEMA DE COORDENADAS
     1 unidad = 1 cm. y = 0 es la cara de arriba del triplay.
     Las medidas se escriben "en la tabla": xb desde el borde izquierdo (lado del
     nacimiento) y zb desde el borde trasero. X(xb) y Z(zb) las pasan a la escena,
     que tiene el origen en el centro de la tabla y +Z hacia el frente (lado del
     servo, el farol y el HW-080).

   CÓMO SE SACARON LAS MEDIDAS
     Fotos con referencias conocidas: protoboard de 830 (16.5 cm), ESP32 DevKit
     (5.1 × 2.8 cm), servo MG995 y el unicel nominal de 12.7 cm.

   QUÉ CAMBIÓ RESPECTO A LA v2.3
   1. Tabla de triplay de 46.5 × 25 × 1.15 cm y patas de 4.9 × 4.9 × 6.7 cm.
   2. Un solo bloque de unicel de 12.7 cm (3″ + 2 × 1″) forrado de cartulina
      blanca, con fibra verde arriba y en la cara de la compuerta. Ya no hay
      sierra escalonada: sólo una franja de fibra encimada al frente.
   3. El río es un contenedor de plástico transparente de 19.5 × 10.8 cm, con
      fondo café y un banco de arena, apoyado en el triplay.
   4. Sin canaleta: la compuerta está en la cara del bloque y suelta el agua
      directo al tóper, que cuelga justo abajo. Cerrada no rebasa (la hoja
      llega a 10.1 cm y la columna máxima es de 5 cm).
   5. Servo MG995 en un abatelenguas parado, con fuente externa de 5 V.
   6. Farol con el LED RGB, placa de lluvia en el techo de la casa y HW-080 en
      un hoyo con tierra.
   7. Toda la electrónica va debajo de la tabla: 2 protoboards, ESP32, LM393,
      buzzer y el relé junto al tóper. El firmware no tiene salida de relé:
      la bomba siempre recircula.

   PINES (firmware y diagrama «Propuesta A v3»)
     HC-SR04 TRIG 33 · ECHO 32 (divisor 1 kΩ / 2 kΩ) · lluvia AO 34 ·
     humedad AO 35 · LED RGB R 27 G 26 B 25 · buzzer pasivo 14 · servo 13.
     Los sensores analógicos van al ADC1: el ADC2 no sirve con el WiFi activo.
   ========================================================================== */

// ===== CONFIG (todo lo ajustable vive aquí; medidas en cm de la tabla) =====
const CONFIG = {
  base:   { largo: 46.5, ancho: 25, espesor: 1.15 },
  patas:  { lado: 4.9, alto: 6.7 },
  fibra:  0.6,                                    // fibra verde (tipo esponja)
  // unicel 3″ + 2 × 1″ = 12.7 cm; las paredes blancas van de -1.2 a 26.65 (sobresale 1.2 cm a la izquierda)
  bloque: { x0: -1.2, x1: 26.65, cara: 27.25, alto: 12.7, pared: 0.5 },
  franja: { espesor: 0.4 },                       // fibra encimada al frente del bloque
  rio:    { x0: 7.8, x1: 27.3, z0: 4.0, z1: 14.8, alto: 12.15, pared: 0.15, piso: 0.2, labio: 1.2 },
  compuerta: { x: 27.5, yEje: 11.6, z0: 4.1, z1: 14.9, yInf: 1.25, barra: 1.5, espesor: 0.25 },
  servo:  { x: 28.3, z: 17.45, y: 10.45 },        // MG995: el eje de salida mira hacia atrás (−z)
  toper:  { x0: 27.8, x1: 41.2, z0: 1.0, z1: 14.6, fondo: -7.45, angosto: 0.8, pared: 0.12, litros: 1.0 },
  puente: { x0: 11.0, x1: 15.1, z0: 2.5, z1: 16.9 },
  farol:  { x: 24.7, z: 15.7, poste: 4.9, cabeza: [3.2, 4.5, 3.2] },
  yl69:   { x: 18.0, z: 18.6, hoyo: 3.1 },
  casa:   { x: 2.9, z: 8.4 },
  placa:  { x: 2.0, z: 6.0 },
  casita: { x: 35.2, z: 20.3 },
  nacimiento: { x: 6.3, z: 10.6 },
  bomba:  { x: 36.0, z: 3.3 },
  rele:   { x: 44.1, z: 11.65 },
  proto:  { x0: 2.6, z0: 5.75 },                  // esquina de las 2 protoboards (bajo la tabla)

  sensor: { distVacio: 13.7, distLleno: 8.7 },    // calibración del firmware (cm)
  sim:    { nivelMax: 400 },                      // cm reales que representa el sistema

  camara: {
    fov: 38, cerca: 0.1, lejos: 900, msVista: 800,
    distMin: 34, distMax: 300,                    // límites del zoom
    nieblaCerca: 170, nieblaLejos: 560
  },

  // Encuadre inicial: desde dónde se mira y cuánto mide el modelo visto así
  // (en cm, ya proyectado), para que quepa en la zona libre entre tarjetas.
  // v3.0: más alto que la v2.3 (~45°) para ver el río, que va 8–12 cm abajo dentro del bloque.
  vista: { dir: [48, 66, 46], objetivo: [-0.6, 3.0, 0.5], ancho: 54, alto: 52, margen: 0.9 },

  anim: { msNivel: 600, msCompuerta: 500 },

  lluvia: { gotas: 240, alto: 32, largo: 0.9 },   // gotas con lluvia al 100 %

  colores: {
    fondo: 0x1d2b24, hueso: 0xdad7cd,             // --bg-deep y --c-bone de la página
    ledBajo: 0xa3b18a, haloMedio: 0xdda15e, haloAlto: 0xbc4749,   // --risk-low / mid / high
    ledApagado: 0x3a3f45
  },

  cable: { v5: 0xcc3b2b, gnd: 0x24282c }
};

// ===== UTILIDADES =====
const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
const mezclar = (a, b, t) => a + (b - a) * t;
function suavizar(a, b, x) { const t = limitar((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function suaveInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
const fmt = n => (Math.round(n * 10) / 10).toString();

// PRNG determinista (LCG): la maqueta se ve idéntica en cada carga
let _semilla = 20261124;
function aleatorio() { _semilla = (_semilla * 1664525 + 1013904223) % 4294967296; return _semilla / 4294967296; }
function entre(a, b) { return a + (b - a) * aleatorio(); }

// De "cm desde el borde izquierdo / trasero" a coordenadas de la escena
const X = xb => xb - CONFIG.base.largo / 2;
const Z = zb => zb - CONFIG.base.ancho / 2;
const V = (xb, y, zb) => new THREE.Vector3(X(xb), y, Z(zb));

// Alturas y atajos que se usan en todos lados
const B = CONFIG.base, K = CONFIG.rio, CP = CONFIG.compuerta, TP = CONFIG.toper, PT = CONFIG.puente;
const BL = CONFIG.bloque, PW = BL.pared;
const yTope = BL.alto + CONFIG.fibra;                     // 13.3: arriba del bloque
const xCara = BL.cara, xIzq = BL.x0;                      // cara de la compuerta y borde izquierdo del bloque
const yBajo = CONFIG.fibra;                               // 0.6: arriba de la zona baja
const yMesa = -B.espesor - CONFIG.patas.alto;             // -7.85
const zcRio = Z((K.z0 + K.z1) / 2);                       // centro del río en la escena
const anchoIntRio = K.z1 - K.z0 - 2 * K.pared;            // 10.5
const xIntRio0 = K.x0 + K.pared, xIntRio1 = K.x1;         // el extremo de aguas abajo lo cierra la compuerta

/* ===== TABLA DE CALIBRACIÓN =====
   El HC-SR04 mide de su cara al agua: vacío 13.7 cm, lleno 8.7 cm (5 cm de
   columna ≡ 400 cm de río). columna = distVacio − distanciaLeída. */
const yCaraSensor = K.piso + CONFIG.sensor.distVacio;     // 13.9 (0.6 cm arriba del bloque)
const columnaMax = CONFIG.sensor.distVacio - CONFIG.sensor.distLleno;   // 5 cm
function columnaDesdeNivel(nivelCm) { return limitar(nivelCm / CONFIG.sim.nivelMax, 0, 1) * columnaMax; }
function yAguaCanal(nivelCm) { return K.piso + columnaDesdeNivel(nivelCm); }
function distanciaSensor(nivelCm) { return yCaraSensor - yAguaCanal(nivelCm); }

// Franja de fibra del frente (borde ondulado, cm desde atrás)
function bordeFranja(xb) { return 21.0 - 0.07 * xb + 0.55 * Math.sin(xb * 0.33 + 0.4) + 0.3 * Math.sin(xb * 0.81 + 1.3); }
// ¿El punto cae dentro del contenedor del río?
function enZanja(xb, zb) { return xb >= K.x0 && xb <= K.x1 && zb > K.z0 && zb < K.z1; }
// Cota de la superficie en un punto de la tabla: para posar árboles, casas y postes
function cotaTerreno(xb, zb) {
  if (xb > xCara) return (xb >= TP.x0 && xb <= TP.x1 && zb >= TP.z0 && zb <= TP.z1) ? 0 : yBajo;
  if (enZanja(xb, zb)) return K.piso;
  return yTope + (zb > bordeFranja(xb) ? CONFIG.franja.espesor : 0);
}

// ===== ESCENA, CÁMARA, RENDER =====
// El lienzo es transparente: detrás se ve el degradado de la página, que es
// lo que difuminan las tarjetas de vidrio. La niebla funde el modelo con él.
const contenedor = document.getElementById('escena');
const lienzo = document.getElementById('lienzo');
const zonaLibre = document.getElementById('zonaLibre');
const barra = document.getElementById('barra');
const escena = new THREE.Scene();
escena.background = null;
escena.fog = new THREE.Fog(CONFIG.colores.fondo, CONFIG.camara.nieblaCerca, CONFIG.camara.nieblaLejos);

const camara = new THREE.PerspectiveCamera(CONFIG.camara.fov, 1, CONFIG.camara.cerca, CONFIG.camara.lejos);
camara.position.set(59, 48, 57);

let render;
try {
  render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true });
} catch (error) {
  contenedor.classList.add('sin-webgl');
  return;
}
render.setClearColor(0x000000, 0);
render.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
render.shadowMap.enabled = true;
render.shadowMap.type = THREE.PCFSoftShadowMap;

// Quien pide menos movimiento no ve oleaje, lluvia ni pulsos
const mqQuieto = window.matchMedia('(prefers-reduced-motion: reduce)');

// ===== CONTROLES DE ÓRBITA =====
// THREE.OrbitControls del CDN; si no cargara, entra un controlador mínimo
// con la misma API que se usa aquí.
let controles;
if (THREE.OrbitControls) {
  controles = new THREE.OrbitControls(camara, render.domElement);
} else {
  controles = new (function ControlesMinimos() {
    const yo = this; let gira = false, desplaza = false, px = 0, py = 0;
    yo.target = new THREE.Vector3(); yo.enabled = true; yo.enableDamping = true;
    yo.dampingFactor = 0.08; yo.autoRotate = false; yo.autoRotateSpeed = 0.6;
    yo.minDistance = 12; yo.maxDistance = 200; yo.maxPolarAngle = Math.PI * 0.495;
    const esf = new THREE.Spherical(), dv = new THREE.Vector3();
    dv.copy(camara.position).sub(yo.target); esf.setFromVector3(dv);
    let dTheta = 0, dPhi = 0, dRadio = 0; const pan = new THREE.Vector3();
    render.domElement.addEventListener('contextmenu', e => e.preventDefault());
    render.domElement.addEventListener('pointerdown', e => {
      if (!yo.enabled) return; px = e.clientX; py = e.clientY;
      if (e.button === 2 || e.shiftKey) desplaza = true; else gira = true;
    });
    window.addEventListener('pointerup', () => { gira = desplaza = false; });
    window.addEventListener('pointermove', e => {
      if (!yo.enabled || (!gira && !desplaza)) return;
      const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      if (gira) { dTheta -= dx * 0.005; dPhi -= dy * 0.005; }
      else {
        const k = esf.radius * 0.0016;
        const der = new THREE.Vector3().setFromMatrixColumn(camara.matrix, 0);
        const arr = new THREE.Vector3().setFromMatrixColumn(camara.matrix, 1);
        pan.addScaledVector(der, -dx * k).addScaledVector(arr, dy * k);
      }
    });
    render.domElement.addEventListener('wheel', e => { if (yo.enabled) { e.preventDefault(); dRadio += e.deltaY * 0.03; } }, { passive: false });
    yo.update = function () {
      if (yo.autoRotate && yo.enabled) dTheta -= 0.0016 * yo.autoRotateSpeed;
      esf.theta += dTheta; esf.phi = limitar(esf.phi + dPhi, 0.05, yo.maxPolarAngle);
      esf.radius = limitar(esf.radius + dRadio, yo.minDistance, yo.maxDistance);
      yo.target.add(pan);
      camara.position.copy(yo.target).add(new THREE.Vector3().setFromSpherical(esf));
      camara.lookAt(yo.target);
      dTheta *= 0.82; dPhi *= 0.82; dRadio *= 0.82; pan.multiplyScalar(0.82);
    };
    // Tras mover la cámara desde el código hay que releer dónde quedó
    yo.sincronizar = function () { dv.copy(camara.position).sub(yo.target); esf.setFromVector3(dv); };
    yo.addEventListener = function (tipo, fn) {
      if (tipo === 'start') render.domElement.addEventListener('pointerdown', fn);
    };
  })();
}
controles.target.fromArray(CONFIG.vista.objetivo);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.minDistance = CONFIG.camara.distMin;
controles.maxDistance = CONFIG.camara.distMax;
controles.maxPolarAngle = Math.PI * 0.495;      // nunca por debajo del piso
controles.autoRotate = false;

// ===== ILUMINACIÓN (hemisférica de relleno + un solo sol con sombras) =====
// El relleno toma el hueso de la paleta para que el modelo se funda con el fondo.
escena.add(new THREE.HemisphereLight(CONFIG.colores.hueso, 0x6d7a63, 0.9));
const sol = new THREE.DirectionalLight(0xfff4e2, 0.82);
sol.position.set(24, 40, 22);
sol.castShadow = true;
sol.shadow.mapSize.set(1536, 1536);
sol.shadow.camera.left = -34; sol.shadow.camera.right = 34;
sol.shadow.camera.top = 28; sol.shadow.camera.bottom = -28;
sol.shadow.camera.near = 1; sol.shadow.camera.far = 150;
sol.shadow.bias = -0.0012;
escena.add(sol, sol.target);

/* ===== TEXTURAS PROCEDURALES (canvas): fibra, triplay, malla, arena… =====
   Se pintan con el LCG, así que salen iguales en cada carga. */
function texturaCanvas(tam, pintar, rep) {
  const c = document.createElement('canvas'); c.width = c.height = tam;
  pintar(c.getContext('2d'), tam);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (rep) t.repeat.set(rep[0], rep[1]);
  return t;
}
function motas(ctx, tam, base, colores, n, rMin, rMax) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, tam, tam);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colores[i % colores.length];
    ctx.globalAlpha = entre(0.25, 0.8);
    const r = entre(rMin, rMax);
    ctx.fillRect(entre(0, tam), entre(0, tam), r, r * entre(0.4, 1.6));
  }
  ctx.globalAlpha = 1;
}
const TEX = {
  fibra:     texturaCanvas(256, (c, s) => motas(c, s, '#2f4a43', ['#4d6b62', '#223a34', '#6f8c84', '#3c5a51', '#8aa39b'], 5200, 1, 3.2), [0.11, 0.11]),
  fibraCara: texturaCanvas(256, (c, s) => motas(c, s, '#2f4a43', ['#4d6b62', '#223a34', '#6f8c84', '#3c5a51'], 5200, 1, 3.2), [1, 1]),
  follaje:   texturaCanvas(128, (c, s) => motas(c, s, '#245f28', ['#3a8a36', '#173f1b', '#4fa046', '#1f5222', '#2f7a30'], 2600, 1, 3), [3, 3]),
  arena:     texturaCanvas(128, (c, s) => motas(c, s, '#b9a37a', ['#d6c49c', '#8f7b57', '#e8dcc0', '#6e5f45'], 2600, 0.6, 1.6), [0.25, 0.25]),
  foam:      texturaCanvas(128, (c, s) => motas(c, s, '#eceef0', ['#e2e5e8', '#f6f7f8', '#dfe2e5'], 900, 2, 6), [0.08, 0.08]),
  triplay:   texturaCanvas(256, (c, s) => {
    c.fillStyle = '#9c6b45'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      c.strokeStyle = i % 2 ? 'rgba(120,78,46,.35)' : 'rgba(170,120,80,.3)';
      c.lineWidth = entre(1, 3);
      c.beginPath(); const y = entre(0, s);
      c.moveTo(0, y); c.bezierCurveTo(s * .3, y + entre(-8, 8), s * .7, y + entre(-8, 8), s, y + entre(-4, 4)); c.stroke();
    }
  }, [0.06, 0.06]),
  canto: texturaCanvas(64, (c, s) => {                   // capas del triplay vistas de canto
    const capas = ['#e5d3b2', '#cdb48c', '#e9dabd', '#c9ae85', '#e2cfaa'];
    for (let i = 0; i < 5; i++) { c.fillStyle = capas[i]; c.fillRect(0, i * s / 5, s, s / 5); }
    c.fillStyle = 'rgba(90,60,30,.5)';
    for (let i = 1; i < 5; i++) c.fillRect(0, i * s / 5 - 1, s, 1.5);
  }, [1, 1]),
  malla: texturaCanvas(128, (c, s) => {                  // hoja de la compuerta (malla tipo tapete)
    c.fillStyle = '#6c6f73'; c.fillRect(0, 0, s, s);
    c.strokeStyle = '#3d4044'; c.lineWidth = 2;
    for (let i = -s; i < 2 * s; i += 10) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i + s, s); c.stroke();
      c.beginPath(); c.moveTo(i, s); c.lineTo(i + s, 0); c.stroke();
    }
    c.fillStyle = 'rgba(220,225,230,.18)';
    for (let i = 0; i < 260; i++) c.fillRect(entre(0, s), entre(0, s), 2, 2);
  }, [2.5, 2.5]),
  peine: texturaCanvas(128, (c, s) => {                  // placa de lluvia: pistas en peine
    c.fillStyle = '#1d2226'; c.fillRect(0, 0, s, s);
    c.fillStyle = '#c9cdd1';
    for (let i = 0; i < 12; i++) c.fillRect(8, 8 + i * 9.5, s - 16, 3.2);
    c.fillRect(6, 6, 4, s - 12); c.fillRect(s - 10, 6, 4, s - 12);
  }, [1, 1])
};

// ===== MATERIALES COMPARTIDOS =====
const Ph = o => new THREE.MeshPhongMaterial(o);
const MAT = {
  triplay:   Ph({ map: TEX.triplay, shininess: 10 }),
  canto:     Ph({ map: TEX.canto, shininess: 8 }),
  pata:      Ph({ color: 0xe9d7ae, shininess: 8 }),
  fibra:     Ph({ map: TEX.fibra, shininess: 2 }),
  fibraCara: Ph({ map: TEX.fibraCara, shininess: 2 }),
  foam:      Ph({ map: TEX.foam, color: 0xffffff, shininess: 12 }),
  unicel:    Ph({ color: 0xe9e6dc, shininess: 4 }),
  plastico:  Ph({ color: 0xcfe3ea, shininess: 110, specular: 0xffffff, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false }),
  aristaPl:  new THREE.LineBasicMaterial({ color: 0x8fb3c2, transparent: true, opacity: 0.85 }),
  aristaTp:  new THREE.LineBasicMaterial({ color: 0xa9bcc4, transparent: true, opacity: 0.8 }),
  fondoRio:  Ph({ color: 0x4b3a2c, shininess: 6 }),
  arena:     Ph({ map: TEX.arena, shininess: 4 }),
  agua:      Ph({ color: 0x2b86c4, shininess: 95, specular: 0xa8ddf5, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
  lamina:    Ph({ color: 0x4aa3dc, shininess: 80, specular: 0xcfeeff, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
  malla:     Ph({ map: TEX.malla, shininess: 20 }),
  abate:     Ph({ color: 0xe6cda3, shininess: 10 }),        // abatelenguas / palito de madera
  brocheta:  Ph({ color: 0xe2c896, shininess: 10 }),
  carton:    Ph({ color: 0xd3b88a, shininess: 6 }),         // tablero del puente
  barandal:  Ph({ color: 0x8a5a33, shininess: 8, side: THREE.DoubleSide }),
  blanco:    Ph({ color: 0xf3f2ee, shininess: 16 }),
  negro:     Ph({ color: 0x24282c, shininess: 30 }),
  grisFarol: Ph({ color: 0x4d545c, shininess: 20 }),
  vidrio:    Ph({ color: 0xdde8ee, shininess: 100, transparent: true, opacity: 0.35, depthWrite: false }),
  metal:     Ph({ color: 0xb7bcc1, shininess: 80, specular: 0x777777 }),
  metalOsc:  Ph({ color: 0x6d757c, shininess: 50 }),
  pcbAzul:   Ph({ color: 0x1f5f9e, shininess: 30 }),
  pcbNegro:  Ph({ color: 0x1c1f22, shininess: 30 }),
  protoboard:Ph({ color: 0xf1eee6, shininess: 22 }),
  tierra:    Ph({ color: 0x5a3f2c, shininess: 3, flatShading: true }),
  tronco:    Ph({ color: 0x5c4130, shininess: 3 }),
  follaje:   Ph({ map: TEX.follaje, color: 0xffffff, shininess: 2 }),
  follaje2:  Ph({ map: TEX.follaje, color: 0xe2f5dc, shininess: 2 }),
  muro:      Ph({ color: 0xf2efe6, shininess: 8 }),
  ventana:   Ph({ color: 0x3a3631, shininess: 4 }),
  puerta:    Ph({ color: 0xe8b890, shininess: 4 }),
  peine:     Ph({ map: TEX.peine, shininess: 60 }),
  toper:     Ph({ color: 0xdfe9ee, shininess: 90, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
  bomba:     Ph({ color: 0xeeeeea, shininess: 40 }),
  manguera:  Ph({ color: 0xd7dccf, shininess: 70, transparent: true, opacity: 0.75 }),
  mesa:      new THREE.ShadowMaterial({ opacity: 0.34 }),   // sólo la sombra: debajo se ve el fondo de la página
  flecha:    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
  // El buzzer va bajo la tabla: su halo se ve de lado, entre las patas
  halo:      new THREE.MeshBasicMaterial({ color: CONFIG.colores.haloAlto, transparent: true, opacity: 0, depthWrite: false, fog: false }),
  guia:      new THREE.LineBasicMaterial({ color: CONFIG.colores.hueso, transparent: true, opacity: 0.45 })   // guías y cotas
};

// ===== GRUPOS (una capa por tipo de pieza) =====
const grupoTerreno      = new THREE.Group(); grupoTerreno.name = 'base_patas_y_bloque';
const grupoCanal        = new THREE.Group(); grupoCanal.name = 'rio_contenedor';
const grupoAgua         = new THREE.Group(); grupoAgua.name = 'agua';
const grupoFlujo        = new THREE.Group(); grupoFlujo.name = 'flechas_de_flujo';
const grupoAmbientacion = new THREE.Group(); grupoAmbientacion.name = 'ambientacion';
const grupoPuente       = new THREE.Group(); grupoPuente.name = 'puente_y_compuerta';
const grupoSensores     = new THREE.Group(); grupoSensores.name = 'sensores_y_cableado';
const grupoActuadores   = new THREE.Group(); grupoActuadores.name = 'actuadores';
const grupoBahia        = new THREE.Group(); grupoBahia.name = 'toper_y_electronica';
const grupoGuias        = new THREE.Group(); grupoGuias.name = 'guias_etiquetas';
const grupoCotas        = new THREE.Group(); grupoCotas.name = 'cotas_generales';
escena.add(grupoTerreno, grupoCanal, grupoAgua, grupoFlujo, grupoAmbientacion, grupoPuente,
           grupoSensores, grupoActuadores, grupoBahia, grupoGuias, grupoCotas);

const CAPAS = {
  terreno: grupoTerreno, canal: grupoCanal, agua: grupoAgua, flujo: grupoFlujo,
  ambientacion: grupoAmbientacion, puente: grupoPuente, sensores: grupoSensores,
  actuadores: grupoActuadores, bahia: grupoBahia, cotas: grupoCotas
};

// ===== AYUDAS DE MODELADO =====
function caja(w, h, d, mat, x, y, z, nombre) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (nombre) m.name = nombre;
  return m;
}
// Caja dada por sus límites en cm de la tabla
function bloque(xb0, xb1, y0, y1, zb0, zb1, mat, nombre) {
  return caja(xb1 - xb0, y1 - y0, zb1 - zb0, mat, X((xb0 + xb1) / 2), (y0 + y1) / 2, Z((zb0 + zb1) / 2), nombre);
}
function cilindro(rt, rb, h, seg, mat, x, y, z, nombre) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (nombre) m.name = nombre;
  return m;
}
// Losa horizontal a partir de un contorno [[xb, zb], ...] (con huecos opcionales).
// mats = [tapas, cantos]
function losa(contorno, y0, espesor, mats, nombre, huecos) {
  const forma = new THREE.Shape();
  contorno.forEach(([xb, zb], i) => i ? forma.lineTo(X(xb), -Z(zb)) : forma.moveTo(X(xb), -Z(zb)));
  forma.closePath();
  (huecos || []).forEach(h => {
    const p = new THREE.Path();
    h.forEach(([xb, zb], i) => i ? p.lineTo(X(xb), -Z(zb)) : p.moveTo(X(xb), -Z(zb)));
    p.closePath(); forma.holes.push(p);
  });
  const geo = new THREE.ExtrudeGeometry(forma, { depth: espesor, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  const m = new THREE.Mesh(geo, mats);
  m.castShadow = true; m.receiveShadow = true; m.name = nombre;
  return m;
}
// Aristas visibles para las piezas transparentes (si no, "desaparecen")
function aristas(malla, grupo, mat) {
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(malla.geometry, 30), mat || MAT.aristaPl);
  l.position.copy(malla.position); l.rotation.copy(malla.rotation); l.name = 'arista';
  (grupo || malla.parent).add(l);
  return malla;
}
const _matsCable = {};
function materialCable(color) {
  if (!_matsCable[color]) _matsCable[color] = Ph({ color: color, shininess: 45 });
  return _matsCable[color];
}
function tubo(puntos, radio, color, nombre, tension) {
  const curva = new THREE.CatmullRomCurve3(puntos, false, 'catmullrom', tension === undefined ? 0.35 : tension);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curva, Math.max(24, puntos.length * 10), radio, 6, false),
    typeof color === 'number' ? materialCable(color) : color);
  m.castShadow = false; m.name = nombre || 'cable';
  return m;
}
// Mazo de varios hilos paralelos que siguen la misma ruta (desfase en un eje)
function mazo(grupo, puntos, colores, eje, sep) {
  const d = eje || new THREE.Vector3(1, 0, 0), s = sep || 0.17;
  colores.forEach((c, i) => {
    const off = (i - (colores.length - 1) / 2) * s;
    grupo.add(tubo(puntos.map(p => p.clone().addScaledVector(d, off)), 0.07, c, 'cable'));
  });
}

/* ============================================================================
   ===== BASE: TRIPLAY CON EL HUECO DEL TÓPER Y 4 PATAS =====
   ========================================================================== */
const huecoToper = [[TP.x0, TP.z0], [TP.x1, TP.z0], [TP.x1, TP.z1], [TP.x0, TP.z1]];
(function construirBase() {
  grupoTerreno.add(losa([[0, 0], [B.largo, 0], [B.largo, B.ancho], [0, B.ancho]],
    -B.espesor, B.espesor, [MAT.triplay, MAT.canto], 'tabla_triplay', [huecoToper]));
  const L = CONFIG.patas.lado, H = CONFIG.patas.alto;
  [[0, 0], [B.largo - L, 0], [0, B.ancho - L], [B.largo - L, B.ancho - L]].forEach(([xb, zb]) =>
    grupoTerreno.add(bloque(xb, xb + L, -B.espesor - H, -B.espesor, zb, zb + L, MAT.pata, 'pata')));
  // Fibra de la zona baja, recortada alrededor del tóper
  grupoTerreno.add(losa([[xCara, 0], [B.largo, 0], [B.largo, B.ancho], [xCara, B.ancho], [xCara, TP.z1], [TP.x1, TP.z1], [TP.x1, TP.z0], [xCara, TP.z0]],
    0, CONFIG.fibra, [MAT.fibra, MAT.fibra], 'fibra_zona_baja'));
})();

// Mesa de trabajo: plano invisible que sólo recibe la sombra de la maqueta
const mesa = new THREE.Mesh(new THREE.PlaneGeometry(170, 120), MAT.mesa);
mesa.rotation.x = -Math.PI / 2;
mesa.position.y = yMesa;
mesa.receiveShadow = true;
mesa.name = 'mesa_trabajo';
escena.add(mesa);

/* ============================================================================
   ===== BLOQUE DE UNICEL CON LA ZANJA DEL RÍO =====
   Unicel de 3″ + 2 × 1″ (12.7 cm). Sobresale 1.2 cm por la izquierda de la
   tabla. La zanja atraviesa todo el bloque hasta el triplay y llega a la cara
   de la compuerta. Paredes de cartulina blanca en el frente, atrás y el lado
   izquierdo; fibra verde arriba y en la cara.
   ========================================================================== */
(function construirBloque() {
  const g = grupoTerreno, x0 = xIzq + PW;
  g.add(losa([[x0, PW], [BL.x1, PW], [BL.x1, K.z0], [K.x0, K.z0], [K.x0, K.z1], [BL.x1, K.z1], [BL.x1, B.ancho - PW], [x0, B.ancho - PW]],
    0, BL.alto, [MAT.unicel, MAT.fibraCara], 'unicel_bloque'));
  // Paredes de cartulina (foam board) de 5 mm
  g.add(bloque(xIzq, BL.x1, 0, BL.alto, B.ancho - PW, B.ancho, MAT.foam, 'pared_frontal'));
  g.add(bloque(xIzq, BL.x1, 0, BL.alto, 0, PW, MAT.foam, 'pared_trasera'));
  g.add(bloque(xIzq, x0, 0, BL.alto, PW, B.ancho - PW, MAT.foam, 'pared_izquierda'));
  // Fibra de arriba (con la muesca de la zanja) y de la cara de la compuerta
  g.add(losa([[xIzq, 0], [xCara, 0], [xCara, K.z0], [K.x0, K.z0], [K.x0, K.z1], [xCara, K.z1], [xCara, B.ancho], [xIzq, B.ancho]],
    BL.alto, CONFIG.fibra, [MAT.fibra, MAT.fibraCara], 'fibra_arriba'));
  g.add(bloque(BL.x1, xCara, 0, BL.alto, 0, K.z0, MAT.fibraCara, 'fibra_cara'));
  g.add(bloque(BL.x1, xCara, 0, BL.alto, K.z1, B.ancho, MAT.fibraCara, 'fibra_cara'));
  // Franja de fibra encimada al frente (borde ondulado)
  const pts = [];
  for (let i = 0; i <= 40; i++) { const xb = mezclar(xIzq, xCara, i / 40); pts.push([xb, bordeFranja(xb)]); }
  pts.push([xCara, B.ancho], [xIzq, B.ancho]);
  g.add(losa(pts, yTope, CONFIG.franja.espesor, [MAT.fibra, MAT.fibraCara], 'fibra_franja_frontal'));
})();

/* ============================================================================
   ===== RÍO: CONTENEDOR DE PLÁSTICO TRANSPARENTE =====
   Apoyado sobre el triplay dentro de la zanja. El extremo de aguas abajo está
   recortado (queda un labio de 1.2 cm) y lo tapa la compuerta.
   ========================================================================== */
(function construirRio() {
  const g = grupoCanal, w = K.pared;
  const piezas = [
    bloque(K.x0, K.x1, 0, w, K.z0, K.z1, MAT.plastico, 'rio_piso'),
    bloque(K.x0, K.x1, 0, K.alto, K.z0, K.z0 + w, MAT.plastico, 'rio_pared_trasera'),
    bloque(K.x0, K.x1, 0, K.alto, K.z1 - w, K.z1, MAT.plastico, 'rio_pared_frontal'),
    bloque(K.x0, K.x0 + w, 0, K.alto, K.z0, K.z1, MAT.plastico, 'rio_testero'),
    bloque(K.x1 - w, K.x1, 0, K.labio, K.z0, K.z1, MAT.plastico, 'rio_labio'),
    // ceja del borde
    bloque(K.x0 - 0.35, K.x1, K.alto - 0.12, K.alto, K.z0 - 0.35, K.z0, MAT.plastico, 'rio_ceja'),
    bloque(K.x0 - 0.35, K.x1, K.alto - 0.12, K.alto, K.z1, K.z1 + 0.35, MAT.plastico, 'rio_ceja'),
    bloque(K.x0 - 0.35, K.x0, K.alto - 0.12, K.alto, K.z0, K.z1, MAT.plastico, 'rio_ceja')
  ];
  piezas.forEach(m => { m.castShadow = false; g.add(m); aristas(m, g); });
  // Nervaduras del molde (líneas a media altura)
  [3.6, 7.4].forEach(y => [K.z0 + 0.02, K.z1 - 0.02].forEach(zb => {
    const n = bloque(K.x0 + 0.6, K.x1 - 0.3, y, y + 0.08, zb - 0.03, zb + 0.03, MAT.plastico, 'rio_nervadura');
    n.castShadow = false; g.add(n); aristas(n, g);
  }));
  // Fondo café
  g.add(bloque(K.x0 + w, K.x1 - 0.02, w, K.piso, K.z0 + w, K.z1 - w, MAT.fondoRio, 'rio_fondo_cafe'));
  // Banco de arena: lengua que se angosta hacia la compuerta, del lado del frente
  const P = [[16.5, 14.25], [16.4, 9.5], [16.9, 7.3], [18.5, 6.4], [20.8, 6.6], [23.0, 7.7], [25.0, 9.6], [26.4, 11.8], [27.2, 13.4], [27.4, 14.25]];
  const curva = new THREE.SplineCurve(P.map(p => new THREE.Vector2(p[0], p[1])));
  g.add(losa(curva.getPoints(40).map(v => [v.x, v.y]), K.piso, 0.45, [MAT.arena, MAT.arena], 'rio_banco_arena'));
})();

/* ============================================================================
   ===== TÓPER (RESERVORIO), BOMBA Y MANGUERA =====
   El tóper entra en el hueco del triplay y cuelga de su ceja; su fondo queda
   a ~0.4 cm de la mesa. La bomba va al fondo, del lado de atrás.
   ========================================================================== */
let bomba, helice;
const zbBomba = Math.max(CONFIG.bomba.z, TP.z0 + TP.angosto + 1.3);   // zb real de la bomba
(function construirToper() {
  const g = new THREE.Group(); g.name = 'toper';
  const w = TP.pared, y0 = TP.fondo, y1 = yBajo, k = TP.angosto;     // el fondo es más angosto que la boca
  const cx = X((TP.x0 + TP.x1) / 2), cz = Z((TP.z0 + TP.z1) / 2), ax = TP.x1 - TP.x0, az = TP.z1 - TP.z0, alto = y1 - y0;
  // Paredes inclinadas: un cilindro abierto de 4 lados con los vértices llevados a las esquinas
  const geo = new THREE.CylinderGeometry(1, 1, alto, 4, 1, true);
  geo.rotateY(Math.PI / 4);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const arriba = v.y > 0, sx = Math.sign(v.x), sz = Math.sign(v.z);
    p.setXYZ(i, sx * (ax / 2 - (arriba ? 0 : k)), v.y, sz * (az / 2 - (arriba ? 0 : k)));
  }
  geo.computeVertexNormals();
  const paredes = new THREE.Mesh(geo, MAT.toper); paredes.position.set(cx, y0 + alto / 2, cz); paredes.name = 'toper_paredes';
  [paredes,
   caja(ax - 2 * k, w, az - 2 * k, MAT.toper, cx, y0 + w / 2, cz, 'toper_piso'),
   bloque(TP.x0 - 0.5, TP.x1 + 0.5, y1, y1 + 0.15, TP.z0 - 0.5, TP.z0, MAT.toper, 'toper_ceja'),
   bloque(TP.x0 - 0.5, TP.x1 + 0.5, y1, y1 + 0.15, TP.z1, TP.z1 + 0.5, MAT.toper, 'toper_ceja'),
   bloque(TP.x1, TP.x1 + 0.5, y1, y1 + 0.15, TP.z0, TP.z1, MAT.toper, 'toper_ceja')
  ].forEach(m => { m.castShadow = false; g.add(m); aristas(m, g, MAT.aristaTp); });

  // Mini bomba sumergible blanca (cilindro con salida arriba)
  bomba = new THREE.Group(); bomba.name = 'bomba';
  bomba.position.set(X(CONFIG.bomba.x), TP.fondo + w, Z(zbBomba));
  bomba.add(cilindro(1.15, 1.2, 3.0, 18, MAT.bomba, 0, 1.5, 0, 'bomba_cuerpo'));
  bomba.add(cilindro(1.2, 1.2, 0.3, 18, MAT.bomba, 0, 0.15, 0, 'bomba_base'));
  bomba.add(cilindro(0.3, 0.32, 0.9, 10, MAT.bomba, 0.35, 3.4, -0.2, 'bomba_salida'));
  bomba.add(cilindro(0.12, 0.12, 0.7, 6, MAT.negro, -0.5, 3.3, 0.3, 'bomba_cable'));
  helice = new THREE.Group(); helice.position.set(0, 0.6, 1.21); helice.name = 'bomba_helice';
  for (let i = 0; i < 3; i++) {
    const pala = caja(0.7, 0.06, 0.06, MAT.metalOsc, 0, 0, 0, 'bomba_pala');
    pala.rotation.z = i * Math.PI * 2 / 3; helice.add(pala);
  }
  bomba.add(helice);
  g.add(bomba);
  grupoBahia.add(g);
})();

// Manguera de silicón transparente: sube por la pared trasera del tóper, entra
// al bloque por la esquina de atrás, corre oculta dentro del unicel y sale en
// el nacimiento (junto a la casa), donde se dobla hacia adentro del río.
const nac = CONFIG.nacimiento;
const curvaManguera = new THREE.CatmullRomCurve3([
  V(CONFIG.bomba.x + 0.35, TP.fondo + 3.9, zbBomba - 0.2),
  V(CONFIG.bomba.x - 0.6, TP.fondo + 5.0, TP.z0 + 1.0),
  V(32.5, -0.8, TP.z0 + 0.6),
  V(29.6, 0.95, TP.z0 + 0.5),
  V(xCara + 0.3, 1.05, 2.3),
  V(xCara - 1.2, 1.0, 2.3),                 // ya dentro del unicel
  V(18.0, 1.0, 2.3),
  V(9.0, 1.0, 2.5),
  V(nac.x, 1.0, 4.4),
  V(nac.x, 1.0, nac.z - 1.2),
  V(nac.x, 2.4, nac.z),
  V(nac.x, 10.0, nac.z),
  V(nac.x, yTope + 0.2, nac.z),
  V(nac.x + 0.6, yTope + 1.3, nac.z),
  V(K.x0 + 0.2, yTope + 1.4, nac.z),
  V(K.x0 + 1.5, yTope + 0.2, nac.z),
  V(K.x0 + 2.1, K.alto - 0.8, nac.z)
], false, 'catmullrom', 0.3);
const boquilla = V(K.x0 + 2.1, K.alto - 0.8, nac.z);
(function construirManguera() {
  const m = new THREE.Mesh(new THREE.TubeGeometry(curvaManguera, 220, 0.3, 8, false), MAT.manguera);
  m.name = 'manguera_silicon'; m.castShadow = true;
  grupoBahia.add(m);
})();
// Chorrito del nacimiento al río (sólo con la bomba encendida)
const chorroNacimiento = cilindro(0.2, 0.24, 1, 8, MAT.lamina, boquilla.x, 0, boquilla.z, 'chorro_nacimiento');
chorroNacimiento.castShadow = false;
grupoAgua.add(chorroNacimiento);

/* ============================================================================
   ===== COMPUERTA ABATIBLE (servo MG995) =====
   Hoja de plástico forrada con malla oscura y bordes negros, con una barra de
   abatelenguas arriba. Cuelga de un eje de brocheta a 11.6 cm del triplay; el
   servo, montado en un abatelenguas parado del lado del frente, la gira 0–90°
   hacia afuera y el agua cae directo al tóper.
   ========================================================================== */
const zcComp = Z((CP.z0 + CP.z1) / 2), anchoComp = CP.z1 - CP.z0;
const altoHoja = CP.yEje - CP.barra - CP.yInf;                 // 8.85
const pivoteCompuerta = new THREE.Group();
pivoteCompuerta.name = 'compuerta_pivote';
pivoteCompuerta.position.set(X(CP.x), CP.yEje, zcComp);
let servo;
(function construirCompuerta() {
  const g = pivoteCompuerta;
  g.add(caja(CP.espesor, altoHoja, anchoComp - 0.3, MAT.malla, 0, -CP.barra - altoHoja / 2, -0.15, 'compuerta_hoja'));
  // cinta negra en los bordes de la hoja
  g.add(caja(CP.espesor + 0.04, 0.35, anchoComp - 0.3, MAT.negro, 0, -CP.barra - altoHoja + 0.17, -0.15, 'compuerta_cinta'));
  g.add(caja(CP.espesor + 0.04, altoHoja, 0.3, MAT.negro, 0, -CP.barra - altoHoja / 2, -anchoComp / 2 + 0.15, 'compuerta_cinta'));
  // barra de abatelenguas y costado de abatelenguas
  g.add(caja(0.3, CP.barra, anchoComp + 0.4, MAT.abate, 0.02, -CP.barra / 2, 0, 'compuerta_barra'));
  g.add(caja(0.3, altoHoja + CP.barra, 0.9, MAT.abate, 0.05, -(altoHoja + CP.barra) / 2, -anchoComp / 2 - 0.2, 'compuerta_costado'));
  // eje de brocheta: del cuerno del servo hasta salir por atrás
  const zEje1 = CONFIG.servo.z - 2.2, zEje0 = K.z0 - 3.0;
  const eje = cilindro(0.15, 0.15, zEje1 - zEje0, 8, MAT.brocheta, 0, 0, Z((zEje1 + zEje0) / 2) - zcComp, 'compuerta_eje');
  eje.rotation.x = Math.PI / 2;
  g.add(eje);
  grupoPuente.add(g);

  // Fijos: palito vertical del frente (tope), soporte trasero con su abatelenguas
  grupoPuente.add(cilindro(0.15, 0.15, CP.yEje, 8, MAT.brocheta, X(CP.x + 0.2), CP.yEje / 2 + 0.6, Z(CP.z1 + 0.35), 'compuerta_palito_tope'));
  grupoPuente.add(bloque(CP.x - 6.6, CP.x + 0.2, K.alto, K.alto + 0.3, K.z0 - 0.75, K.z0 + 0.15, MAT.abate, 'soporte_abatelenguas'));
  grupoPuente.add(bloque(CP.x - 0.4, CP.x + 0.6, CP.yEje - 0.6, CP.yEje + 0.5, K.z0 - 1.6, K.z0 - 0.5, MAT.abate, 'soporte_taquito'));
  const stub = cilindro(0.15, 0.15, 2.6, 8, MAT.brocheta, X(CP.x - 5.0), K.alto + 0.45, Z(K.z0 - 1.3), 'soporte_brocheta');
  stub.rotation.x = Math.PI / 2;
  grupoPuente.add(stub);
  grupoPuente.add(cilindro(0.15, 0.15, 3.0, 8, MAT.brocheta, X(CP.x - 5.0), K.alto + 1.6, Z(K.z0 - 0.3), 'soporte_brocheta'));

  // Servo MG995 (negro): cuerpo 4.07 × 1.97 × 3.95 (sin flecha); orejas a lo alto
  servo = new THREE.Group(); servo.name = 'servo_mg995';
  servo.position.set(X(CONFIG.servo.x), CONFIG.servo.y, Z(CONFIG.servo.z));
  servo.add(caja(1.97, 4.07, 3.95, MAT.negro, 0, 0, 0, 'mg995_cuerpo'));
  servo.add(caja(1.97, 5.45, 0.25, MAT.negro, 0, 0, -0.85, 'mg995_orejas'));
  servo.add(caja(1.6, 1.4, 0.06, Ph({ color: 0x3a3f45 }), 0.99, 0.2, 0.8, 'mg995_etiqueta'));
  const yFlecha = CP.yEje - CONFIG.servo.y;
  const corona = cilindro(0.55, 0.55, 0.35, 14, MAT.negro, 0, yFlecha, -2.15, 'mg995_corona');
  corona.rotation.x = Math.PI / 2; servo.add(corona);
  servo.add(caja(0.45, 2.8, 0.15, MAT.negro, 0, yFlecha, -2.4, 'mg995_cuerno'));
  grupoActuadores.add(servo);
  // Abatelenguas parado que lo sostiene, sobre la fibra de la zona baja
  grupoActuadores.add(bloque(CONFIG.servo.x + 0.15, CONFIG.servo.x + 0.37, yBajo, CONFIG.servo.y - 2.035,
    CONFIG.servo.z + 0.4, CONFIG.servo.z + 2.2, MAT.abate, 'servo_abatelenguas'));
})();

/* ============================================================================
   ===== PUENTE CON EL HC-SR04 =====
   Tablero de cartón con barandal de cerca, postes blancos y estribos blancos a
   cada lado de la zanja. El HC-SR04 va debajo, con la cara a 13.7 cm del fondo.
   ========================================================================== */
const yTablero = yCaraSensor + 1.36 + 0.3;         // arriba del tablero ≈ 15.56
const xcPuente = (PT.x0 + PT.x1) / 2, anchoPuente = PT.x1 - PT.x0, largoPuente = PT.z1 - PT.z0;
function geoCerca(largo, alto, n) {                // barandal de cerca: una sola pieza con huecos
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(largo, 0); s.lineTo(largo, alto); s.lineTo(0, alto); s.closePath();
  const paso = largo / n, ancho = paso * 0.5;
  for (let i = 0; i < n; i++) {
    const x0 = i * paso + (paso - ancho) / 2 + paso / 2;
    if (x0 + ancho > largo - 0.05) break;
    const h = new THREE.Path();
    h.moveTo(x0, 0.16); h.lineTo(x0 + ancho, 0.16); h.lineTo(x0 + ancho, alto * 0.55); h.lineTo(x0, alto * 0.55); h.closePath();
    s.holes.push(h);
    const h2 = new THREE.Path();
    h2.moveTo(x0, alto * 0.67); h2.lineTo(x0 + ancho, alto * 0.67); h2.lineTo(x0 + ancho * 0.5, alto); h2.closePath();
    s.holes.push(h2);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
}
(function construirPuente() {
  const g = new THREE.Group(); g.name = 'puente';
  g.add(bloque(PT.x0, PT.x1, yTablero - 0.3, yTablero, PT.z0, PT.z1, MAT.carton, 'puente_tablero'));
  const geo = geoCerca(largoPuente - 1.4, 0.95, 34);
  [PT.x0 + 0.15, PT.x1 - 0.25].forEach(xb => {
    const c = new THREE.Mesh(geo, MAT.barandal);
    c.rotation.y = -Math.PI / 2;               // largo a lo largo de +Z
    c.position.set(X(xb), yTablero, Z(PT.z0 + 0.7));
    c.castShadow = true; c.name = 'puente_barandal';
    g.add(c);
  });
  [[PT.x0 + 0.2, PT.z0 + 0.35], [PT.x1 - 0.2, PT.z0 + 0.35], [PT.x0 + 0.2, PT.z1 - 0.35], [PT.x1 - 0.2, PT.z1 - 0.35]].forEach(([xb, zb]) =>
    g.add(bloque(xb - 0.45, xb + 0.45, yTablero, yTablero + 1.3, zb - 0.35, zb + 0.35, MAT.blanco, 'puente_poste')));
  // Estribos blancos a cada lado de la zanja
  g.add(bloque(PT.x0 - 0.2, PT.x1 + 0.2, yTope, yTablero - 0.3, PT.z0, K.z0 - 0.05, MAT.blanco, 'puente_estribo'));
  g.add(bloque(PT.x0 - 0.2, PT.x1 + 0.2, yTope, yTablero - 0.3, K.z1 + 0.05, PT.z1, MAT.blanco, 'puente_estribo'));
  grupoPuente.add(g);
})();

/* ============================================================================
   ===== SENSORES =====
   ========================================================================== */
function crearHCSR04() {
  const g = new THREE.Group(); g.name = 'hc_sr04';
  g.add(caja(4.5, 0.16, 2.0, MAT.pcbAzul, 0, 0, 0, 'hcsr04_pcb'));
  for (const s of [-1, 1]) {
    g.add(cilindro(0.8, 0.8, 1.2, 16, MAT.metal, s * 1.3, -0.68, 0, 'hcsr04_transductor'));
    g.add(cilindro(0.66, 0.66, 0.05, 16, Ph({ color: 0x3a4046 }), s * 1.3, -1.29, 0, 'hcsr04_malla'));
  }
  g.add(caja(0.5, 0.35, 0.3, MAT.metal, 0, -0.25, 0.6, 'hcsr04_cristal'));
  g.add(caja(1.1, 0.25, 0.25, MAT.negro, 0, 0.18, -0.85, 'hcsr04_pines'));
  return g;
}
function crearPlacaLluvia() {                       // placa de 5.4 × 4.0 con pistas en peine
  const g = new THREE.Group(); g.name = 'placa_lluvia';
  const p = new THREE.Mesh(new THREE.BoxGeometry(5.4, 4.0, 0.16), [MAT.pcbNegro, MAT.pcbNegro, MAT.pcbNegro, MAT.pcbNegro, MAT.peine, MAT.pcbNegro]);
  p.castShadow = true; p.name = 'lluvia_placa'; g.add(p);
  g.add(caja(0.9, 0.5, 0.35, MAT.negro, 0, -1.7, -0.2, 'lluvia_conector'));
  return g;
}
function crearHW080() {                             // horquilla de 2.0 × 6.0 cm
  const g = new THREE.Group(); g.name = 'hw080';
  const pcb = new THREE.Shape();
  pcb.moveTo(-1.0, 0); pcb.lineTo(1.0, 0); pcb.lineTo(1.0, -1.4); pcb.lineTo(0.75, -1.4); pcb.lineTo(0.75, -5.6); pcb.lineTo(0.55, -6.0);
  pcb.lineTo(0.35, -5.6); pcb.lineTo(0.35, -1.4); pcb.lineTo(-0.35, -1.4); pcb.lineTo(-0.35, -5.6); pcb.lineTo(-0.55, -6.0);
  pcb.lineTo(-0.75, -5.6); pcb.lineTo(-0.75, -1.4); pcb.lineTo(-1.0, -1.4); pcb.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(pcb, { depth: 0.16, bevelEnabled: false }), MAT.pcbNegro);
  m.castShadow = true; m.name = 'hw080_horquilla'; g.add(m);
  g.add(caja(0.8, 0.3, 0.6, MAT.negro, 0, 0.15, 0.25, 'hw080_conector'));
  return g;
}

// HC-SR04 bajo el puente, con los transductores a lo ancho del río
const hcsr04 = crearHCSR04();
hcsr04.position.set(X(xcPuente), yCaraSensor + 1.28, zcRio);
hcsr04.rotation.y = Math.PI / 2;
grupoSensores.add(hcsr04);

// Hoyo con tierra y el HW-080 (YL-69) adentro
const YL = CONFIG.yl69;
const hw080 = crearHW080();
hw080.position.set(X(YL.x + 0.2), yTope + 1.05, Z(YL.z));
hw080.rotation.set(-0.35, 0.6, 0.12);
grupoSensores.add(hw080);
grupoSensores.add(cilindro(YL.hoyo / 2, YL.hoyo / 2 - 0.2, 0.7, 18, MAT.tierra, X(YL.x), yTope - 0.3, Z(YL.z), 'hoyo_tierra'));

// Cono del ultrasonido (~30°): deja ver que la huella cae dentro del río
const conoHC = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 28, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xe8a33a, transparent: true, opacity: 0.17, side: THREE.DoubleSide, depthWrite: false }));
conoHC.name = 'cono_ultrasonido';
grupoSensores.add(conoHC);
const TAN15 = Math.tan(15 * Math.PI / 180);
function actualizarCono(yAgua) {
  const d = Math.max(0.2, yCaraSensor - yAgua), r = d * TAN15;
  conoHC.scale.set(r, d, r);
  conoHC.position.set(X(xcPuente), yAgua + d / 2, zcRio);
}

/* ============================================================================
   ===== FAROL CON EL LED RGB =====
   El LED toma el color que publica el nodo (campo "led"): apagado hasta que
   llega la primera lectura.
   ========================================================================== */
const FA = CONFIG.farol;
let ledFarol, luzFarol, brilloFarol;
const farol = new THREE.Group(); farol.name = 'farol';
(function construirFarol() {
  const g = farol, [cw, ch, cd] = FA.cabeza, y0 = FA.poste;
  g.position.set(X(FA.x), yTope, Z(FA.z));
  g.add(cilindro(0.6, 0.62, FA.poste, 14, MAT.grisFarol, 0, FA.poste / 2, 0, 'farol_poste'));
  g.add(caja(cw, 0.3, cd, MAT.grisFarol, 0, y0 + 0.15, 0, 'farol_base'));
  g.add(caja(cw + 0.2, 0.35, cd + 0.2, MAT.grisFarol, 0, y0 + ch - 0.17, 0, 'farol_techo'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    g.add(caja(0.35, ch, 0.35, MAT.grisFarol, sx * (cw / 2 - 0.17), y0 + ch / 2, sz * (cd / 2 - 0.17), 'farol_marco'));
  for (const s of [-1, 1]) {
    g.add(caja(cw - 0.5, ch - 0.7, 0.05, MAT.vidrio, 0, y0 + ch / 2, s * (cd / 2 - 0.05), 'farol_vidrio'));
    g.add(caja(0.05, ch - 0.7, cd - 0.5, MAT.vidrio, s * (cw / 2 - 0.05), y0 + ch / 2, 0, 'farol_vidrio'));
  }
  ledFarol = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: CONFIG.colores.ledApagado }));
  ledFarol.position.set(0, y0 + 1.25, 0); ledFarol.name = 'farol_led_rgb';
  g.add(ledFarol);
  g.add(cilindro(0.28, 0.28, 0.6, 10, Ph({ color: 0xe8eef2, transparent: true, opacity: 0.8 }), 0, y0 + 0.75, 0, 'farol_led_cuerpo'));
  // Resplandor dentro de la cabeza: el LED real es chiquito y de lejos no se notaría el color
  brilloFarol = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12),
    new THREE.MeshBasicMaterial({ color: CONFIG.colores.ledBajo, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  brilloFarol.position.set(0, y0 + 1.5, 0); brilloFarol.name = 'farol_brillo'; brilloFarol.renderOrder = 5;
  g.add(brilloFarol);
  luzFarol = new THREE.PointLight(CONFIG.colores.ledBajo, 0, 14, 2);
  luzFarol.position.set(0, y0 + 1.4, 0);
  g.add(luzFarol);
  grupoActuadores.add(g);
})();

/* ============================================================================
   ===== AMBIENTACIÓN: CASA CON LA PLACA DE LLUVIA, CASITA Y ÁRBOLES =====
   ========================================================================== */
function palitoRedondo(largo, ancho, grueso, mat) {  // abatelenguas con una punta redonda
  const s = new THREE.Shape(), r = ancho / 2;
  s.moveTo(0, -r); s.lineTo(largo - r, -r); s.absarc(largo - r, 0, r, -Math.PI / 2, Math.PI / 2, false); s.lineTo(0, r); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: grueso, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -grueso / 2);
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}
// Casa de cartulina blanca con techo de dos aguas de abatelenguas (cumbrera a lo largo de x)
function casa(largo, fondo, alto, nombre) {
  const g = new THREE.Group(); g.name = nombre;
  g.add(caja(largo, alto, fondo, MAT.muro, 0, alto / 2, 0, nombre + '_muros'));
  // hastiales
  const tri = new THREE.Shape(), hr = fondo * 0.45;
  tri.moveTo(-fondo / 2, 0); tri.lineTo(fondo / 2, 0); tri.lineTo(0, hr); tri.closePath();
  const geoTri = new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(geoTri, MAT.muro);
    m.rotation.y = Math.PI / 2; m.position.set(s * largo / 2 - (s > 0 ? 0.1 : 0), alto, 0); m.castShadow = true; m.name = nombre + '_hastial';
    g.add(m);
  }
  // techo: palitos con punta redonda, perpendiculares a la cumbrera
  const pend = Math.atan2(hr, fondo / 2), lado = Math.hypot(hr, fondo / 2) + 0.7;
  const n = Math.max(3, Math.round((largo + 0.6) / 1.55)), anchoP = (largo + 0.6) / n;
  const e = new THREE.Vector3(1, 0, 0);
  for (const s of [-1, 1]) {
    const d = new THREE.Vector3(0, -Math.sin(pend), s * Math.cos(pend));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(d, e, new THREE.Vector3().crossVectors(d, e)));
    for (let i = 0; i < n; i++) {
      const p = palitoRedondo(lado, anchoP - 0.06, 0.18, MAT.abate);
      p.name = nombre + '_techo'; p.quaternion.copy(q);
      p.position.set(-largo / 2 - 0.3 + anchoP * (i + 0.5), alto + hr + 0.12, 0);
      g.add(p);
    }
  }
  g.add(caja(largo + 0.7, 0.2, 0.55, MAT.blanco, 0, alto + hr + 0.2, 0, nombre + '_cumbrera'));
  // ventanas (cuadritos oscuros) y puerta en la cara del frente (+z)
  const fz = fondo / 2 + 0.01;
  [-largo * 0.28, largo * 0.28].forEach(x => {
    for (const dx of [-0.22, 0.22]) for (const dy of [-0.22, 0.22])
      g.add(caja(0.3, 0.3, 0.04, MAT.ventana, x + dx, alto * 0.62 + dy, fz, nombre + '_ventana'));
  });
  g.add(caja(Math.min(1.0, largo * 0.22), alto * 0.5, 0.05, MAT.puerta, 0, alto * 0.25, fz, nombre + '_puerta'));
  // ventanas en los costados
  for (const s of [-1, 1]) for (const dx of [-0.22, 0.22]) for (const dy of [-0.22, 0.22])
    g.add(caja(0.04, 0.3, 0.3, MAT.ventana, s * (largo / 2 + 0.01), alto * 0.6 + dy, dx, nombre + '_ventana'));
  return g;
}
const casaPrincipal = casa(5.4, 4.2, 3.0, 'casa');
casaPrincipal.position.set(X(CONFIG.casa.x), yTope, Z(CONFIG.casa.z));
grupoAmbientacion.add(casaPrincipal);
const casita = casa(3.4, 3.0, 2.6, 'casita');
casita.position.set(X(CONFIG.casita.x), yBajo, Z(CONFIG.casita.z));
casita.rotation.y = Math.PI / 2;                   // la puerta mira hacia el extremo de la zona baja
grupoAmbientacion.add(casita);

// Placa de lluvia recargada en la vertiente de atrás del techo, sostenida por una brocheta
const placaLluvia = crearPlacaLluvia();
placaLluvia.position.set(X(CONFIG.placa.x), yTope + 5.2, Z(CONFIG.placa.z));
placaLluvia.rotation.set(-0.35, 0, 0);
grupoSensores.add(placaLluvia);
const palitoPlaca = cilindro(0.12, 0.12, 4.4, 6, MAT.brocheta, X(CONFIG.placa.x), yTope + 3.4, Z(CONFIG.placa.z + 0.9), 'placa_brocheta');
palitoPlaca.rotation.x = 0.35;
grupoSensores.add(palitoPlaca);

// Árboles: copas de esponja con textura de follaje, deformadas para que no se vean lisas
function copa(rx, ry, rz, mat) {
  const geo = new THREE.SphereGeometry(1, 28, 20);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.06 * Math.sin(v.x * 7.1 + v.y * 3.3) + 0.05 * Math.sin(v.z * 8.3 - v.y * 5.1) + 0.03 * Math.sin(v.x * 17 + v.z * 13);
    p.setXYZ(i, v.x * rx * n, v.y * ry * n, v.z * rz * n);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.name = 'arbol_copa';
  return m;
}
function arbol(d) {
  const g = new THREE.Group(); g.name = 'arbol';
  const hT = d.tronco + d.copa * 0.3;
  g.add(cilindro(0.11, 0.15, hT, 6, MAT.tronco, 0, hT / 2, 0, 'arbol_tronco'));
  const c = copa(d.ancho / 2, d.copa / 2, d.ancho / 2 * (d.fondo || 1), d.mat);
  c.position.set(d.copaDx || 0, d.tronco + d.copa / 2, d.copaDz || 0);
  g.add(c);
  if (d.dona) {                                      // arbusto en forma de dona al pie
    const geo = new THREE.TorusGeometry(d.dona[0], d.dona[1], 10, 22);
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + 0.05 * Math.sin(v.x * 4.3 + v.y * 6.1); p.setXYZ(i, v.x * n, v.y * n, v.z * n * 1.25); }
    geo.computeVertexNormals();
    const dn = new THREE.Mesh(geo, MAT.follaje2); dn.rotation.x = Math.PI / 2; dn.position.y = d.dona[1];
    dn.castShadow = true; dn.name = 'arbol_dona'; g.add(dn);
  }
  return g;
}
const ARBOLES = [
  // x, z = posición del tronco (cm de la tabla); alto = tronco + copa (medido en las fotos)
  { x: 3.8,  z: 0.7,  ancho: 4.0, copa: 6.8, tronco: 4.6 },                     // atrás, junto a la casa (11.4 cm)
  { x: 13.4, z: 0.7,  ancho: 3.8, copa: 6.6, tronco: 4.6, mat: 'follaje2' },     // atrás, detrás del puente (11.2 cm)
  { x: 20.4, z: 1.1,  ancho: 4.2, copa: 6.4, tronco: 4.2 },                     // atrás, derecha (10.6 cm)
  { x: 4.2,  z: 17.4, ancho: 5.8, copa: 5.6, tronco: 2.3, dona: [2.55, 1.1], fondo: 0.95, copaDz: -1.7, copaDx: -0.5 },  // grande con dona (7.9 cm)
  { x: 11.1, z: 21.3, ancho: 4.0, copa: 4.6, tronco: 1.8, mat: 'follaje2' },     // frente (6.4 cm)
  { x: 23.4, z: 21.9, ancho: 4.2, copa: 6.9, tronco: 4.7 },                     // frente, junto al farol (11.6 cm)
  { x: 30.4, z: 20.7, ancho: 3.6, copa: 4.6, tronco: 1.9, mat: 'follaje2' }      // zona baja, junto al servo
];
ARBOLES.forEach(a => {
  const t = arbol(Object.assign({}, a, { mat: MAT[a.mat || 'follaje'] }));
  t.position.set(X(a.x), cotaTerreno(a.x, a.z) - 0.05, Z(a.z));
  if (!a.copaDz) t.rotation.y = entre(0, Math.PI * 2);
  grupoAmbientacion.add(t);
});

/* ============================================================================
   ===== ELECTRÓNICA BAJO LA TABLA =====
   2 protoboards de 830 boca abajo (proto 1 al frente, proto 2 atrás), el ESP32
   en la proto 2, las plaquitas LM393 y el buzzer en la proto 1. El relé va
   pegado bajo la tabla junto al tóper.
   ========================================================================== */
const yBajoTabla = -B.espesor;
const PR = CONFIG.proto;
const yCaraProto = yBajoTabla - 0.9;                 // cara de los hoyitos (mirando a la mesa)
let esp32, moduloRele, ledRele, buzzer;
const colX = c => PR.x0 + 0.45 + (c - 1) * 0.254;     // columna de la protoboard → xb
(function construirElectronica() {
  const g = new THREE.Group(); g.name = 'electronica';
  // Protoboards
  [PR.z0, PR.z0 + 5.5].forEach((z0, i) => {
    const p = new THREE.Group(); p.name = 'protoboard_' + (i ? 1 : 2);
    p.add(bloque(PR.x0, PR.x0 + 16.5, yCaraProto, yBajoTabla, z0, z0 + 5.5, MAT.protoboard, 'protoboard_830'));
    p.add(bloque(PR.x0 + 0.3, PR.x0 + 16.2, yCaraProto - 0.02, yCaraProto, z0 + 2.5, z0 + 3.0, Ph({ color: 0xd9d5c8 }), 'protoboard_canal'));
    [[0.35, CONFIG.cable.v5], [0.55, 0x2f5fb0], [4.95, 0x2f5fb0], [5.15, CONFIG.cable.v5]].forEach(([dz, c]) =>
      p.add(bloque(PR.x0 + 0.4, PR.x0 + 16.1, yCaraProto - 0.02, yCaraProto, z0 + dz - 0.03, z0 + dz + 0.03, materialCable(c), 'protoboard_bus')));
    g.add(p);
  });
  // ESP32 DevKit V1 de 30 pines (columnas 8 a 22 de la proto 2), USB-C hacia la izquierda
  esp32 = new THREE.Group(); esp32.name = 'esp32';
  esp32.position.set(X((colX(8) + colX(22)) / 2), yCaraProto - 0.95, Z(PR.z0 + 2.75));
  esp32.add(caja(5.1, 0.16, 2.8, MAT.pcbNegro, 0, 0, 0, 'esp32_pcb'));
  esp32.add(caja(1.8, 0.3, 1.6, MAT.metal, 1.3, -0.23, 0, 'esp32_blindaje'));
  esp32.add(caja(0.75, 0.3, 0.9, MAT.metal, -2.3, -0.22, 0, 'esp32_usbc'));
  for (const s of [-1, 1]) esp32.add(caja(3.8, 0.85, 0.25, MAT.negro, 0, 0.5, s * 1.27, 'esp32_pines'));
  g.add(esp32);
  // Plaquitas LM393 (lluvia c22–c25 y humedad c28–c31), paradas en la proto 1
  [[23.5, 'lm393_lluvia'], [29.5, 'lm393_humedad']].forEach(([c, nombre]) => {
    const m = new THREE.Group(); m.name = nombre;
    m.position.set(X(colX(c)), yCaraProto - 1.5, Z(PR.z0 + 5.5 + 3.6));
    m.add(caja(1.55, 3.0, 0.14, MAT.pcbAzul, 0, 0, 0, 'lm393_pcb'));
    m.add(caja(0.6, 0.45, 0.35, MAT.negro, 0, -0.2, 0.2, 'lm393_chip'));
    m.add(caja(0.6, 0.6, 0.45, Ph({ color: 0x2f6fe0 }), 0, 0.7, 0.22, 'lm393_potenciometro'));
    m.rotation.x = -0.35;
    g.add(m);
  });
  // Buzzer pasivo (c51–c53 de la proto 1)
  buzzer = new THREE.Group(); buzzer.name = 'buzzer';
  buzzer.position.set(X(colX(52)), yCaraProto, Z(PR.z0 + 5.5 + 1.5));
  buzzer.add(cilindro(0.6, 0.6, 0.85, 18, MAT.negro, 0, -0.45, 0, 'buzzer_capsula'));
  buzzer.add(cilindro(0.12, 0.12, 0.04, 8, MAT.metalOsc, 0, -0.9, 0, 'buzzer_orificio'));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), MAT.halo);
  halo.position.y = -0.5; halo.name = 'buzzer_halo'; halo.castShadow = false;
  buzzer.add(halo); buzzer.userData.halo = halo;
  g.add(buzzer);
  // Resistencias del divisor del ECHO y del LED
  [[49, 6.5], [55, 6.5], [57, 6.0]].forEach(([c, dz]) => {
    const r = cilindro(0.1, 0.1, 0.65, 8, Ph({ color: 0xd8b48a }), X(colX(c)), yCaraProto - 0.25, Z(PR.z0 + dz - 2.5), 'resistencia');
    r.rotation.z = Math.PI / 2; g.add(r);
  });
  // Módulo relé de 1 canal bajo la tabla, junto al tóper
  moduloRele = new THREE.Group(); moduloRele.name = 'modulo_rele';
  moduloRele.position.set(X(CONFIG.rele.x), yBajoTabla - 0.35, Z(CONFIG.rele.z));
  moduloRele.add(caja(2.6, 0.16, 3.4, MAT.pcbNegro, 0, 0, 0, 'rele_pcb'));
  moduloRele.add(caja(1.55, 1.5, 1.9, Ph({ color: 0x2a5aa8, shininess: 25 }), 0, -0.83, 0.2, 'rele_bloque'));
  moduloRele.add(caja(1.6, 0.9, 0.8, Ph({ color: 0x2f6fbf }), 0, -0.5, 1.25, 'rele_bornera'));
  moduloRele.add(caja(0.8, 0.25, 0.25, MAT.negro, 0, 0.2, -1.45, 'rele_pines'));
  for (let i = 0; i < 2; i++) moduloRele.add(cilindro(0.15, 0.15, 0.35, 8, MAT.negro, -0.9, 0.25, -1.1 + i * 2.2, 'rele_separador'));
  ledRele = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), Ph({ color: 0xd8402c }));
  ledRele.position.set(0.8, -0.12, -1.1); ledRele.name = 'rele_led'; moduloRele.add(ledRele);
  g.add(moduloRele);
  grupoBahia.add(g);
})();

/* ============================================================================
   ===== CABLEADO =====
   Rojo = 5 V, negro = GND, colores = datos (mismos colores del diagrama).
   · Esquina frontal derecha del bloque: servo, LED del farol y HW-080 bajan
     por la pared del frente.
   · Esquina trasera izquierda: HC-SR04 y placa de lluvia bajan por el lado
     izquierdo.
   · La bomba sale del tóper por la orilla derecha y va al relé.
   ========================================================================== */
const grupoCables = new THREE.Group(); grupoCables.name = 'cableado';
grupoSensores.add(grupoCables);
(function construirCables() {
  const g = grupoCables, ejeX = new THREE.Vector3(1, 0, 0), ejeZ = new THREE.Vector3(0, 0, 1);
  const yt = yTope + CONFIG.franja.espesor;            // arriba de la franja del frente
  const SV = CONFIG.servo, xp = xIzq - 0.25;           // xp: cara de afuera de la pared izquierda
  const zF = B.ancho + 0.25;                           // cara de afuera de la pared del frente
  const pz1 = PR.z0 + 5.5;                             // borde entre proto 2 (atrás) y proto 1 (frente)
  // Bajada común por la pared del frente y llegada a la protoboard
  const bajaFrente = (x, xFin, zFin) => [V(x, yt - 0.3, zF), V(x, 6.0, zF + 0.05), V(x, 0.5, zF + 0.1), V(x - 0.1, -0.7, zF + 0.15),
                                         V(x - 1.2, -1.6, B.ancho - 1.2), V(xFin + 3, -2.3, zFin + 1.5), V(xFin, yCaraProto - 0.15, zFin)];
  // Servo: café, rojo, naranja → por la cara del bloque hacia el frente y abajo
  mazo(g, [V(SV.x - 0.3, SV.y - 1.6, SV.z + 1.95), V(SV.x - 0.6, SV.y - 1.2, 22.3), V(26.9, SV.y - 1.4, zF)]
    .concat(bajaFrente(26.3, colX(58), PR.z0 + 4.6).slice(1)), [0x7a4a2a, CONFIG.cable.v5, 0xe08a1e], ejeX, 0.16);
  // LED RGB del farol: 3 hilos amarillos y el cátodo común → por el frente
  mazo(g, [V(FA.x + 0.2, yTope + 0.15, FA.z + 0.75), V(25.2, yTope + 0.2, 19.8), V(25.7, yt + 0.25, 24.0)]
    .concat(bajaFrente(25.7, colX(35), pz1 + 4.2)), [0xe6c228, 0xe6c228, 0xe6c228, CONFIG.cable.gnd], ejeX, 0.15);
  // HW-080: naranja y gris → hacia la esquina y abajo
  mazo(g, [V(YL.x + 0.5, yTope + 1.3, YL.z + 0.4), V(21.0, yt + 0.2, 21.4), V(24.8, yt + 0.25, 24.0)]
    .concat(bajaFrente(24.9, colX(29), pz1 + 4.6)), [0xe08a1e, 0x7d858c], ejeX, 0.16);
  // Bajada común por la pared izquierda (esquina de atrás) y llegada a la protoboard
  const bajaIzq = (z, xFin, zFin) => [V(xp, yTope - 0.4, z), V(xp - 0.05, 6.0, z - 0.2), V(xp - 0.1, 0.3, z - 0.3),
                                       V(0.2, -0.5, z - 0.3), V(1.4, -1.7, z + 1.5), V(xFin - 2, -2.3, zFin), V(xFin, yCaraProto - 0.15, zFin)];
  // HC-SR04: 4 hilos bajo el tablero hasta el estribo de atrás, luego por atrás hasta la casa
  mazo(g, [V(xcPuente - 0.85, yCaraSensor + 1.45, 9.4), V(xcPuente - 1.3, yTablero - 0.45, 7.0), V(xcPuente - 1.3, yTablero - 0.45, PT.z0 + 0.3),
           V(xcPuente - 1.0, yTope + 0.4, 2.2), V(8.5, yTope + 0.25, 2.4), V(1.5, yTope + 0.3, 3.0), V(xIzq + 0.2, yTope + 0.25, 3.3)]
    .concat(bajaIzq(3.3, colX(51), PR.z0 + 1.6)), [CONFIG.cable.gnd, 0x2e9c55, 0xe08a1e, 0x2f5fb0], ejeZ, 0.15);
  // Placa de lluvia: negro, blanco, café → mismo camino por el lado izquierdo
  mazo(g, [V(CONFIG.placa.x, yTope + 3.1, CONFIG.placa.z - 0.9), V(1.4, yTope + 0.6, 4.3), V(xIzq + 0.2, yTope + 0.25, 4.3)]
    .concat(bajaIzq(4.3, colX(23), pz1 + 4.4)), [CONFIG.cable.gnd, 0xeeeeee, 0x7a4a2a], ejeZ, 0.15);
  // Bomba: del tóper por la orilla derecha, baja por el canto y llega al relé
  mazo(g, [V(CONFIG.bomba.x - 0.5, TP.fondo + 3.6, zbBomba + 0.3), V(38.0, -2.0, 2.6), V(TP.x1 - 0.2, 0.4, 2.8), V(TP.x1 + 0.6, yBajo + 0.9, 3.4),
           V(44.6, yBajo + 0.25, 4.2), V(B.largo + 0.25, 0.2, 4.6), V(B.largo + 0.35, -1.0, 5.0), V(B.largo - 0.9, -1.6, 7.5), V(CONFIG.rele.x + 0.6, -1.9, CONFIG.rele.z + 1.7)],
    [CONFIG.cable.gnd, CONFIG.cable.v5], ejeX, 0.14);
  // Relé → proto 2: S (verde), + y − (fuente externa)
  mazo(g, [V(CONFIG.rele.x, -1.6, CONFIG.rele.z - 1.7), V(40.5, -2.4, 9.8), V(30.0, -2.6, 9.0), V(21.5, -2.5, 8.6), V(colX(60), yCaraProto - 0.15, PR.z0 + 2.6)],
    [0x2e9c55, CONFIG.cable.v5, CONFIG.cable.gnd], ejeZ, 0.15);
  // ESP32: cable USB-C al power bank (sale por la izquierda)
  g.add(tubo([V(colX(8) - 1.8, yCaraProto - 1.2, PR.z0 + 2.75), V(0.3, -3.2, 8.0), V(-2.5, -5.5, 9.5), V(-5.5, yMesa + 0.25, 10.5), V(-10, yMesa + 0.25, 11.5)], 0.18, 0x2b2f33, 'cable_usbc'));
  // Fuente externa de 5 V: rojo y negro salen por atrás con puntas dupont
  mazo(g, [V(colX(63), yCaraProto - 0.15, PR.z0 + 1.0), V(20.5, -2.4, 3.0), V(21.5, -2.0, 0.2), V(22.0, -3.2, -0.6), V(22.5, yMesa + 0.6, -1.4)],
    [CONFIG.cable.v5, CONFIG.cable.gnd], ejeX, 0.18);
  // Puentes en las protoboards (colores del diagrama)
  [[13, 0xcc3b2b, 34], [14, 0x2e9c55, 36], [15, 0x2f5fb0, 37], [12, 0x8a4fc4, 51], [10, 0xe08a1e, 58],
   [19, 0x7a4a2a, 22], [18, 0x1f8f8a, 28], [16, 0x2f5fb0, 49], [17, 0x2aa7c9, 57], [8, 0xe0559a, 51]].forEach(([c0, col, c1], i) => {
    const za = PR.z0 + 1.0, zb = (i < 7 ? PR.z0 + 5.5 + 4.2 : PR.z0 + 3.6);
    g.add(tubo([V(colX(c0), yCaraProto, za), V(colX(c0), yCaraProto - 0.7 - i * 0.06, za + 0.6),
      V((colX(c0) + colX(c1)) / 2, yCaraProto - 0.9 - i * 0.08, (za + zb) / 2), V(colX(c1), yCaraProto - 0.6, zb - 0.4), V(colX(c1), yCaraProto, zb)], 0.05, col, 'puente_proto'));
  });
})();

/* ============================================================================
   ===== AGUA =====
   Río (lámina con oleaje y volumen), descarga por la compuerta abierta que
   cae directo al tóper, y nivel del tóper. El volumen se conserva: lo que
   sube en el río baja en el tóper.
   ========================================================================== */
const geoAguaRio = new THREE.PlaneGeometry(1, 1, 60, 3);
const mallaAguaRio = new THREE.Mesh(geoAguaRio, MAT.agua);
mallaAguaRio.name = 'agua_rio'; mallaAguaRio.renderOrder = 2;
grupoAgua.add(mallaAguaRio);
(function normalesArriba() {
  const n = geoAguaRio.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
})();
// Volumen de agua (para que se vea a través del plástico)
const aguaVolumen = caja(xIntRio1 - xIntRio0 - 0.05, 1, anchoIntRio - 0.04, MAT.agua, X((xIntRio0 + xIntRio1) / 2), 0, zcRio, 'agua_rio_volumen');
aguaVolumen.castShadow = false; aguaVolumen.renderOrder = 1;
grupoAgua.add(aguaVolumen);

const laminaSalida = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 12), MAT.lamina);
laminaSalida.name = 'lamina_descarga'; laminaSalida.visible = false; laminaSalida.frustumCulled = false; laminaSalida.renderOrder = 3;
grupoAgua.add(laminaSalida);
// Coloca una lámina como parábola de caída libre entre dos puntos (plano XY)
function laminaParabolica(malla, x0, y0, x1, y1, semi0, semi1, zc) {
  const pos = malla.geometry.attributes.position, filas = pos.count / 2 - 1;
  for (let j = 0; j <= filas; j++) {
    const s = j / filas, x = mezclar(x0, x1, s), y = y0 + (y1 - y0) * s * s, sa = mezclar(semi0, semi1, s);
    pos.setXYZ(j * 2, x, y, zc - sa); pos.setXYZ(j * 2 + 1, x, y, zc + sa);
  }
  pos.needsUpdate = true;
  malla.geometry.computeVertexNormals(); malla.geometry.computeBoundingSphere();
}
// El tóper es cónico: se usa el promedio de la boca y el fondo
const areaToper = (TP.x1 - TP.x0 - 2 * TP.pared - TP.angosto) * (TP.z1 - TP.z0 - 2 * TP.pared - TP.angosto);
const yPisoToper = TP.fondo + TP.pared;
const altoToper = yBajo - yPisoToper;
const aguaToper = bloque(TP.x0 + TP.angosto + 0.15, TP.x1 - TP.angosto - 0.15, 0, 1, TP.z0 + TP.angosto + 0.15, TP.z1 - TP.angosto - 0.15, MAT.agua, 'agua_toper');
aguaToper.castShadow = false;
grupoAgua.add(aguaToper);

// Apertura de la compuerta, 0 cerrada / 1 abierta (90°): la fija el bucle
let aperturaCompuerta = 0;
const areaRio = (xIntRio1 - xIntRio0) * anchoIntRio;
// Caudal relativo que sale del río, en "cm de carga" (sólo para dibujar).
// Cerrada no sale nada: la hoja llega a 10.1 cm y la columna máxima es de 5 cm.
function caudales(nivelCm) {
  const yA = yAguaCanal(nivelCm), col = yA - K.piso;
  const q = aperturaCompuerta * Math.max(0, yA - K.labio);     // sale sobre el labio, bajo la hoja levantada
  return { yA: yA, col: col, q: q };
}
// Cota del agua en el tóper: volumen total − volumen en el río
function yAguaToper(col) {
  const h = limitar((TP.litros * 1000 - areaRio * col) / areaToper, 0.4, altoToper - 0.3);
  return yPisoToper + h;
}
function actualizarAgua(nivelCm, t) {
  const Q = caudales(nivelCm), ap = aperturaCompuerta;
  // Río: plano a la cota medida; junto a la compuerta abierta se abate hacia el labio
  const yFin = mezclar(Q.yA, K.labio + 0.15, 0.75 * ap);
  const pos = geoAguaRio.attributes.position, nx = 60, nz = 3;
  for (let ix = 0; ix <= nx; ix++) {
    const xb = mezclar(xIntRio0 + 0.02, xIntRio1, ix / nx);
    const yCol = mezclar(Q.yA, yFin, suavizar(xIntRio1 - 6, xIntRio1, xb));
    for (let iz = 0; iz <= nz; iz++) {
      const zb = (K.z0 + K.pared) + (iz / nz) * anchoIntRio;
      const onda = 0.03 * Math.sin(xb * 0.9 - t * 2.4) + 0.02 * Math.sin(zb * 1.7 - t * 1.8);
      pos.setXYZ(iz * (nx + 1) + ix, X(xb), Math.max(K.piso + 0.02, yCol + onda), Z(zb));
    }
  }
  pos.needsUpdate = true; geoAguaRio.computeBoundingSphere();
  const hv = Math.max(0.02, Q.col - 0.02);
  aguaVolumen.scale.y = hv; aguaVolumen.position.y = K.piso + hv / 2;
  mallaAguaRio.visible = aguaVolumen.visible = Q.col > 0.03;

  // Descarga: cae de la boca del contenedor directo al tóper
  const yT = yAguaToper(Q.col);
  if (Q.q > 0.02) {
    const alcance = 0.6 + 1.0 * Math.sqrt(Q.q);
    laminaParabolica(laminaSalida, X(K.x1), K.labio + 0.1, X(K.x1 + alcance), yT + 0.05, anchoIntRio / 2 - 0.1, anchoIntRio / 2 - 0.6, zcRio);
    laminaSalida.visible = true;
  } else laminaSalida.visible = false;

  // Nivel del tóper
  const h = yT - yPisoToper;
  aguaToper.scale.y = h; aguaToper.position.y = yPisoToper + h / 2;
  return Q;
}
actualizarAgua(0, 0);

/* ===== FLECHAS DE FLUJO =====
   Conos blancos que avanzan por el recorrido del agua: bomba → manguera →
   nacimiento → río → compuerta → tóper. Sólo se ven donde de verdad hay
   corriente en ese momento. */
const geoFlecha = new THREE.ConeGeometry(0.3, 0.9, 8);
geoFlecha.rotateZ(-Math.PI / 2);                      // la punta mira a +X
const _ejeX = new THREE.Vector3(1, 0, 0), _pF = new THREE.Vector3(), _tF = new THREE.Vector3();
function crearCorriente(n, nombre) {
  const c = { flechas: [] };
  for (let i = 0; i < n; i++) {
    const f = new THREE.Mesh(geoFlecha, MAT.flecha);
    f.name = nombre; f.visible = false; f.renderOrder = 4;
    grupoFlujo.add(f); c.flechas.push(f);
  }
  return c;
}
function moverCorriente(c, curva, t, vel, activa) {
  const n = c.flechas.length;
  for (let i = 0; i < n; i++) {
    const f = c.flechas[i];
    f.visible = activa;
    if (!activa) continue;
    const u = ((i / n) + t * vel) % 1;
    curva.getPointAt(u, _pF); curva.getTangentAt(u, _tF);
    f.position.copy(_pF);
    f.quaternion.setFromUnitVectors(_ejeX, _tF.normalize());
  }
}
const corrienteManguera = crearCorriente(18, 'flecha_manguera');
const corrienteRio = crearCorriente(7, 'flecha_rio');
function moverCorrienteRio(t, yAgua, activa) {
  const n = corrienteRio.flechas.length, xa = K.x0 + 3.0, xb = K.x1 - 1.2;
  for (let i = 0; i < n; i++) {
    const f = corrienteRio.flechas[i];
    f.visible = activa;
    if (!activa) continue;
    const u = ((i / n) + t * 0.035) % 1;
    f.position.set(X(mezclar(xa, xb, u)), yAgua + 0.32, zcRio + 1.5);
    f.quaternion.identity();
  }
}
const corrienteSalida = crearCorriente(6, 'flecha_salida');
const zbRio = (K.z0 + K.z1) / 2;
const curvaDescarga = new THREE.CatmullRomCurve3([
  V(K.x1 - 2.2, 1.6, zbRio), V(K.x1 + 0.2, 1.3, zbRio), V(K.x1 + 1.4, -0.8, zbRio), V(K.x1 + 1.9, -3.6, zbRio)
]);

/* ============================================================================
   ===== ETIQUETAS DE COMPONENTES =====
   Cada etiqueta es un <div> posicionado proyectando un punto de anclaje 3D
   y unido al componente por una línea guía. Sólo se ven con el botón
   "Componentes" de la barra superior, igual que las cotas, las flechas de
   flujo y el cono del ultrasonido. Los pines son los del firmware.
   ========================================================================== */
const contEtiquetas = document.getElementById('etiquetas');

// Marcadores invisibles para etiquetar piezas que no son un objeto suelto
function marca(x, y, z, grupo) { const o = new THREE.Object3D(); o.position.set(x, y, z); grupo.add(o); return o; }
const marcaRio        = marca(X(K.x0 + 5), K.alto, Z(K.z0), grupoCanal);
const marcaCompuerta  = marca(X(CP.x + 0.2), CP.yEje - 4.5, Z(CP.z0 + 1), grupoPuente);
const marcaNacimiento = marca(X(nac.x), yTope + 1.2, Z(nac.z), grupoBahia);
const marcaToper      = marca(X(TP.x1), -3.5, Z(TP.z1), grupoBahia);

/* ===== COTAS GENERALES =====
   Largo al frente y ancho a la derecha, sobre la mesa; alto en la esquina
   trasera izquierda, de la mesa a la cara de arriba del bloque. */
const altoTotal = CONFIG.patas.alto + B.espesor + yTope;
(function construirCotas() {
  const pts = [], seg = (a, b) => pts.push(a, b);
  const P3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const tic = (p, ux, uz, uy) => seg(P3(p.x - ux, p.y - uy, p.z - uz), P3(p.x + ux, p.y + uy, p.z + uz));
  const xa = -B.largo / 2, xb = B.largo / 2, za = -B.ancho / 2, zb = B.ancho / 2, sep = 3.2, y0 = yMesa + 0.04;
  // Largo: línea al frente de la tabla
  const zL = zb + sep;
  seg(P3(xa, y0, zb + 0.4), P3(xa, y0, zL + 0.7)); seg(P3(xb, y0, zb + 0.4), P3(xb, y0, zL + 0.7));
  seg(P3(xa, y0, zL), P3(xb, y0, zL)); tic(P3(xa, y0, zL), 0.45, 0.45, 0); tic(P3(xb, y0, zL), 0.45, 0.45, 0);
  // Ancho: línea a la derecha
  const xL = xb + sep;
  seg(P3(xb + 0.4, y0, za), P3(xL + 0.7, y0, za)); seg(P3(xb + 0.4, y0, zb), P3(xL + 0.7, y0, zb));
  seg(P3(xL, y0, za), P3(xL, y0, zb)); tic(P3(xL, y0, za), 0.45, 0.45, 0); tic(P3(xL, y0, zb), 0.45, 0.45, 0);
  // Alto: vertical en la esquina trasera izquierda (el bloque sobresale 1.2 cm)
  const xBl = X(xIzq), xH = xBl - sep;
  seg(P3(xBl - 0.4, yTope, za), P3(xH - 0.7, yTope, za)); seg(P3(xa - 0.4, y0, za), P3(xH - 0.7, y0, za));
  seg(P3(xH, y0, za), P3(xH, yTope, za)); tic(P3(xH, yTope, za), 0.45, 0, 0.45); tic(P3(xH, y0, za), 0.45, 0, 0.45);
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), MAT.guia);
  l.name = 'cotas'; grupoCotas.add(l);
})();
const marcaCotaLargo = marca(0, yMesa, B.ancho / 2 + 3.2, grupoCotas);
const marcaCotaAncho = marca(B.largo / 2 + 3.2, yMesa, 0, grupoCotas);
const marcaCotaAlto  = marca(X(xIzq) - 3.2, (yMesa + yTope) / 2 + 1, -B.ancho / 2, grupoCotas);

const ETIQUETAS = [
  { obj: hcsr04,          capa: 'sensores',   modelo: 'HC-SR04',            pines: 'TRIG 33 / ECHO 32 · ' + fmt(CONFIG.sensor.distVacio) + ' cm al fondo', desfase: new THREE.Vector3(-4.0, 6.0, -6.0), nuevo: true },
  { obj: placaLluvia,     capa: 'sensores',   modelo: 'Placa de lluvia',    pines: 'LM393 → AO 34 (ADC1)',      desfase: new THREE.Vector3(-3.0, 4.0, -4.0) },
  { obj: hw080,           capa: 'sensores',   modelo: 'HW-080 (YL-69)',     pines: 'LM393 → AO 35 (ADC1)',      desfase: new THREE.Vector3(-1.0, 5.0, 4.5) },
  { obj: farol,           capa: 'actuadores', modelo: 'Farol · LED RGB',    pines: 'R 27 · G 26 · B 25',        desfase: new THREE.Vector3(-1.5, 13.0, 3.5), nuevo: true },
  { obj: servo,           capa: 'actuadores', modelo: 'Servo MG995',        pines: 'GPIO13 · fuente 5 V ext.',  desfase: new THREE.Vector3(6.0, 3.0, 5.0), nuevo: true },
  { obj: marcaCompuerta,  capa: 'puente',     modelo: 'Compuerta abatible', pines: '0° cerrada / 90° abierta',  desfase: new THREE.Vector3(6.0, 6.0, -6.0) },
  { obj: marcaRio,        capa: 'canal',      modelo: 'Río',                pines: 'contenedor ' + fmt(K.x1 - K.x0) + ' × ' + fmt(K.z1 - K.z0) + ' cm', desfase: new THREE.Vector3(-2.0, 7.0, -6.0), nuevo: true },
  { obj: marcaNacimiento, capa: 'bahia',      modelo: 'Nacimiento',         pines: 'manguera desde el tóper',   desfase: new THREE.Vector3(-3.0, 6.0, 3.0) },
  { obj: marcaToper,      capa: 'bahia',      modelo: 'Tóper ~1.2 L',       pines: fmt(TP.x1 - TP.x0) + ' × ' + fmt(TP.z1 - TP.z0) + ' × ' + fmt(yBajo - TP.fondo) + ' cm', desfase: new THREE.Vector3(6.0, -1.0, 5.0), nuevo: true },
  { obj: bomba,           capa: 'bahia',      modelo: 'Bomba 5 V',          pines: 'recircula el agua',         desfase: new THREE.Vector3(6.0, 2.5, -6.0) },
  { obj: moduloRele,      capa: 'bahia',      modelo: 'Relé 1 canal',       pines: 'bajo la tabla · diagrama S → D23', desfase: new THREE.Vector3(5.0, -3.0, 4.0) },
  { obj: esp32,           capa: 'bahia',      modelo: 'ESP32 DevKit V1',    pines: 'proto 2 · USB-C',           desfase: new THREE.Vector3(-5.0, -4.0, -3.0) },
  { obj: buzzer,          capa: 'bahia',      modelo: 'Buzzer pasivo',      pines: 'GPIO14 · proto 1',          desfase: new THREE.Vector3(2.0, -4.5, 4.0) },
  { obj: marcaCotaLargo,  capa: 'cotas', cota: true, modelo: fmt(B.largo) + ' cm',  pines: 'largo',          desfase: new THREE.Vector3(0, 0, 0) },
  { obj: marcaCotaAncho,  capa: 'cotas', cota: true, modelo: fmt(B.ancho) + ' cm',  pines: 'ancho',          desfase: new THREE.Vector3(0, 0, 0) },
  { obj: marcaCotaAlto,   capa: 'cotas', cota: true, modelo: fmt(altoTotal) + ' cm', pines: 'alto al bloque', desfase: new THREE.Vector3(-0.6, 0, 0) }
];

ETIQUETAS.forEach(e => {
  const d = document.createElement('div');
  d.className = 'etq' + (e.nuevo ? ' nuevo' : '') + (e.cota ? ' cota' : '');
  d.innerHTML = '<b>' + e.modelo + '</b> · <span>' + e.pines + '</span>';
  contEtiquetas.appendChild(d);
  e.div = d;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  e.linea = new THREE.Line(geo, MAT.guia);
  e.linea.name = 'guia_etiqueta';
  grupoGuias.add(e.linea);
});

const _vAnc = new THREE.Vector3(), _vObj = new THREE.Vector3(), _vPr = new THREE.Vector3();
let hayEtiquetas = true;                 // false cuando ya quedaron todas ocultas
function actualizarEtiquetas() {
  if (!estado.componentes && !hayEtiquetas) return;
  hayEtiquetas = estado.componentes;
  const w = anchoVista, h = altoVista;
  const colocadas = [];

  ETIQUETAS.forEach(e => {
    // Las cotas sólo se rotulan en las vistas de conjunto (de lejos)
    const lejos = !e.cota || camara.position.distanceTo(controles.target) > 55;
    const visible = estado.componentes && CAPAS[e.capa].visible && lejos;
    e.linea.visible = visible && !e.cota;
    if (!visible) { e.div.style.display = 'none'; return; }

    e.obj.getWorldPosition(_vObj);
    _vAnc.copy(_vObj).add(e.desfase);

    const p = e.linea.geometry.attributes.position;
    p.setXYZ(0, _vObj.x, _vObj.y, _vObj.z);
    p.setXYZ(1, _vAnc.x, _vAnc.y, _vAnc.z);
    p.needsUpdate = true;
    e.linea.geometry.computeBoundingSphere();

    _vPr.copy(_vAnc).project(camara);
    if (_vPr.z > 1) { e.div.style.display = 'none'; return; }
    e.div.style.display = 'block';
    colocadas.push({
      e: e, x: (_vPr.x * 0.5 + 0.5) * w, y: (-_vPr.y * 0.5 + 0.5) * h,
      w: e.div.offsetWidth || 120, h: e.div.offsetHeight || 16
    });
  });

  // Separación en pantalla: se empuja hacia abajo lo que se pise
  colocadas.sort((a, b) => a.y - b.y);
  for (let i = 0; i < colocadas.length; i++) {
    const a = colocadas[i];
    for (let j = 0; j < i; j++) {
      const b = colocadas[j];
      const dx = Math.abs(a.x - b.x), dy = Math.abs((a.y - a.h / 2) - (b.y - b.h / 2));
      if (dx < (a.w + b.w) / 2 + 4 && dy < (a.h + b.h) / 2 + 3) {
        a.y = b.y + (a.h + b.h) / 2 + 3 - (b.h - a.h) / 2 + 1;
        j = -1;
      }
    }
    a.e.div.style.left = a.x.toFixed(1) + 'px';
    a.e.div.style.top = a.y.toFixed(1) + 'px';
  }
}

/* ============================================================================
   ===== ESTADO DE LA ESCENA =====
   Todo en variables JS. Lo cambia app.js a través de window.Escena.
   ========================================================================== */
const estado = {
  nivel: 0,                 // cm reales de río (0–400), ya interpolado
  lluvia: 0,                // %
  apertura: 0,              // compuerta, 0 cerrada / 1 abierta (90°)
  buzzer: 'apagado',        // 'apagado' | 'intermitente' | 'sonando'
  bombaEncendida: true,     // el firmware no gobierna la bomba: siempre recircula
  componentes: false,       // etiquetas, cotas, flechas de flujo y cono del sensor
  vistaPropia: false        // true cuando el usuario ya movió la cámara
};
const reloj = new THREE.Clock();
let animNivel = null, animCompuerta = null, animCamara = null;
const suaveSalida = k => 1 - Math.pow(1 - k, 3);

function fijarNivel(pct) {
  const cm = limitar(Number(pct) || 0, 0, 100) / 100 * CONFIG.sim.nivelMax;
  if (mqQuieto.matches) { animNivel = null; estado.nivel = cm; return; }
  if (Math.abs(cm - (animNivel ? animNivel.n1 : estado.nivel)) < 0.01) return;
  animNivel = { t0: reloj.getElapsedTime(), n0: estado.nivel, n1: cm };
}
function fijarCompuerta(abierta) {
  const a = abierta ? 1 : 0;
  if (mqQuieto.matches) { animCompuerta = null; estado.apertura = a; return; }
  if (a === (animCompuerta ? animCompuerta.a1 : estado.apertura)) return;
  animCompuerta = { t0: reloj.getElapsedTime(), a0: estado.apertura, a1: a };
}
function fijarBuzzer(modo) {
  estado.buzzer = (modo === 'sonando' || modo === 'intermitente') ? modo : 'apagado';
}
// LED RGB del farol: el color que publica el nodo ('verde' | 'amarillo' | 'rojo')
const COLOR_LED = { verde: CONFIG.colores.ledBajo, amarillo: CONFIG.colores.haloMedio, rojo: CONFIG.colores.haloAlto };
function fijarLed(color) {
  const hex = COLOR_LED[String(color).toLowerCase()];
  ledFarol.material.color.setHex(hex === undefined ? CONFIG.colores.ledApagado : hex);
  if (hex !== undefined) luzFarol.color.setHex(hex);
  luzFarol.intensity = hex === undefined ? 0 : 0.7;
  if (hex !== undefined) brilloFarol.material.color.setHex(hex);
  brilloFarol.material.opacity = hex === undefined ? 0 : 0.55;
}
function fijarLluvia(pct) { estado.lluvia = limitar(Number(pct) || 0, 0, 100); }
function mostrarComponentes(ver) {
  estado.componentes = !!ver;
  grupoFlujo.visible = grupoGuias.visible = grupoCotas.visible = conoHC.visible = estado.componentes;
}
mostrarComponentes(false);

/* ============================================================================
   ===== LLUVIA =====
   Unas cuantas rayas que caen sobre la maqueta; cuántas, lo dice el % de lluvia.
   ========================================================================== */
const LL = CONFIG.lluvia;
const gotas = [];
for (let i = 0; i < LL.gotas; i++)
  gotas.push({ x: entre(-B.largo / 2, B.largo / 2), y: entre(0, LL.alto), z: entre(-B.ancho / 2, B.ancho / 2), v: entre(20, 30) });
const posLluvia = new Float32Array(LL.gotas * 6);
const geoLluvia = new THREE.BufferGeometry();
geoLluvia.setAttribute('position', new THREE.BufferAttribute(posLluvia, 3));
geoLluvia.setDrawRange(0, 0);
const lluvia = new THREE.LineSegments(geoLluvia,
  new THREE.LineBasicMaterial({ color: CONFIG.colores.hueso, transparent: true, opacity: 0.42, depthWrite: false }));
lluvia.name = 'lluvia'; lluvia.frustumCulled = false; lluvia.visible = false;
escena.add(lluvia);
let gotasVisibles = 0;
function actualizarLluvia(dt, quieto) {
  const meta = quieto ? 0 : LL.gotas * estado.lluvia / 100;
  gotasVisibles += (meta - gotasVisibles) * Math.min(1, dt * 2);
  const n = Math.round(gotasVisibles);
  lluvia.visible = n > 0;
  if (!n) return;
  for (let i = 0; i < n; i++) {
    const g = gotas[i], j = i * 6;
    g.y -= g.v * dt;
    if (g.y < 0) g.y += LL.alto;
    posLluvia[j] = g.x;     posLluvia[j + 1] = g.y;            posLluvia[j + 2] = g.z;
    posLluvia[j + 3] = g.x; posLluvia[j + 4] = g.y + LL.largo; posLluvia[j + 5] = g.z;
  }
  geoLluvia.attributes.position.needsUpdate = true;
  geoLluvia.setDrawRange(0, n * 2);
}

/* ============================================================================
   ===== ENCUADRE =====
   En escritorio el lienzo ocupa toda la ventana y las tarjetas flotan encima,
   así que la maqueta se centra en la "zona libre" (el hueco entre columnas y
   sobre el historial) desplazando el centro óptico de la cámara, y se aleja lo
   justo para caber ahí. En tablet y móvil la zona libre es todo el lienzo.
   ========================================================================== */
const dirInicio = new THREE.Vector3().fromArray(CONFIG.vista.dir).normalize();
const objetivoInicio = new THREE.Vector3().fromArray(CONFIG.vista.objetivo);
let anchoVista = 1, altoVista = 1;
const zona = { w: 1, h: 1 };                    // tamaño de la zona libre, en px
const desfase = { x: 0, y: 0, ox: 0, oy: 0 };   // centro de la zona respecto al del lienzo: actual y objetivo
let primeraMedida = true;

function posicionInicio() {
  const VI = CONFIG.vista, tan = Math.tan(THREE.MathUtils.degToRad(CONFIG.camara.fov / 2));
  const dAncho = (VI.ancho / 2) * altoVista / (tan * zona.w * VI.margen);
  const dAlto = (VI.alto / 2) * altoVista / (tan * zona.h * VI.margen);
  const d = limitar(Math.max(dAncho, dAlto), CONFIG.camara.distMin, CONFIG.camara.distMax);
  return objetivoInicio.clone().addScaledVector(dirInicio, d);
}
function irAInicio(animar) {
  estado.vistaPropia = false;
  const p1 = posicionInicio();
  if (!animar || mqQuieto.matches) {
    animCamara = null;
    camara.position.copy(p1);
    controles.target.copy(objetivoInicio);
    if (controles.sincronizar) controles.sincronizar();
    return;
  }
  animCamara = {
    t0: reloj.getElapsedTime(),
    p0: camara.position.clone(), p1: p1,
    o0: controles.target.clone(), o1: objetivoInicio.clone()
  };
}
function aplicarDesfase() {
  camara.setViewOffset(anchoVista, altoVista, -desfase.x, -desfase.y, anchoVista, altoVista);
}
function ajustarTamano() {
  const c = contenedor.getBoundingClientRect();
  if (c.width < 2 || c.height < 2) return;
  anchoVista = Math.round(c.width); altoVista = Math.round(c.height);
  render.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  render.setSize(anchoVista, altoVista, false);
  camara.aspect = anchoVista / altoVista;

  // Zona libre: el hueco entre tarjetas; si no existe, el lienzo sin la barra superior
  const r = { izq: c.left, arr: c.top, der: c.right, aba: c.bottom };
  if (zonaLibre && zonaLibre.offsetParent !== null) {
    const z = zonaLibre.getBoundingClientRect();
    r.izq = Math.max(r.izq, z.left); r.der = Math.min(r.der, z.right);
    r.arr = Math.max(r.arr, z.top);  r.aba = Math.min(r.aba, z.bottom);
  } else if (barra) {
    const b = barra.getBoundingClientRect();
    if (b.bottom > c.top && b.top < c.bottom) r.arr = b.bottom + 12;
  }
  zona.w = Math.max(60, r.der - r.izq);
  zona.h = Math.max(60, r.aba - r.arr);
  desfase.ox = (r.izq + r.der) / 2 - (c.left + c.right) / 2;
  desfase.oy = (r.arr + r.aba) / 2 - (c.top + c.bottom) / 2;
  if (primeraMedida || mqQuieto.matches) { desfase.x = desfase.ox; desfase.y = desfase.oy; }
  aplicarDesfase();

  if (!estado.vistaPropia) irAInicio(!primeraMedida);
  primeraMedida = false;
}
if (controles.addEventListener)
  controles.addEventListener('start', () => { estado.vistaPropia = true; animCamara = null; });
if (window.ResizeObserver) {
  const observador = new ResizeObserver(ajustarTamano);
  observador.observe(contenedor);
  if (zonaLibre) observador.observe(zonaLibre);
}
window.addEventListener('resize', ajustarTamano);
ajustarTamano();

/* ============================================================================
   ===== BUCLE PRINCIPAL =====
   Un único requestAnimationFrame. Las animaciones (nivel, compuerta, cámara)
   se miden con el reloj, no acumulando dt.
   ========================================================================== */
function bucle() {
  requestAnimationFrame(bucle);
  const dt = Math.min(reloj.getDelta(), 0.05);
  const t = reloj.getElapsedTime();
  const quieto = mqQuieto.matches;

  // --- Nivel del río: 600 ms hacia la última lectura ---
  if (animNivel) {
    const k = limitar((t - animNivel.t0) * 1000 / CONFIG.anim.msNivel, 0, 1);
    estado.nivel = mezclar(animNivel.n0, animNivel.n1, suaveSalida(k));
    if (k >= 1) animNivel = null;
  }

  // --- Compuerta abatible: el servo la gira de 0° a 90° en 500 ms ---
  if (animCompuerta) {
    const k = limitar((t - animCompuerta.t0) * 1000 / CONFIG.anim.msCompuerta, 0, 1);
    estado.apertura = mezclar(animCompuerta.a0, animCompuerta.a1, suaveInOut(k));
    if (k >= 1) animCompuerta = null;
  }
  aperturaCompuerta = estado.apertura;
  pivoteCompuerta.rotation.z = estado.apertura * Math.PI / 2;

  // --- Agua y chorro del nacimiento ---
  const Q = actualizarAgua(estado.nivel, quieto ? 0 : t);
  const hayRetorno = Q.q > 0.02;
  chorroNacimiento.visible = estado.bombaEncendida;
  if (estado.bombaEncendida) {
    const h = Math.max(0.1, boquilla.y - 0.15 - Q.yA);
    chorroNacimiento.scale.y = h;
    chorroNacimiento.position.y = Q.yA + h / 2;
    if (!quieto) helice.rotation.z += dt * 16;
  }

  // --- Cono del sensor y flechas de flujo: sólo con "Componentes" ---
  if (estado.componentes) {
    actualizarCono(Q.yA);
    moverCorriente(corrienteManguera, curvaManguera, t, 0.05, estado.bombaEncendida);
    moverCorrienteRio(t, Q.yA, (estado.bombaEncendida || hayRetorno) && Q.col > 0.2);
    moverCorriente(corrienteSalida, curvaDescarga, t, 0.4, hayRetorno);
  }

  // --- Buzzer: halo ámbar si es intermitente, terracota si suena ---
  const halo = buzzer.userData.halo;
  if (estado.buzzer === 'sonando') {
    const pulso = quieto ? 0.6 : 0.5 + 0.5 * Math.sin(t * 9);
    halo.material.color.setHex(CONFIG.colores.haloAlto);
    halo.material.opacity = 0.14 + 0.3 * pulso;
    halo.scale.setScalar(0.85 + 0.3 * pulso);
  } else if (estado.buzzer === 'intermitente') {
    const pulso = quieto ? 0.6 : Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 2);   // un destello por segundo
    halo.material.color.setHex(CONFIG.colores.haloMedio);
    halo.material.opacity = 0.08 + 0.32 * pulso;
    halo.scale.setScalar(0.85 + 0.2 * pulso);
  } else {
    halo.material.opacity = Math.max(0, halo.material.opacity - dt * 1.2);
  }

  actualizarLluvia(dt, quieto);

  // --- Cámara: vuelta al encuadre inicial y centro óptico hacia la zona libre ---
  if (animCamara) {
    const k = limitar((t - animCamara.t0) * 1000 / CONFIG.camara.msVista, 0, 1), e = suaveInOut(k);
    camara.position.lerpVectors(animCamara.p0, animCamara.p1, e);
    controles.target.lerpVectors(animCamara.o0, animCamara.o1, e);
    if (controles.sincronizar) controles.sincronizar();
    if (k >= 1) animCamara = null;
  }
  const dx = desfase.ox - desfase.x, dy = desfase.oy - desfase.y;
  if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
    const k = Math.min(1, dt * 7);
    desfase.x += dx * k; desfase.y += dy * k;
    aplicarDesfase();
  }

  controles.update();
  render.render(escena, camara);
  actualizarEtiquetas();
}
bucle();

// ===== API PARA app.js =====
window.Escena = {
  fijarNivel: fijarNivel,             // % 0–100
  fijarCompuerta: fijarCompuerta,     // true = abierta (90°)
  fijarBuzzer: fijarBuzzer,           // 'apagado' | 'intermitente' | 'sonando'
  fijarLed: fijarLed,                 // 'verde' | 'amarillo' | 'rojo' (campo "led" del nodo)
  fijarLluvia: fijarLluvia,           // % 0–100
  mostrarComponentes: mostrarComponentes,
  restablecerVista: function () { irAInicio(true); }
};
})();

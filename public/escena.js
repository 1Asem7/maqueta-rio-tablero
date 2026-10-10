(function () {
"use strict";
/* ============================================================================
   ESCENA 3D DE LA MAQUETA DIGITAL
   Este archivo sólo dibuja el modelo. No lee sensores ni calcula el riesgo:
   app.js recibe los datos del nodo por MQTT y mueve la escena con window.Escena
   (fijarNivel, fijarCompuerta, fijarBuzzer, fijarLluvia, mostrarComponentes,
   restablecerVista). La geometría es la de la maqueta v2.3, sin cambios.
   ========================================================================== */
if (!window.THREE) {
  document.getElementById('escena').classList.add('sin-webgl');
  return;
}

/* ============================================================================
   MAQUETA VIRTUAL v2.3 · SISTEMA IoT DE ALERTA TEMPRANA POR NIVEL DE RÍO (COLIMA)
   Nodo único ESP32-WROOM-32 DevKit V1 (30 pines) sobre protoboard de 830 puntos.

   FORMATO COMPACTO: 45 cm de largo × 25 cm de ancho × ≈ 20 cm de alto.
   Se conserva todo lo de la v2.1 (río incrustado, HC-SR04 colgado del puente,
   compuerta abatible que también es vertedero, canaleta y tóper colgado) y se
   reacomoda para que quepa en un escritorio y se pueda cargar a mano.

   PRESUPUESTO DE ALTURA (desde la mesa)
     patas 6.5 + MDF 0.9 + bloque de 3" 7.5 + sierra 2 × 2.5 = 19.9 cm
     El puente y la caseta llegan a ~20.3 cm. Los árboles se limitan a la cota
     de la sierra para que nada pase de ahí.

   QUÉ CAMBIÓ RESPECTO A LA v2.1
   1. Tabla de 45 × 25 cm (antes 60 × 30) y patas de 6.5 cm (antes 13).
   2. Sierra de 2 capas de 1" (antes 4) y terraza de 1 capa.
   3. Canal de 24.4 × 6 × 6 cm interior (antes 37 × 8 × 6). La profundidad no
      cambia, así que la calibración 1 cm de columna = 80 cm de río se conserva.
   4. HC-SR04 a 3.0 cm del borde (antes 5.2). Lee 9.0 cm con el río vacío y
      4.0 cm con la columna máxima de 5 cm (el HC-SR04 mide desde ~2 cm). Con un
      cono de ~30° la huella mide 1.6 cm en el borde y 4.8 cm en el fondo,
      dentro del canal de 6 cm.
   5. Tóper de 12 × 14 × 6.5 cm (~1.1 L) con 0.8 L de agua. Con la bomba
      encendida el río nunca pasa de 250 cm (en ALTO el relé la apaga), así que
      en el tóper quedan al menos ~2.3 cm de agua para la bomba; con el río
      vacío el agua queda ~0.9 cm abajo del borde.
   6. La manguera va por una ranura en la cara inferior del unicel: el MDF ya no
      lleva perforaciones y debajo de la tabla sólo cuelga el tóper.

   RESTRICCIÓN ELÉCTRICA (sin cambios): los sensores analógicos van a GPIO34 y
   GPIO35, del ADC1. El ADC2 queda inutilizable en cuanto se activa el WiFi.
   ========================================================================== */

// ===== CONFIG (todo lo ajustable vive aquí) =====
const CONFIG = {
  base:  { x: 45, z: 25, espesor: 0.9 },          // tabla MDF 9 mm, cara superior en y = 0
  patas: { alto: 6.5, lado: 3.0, x: 21.0, z: 11.0 },    // centros de las 4 patas (esquinas)

  terreno: {
    xMin: -22.5, xMax: 5.5,      // bloque de unicel del paisaje: 28 × 25 cm
    yCama: 7.5,                  // primer bloque (3") = cota de la llanura = borde del río
    paso: 2.5,                   // capas de 1" para la sierra y la terraza
    capasSierra: 2, zTerraza: 8.9
  },

  canal: {                       // caja de acrílico incrustada en la zanja
    x0: -18.5, x1: 5.9,          // asoma 4 mm del unicel: ahí cierra la compuerta
    zc: -3, anchoInt: 6, altoInt: 6, pared: 0.3,
    pisoY: 1.5                   // fondo interior: 1.2 cm de unicel + 3 mm de acrílico
  },

  compuerta: { x: 6.1, ancho: 6.4, cresta: 4.0, ejeSobreBorde: 0.8 },  // cresta a 4 cm del fondo
  canaleta:  { x0: 5.5, largo: 3.5, yInicio: 1.0, caida: 1.0, anchoInt: 7.6, altoPared: 2.5 },

  puente: { x: -10, z0: -9.4, z1: 3.4, ancho: 3.2, sensorSobreBorde: 3.0 },

  bahia: {
    reservorio: { x0: 7.0, x1: 19.0, z0: -11.2, z1: 2.8, prof: 6.5 },  // tóper 12 × 14 × 6.5 cm colgado bajo el MDF
    seco:       { x0: 5.7, x1: 22.3, z0: 3.7, z1: 12.4, tarima: 1.2 },
    litros: 0.8                                                       // agua total del circuito
  },

  sim: {
    nivelMax: 400,        // cm reales que representa el sistema
    columnaMax: 5.0       // cm de agua en el río equivalentes a nivelMax
  },

  camara: {
    fov: 38, cerca: 0.1, lejos: 900, msVista: 800,
    distMin: 34, distMax: 300,            // límites del zoom
    nieblaCerca: 170, nieblaLejos: 560
  },

  // Encuadre inicial: desde dónde se mira y cuánto mide el modelo visto así
  // (en cm, ya proyectado), para que quepa en la zona libre entre tarjetas.
  vista: { dir: [59, 46, 57], objetivo: [1.5, -2.0, -1.6], ancho: 50, alto: 46, margen: 0.9 },

  anim: { msNivel: 600, msCompuerta: 500 },

  lluvia: { gotas: 220, alto: 26, largo: 0.9 },   // gotas con lluvia al 100 %

  colores: {
    fondo: 0x1d2b24, hueso: 0xdad7cd,     // --bg-deep y --c-bone de la página
    haloMedio: 0xdda15e, haloAlto: 0xbc4749,
    mdf: 0xb08a5c, llanura: 0x94a173, unicel: 0xd8d2bf,
    acrilico: 0xa9cfe0, agua: 0x2380c0,
    blanco: 0xf1eee2, hormigon: 0xd2cec3, metal: 0x9aa0a6, negro: 0x2b3036,
    pcb: 0x1f6f8b, protoboard: 0xf0ede3, teja: 0xa2604a, pvc: 0xd9d6cd
  },

  cable: { v5: 0xcc3b2b, gnd: 0x24282c, dato: 0x2f6f9e, dato2: 0xd79a1e, dato3: 0x6d9c4a }
};

// ===== UMBRALES DE NIVEL =====
// Sólo pintan las marcas de la regleta de aforo. El riesgo lo calcula el
// firmware; la página lo lee del tópico de datos.
const UMBRALES = { nivelBajo: 150, nivelMedio: 250 };

// ===== UTILIDADES =====
const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
const mezclar = (a, b, t) => a + (b - a) * t;
function suavizar(a, b, x) { const t = limitar((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function suaveInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// PRNG determinista (LCG): la maqueta se ve idéntica en cada carga
let _semilla = 20261005;
function aleatorio() { _semilla = (_semilla * 1664525 + 1013904223) % 4294967296; return _semilla / 4294967296; }
function entre(a, b) { return a + (b - a) * aleatorio(); }

/* ===== TABLA DE CALIBRACIÓN =====
   El simulador trabaja en cm REALES de río; la maqueta los representa con la
   columna de agua del canal. El HC-SR04 mide la distancia desde su cara hasta
   el agua, así que: columna = distanciaVacio − distanciaLeida. */
const yCaraSensor = CONFIG.terreno.yCama + CONFIG.puente.sensorSobreBorde;   // 10.5
function columnaDesdeNivel(nivelCm) {
  return limitar(nivelCm / CONFIG.sim.nivelMax, 0, 1) * CONFIG.sim.columnaMax;
}
function yAguaCanal(nivelCm) { return CONFIG.canal.pisoY + columnaDesdeNivel(nivelCm); }
function distanciaSensor(nivelCm) { return yCaraSensor - yAguaCanal(nivelCm); }
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
sol.position.set(24, 36, 19);
sol.castShadow = true;
sol.shadow.mapSize.set(1024, 1024);
sol.shadow.camera.left = -30; sol.shadow.camera.right = 30;
sol.shadow.camera.top = 24; sol.shadow.camera.bottom = -24;
sol.shadow.camera.near = 1; sol.shadow.camera.far = 140;
sol.shadow.bias = -0.0016;
escena.add(sol, sol.target);

// ===== MATERIALES COMPARTIDOS =====
const C = CONFIG.colores;
const MAT = {
  mdf:       new THREE.MeshPhongMaterial({ color: C.mdf, shininess: 12 }),
  llanura:   new THREE.MeshPhongMaterial({ color: C.llanura, shininess: 3, flatShading: true }),
  unicel:    new THREE.MeshPhongMaterial({ color: C.unicel, shininess: 4 }),
  lecho:     new THREE.MeshPhongMaterial({ color: 0x8f8268, shininess: 4 }),
  sierra:    [],   // se rellena por capa, de verde a ocre según la cota
  acrilico:  new THREE.MeshPhongMaterial({ color: C.acrilico, shininess: 100, specular: 0xffffff, transparent: true, opacity: 0.34, side: THREE.DoubleSide }),
  aristaAcr: new THREE.LineBasicMaterial({ color: 0x4f8fb2, transparent: true, opacity: 0.75 }),
  agua:      new THREE.MeshPhongMaterial({ color: C.agua, shininess: 95, specular: 0xa8ddf5, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  lamina:    new THREE.MeshPhongMaterial({ color: 0x4aa3dc, shininess: 80, specular: 0xcfeeff, transparent: true, opacity: 0.68, side: THREE.DoubleSide, depthWrite: false }),
  pvc:       new THREE.MeshPhongMaterial({ color: C.pvc, shininess: 30 }),
  madera:    new THREE.MeshPhongMaterial({ color: 0xba9160, shininess: 10 }),
  pata:      new THREE.MeshPhongMaterial({ color: 0x9c7a52, shininess: 10 }),
  tarima:    new THREE.MeshPhongMaterial({ color: 0xd8d3c5, shininess: 14 }),
  blanco:    new THREE.MeshPhongMaterial({ color: C.blanco, shininess: 18 }),
  hormigon:  new THREE.MeshPhongMaterial({ color: C.hormigon, shininess: 6, flatShading: true }),
  metal:     new THREE.MeshPhongMaterial({ color: C.metal, shininess: 70, specular: 0x666666 }),
  metalOsc:  new THREE.MeshPhongMaterial({ color: 0x6d757c, shininess: 50 }),
  negro:     new THREE.MeshPhongMaterial({ color: C.negro, shininess: 25 }),
  pcb:       new THREE.MeshPhongMaterial({ color: C.pcb, shininess: 30 }),
  pcbVerde:  new THREE.MeshPhongMaterial({ color: 0x2f6b3c, shininess: 30 }),
  protoboard:new THREE.MeshPhongMaterial({ color: C.protoboard, shininess: 22 }),
  rojo:      new THREE.MeshPhongMaterial({ color: 0xcc3b2b, shininess: 30 }),
  naranja:   new THREE.MeshPhongMaterial({ color: 0xd79a1e, shininess: 30 }),
  tierra:    new THREE.MeshPhongMaterial({ color: 0x6b4f36, shininess: 2, flatShading: true }),
  tronco:    new THREE.MeshPhongMaterial({ color: 0x8a6a4a, shininess: 3, flatShading: true }),
  copaA:     new THREE.MeshPhongMaterial({ color: 0x5e7a4a, shininess: 3, flatShading: true }),
  copaB:     new THREE.MeshPhongMaterial({ color: 0x6f8c56, shininess: 3, flatShading: true }),
  roca:      new THREE.MeshPhongMaterial({ color: 0xa8a294, shininess: 5, flatShading: true }),
  arbusto:   new THREE.MeshPhongMaterial({ color: 0x6f8659, shininess: 3, flatShading: true }),
  muro:      new THREE.MeshPhongMaterial({ color: 0xece7dc, shininess: 8 }),
  teja:      new THREE.MeshPhongMaterial({ color: C.teja, shininess: 8, flatShading: true }),
  vidrio:    new THREE.MeshPhongMaterial({ color: 0xbcd6e2, shininess: 90, transparent: true, opacity: 0.55 }),
  mesa:      new THREE.ShadowMaterial({ opacity: 0.34 }),   // sólo la sombra: debajo se ve el fondo de la página
  flecha:    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
  halo:      new THREE.MeshBasicMaterial({ color: CONFIG.colores.haloAlto, transparent: true, opacity: 0, depthWrite: false, fog: false }),
  guia:      new THREE.LineBasicMaterial({ color: CONFIG.colores.hueso, transparent: true, opacity: 0.45 })   // guías y cotas
};
(function paletaSierra() {                          // capas: verde abajo, ocre arriba
  const a = new THREE.Color(0x8a9a6e), b = new THREE.Color(0xb9b492);
  for (let i = 0; i <= CONFIG.terreno.capasSierra; i++) {
    MAT.sierra.push(new THREE.MeshPhongMaterial({
      color: a.clone().lerp(b, i / CONFIG.terreno.capasSierra), shininess: 3, flatShading: true
    }));
  }
})();

// ===== GRUPOS (una capa por tipo de pieza) =====
const grupoTerreno      = new THREE.Group(); grupoTerreno.name = 'base_patas_y_relieve';
const grupoCanal        = new THREE.Group(); grupoCanal.name = 'canal_acrilico';
const grupoAgua         = new THREE.Group(); grupoAgua.name = 'agua';
const grupoFlujo        = new THREE.Group(); grupoFlujo.name = 'flechas_de_flujo';
const grupoAmbientacion = new THREE.Group(); grupoAmbientacion.name = 'ambientacion';
const grupoPuente       = new THREE.Group(); grupoPuente.name = 'puente_y_compuerta';
const grupoSensores     = new THREE.Group(); grupoSensores.name = 'sensores_y_cableado';
const grupoActuadores   = new THREE.Group(); grupoActuadores.name = 'actuadores';
const grupoBahia        = new THREE.Group(); grupoBahia.name = 'bahia_tecnica';
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
function cilindro(rt, rb, h, seg, mat, x, y, z, nombre) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (nombre) m.name = nombre;
  return m;
}
// Caja de unicel con un material por cara: [+X, −X, +Y, −Y, +Z, −Z]
function bloque(x0, x1, y0, y1, z0, z1, mats, nombre) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mats);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true; m.receiveShadow = true;
  m.name = nombre;
  return m;
}
// Aristas visibles para las piezas de acrílico (si no, el canal "desaparece")
function aristas(malla, grupo) {
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(malla.geometry), MAT.aristaAcr);
  l.position.copy(malla.position); l.rotation.copy(malla.rotation); l.name = 'arista';
  (grupo || malla.parent).add(l);
  return malla;
}

/* ============================================================================
   ===== BASE, PATAS Y RELIEVE =====
   Tabla de MDF con un recorte para el tóper (reservorio) y cuatro patas.
   Encima, UN bloque de unicel de 3" con la zanja del río; sobre él, 2 capas
   de 1" de la sierra (atrás) y 1 de la terraza (al frente).
   ========================================================================== */
const T = CONFIG.terreno, B = CONFIG.base, K = CONFIG.canal, RS = CONFIG.bahia.reservorio;

// Geometría de la zanja: el ancho y largo EXTERIORES del canal de acrílico
const zZanja0 = K.zc - K.anchoInt / 2 - K.pared;       // -6.3
const zZanja1 = K.zc + K.anchoInt / 2 + K.pared;       //  0.3
const xZanja0 = K.x0 - K.pared;                        // -18.8
const yFondoZanja = K.pisoY - K.pared;                 //  1.2  (unicel que queda bajo el canal)
const zParedTras = K.zc - K.anchoInt / 2 - K.pared / 2;
const zParedFrente = K.zc + K.anchoInt / 2 + K.pared / 2;
const yCoronaCanal = K.pisoY + K.altoInt;              //  7.5  = cota de la llanura

// Siluetas de las curvas de nivel (deterministas)
const FRENTES_SIERRA = [-7.6, -10.0];
function frenteSierra(i, x) {
  return FRENTES_SIERRA[i] + 0.6 * Math.sin(x * 0.19 + i * 1.7) + 0.34 * Math.sin(x * 0.47 - i * 2.3);
}
function frenteTerraza(x) {
  return T.zTerraza + 0.6 * Math.sin(x * 0.23 + 0.6) + 0.3 * Math.sin(x * 0.51);
}
function enZanja(x, z) { return x >= xZanja0 && x <= T.xMax && z > zZanja0 && z < zZanja1; }

// Cota de la superficie en un punto: para posar árboles, casas y postes
function cotaTerreno(x, z) {
  if (x > T.xMax || x < T.xMin || Math.abs(z) > B.z / 2) return 0;   // fuera del unicel: la tabla
  if (enZanja(x, z)) return T.yCama;                                 // sobre el río: el borde
  if (z > frenteTerraza(x)) return T.yCama + T.paso;
  let h = T.yCama;
  for (let i = 0; i < T.capasSierra; i++) if (z < frenteSierra(i, x)) h = T.yCama + (i + 1) * T.paso;
  return h;
}

// Losa entre un borde ondulado zFrente(x) y un borde recto en zRecto
function losaContorno(zFrente, zRecto, xMin, xMax, yInf, altura, mat, nombre) {
  const forma = new THREE.Shape();
  const pasos = 46;
  forma.moveTo(xMin, -zFrente(xMin));
  for (let i = 1; i <= pasos; i++) {
    const x = mezclar(xMin, xMax, i / pasos);
    forma.lineTo(x, -zFrente(x));
  }
  forma.lineTo(xMax, -zRecto);
  forma.lineTo(xMin, -zRecto);
  forma.closePath();
  const geo = new THREE.ExtrudeGeometry(forma, { depth: altura, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, yInf, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  m.name = nombre || 'curva_nivel';
  return m;
}

(function construirBase() {
  // --- Tabla MDF en 4 piezas alrededor del recorte del tóper ---
  const xa = -B.x / 2, xb = B.x / 2, za = -B.z / 2, zb = B.z / 2, y = -B.espesor / 2;
  grupoTerreno.add(caja(RS.x0 - xa, B.espesor, B.z, MAT.mdf, (xa + RS.x0) / 2, y, 0, 'tabla_mdf'));
  grupoTerreno.add(caja(xb - RS.x1, B.espesor, B.z, MAT.mdf, (RS.x1 + xb) / 2, y, 0, 'tabla_mdf'));
  grupoTerreno.add(caja(RS.x1 - RS.x0, B.espesor, RS.z0 - za, MAT.mdf, (RS.x0 + RS.x1) / 2, y, (za + RS.z0) / 2, 'tabla_mdf'));
  grupoTerreno.add(caja(RS.x1 - RS.x0, B.espesor, zb - RS.z1, MAT.mdf, (RS.x0 + RS.x1) / 2, y, (RS.z1 + zb) / 2, 'tabla_mdf'));

  // --- Patas: dejan el hueco para que el tóper cuelgue sin tocar la mesa ---
  const PT = CONFIG.patas;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    grupoTerreno.add(caja(PT.lado, PT.alto, PT.lado, MAT.pata,
      sx * PT.x, -B.espesor - PT.alto / 2, sz * PT.z, 'pata'));
  }
})();

// Mesa de trabajo: plano invisible que sólo recibe la sombra de la maqueta
const mesa = new THREE.Mesh(new THREE.PlaneGeometry(170, 120), MAT.mesa);
mesa.rotation.x = -Math.PI / 2;
mesa.position.y = -B.espesor - CONFIG.patas.alto;
mesa.receiveShadow = true;
mesa.name = 'mesa_trabajo';
escena.add(mesa);

(function construirRelieve() {
  const U = MAT.unicel, L = MAT.llanura, H = MAT.lecho;
  // --- Bloque 3" con la zanja tallada (4 piezas = 1 bloque con un canal) ---
  //     orden de caras: [+X, −X, +Y, −Y, +Z, −Z]
  grupoTerreno.add(bloque(xZanja0, T.xMax, 0, yFondoZanja, zZanja0, zZanja1, [U, U, H, U, U, U], 'unicel_fondo_zanja'));
  grupoTerreno.add(bloque(T.xMin, T.xMax, 0, T.yCama, -B.z / 2, zZanja0, [U, U, L, U, H, U], 'unicel_orilla_trasera'));
  grupoTerreno.add(bloque(T.xMin, T.xMax, 0, T.yCama, zZanja1, B.z / 2, [U, U, L, U, U, H], 'unicel_orilla_frontal'));
  grupoTerreno.add(bloque(T.xMin, xZanja0, 0, T.yCama, zZanja0, zZanja1, [H, U, L, U, U, U], 'unicel_cabecera'));

  // --- Sierra escalonada (capas de 1"), sólo detrás del río ---
  for (let i = 0; i < T.capasSierra; i++) {
    grupoTerreno.add(losaContorno(x => frenteSierra(i, x), -B.z / 2, T.xMin, T.xMax,
      T.yCama + i * T.paso, T.paso, MAT.sierra[i + 1], 'sierra_capa_' + (i + 1)));
  }
  // --- Terraza del frente (1 capa de 1"): ahí va la caseta con el buzzer ---
  grupoTerreno.add(losaContorno(frenteTerraza, B.z / 2, T.xMin, T.xMax,
    T.yCama, T.paso, MAT.sierra[1], 'terraza_frontal'));
})();

/* ============================================================================
   ===== CANAL DE ACRÍLICO INCRUSTADO =====
   Caja abierta: piso + 2 paredes + testero aguas arriba. Aguas abajo NO lleva
   pared: la cierra la compuerta. Entra completa en la zanja y su borde queda a
   la cota de la llanura, como un río real visto desde arriba.
   ========================================================================== */
const largoCanal = K.x1 - xZanja0, cxCanal = (xZanja0 + K.x1) / 2;
(function construirCanal() {
  const g = grupoCanal;
  const piso = caja(largoCanal, K.pared, K.anchoInt + 2 * K.pared, MAT.acrilico, cxCanal, K.pisoY - K.pared / 2, K.zc, 'canal_piso');
  const pT = caja(largoCanal, K.altoInt, K.pared, MAT.acrilico, cxCanal, K.pisoY + K.altoInt / 2, zParedTras, 'canal_pared_trasera');
  const pF = caja(largoCanal, K.altoInt, K.pared, MAT.acrilico, cxCanal, K.pisoY + K.altoInt / 2, zParedFrente, 'canal_pared_frontal');
  const tes = caja(K.pared, K.altoInt, K.anchoInt, MAT.acrilico, K.x0 - K.pared / 2, K.pisoY + K.altoInt / 2, K.zc, 'canal_testero');
  [piso, pT, pF, tes].forEach(m => { m.castShadow = false; g.add(m); aristas(m, g); });

  // Regleta de aforo (limnímetro) pegada por dentro a la pared trasera:
  // marcas cada 1 cm (≡ 80 cm reales) + umbrales de 150 y 250 cm en color.
  const xR = CONFIG.puente.x + 4.0, zR = K.zc - K.anchoInt / 2 + 0.06;
  g.add(caja(0.7, K.altoInt, 0.06, MAT.blanco, xR, K.pisoY + K.altoInt / 2, zR, 'regleta_aforo'));
  for (let i = 0; i <= 5; i++)
    g.add(caja(i % 5 === 0 ? 0.7 : 0.45, 0.07, 0.04, MAT.negro, xR, K.pisoY + i, zR + 0.05, 'regleta_marca'));
  g.add(caja(0.7, 0.12, 0.04, MAT.naranja, xR, K.pisoY + columnaDesdeNivel(UMBRALES.nivelBajo), zR + 0.06, 'regleta_150cm'));
  g.add(caja(0.7, 0.12, 0.04, MAT.rojo, xR, K.pisoY + columnaDesdeNivel(UMBRALES.nivelMedio), zR + 0.06, 'regleta_250cm'));
})();

/* ===== CANALETA DE RETORNO =====
   Rampa transparente con dos paredes que recibe TODO lo que sale del río
   (por encima de la cresta o por la compuerta abierta) y lo deja caer al tóper.
   Arranca 5 mm por debajo del piso del canal y baja 1 cm en 3.5 cm. */
const CA = CONFIG.canaleta;
const xFinCanaleta = CA.x0 + CA.largo;
function yPisoCanaleta(x) { return CA.yInicio - (limitar(x, CA.x0, xFinCanaleta) - CA.x0) * CA.caida / CA.largo; }

(function construirCanaleta() {
  const ang = Math.atan2(CA.caida, CA.largo), L = Math.hypot(CA.largo, CA.caida);
  const g = new THREE.Group(); g.name = 'canaleta_retorno';
  g.position.set(CA.x0 + CA.largo / 2, CA.yInicio - CA.caida / 2, K.zc);
  g.rotation.z = -ang;
  const piso = caja(L, 0.3, CA.anchoInt + 0.6, MAT.acrilico, 0, -0.15, 0, 'canaleta_piso');
  piso.castShadow = false; g.add(piso); aristas(piso, g);
  for (const s of [-1, 1]) {
    const p = caja(L, CA.altoPared, 0.3, MAT.acrilico, 0, CA.altoPared / 2 - 0.3, s * (CA.anchoInt / 2 + 0.15), 'canaleta_pared');
    p.castShadow = false; g.add(p); aristas(p, g);
  }
  grupoCanal.add(g);
  // Cuña que la apoya sobre la tabla antes de volar sobre el tóper
  grupoCanal.add(caja(1.3, 0.55, CA.anchoInt, MAT.madera, CA.x0 + 0.7, 0.275, K.zc, 'cuna_canaleta'));
})();

/* ============================================================================
   ===== AGUA =====
   Río (lámina con oleaje), lámina vertiente sobre la cresta o salida por la
   compuerta abierta, película en la canaleta, chorro al tóper y nivel del tóper.
   El volumen se conserva: lo que sube en el río baja en el tóper.
   ========================================================================== */
const geoAguaRio = new THREE.PlaneGeometry(1, 1, 70, 3);
const mallaAguaRio = new THREE.Mesh(geoAguaRio, MAT.agua);
mallaAguaRio.name = 'agua_rio';
grupoAgua.add(mallaAguaRio);
(function normalesArriba() {
  const n = geoAguaRio.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
})();

function crearLamina(segs, nombre) {
  const geo = new THREE.PlaneGeometry(1, 1, 1, segs);
  const m = new THREE.Mesh(geo, MAT.lamina);
  m.name = nombre; m.visible = false; m.frustumCulled = false; m.renderOrder = 2;
  grupoAgua.add(m);
  return m;
}
const laminaSalida = crearLamina(10, 'lamina_vertiente');
const aguaCanaleta = crearLamina(1, 'agua_canaleta');
const chorroToper  = crearLamina(10, 'chorro_al_toper');

// Coloca una lámina como parábola de caída libre entre dos puntos (plano XY)
function laminaParabolica(malla, x0, y0, x1, y1, semi0, semi1, curva) {
  const pos = malla.geometry.attributes.position;
  const filas = pos.count / 2 - 1;
  for (let j = 0; j <= filas; j++) {
    const s = j / filas;
    const x = mezclar(x0, x1, s);
    const y = curva ? y0 + (y1 - y0) * s * s : mezclar(y0, y1, s);
    const sa = mezclar(semi0, semi1, s);
    pos.setXYZ(j * 2, x, y, K.zc - sa);
    pos.setXYZ(j * 2 + 1, x, y, K.zc + sa);
  }
  pos.needsUpdate = true;
  malla.geometry.computeVertexNormals();
  malla.geometry.computeBoundingSphere();
}

const yCresta = K.pisoY + CONFIG.compuerta.cresta;            // 5.5
const areaToper = (RS.x1 - RS.x0 - 0.7) * (RS.z1 - RS.z0 - 0.7);
const aguaReservorio = caja(RS.x1 - RS.x0 - 0.7, 1, RS.z1 - RS.z0 - 0.7, MAT.agua,
  (RS.x0 + RS.x1) / 2, 0, (RS.z0 + RS.z1) / 2, 'agua_toper');
aguaReservorio.castShadow = false;
grupoAgua.add(aguaReservorio);

// Apertura de la compuerta, 0 cerrada / 1 abierta (90°): la fija el bucle
let aperturaCompuerta = 0;

// Caudal relativo que sale del río, en "cm de carga" (sólo para dibujar)
function caudales(nivelCm) {
  const yA = yAguaCanal(nivelCm);
  const col = yA - K.pisoY;
  const carga = Math.max(0, yA - yCresta);
  const qVert = (1 - aperturaCompuerta) * carga;     // rebasa la cresta
  const qAbre = aperturaCompuerta * col;             // sale por la compuerta abierta
  return { yA: yA, col: col, carga: carga, qVert: qVert, qAbre: qAbre, q: qVert + qAbre };
}
// Cota del agua en el tóper: volumen total − volumen en el río
function yAguaToper(col) {
  const vRio = (K.x1 - K.x0) * K.anchoInt * col;
  const h = limitar((CONFIG.bahia.litros * 1000 - vRio) / areaToper, 0.8, RS.prof - 1);
  return -RS.prof + 0.3 + h;
}

function actualizarAgua(nivelCm, t) {
  const Q = caudales(nivelCm);
  const ap = aperturaCompuerta;

  // --- Río: plano a la cota medida; junto a la compuerta abierta se abate ---
  const yFin = K.pisoY + Q.col * (1 - 0.5 * ap) - 0.25 * Math.min(Q.carga, 1) * (1 - ap);
  const pos = geoAguaRio.attributes.position;
  const nx = 70, nz = 3;
  for (let ix = 0; ix <= nx; ix++) {
    const x = mezclar(K.x0 + 0.02, K.x1 + 0.04, ix / nx);
    const yCol = mezclar(Q.yA, yFin, suavizar(K.x1 - 7, K.x1, x));
    for (let iz = 0; iz <= nz; iz++) {
      const z = K.zc + (iz / nz - 0.5) * (K.anchoInt - 0.04);
      const onda = 0.035 * Math.sin(x * 0.9 - t * 2.4) + 0.022 * Math.sin(z * 1.7 - t * 1.8);
      pos.setXYZ(iz * (nx + 1) + ix, x, yCol + onda, z);
    }
  }
  pos.needsUpdate = true;
  geoAguaRio.computeBoundingSphere();

  // --- Salida del río: sobre la cresta (cerrada) o por la boca (abierta) ---
  const hCan = 0.1 + 0.16 * Math.min(Q.q, 3);                  // espesor en la canaleta
  if (Q.q > 0.02) {
    let x0, y0, alcance;
    if (ap < 0.5) {                                            // lámina vertiente
      x0 = CONFIG.compuerta.x + 0.16; y0 = yCresta + 0.55 * Q.carga;
      alcance = 0.45 + 1.5 * Math.sqrt(Q.qVert);
    } else {                                                   // descarga de fondo
      x0 = K.x1; y0 = yFin;
      alcance = 0.35 + 0.9 * Math.sqrt(Q.qAbre);
    }
    const x1 = Math.min(x0 + alcance, xFinCanaleta - 0.4);
    laminaParabolica(laminaSalida, x0, y0, x1, yPisoCanaleta(x1) + hCan, K.anchoInt / 2 - 0.1, K.anchoInt / 2, true);
    laminaSalida.visible = true;

    // Película sobre la canaleta
    laminaParabolica(aguaCanaleta, CA.x0 + 0.3, yPisoCanaleta(CA.x0 + 0.3) + hCan,
      xFinCanaleta, yPisoCanaleta(xFinCanaleta) + hCan, CA.anchoInt / 2 - 0.05, CA.anchoInt / 2 - 0.05, false);
    aguaCanaleta.visible = true;

    // Chorro que cae al tóper
    const yT = yAguaToper(Q.col);
    laminaParabolica(chorroToper, xFinCanaleta, yPisoCanaleta(xFinCanaleta) + hCan * 0.6,
      xFinCanaleta + 0.5 + 0.55 * Math.sqrt(Q.q), yT + 0.05, CA.anchoInt / 2 - 0.2, CA.anchoInt / 2 - 1.3, true);
    chorroToper.visible = true;
  } else {
    laminaSalida.visible = aguaCanaleta.visible = chorroToper.visible = false;
  }

  // --- Nivel del tóper ---
  const yT = yAguaToper(Q.col), h = yT - (-RS.prof + 0.3);
  aguaReservorio.scale.y = h;
  aguaReservorio.position.y = -RS.prof + 0.3 + h / 2;
  return Q;
}
actualizarAgua(0, 0);

/* ===== FLECHAS DE FLUJO =====
   Conos blancos que avanzan por el recorrido del agua: bomba → manguera →
   nacimiento → río → compuerta → canaleta → tóper. Sólo se ven donde de
   verdad hay corriente en ese momento. */
const geoFlecha = new THREE.ConeGeometry(0.3, 0.9, 8);
geoFlecha.rotateZ(-Math.PI / 2);                      // la punta mira a +X
const _ejeX = new THREE.Vector3(1, 0, 0), _pF = new THREE.Vector3(), _tF = new THREE.Vector3();
function crearCorriente(n, nombre) {
  const c = { flechas: [] };
  for (let i = 0; i < n; i++) {
    const f = new THREE.Mesh(geoFlecha, MAT.flecha);
    f.name = nombre; f.visible = false; f.renderOrder = 3;
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
const corrienteRio = crearCorriente(8, 'flecha_rio');
function moverCorrienteRio(t, yAgua, activa) {
  const n = corrienteRio.flechas.length, xa = K.x0 + 2.0, xb = K.x1 - 1.2;
  for (let i = 0; i < n; i++) {
    const f = corrienteRio.flechas[i];
    f.visible = activa;
    if (!activa) continue;
    const u = ((i / n) + t * 0.035) % 1;
    f.position.set(mezclar(xa, xb, u), yAgua + 0.32, K.zc);
    f.quaternion.identity();
  }
}
const corrienteSalida = crearCorriente(7, 'flecha_salida');
const colaSalida = [
  new THREE.Vector3(xFinCanaleta - 1.8, yPisoCanaleta(xFinCanaleta - 1.8) + 0.5, K.zc),
  new THREE.Vector3(xFinCanaleta - 0.4, yPisoCanaleta(xFinCanaleta - 0.4) + 0.5, K.zc),
  new THREE.Vector3(xFinCanaleta + 0.7, -1.4, K.zc),
  new THREE.Vector3(xFinCanaleta + 1.1, -3.0, K.zc)
];
const xCP = CONFIG.compuerta.x;
const curvaVertiente = new THREE.CatmullRomCurve3([
  new THREE.Vector3(xCP - 1.0, yCresta + 0.6, K.zc),
  new THREE.Vector3(xCP + 0.2, yCresta + 0.4, K.zc),
  new THREE.Vector3(xCP + 0.7, 2.6, K.zc)
].concat(colaSalida));
const curvaDescarga = new THREE.CatmullRomCurve3([
  new THREE.Vector3(xCP - 1.8, 2.9, K.zc),
  new THREE.Vector3(xCP - 0.2, 2.3, K.zc),
  new THREE.Vector3(xCP + 0.7, yPisoCanaleta(xCP + 0.7) + 0.6, K.zc)
].concat(colaSalida));

/* ============================================================================
   ===== PUENTE CON EL HC-SR04 COLGADO =====
   El sensor va pegado bajo el tablero, centrado sobre el río, con sus dos
   transductores alineados a lo largo del canal. Un separador de 1.7 mm deja
   la cara del sensor justo a 3.0 cm del borde (v2.3: el puente baja 2.2 cm).
   ========================================================================== */
const P = CONFIG.puente;
const yHC = yCaraSensor + 1.2;            // centro del PCB (los transductores miden 1.2 cm)
const yTablero = yHC + 0.45;              // centro del tablero de 4 mm

(function construirPuente() {
  const g = new THREE.Group(); g.name = 'puente';
  const largo = P.z1 - P.z0, cz = (P.z0 + P.z1) / 2;
  g.add(caja(P.ancho, 0.4, largo, MAT.madera, P.x, yTablero, cz, 'puente_tablero'));
  for (const s of [-1, 1]) {
    g.add(caja(0.15, 0.15, largo, MAT.blanco, P.x + s * (P.ancho / 2 - 0.1), yTablero + 0.55, cz, 'puente_pasamanos'));
    for (let i = 0; i <= 8; i++) {
      const z = P.z0 + 0.3 + (i / 8) * (largo - 0.6);
      g.add(caja(0.12, 0.5, 0.12, MAT.blanco, P.x + s * (P.ancho / 2 - 0.1), yTablero + 0.3, z, 'puente_montante'));
    }
  }
  // Pilares: uno sobre la primera capa de la sierra y otro sobre la llanura,
  // los dos fuera de la zanja para no estorbar al canal.
  [P.z0 + 0.6, P.z1 - 0.6].forEach(zE => {
    const yE = cotaTerreno(P.x, zE), yTop = yTablero - 0.2;
    g.add(caja(P.ancho * 0.9, yTop - yE, 1.2, MAT.hormigon, P.x, (yTop + yE) / 2, zE, 'puente_pilar'));
  });
  // Separador bajo el tablero donde se pega el sensor (cinta doble cara)
  g.add(caja(1.6, 0.17, 3.6, MAT.madera, P.x, yTablero - 0.285, K.zc, 'puente_separador'));
  grupoPuente.add(g);
})();

/* ============================================================================
   ===== COMPUERTA ABATIBLE (servo SG90) =====
   Comparada con la guillotina:
     · Guillotina: necesita piñón-cremallera, dos guías verticales y que la
       hoja deslice sin trabarse con agua. Con un piñón de ~20 dientes, los
       180° del SG90 dan unos 3 cm de carrera: no alcanza a liberar el canal.
     · Abatible: la hoja va pegada al brazo del servo y gira 90° sobre un eje
       horizontal. Sin guías ni fricción, se ve de lejos y cuesta casi nada.
       Par necesario ≈ 0.35 kg·cm con la hoja de 6.4 cm (empuje del agua ×
       brazo de 5.5 cm); el SG90 entrega ~1.5 kg·cm. => se elige la ABATIBLE.
   Cerrada, la hoja mide 4 cm: es la presa y también el vertedero.
   ========================================================================== */
const CP = CONFIG.compuerta;
const yEje = yCoronaCanal + CP.ejeSobreBorde;     // 8.3
const hBrazo = yEje - yCresta;                    // 2.8: del eje a la cresta
const matHoja = new THREE.MeshPhongMaterial({ color: 0x7f9cae, shininess: 90, specular: 0xffffff, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
const pivoteCompuerta = new THREE.Group();
pivoteCompuerta.name = 'compuerta_pivote';
pivoteCompuerta.position.set(CP.x, yEje, K.zc);
let hojaCompuerta, servo;

(function construirCompuerta() {
  const g = pivoteCompuerta;
  hojaCompuerta = caja(0.3, CP.cresta, CP.ancho, matHoja, 0, -(hBrazo + CP.cresta / 2), 0, 'compuerta_hoja');
  g.add(hojaCompuerta);
  g.add(caja(0.36, 0.16, CP.ancho, MAT.rojo, 0, -hBrazo - 0.08, 0, 'compuerta_cresta'));   // cinta roja = cresta
  for (const s of [-1, 1])
    g.add(caja(0.3, hBrazo + 0.6, 0.4, matHoja, 0, 0.3 - (hBrazo + 0.6) / 2, s * (CP.ancho / 2 + 0.2), 'compuerta_brazo'));
  const eje = cilindro(0.09, 0.09, CP.ancho + 1.9, 6, MAT.metal, 0, 0, -0.1, 'compuerta_eje');
  eje.rotation.x = Math.PI / 2;
  g.add(eje);
  g.add(caja(0.3, 1.8, 0.12, MAT.blanco, 0, -0.55, CP.ancho / 2 + 0.52, 'sg90_aspa'));       // brazo del servo
  grupoPuente.add(g);

  // Soporte del pasador del lado de la sierra, pegado a la cara del unicel
  grupoPuente.add(caja(0.8, 1.8, 0.5, MAT.blanco, T.xMax + 0.4, yEje, K.zc - CP.ancho / 2 - 0.75, 'compuerta_soporte_pasador'));

  // Servo SG90 acostado contra la cara del unicel, con el eje hacia el río
  servo = new THREE.Group(); servo.name = 'servo_sg90';
  servo.position.set(CP.x, yEje, K.zc + CP.ancho / 2 + 0.7);
  const azul = new THREE.MeshPhongMaterial({ color: 0x2f7fd0, shininess: 40 });
  servo.add(caja(1.2, 2.3, 2.25, azul, 0, -0.55, 1.125, 'sg90_cuerpo'));
  servo.add(caja(1.2, 3.25, 0.25, azul, 0, -0.55, 0.55, 'sg90_orejas'));
  const corona = cilindro(0.42, 0.42, 0.3, 10, MAT.blanco, 0, 0, -0.15, 'sg90_corona');
  corona.rotation.x = Math.PI / 2;
  servo.add(corona);
  grupoActuadores.add(servo);
})();

/* ============================================================================
   ===== RESERVORIO (TÓPER COLGADO), BOMBA Y MANGUERA =====
   El tóper (12 × 14 × 6.5 cm) entra en el recorte del MDF y cuelga de su ceja.
   Su boca queda abajo del final de la canaleta y el agua vuelve sola, por
   gravedad. Con patas de 6.5 cm su fondo queda 0.9 cm sobre la mesa.
   ========================================================================== */
const SE = CONFIG.bahia.seco;
let bomba, helice, esp32, moduloRele, ledRele;

(function construirReservorio() {
  const g = new THREE.Group(); g.name = 'reservorio';
  const matTina = new THREE.MeshPhongMaterial({ color: 0x8fb9cc, shininess: 90, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false });
  const anchoR = RS.x1 - RS.x0, largoR = RS.z1 - RS.z0, cxR = (RS.x0 + RS.x1) / 2, czR = (RS.z0 + RS.z1) / 2;
  g.add(caja(anchoR, 0.3, largoR, matTina, cxR, -RS.prof + 0.15, czR, 'toper_piso'));
  for (const s of [-1, 1]) {
    g.add(caja(0.3, RS.prof, largoR, matTina, cxR + s * (anchoR / 2 - 0.15), -RS.prof / 2, czR, 'toper_costado'));
    g.add(caja(anchoR, RS.prof, 0.3, matTina, cxR, -RS.prof / 2, czR + s * (largoR / 2 - 0.15), 'toper_testero'));
  }
  // Ceja que se apoya sobre la tabla
  const matCeja = new THREE.MeshPhongMaterial({ color: 0x9cc3d4, shininess: 60, transparent: true, opacity: 0.6 });
  g.add(caja(anchoR + 1.2, 0.2, 0.6, matCeja, cxR, 0.1, RS.z0 - 0.3, 'toper_ceja'));
  g.add(caja(anchoR + 1.2, 0.2, 0.6, matCeja, cxR, 0.1, RS.z1 + 0.3, 'toper_ceja'));
  g.add(caja(0.6, 0.2, largoR, matCeja, RS.x0 - 0.3, 0.1, czR, 'toper_ceja'));
  g.add(caja(0.6, 0.2, largoR, matCeja, RS.x1 + 0.3, 0.1, czR, 'toper_ceja'));
  g.children.forEach(m => { m.castShadow = false; });

  // Bomba sumergible al fondo, en la esquina opuesta a donde cae el chorro
  bomba = new THREE.Group(); bomba.name = 'bomba';
  bomba.position.set(RS.x1 - 2.6, -RS.prof + 0.3, RS.z0 + 2.6);
  bomba.add(caja(2.2, 2.0, 2.0, MAT.negro, 0, 1.0, 0, 'bomba_cuerpo'));
  bomba.add(caja(2.4, 0.35, 2.2, MAT.metalOsc, 0, 0.18, 0, 'bomba_base'));
  bomba.add(cilindro(0.3, 0.3, 1.0, 8, MAT.metalOsc, 0, 2.5, 0.4, 'bomba_salida'));
  helice = new THREE.Group(); helice.name = 'bomba_helice';
  helice.position.set(0, 1.0, 1.08);                 // rejilla de succión al frente
  for (let i = 0; i < 3; i++) {
    const pala = caja(0.75, 0.06, 0.2, MAT.metal, 0, 0, 0, 'bomba_pala');
    pala.rotation.z = (i * Math.PI * 2) / 3;
    helice.add(pala);
  }
  bomba.add(helice);
  g.add(bomba);
  grupoBahia.add(g);
})();

// Manguera: sube por dentro del tóper pegada a su pared trasera, salta la ceja
// del lado del unicel y entra en una RANURA de ~1 × 1 cm tallada en la cara
// inferior del bloque de 3". Corre por ella bajo la sierra (lejos del canal)
// y sube por un túnel vertical en la cabecera hasta el nacimiento.
// v2.3: el MDF ya no lleva perforaciones y la manguera no cuelga bajo la tabla.
const xNac = T.xMin + 1.8, zNac = K.zc;                  // donde asoma la manguera
const zRanura = -9.8, yRanura = 0.5;
const curvaManguera = new THREE.CatmullRomCurve3([
  new THREE.Vector3(RS.x1 - 2.6, -RS.prof + 3.2, RS.z0 + 2.9),
  new THREE.Vector3(RS.x1 - 3.4, -2.4, RS.z0 + 1.0),
  new THREE.Vector3(RS.x0 + 4.0, -1.6, RS.z0 + 0.9),
  new THREE.Vector3(RS.x0 + 1.0, -0.6, zRanura),
  new THREE.Vector3(RS.x0 + 0.1, 0.75, zRanura),          // salta la ceja del tóper
  new THREE.Vector3(RS.x0 - 0.8, 0.6, zRanura),
  new THREE.Vector3(T.xMax + 0.1, yRanura, zRanura),       // entra a la ranura
  new THREE.Vector3(T.xMax - 4.0, yRanura, zRanura),
  new THREE.Vector3(xZanja0 + 2.0, yRanura, zRanura),
  new THREE.Vector3(xNac + 0.2, yRanura, zRanura + 2.2),
  new THREE.Vector3(xNac, yRanura, zNac - 1.6),
  new THREE.Vector3(xNac, yRanura + 0.6, zNac),            // codo al pie del túnel
  new THREE.Vector3(xNac, 3.6, zNac),                      // túnel dentro del unicel
  new THREE.Vector3(xNac, T.yCama + 0.15, zNac),
  new THREE.Vector3(xNac + 0.5, T.yCama + 1.0, zNac),
  new THREE.Vector3(xZanja0 - 0.1, T.yCama + 0.9, zNac),
  new THREE.Vector3(K.x0 + 0.7, T.yCama - 0.8, zNac)       // boquilla dentro del río
], false, 'catmullrom', 0.35);
const xBoquilla = K.x0 + 0.7, yBoquilla = T.yCama - 0.95;
(function construirManguera() {
  const m = new THREE.Mesh(new THREE.TubeGeometry(curvaManguera, 140, 0.22, 7, false),
    new THREE.MeshPhongMaterial({ color: 0x3b4248, shininess: 40 }));
  m.name = 'manguera_impulsion'; m.castShadow = true;
  grupoBahia.add(m);
  grupoBahia.add(cilindro(0.3, 0.26, 0.5, 8, MAT.metalOsc, xBoquilla, yBoquilla + 0.1, zNac, 'boquilla_nacimiento'));
})();
// Chorrito del nacimiento al río (sólo con la bomba encendida)
const chorroNacimiento = cilindro(0.17, 0.2, 1, 8, MAT.lamina, xBoquilla, 0, zNac, 'chorro_nacimiento');
chorroNacimiento.castShadow = false;
grupoAgua.add(chorroNacimiento);
const corrienteManguera = crearCorriente(16, 'flecha_manguera');

/* ============================================================================
   ===== ZONA SECA DE LA ELECTRÓNICA =====
   Al frente del tóper, sobre una tarima, y separada del agua por una mampara
   transparente que detiene salpicaduras del chorro. Mide 16.6 × 8.7 cm: entra
   justo la protoboard de 830 (16.5 × 5.5) con el relé delante.
   ========================================================================== */
const pbx = (SE.x0 + SE.x1) / 2, pbz = SE.z0 + 0.3 + 2.75, pby = SE.tarima;
(function construirZonaSeca() {
  const g = new THREE.Group(); g.name = 'zona_seca';
  const anchoS = SE.x1 - SE.x0, largoS = SE.z1 - SE.z0, cxS = (SE.x0 + SE.x1) / 2, czS = (SE.z0 + SE.z1) / 2;
  g.add(caja(anchoS, SE.tarima, largoS, MAT.tarima, cxS, SE.tarima / 2, czS, 'tarima_seca'));
  const mampara = caja(anchoS, 4.0, 0.3, MAT.acrilico, cxS, 2.0, SE.z0 - 0.15, 'mampara_antisalpicaduras');
  mampara.castShadow = false; g.add(mampara); aristas(mampara, g);

  // Protoboard de 830 puntos (16.5 x 5.5 cm)
  g.add(caja(16.5, 0.9, 5.5, MAT.protoboard, pbx, pby + 0.45, pbz, 'protoboard_830'));
  g.add(caja(15.9, 0.06, 0.5, new THREE.MeshPhongMaterial({ color: 0xd9d5c8 }), pbx, pby + 0.91, pbz, 'protoboard_canal'));
  for (const s of [-1, 1]) {
    g.add(caja(15.9, 0.05, 0.07, MAT.rojo, pbx, pby + 0.92, pbz + s * 2.35, 'bus_5v'));
    g.add(caja(15.9, 0.05, 0.07, MAT.negro, pbx, pby + 0.92, pbz + s * 2.62, 'bus_gnd'));
  }

  // ESP32-WROOM-32 DevKit V1
  esp32 = new THREE.Group(); esp32.name = 'esp32';
  esp32.position.set(pbx - 4.6, pby + 0.9, pbz);
  esp32.add(caja(5.1, 0.16, 2.85, MAT.pcb, 0, 0.08, 0, 'esp32_pcb'));
  esp32.add(caja(1.8, 0.28, 1.6, MAT.metal, -1.3, 0.30, 0, 'esp32_blindaje'));
  esp32.add(caja(0.9, 0.1, 1.55, new THREE.MeshPhongMaterial({ color: 0xd8d4c8 }), -0.15, 0.22, 0, 'esp32_antena'));
  esp32.add(caja(0.8, 0.32, 0.75, MAT.metal, 2.35, 0.30, 0, 'esp32_usb'));
  for (const s of [-1, 1])
    esp32.add(caja(4.6, 0.22, 0.22, new THREE.MeshPhongMaterial({ color: 0x25292d }), -0.1, 0.02, s * 1.32, 'esp32_tira_pines'));
  esp32.add(caja(0.18, 0.1, 0.18, new THREE.MeshPhongMaterial({ color: 0xd23b2b }), 1.6, 0.2, 0.7, 'esp32_led'));
  g.add(esp32);

  // Módulo relé de 1 canal
  moduloRele = new THREE.Group(); moduloRele.name = 'modulo_rele';
  moduloRele.position.set(pbx + 3.0, pby, SE.z1 - 1.35);
  moduloRele.add(caja(5.0, 0.16, 2.6, MAT.pcbVerde, 0, 0.08, 0, 'rele_pcb'));
  moduloRele.add(caja(1.9, 1.55, 1.6, new THREE.MeshPhongMaterial({ color: 0x2a5aa8, shininess: 25 }), -1.2, 0.93, 0, 'rele_bloque'));
  moduloRele.add(caja(1.5, 1.0, 1.9, new THREE.MeshPhongMaterial({ color: 0x2f6b3c }), 1.4, 0.66, 0, 'rele_bornera'));
  ledRele = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshPhongMaterial({ color: 0x8a2b22 }));
  ledRele.position.set(0.3, 0.28, 0.9); ledRele.name = 'rele_led';
  moduloRele.add(ledRele);
  g.add(moduloRele);
  grupoBahia.add(g);
})();

/* ============================================================================
   ===== SENSORES Y ACTUADORES =====
   ========================================================================== */
function crearHCSR04() {
  const g = new THREE.Group(); g.name = 'hc_sr04';
  g.add(caja(4.5, 0.16, 2.0, MAT.pcb, 0, 0, 0, 'hcsr04_pcb'));
  for (const s of [-1, 1]) {
    g.add(cilindro(0.8, 0.8, 1.2, 12, MAT.metal, 0, -0.6, s * 1.05, 'hcsr04_transductor'));
    g.add(cilindro(0.72, 0.72, 0.1, 12, new THREE.MeshPhongMaterial({ color: 0x3a4046 }), 0, -1.2, s * 1.05, 'hcsr04_membrana'));
  }
  g.add(caja(0.5, 0.5, 0.5, MAT.metal, 1.6, -0.2, 0, 'hcsr04_cristal'));
  g.add(caja(0.22, 0.55, 2.0, new THREE.MeshPhongMaterial({ color: 0x25292d }), -2.05, -0.28, 0, 'hcsr04_pines'));
  return g;
}
function crearFC37() {
  const g = new THREE.Group(); g.name = 'fc_37';
  const tabl = caja(5.4, 0.14, 4.0, new THREE.MeshPhongMaterial({ color: 0xbf9a3a, shininess: 55 }), 0, 0, 0, 'fc37_tablilla');
  tabl.rotation.x = -0.32; g.add(tabl);
  for (let i = -4; i <= 4; i++) {
    const p = caja(0.13, 0.05, 3.4, new THREE.MeshPhongMaterial({ color: 0xd8b34f }), i * 0.55, 0.1, 0, 'fc37_pista');
    p.rotation.x = -0.32; g.add(p);
  }
  const comp = new THREE.Group(); comp.position.set(0, -1.5, 1.2); comp.name = 'fc37_comparador';
  comp.add(caja(3.0, 0.14, 1.6, MAT.pcbVerde, 0, 0, 0, 'fc37_comp_pcb'));
  comp.add(caja(0.9, 0.35, 0.55, MAT.negro, -0.6, 0.24, 0, 'fc37_lm393'));
  comp.add(caja(0.55, 0.5, 0.55, new THREE.MeshPhongMaterial({ color: 0x2255aa }), 0.7, 0.3, 0, 'fc37_potenciometro'));
  g.add(comp);
  return g;
}
function crearYL69() {
  const g = new THREE.Group(); g.name = 'yl_69';
  // Sonda vertical: 5 cm dentro del vasito con tierra, 1 cm asomando
  g.add(caja(2.0, 6.0, 0.14, new THREE.MeshPhongMaterial({ color: 0xbf9a3a, shininess: 55 }), 0, -2.0, 0, 'yl69_sonda'));
  for (const s of [-1, 1])
    g.add(caja(0.45, 4.6, 0.06, new THREE.MeshPhongMaterial({ color: 0xd8b34f }), s * 0.55, -2.6, 0.08, 'yl69_pua'));
  const comp = new THREE.Group(); comp.position.set(0, 1.25, 0); comp.name = 'yl69_lm393';
  comp.add(caja(3.0, 0.14, 1.6, MAT.pcbVerde, 0, 0, 0, 'yl69_comp_pcb'));
  comp.add(caja(0.9, 0.35, 0.55, MAT.negro, -0.6, 0.24, 0, 'yl69_chip_lm393'));
  comp.add(caja(0.55, 0.5, 0.55, new THREE.MeshPhongMaterial({ color: 0x2255aa }), 0.7, 0.3, 0, 'yl69_potenciometro'));
  g.add(comp);
  return g;
}
function crearBuzzer() {
  const g = new THREE.Group(); g.name = 'buzzer';
  g.add(cilindro(0.65, 0.65, 0.85, 14, MAT.negro, 0, 0.43, 0, 'buzzer_capsula'));
  g.add(cilindro(0.16, 0.16, 0.06, 8, new THREE.MeshPhongMaterial({ color: 0x8d949a }), 0, 0.87, 0, 'buzzer_orificio'));
  g.add(caja(1.5, 0.12, 1.0, MAT.pcbVerde, 0, 0.05, 0, 'buzzer_soporte'));
  g.add(caja(0.5, 0.4, 0.3, MAT.negro, 0.85, 0.25, 0.35, 'buzzer_transistor'));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.9, 14, 10), MAT.halo);
  halo.position.set(0, 0.5, 0); halo.name = 'buzzer_halo'; halo.castShadow = false;
  g.add(halo); g.userData.halo = halo;
  return g;
}
function crearCaseta() {
  const g = new THREE.Group(); g.name = 'caseta_control';
  g.add(caja(3.6, 2.6, 3.0, MAT.muro, 0, 1.3, 0, 'caseta_muros'));
  const techo = new THREE.Mesh(new THREE.ConeGeometry(2.85, 1.2, 4), MAT.teja);
  techo.position.set(0, 3.2, 0); techo.rotation.y = Math.PI / 4;
  techo.castShadow = true; techo.name = 'caseta_techo';
  g.add(techo);
  g.add(caja(0.9, 1.5, 0.1, MAT.madera, 0, 0.75, 1.52, 'caseta_puerta'));
  g.add(caja(0.9, 0.7, 0.1, MAT.vidrio, -1.2, 1.6, 1.52, 'caseta_ventana'));
  return g;
}

const hcsr04 = crearHCSR04();
const fc37   = crearFC37();
const yl69   = crearYL69();
const buzzer = crearBuzzer();
const caseta = crearCaseta();
grupoSensores.add(hcsr04, fc37, yl69);
grupoActuadores.add(buzzer, caseta);

// --- Distribución "colgado del puente" (única) ---
const POS = {
  fc37:   { x: -15.0, z: 4.4, alto: 4.5 },     // mástil junto al puente, del lado de aguas arriba
  yl69:   { x: -3.0,  z: 4.4 },                // en un vasito con tierra enterrado en la llanura
  caseta: { x: -5.0,  z: 10.5 }                // terraza del frente
};
hcsr04.position.set(P.x, yHC, K.zc);
hcsr04.rotation.y = Math.PI / 2;                 // transductores a lo largo del río
fc37.position.set(POS.fc37.x, cotaTerreno(POS.fc37.x, POS.fc37.z) + POS.fc37.alto, POS.fc37.z);
yl69.position.set(POS.yl69.x, T.yCama + 0.05, POS.yl69.z);
caseta.position.set(POS.caseta.x, cotaTerreno(POS.caseta.x, POS.caseta.z), POS.caseta.z);
caseta.scale.setScalar(0.75);                                 // v2.3: caseta más chica
const DESFASE_BUZZER = new THREE.Vector3(2.1, 1.9, 0.4);     // sirena en un poste junto a la caseta
buzzer.position.copy(caseta.position).add(DESFASE_BUZZER);

// Vasito con tierra para el YL-69 (sólo asoma la tierra)
grupoSensores.add(cilindro(1.5, 1.3, 4.6, 16, MAT.tierra, POS.yl69.x, T.yCama - 2.27, POS.yl69.z, 'vaso_tierra_yl69'));

// Cono del ultrasonido (~30°): deja ver que la huella cae dentro del canal
const conoHC = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 28, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xe8a33a, transparent: true, opacity: 0.17, side: THREE.DoubleSide, depthWrite: false }));
conoHC.name = 'cono_ultrasonido';
grupoSensores.add(conoHC);
const TAN15 = Math.tan(15 * Math.PI / 180);
function actualizarCono(yAgua) {
  const d = Math.max(0.2, yCaraSensor - yAgua), r = d * TAN15;
  conoHC.scale.set(r, d, r);
  conoHC.position.set(P.x, yAgua + d / 2, K.zc);
}

/* ============================================================================
   ===== CABLEADO Y POSTES =====
   Rojo = 5V, negro = GND, colores = datos. Todos los mazos van por el borde
   FRONTAL de la terraza y bajan por la cara del unicel a la zona seca: no
   cruzan el río ni pasan sobre el tóper.
   ========================================================================== */
const grupoCables = new THREE.Group(); grupoCables.name = 'cableado';
const grupoPostes = new THREE.Group(); grupoPostes.name = 'postes';
grupoSensores.add(grupoCables, grupoPostes);

const ENTRADA = new THREE.Vector3(SE.x0 + 0.9, pby + 0.95, pbz + 2.2);
const ENTRADA_SERVO = new THREE.Vector3(SE.x0 + 1.2, pby + 0.95, pbz - 2.1);
const zBorde = B.z / 2 - 0.4;
const _matsCable = {};
function materialCable(color) {
  if (!_matsCable[color]) _matsCable[color] = new THREE.MeshPhongMaterial({ color: color, shininess: 45 });
  return _matsCable[color];
}
function limpiarGrupo(g) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const o = g.children[i];
    if (o.geometry) o.geometry.dispose();
    g.remove(o);
  }
}
function tuboCable(puntos, color) {
  const curva = new THREE.CatmullRomCurve3(puntos, false, 'catmullrom', 0.3);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.075, 4, false), materialCable(color));
  m.castShadow = false; m.name = 'cable';
  return m;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// "inicio" son los primeros puntos propios de cada pieza; el último ya toca el suelo
function rutaHastaBahia(inicio, d) {
  const pts = inicio.map(p => V(p.x + d, p.y, p.z));
  const ult = inicio[inicio.length - 1];
  const x0 = ult.x + d, yTer = T.yCama + T.paso + 0.3;
  const zT = frenteTerraza(ult.x);
  if (ult.z < zT - 0.6) {                                   // sube el escalón de la terraza
    pts.push(V(x0, T.yCama + 0.3, zT - 0.5));
    pts.push(V(x0, yTer, zT + 0.6));
  }
  pts.push(V(x0, yTer, zBorde + d * 0.5));
  pts.push(V(mezclar(x0, T.xMax - 0.7, 0.5), yTer, zBorde + d));
  pts.push(V(T.xMax - 0.7, yTer, zBorde + d));
  pts.push(V(T.xMax + 0.45, yTer - 2.0, zBorde - 0.3 + d));  // baja por la cara del unicel
  pts.push(V(T.xMax + 1.0, pby + 1.8, zBorde - 1.2 + d));
  pts.push(V(ENTRADA.x + d, ENTRADA.y, ENTRADA.z));
  return pts;
}

function ponerPoste(x, z, yTop) {
  const yBase = cotaTerreno(x, z), h = yTop - yBase;
  if (h < 0.6) return;
  grupoPostes.add(cilindro(0.16, 0.24, h, 7, MAT.madera, x, yBase + h / 2, z, 'poste'));
  grupoPostes.add(cilindro(0.45, 0.6, 0.3, 8, MAT.hormigon, x, yBase + 0.15, z, 'poste_dado'));
}

function reconstruirCableado() {
  limpiarGrupo(grupoCables);
  limpiarGrupo(grupoPostes);

  const f = fc37.position, b = buzzer.position, y = yl69.position;
  ponerPoste(f.x, f.z - 0.3, f.y - 1.2);                    // mástil del FC-37
  ponerPoste(b.x, b.z, b.y);                                // poste de la sirena

  const mazos = [
    { colores: [CONFIG.cable.v5, CONFIG.cable.gnd, CONFIG.cable.dato, CONFIG.cable.dato2],   // HC-SR04: 4 hilos
      inicio: [V(P.x + 0.4, yHC + 0.1, K.zc + 2.1), V(P.x + 1.9, yTablero - 0.3, K.zc + 2.7),
               V(P.x + 1.9, yTablero - 0.3, P.z1 - 0.3), V(P.x + 1.9, T.yCama + 1.6, P.z1 + 0.5),
               V(P.x + 1.9, T.yCama + 0.3, P.z1 + 1.3)] },
    { colores: [CONFIG.cable.v5, CONFIG.cable.gnd, CONFIG.cable.dato3, 0x8a5bc4],
      inicio: [V(f.x + 0.2, f.y - 1.5, f.z + 1.0), V(f.x + 0.35, f.y - 2.6, f.z + 0.1),
               V(f.x + 0.35, cotaTerreno(f.x, f.z) + 0.3, f.z + 0.4)] },
    { colores: [CONFIG.cable.v5, CONFIG.cable.gnd, 0x3a9c8c],
      inicio: [V(y.x + 0.6, y.y + 1.0, y.z), V(y.x + 0.9, T.yCama + 0.3, y.z + 0.9)] },
    { colores: [CONFIG.cable.v5, CONFIG.cable.gnd],
      inicio: [V(b.x + 0.3, b.y - 0.1, b.z), V(b.x + 0.3, cotaTerreno(b.x, b.z) + 0.3, b.z + 0.5)] }
  ];
  mazos.forEach(mz => mz.colores.forEach((col, i) => {
    const d = (i - (mz.colores.length - 1) / 2) * 0.2;
    grupoCables.add(tuboCable(rutaHastaBahia(mz.inicio, d), col));
  }));

  // Servo: mazo corto directo a la protoboard (queda junto a la zona seca)
  [CONFIG.cable.v5, CONFIG.cable.gnd, 0xd79a1e].forEach((col, i) => {
    const d = (i - 1) * 0.2;
    grupoCables.add(tuboCable([
      V(CP.x + 0.2 + d, yEje - 1.7, K.zc + CP.ancho / 2 + 2.0),
      V(CP.x + 0.25 + d, 4.4, SE.z0 - 0.6),
      V(CP.x + 0.3 + d, 2.6, SE.z0 + 0.3),
      V(ENTRADA_SERVO.x + d, ENTRADA_SERVO.y, ENTRADA_SERVO.z)
    ], col));
  });
}
reconstruirCableado();

// Cableado interno: ESP32 -> relé y relé -> bomba (entra al tóper por encima)
(function cableadoBahia() {
  const g = new THREE.Group(); g.name = 'cableado_bahia';
  const tubo = (pts, col) => g.add(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35), 40, 0.075, 4, false), materialCable(col)));
  const xb = bomba.position.x, yb = bomba.position.y, zb = bomba.position.z;
  const xr = moduloRele.position.x + 1.4;                   // bornera del relé
  [[CONFIG.cable.v5, 0.2], [CONFIG.cable.gnd, -0.2]].forEach(([col, o]) => tubo([
    V(xr + o, pby + 1.0, SE.z1 - 2.0), V(xr + 0.2 + o, 5.0, SE.z0 + 0.6), V(xr + 0.3 + o, 4.6, SE.z0 - 0.9),
    V(xr + 0.2 + o, 1.0, RS.z1 - 1.0), V(xb + 0.8 + o, -2.0, RS.z1 - 4.0), V(xb + 0.6 + o, yb + 2.2, zb + 1.6)
  ], col));
  tubo([V(esp32.position.x + 2.0, pby + 1.2, pbz + 1.0), V(esp32.position.x + 4.4, pby + 2.6, pbz + 2.6),
        V(moduloRele.position.x - 1.6, pby + 1.0, SE.z1 - 1.35)], 0x9a5bd0);
  grupoBahia.add(g);
})();

/* ============================================================================
   ===== AMBIENTACIÓN =====
   Geometrías y materiales compartidos. Árboles en la sierra, arbustos en las
   orillas, rocas en el nacimiento y tres casas en la llanura: son las que se
   inundarían primero.
   ========================================================================== */
const geoTronco   = new THREE.CylinderGeometry(0.13, 0.19, 1, 6); geoTronco.translate(0, 0.5, 0);
const geoCopaBaja = new THREE.ConeGeometry(0.85, 1.9, 7);
const geoCopaAlta = new THREE.ConeGeometry(0.60, 1.5, 7);
const geoRoca     = new THREE.IcosahedronGeometry(0.5, 0);
const geoArbusto  = new THREE.IcosahedronGeometry(0.45, 0);

function arbol(e) {
  const g = new THREE.Group(); g.name = 'arbol';
  const hT = 1.5 * e;
  const tr = new THREE.Mesh(geoTronco, MAT.tronco);
  tr.scale.set(e, hT, e); tr.castShadow = true; tr.name = 'arbol_tronco'; g.add(tr);
  const c1 = new THREE.Mesh(geoCopaBaja, MAT.copaA);
  c1.position.y = hT + 0.75 * e; c1.scale.setScalar(e); c1.castShadow = true; c1.name = 'arbol_copa'; g.add(c1);
  const c2 = new THREE.Mesh(geoCopaAlta, MAT.copaB);
  c2.position.y = hT + 1.75 * e; c2.scale.setScalar(e); c2.castShadow = true; c2.name = 'arbol_copa_alta'; g.add(c2);
  return g;
}
function casa(ancho, fondo) {
  const g = new THREE.Group(); g.name = 'casa';
  g.add(caja(ancho, 1.9, fondo, MAT.muro, 0, 0.95, 0, 'casa_muros'));
  const techo = new THREE.Mesh(new THREE.ConeGeometry(Math.max(ancho, fondo) * 0.78, 1.1, 4), MAT.teja);
  techo.position.y = 2.45; techo.rotation.y = Math.PI / 4; techo.castShadow = true; techo.name = 'casa_techo';
  g.add(techo);
  g.add(caja(0.55, 1.0, 0.08, MAT.madera, 0, 0.5, fondo / 2 + 0.02, 'casa_puerta'));
  return g;
}
function roca(x, z, s) {
  const r = new THREE.Mesh(geoRoca, MAT.roca);
  r.position.set(x, cotaTerreno(x, z) + 0.12 * s, z);
  r.scale.set(entre(0.7, 1.4) * s, entre(0.45, 0.9) * s, entre(0.7, 1.3) * s);
  r.rotation.set(entre(0, 3), entre(0, 3), entre(0, 3));
  r.castShadow = true; r.receiveShadow = true; r.name = 'roca';
  grupoAmbientacion.add(r);
}

const CASAS = [{ x: -19.0, z: 5.6 }, { x: 0.6, z: 6.4 }, { x: 3.6, z: 3.4 }];
const yPico = T.yCama + T.capasSierra * T.paso;          // 12.5: nada pasa de aquí
(function poblarAmbientacion() {
  const cerca = (x, z, px, pz, r) => Math.abs(x - px) < r && Math.abs(z - pz) < r;
  const libre = (x, z) =>
    x < T.xMax - 1.2 && x > T.xMin + 1 && Math.abs(z) < B.z / 2 - 0.8 &&
    !(z > zZanja0 - 0.9 && z < zZanja1 + 0.9) &&                          // río y sus orillas
    !(Math.abs(x - P.x) < 3.0 && z > P.z0 - 0.8 && z < P.z1 + 1.4) &&     // puente
    !(x < xZanja0 + 1.2 && z > zZanja0 - 1 && z < zZanja1 + 1) &&         // nacimiento
    !cerca(x, z, POS.fc37.x, POS.fc37.z, 1.8) && !cerca(x, z, POS.yl69.x, POS.yl69.z, 2.2) &&
    !cerca(x, z, POS.caseta.x + 1.2, POS.caseta.z, 3.6) &&
    !CASAS.some(c => cerca(x, z, c.x, c.z, 2.6));

  // Árboles: un árbol mide 4 × su escala; se recorta para no pasar de la cima
  const tallas = [0.45, 0.55, 0.62];
  for (let i = 0; i < 20; i++) {                 // árboles: sierra escalonada
    const x = entre(T.xMin + 1.2, T.xMax - 1.5);
    const z = entre(-12.0, frenteSierra(0, x) - 0.5);
    if (!libre(x, z)) continue;
    const eMax = (yPico - cotaTerreno(x, z)) / 4.0;
    if (eMax < 0.35) continue;
    const a = arbol(Math.min(eMax, tallas[i % 3] * entre(0.9, 1.12)));
    a.position.set(x, cotaTerreno(x, z) - 0.05, z);
    a.rotation.y = entre(0, Math.PI * 2);
    grupoAmbientacion.add(a);
  }
  for (let i = 0; i < 8; i++) {                  // rocas: pie de la sierra y llanura
    const x = entre(T.xMin + 1.2, T.xMax - 1.5);
    const z = aleatorio() < 0.5 ? entre(-11.5, frenteSierra(0, x) - 0.4) : entre(1.8, 8.2);
    const sR = entre(0.6, 1.1);
    if (libre(x, z) && cotaTerreno(x, z) < yPico) roca(x, z, sR);      // ninguna sobre la cima
  }
  // Rocas del nacimiento, alrededor de donde asoma la manguera
  [[-0.9, -1.4, 1.0], [0.9, -1.6, 0.9], [-0.9, 1.3, 0.9], [0.9, 1.5, 0.8], [-0.1, 2.4, 0.7], [0.2, -2.6, 0.7]]
    .forEach(([dx, dz, s]) => roca(xNac + dx, zNac + dz, s));
  for (let i = 0; i < 8; i++) {                  // arbustos en las orillas del río
    const x = entre(T.xMin + 3, T.xMax - 1.5);
    const z = entre(1.7, 8.0);
    if (!libre(x, z)) continue;
    const b = new THREE.Mesh(geoArbusto, MAT.arbusto);
    b.position.set(x, cotaTerreno(x, z) + 0.2, z);
    b.scale.set(entre(0.9, 1.7), entre(0.6, 1.1), entre(0.9, 1.7));
    b.rotation.y = entre(0, 3); b.castShadow = true; b.name = 'arbusto';
    grupoAmbientacion.add(b);
  }
  CASAS.forEach(s => {
    const c = casa(entre(2.2, 2.8), entre(2.0, 2.5));
    c.position.set(s.x, cotaTerreno(s.x, s.z), s.z);
    c.rotation.y = entre(-0.4, 0.4);
    grupoAmbientacion.add(c);
  });
})();

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
const marcaRio        = marca(K.x0 + 3.5, yCoronaCanal, K.zc - K.anchoInt / 2, grupoCanal);
const marcaRegleta    = marca(P.x + 4.0, K.pisoY + 5.6, K.zc - K.anchoInt / 2, grupoCanal);
const marcaCresta     = marca(CP.x, yCresta, K.zc - CP.ancho / 2, grupoPuente);
const marcaCanaleta   = marca(CA.x0 + 2.6, yPisoCanaleta(CA.x0 + 2.6) + CA.altoPared, K.zc + CA.anchoInt / 2, grupoCanal);
const marcaNacimiento = marca(xNac, T.yCama + 1.2, zNac, grupoBahia);
const marcaToper      = marca(RS.x1, -RS.prof * 0.45, RS.z1, grupoBahia);

/* ===== COTAS GENERALES (v2.3) =====
   Largo al frente y ancho a la derecha, sobre la mesa; alto en la esquina
   trasera izquierda, de la mesa a la cima de la sierra. */
const yMesa = -B.espesor - CONFIG.patas.alto;
const altoTotal = CONFIG.patas.alto + B.espesor + yPico;
(function construirCotas() {
  const mat = MAT.guia;
  const pts = [];
  const seg = (a, b) => { pts.push(a, b); };
  const tic = (p, ux, uz, uy) => seg(V(p.x - ux, p.y - uy, p.z - uz), V(p.x + ux, p.y + uy, p.z + uz));
  const xa = -B.x / 2, xb = B.x / 2, za = -B.z / 2, zb = B.z / 2, sep = 2.6, y0 = yMesa + 0.04;
  // Largo (45): línea al frente de la tabla
  const zL = zb + sep;
  seg(V(xa, y0, zb + 0.4), V(xa, y0, zL + 0.7)); seg(V(xb, y0, zb + 0.4), V(xb, y0, zL + 0.7));
  seg(V(xa, y0, zL), V(xb, y0, zL));
  tic(V(xa, y0, zL), 0.45, 0.45, 0); tic(V(xb, y0, zL), 0.45, 0.45, 0);
  // Ancho (25): línea a la derecha
  const xL = xb + sep;
  seg(V(xb + 0.4, y0, za), V(xL + 0.7, y0, za)); seg(V(xb + 0.4, y0, zb), V(xL + 0.7, y0, zb));
  seg(V(xL, y0, za), V(xL, y0, zb));
  tic(V(xL, y0, za), 0.45, 0.45, 0); tic(V(xL, y0, zb), 0.45, 0.45, 0);
  // Alto (≈20): vertical en la esquina trasera izquierda
  const xH = xa - sep;
  seg(V(xa - 0.4, yPico, za), V(xH - 0.7, yPico, za)); seg(V(xa - 0.4, y0, za), V(xH - 0.7, y0, za));
  seg(V(xH, y0, za), V(xH, yPico, za));
  tic(V(xH, yPico, za), 0.45, 0, 0.45); tic(V(xH, y0, za), 0.45, 0, 0.45);
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat);
  l.name = 'cotas'; grupoCotas.add(l);
})();
const marcaCotaLargo = marca(0, yMesa, B.z / 2 + 2.6, grupoCotas);
const marcaCotaAncho = marca(B.x / 2 + 2.6, yMesa, 0, grupoCotas);
const marcaCotaAlto  = marca(-B.x / 2 - 2.6, (yMesa + yPico) / 2 + 1.0, -B.z / 2, grupoCotas);
const fmt = n => (Math.round(n * 10) / 10).toString();
const litrosToper = (RS.x1 - RS.x0) * (RS.z1 - RS.z0) * RS.prof / 1000;

const ETIQUETAS = [
  { obj: hcsr04,          capa: 'sensores',   modelo: 'HC-SR04',        pines: 'TRIG 33 / ECHO 32 · a ' + fmt(P.sensorSobreBorde) + ' cm del borde', desfase: new THREE.Vector3(-3.0, 4.0, -5.0), nuevo: true },
  { obj: marcaRio,        capa: 'canal',      modelo: 'Río incrustado', pines: 'canal ' + fmt(K.x1 - K.x0) + ' × ' + fmt(K.anchoInt) + ' × ' + fmt(K.altoInt) + ' cm', desfase: new THREE.Vector3(-1.5, 6.0, -5.0), nuevo: true },
  { obj: marcaRegleta,    capa: 'canal',      modelo: 'Regleta',        pines: '1 cm ≡ 80 cm',          desfase: new THREE.Vector3( 2.4, 6.8, -5.2) },
  { obj: fc37,            capa: 'sensores',   modelo: 'FC-37',          pines: 'AO 34 (ADC1)',         desfase: new THREE.Vector3(-2.2, 2.8,  2.8) },
  { obj: yl69,            capa: 'sensores',   modelo: 'YL-69 + LM393',  pines: 'AO 35 (ADC1)',          desfase: new THREE.Vector3( 1.0, 4.5,  3.0) },
  { obj: marcaCresta,     capa: 'puente',     modelo: 'Compuerta = vertedero', pines: 'cresta 4 cm ≡ 320 cm', desfase: new THREE.Vector3( 0.5, 7.2, -5.0) },
  { obj: marcaCanaleta,   capa: 'canal',      modelo: 'Canaleta',       pines: 'retorno al tóper',      desfase: new THREE.Vector3( 4.0, 3.2,  5.6) },
  { obj: marcaNacimiento, capa: 'bahia',      modelo: 'Nacimiento',     pines: 'manguera por ranura bajo el unicel', desfase: new THREE.Vector3(-1.2, 4.8, 5.2), nuevo: true },
  { obj: buzzer,          capa: 'actuadores', modelo: 'Buzzer pasivo',  pines: 'GPIO14', desfase: new THREE.Vector3( 2.4, 2.8, -0.8) },
  { obj: servo,           capa: 'actuadores', modelo: 'Servo SG90',     pines: 'GPIO13 · 0–90°',        desfase: new THREE.Vector3( 1.6, 4.0,  4.8) },
  { obj: esp32,           capa: 'bahia',      modelo: 'ESP32-WROOM-32', pines: 'DevKit V1 · 30 pines',  desfase: new THREE.Vector3(-1.3, 4.0,  3.7) },
  { obj: moduloRele,      capa: 'bahia',      modelo: 'Relé 1 canal',   pines: 'enciende la bomba',     desfase: new THREE.Vector3( 2.0, 4.5,  1.8) },
  { obj: bomba,           capa: 'bahia',      modelo: 'Bomba 5V',       pines: 'recircula el agua',     desfase: new THREE.Vector3( 4.8, 4.0, -6.0) },
  { obj: marcaToper,      capa: 'bahia',      modelo: 'Tóper ~' + fmt(litrosToper) + ' L', pines: fmt(RS.x1 - RS.x0) + ' × ' + fmt(RS.z1 - RS.z0) + ' × ' + fmt(RS.prof) + ' cm · ' + fmt(CONFIG.bahia.litros) + ' L de agua', desfase: new THREE.Vector3( 4.0, -0.8, 4.8), nuevo: true },
  { obj: marcaCotaLargo,  capa: 'cotas', cota: true, modelo: fmt(B.x) + ' cm',  pines: 'largo',  desfase: new THREE.Vector3(0, 0, 0) },
  { obj: marcaCotaAncho,  capa: 'cotas', cota: true, modelo: fmt(B.z) + ' cm',  pines: 'ancho',  desfase: new THREE.Vector3(0, 0, 0) },
  { obj: marcaCotaAlto,   capa: 'cotas', cota: true, modelo: fmt(altoTotal) + ' cm', pines: 'alto total', desfase: new THREE.Vector3(-0.6, 0, 0) }
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
function fijarLluvia(pct) { estado.lluvia = limitar(Number(pct) || 0, 0, 100); }
function mostrarComponentes(ver) {
  estado.componentes = !!ver;
  grupoFlujo.visible = grupoGuias.visible = grupoCotas.visible = conoHC.visible = estado.componentes;
}
mostrarComponentes(false);
ledRele.material.color.setHex(0xd8402c);

/* ============================================================================
   ===== LLUVIA =====
   Unas cuantas rayas que caen sobre la maqueta; cuántas, lo dice el % de lluvia.
   ========================================================================== */
const LL = CONFIG.lluvia;
const gotas = [];
for (let i = 0; i < LL.gotas; i++)
  gotas.push({ x: entre(-B.x / 2, B.x / 2), y: entre(0, LL.alto), z: entre(-B.z / 2, B.z / 2), v: entre(20, 30) });
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
  const V = CONFIG.vista, tan = Math.tan(THREE.MathUtils.degToRad(CONFIG.camara.fov / 2));
  const dAncho = (V.ancho / 2) * altoVista / (tan * zona.w * V.margen);
  const dAlto = (V.alto / 2) * altoVista / (tan * zona.h * V.margen);
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
    const h = Math.max(0.1, yBoquilla - 0.15 - Q.yA);
    chorroNacimiento.scale.y = h;
    chorroNacimiento.position.y = Q.yA + h / 2;
    if (!quieto) helice.rotation.z += dt * 16;
  }

  // --- Cono del sensor y flechas de flujo: sólo con "Componentes" ---
  if (estado.componentes) {
    actualizarCono(Q.yA);
    moverCorriente(corrienteManguera, curvaManguera, t, 0.05, estado.bombaEncendida);
    moverCorrienteRio(t, Q.yA, estado.bombaEncendida || hayRetorno);
    moverCorriente(corrienteSalida, aperturaCompuerta > 0.5 ? curvaDescarga : curvaVertiente, t, 0.4, hayRetorno);
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
  fijarLluvia: fijarLluvia,           // % 0–100
  mostrarComponentes: mostrarComponentes,
  restablecerVista: function () { irAInicio(true); }
};
})();

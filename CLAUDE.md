# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser dashboard for an IoT river-level early-warning node in Colima: a 3D scale model ("maqueta v2.3", compact 45 × 25 × 20 cm) with glass cards floating over it. The page talks **directly to the MQTT broker**, in parallel to the user's Node-RED dashboard: it shows what the ESP32 node publishes and sends the same manual-mode commands Node-RED sends.

The model shows an acrylic channel set into a foam block, an HC-SR04 hanging from a bridge, rain and soil sensors, an SG90-driven tilting gate (it opens 90°; its crest doubles as the overflow spillway), a return chute into a tub hanging under the MDF board, a pump and an ESP32 in a side tech strip.

All code, identifiers, comments and UI text are in Spanish; keep new code in Spanish to match.

## Commands

```bash
npm install
npm start        # node server.js → http://localhost:3000
npm run dev      # node --watch server.js (restarts on server.js changes only; just reload the browser for public/ edits)
```

`PORT` and `HOST` env vars override the defaults (3000 / 0.0.0.0). Requires Node ≥ 18. There are no tests, linter or build step.

To work without the node powered on, open `http://localhost:3000/?demo=1`: a fake node inside the page publishes the firmware's JSON, applies its risk rules and obeys the control topic, with no broker. `?demo=offline` makes that fake node drop after a few seconds, to see the offline state.

## Deployment

The app runs as a single Node process with no build step: on the server, `npm ci --omit=dev` and then `npm start`. `node_modules/` is not committed, so the install step is required (the libraries are served out of it). The host's reverse proxy or platform should forward the subdomain to `PORT`; `GET /api/salud` is the health check. Files in `public/` are sent with `Cache-Control: no-cache` so a new deploy shows up on reload; `/vendor/*` is cached for 30 days because the library versions are pinned in `package.json`.

The page's broker connection comes from env vars, served at `GET /api/config`, so credentials stay out of the repo:

- `MQTT_URL` (default in `app.js`: `wss://mqtt.eparedes.dev/mqtt`, the same listener the ESP32 uses)
- `MQTT_USUARIO`, `MQTT_CLAVE`: a Mosquitto user created only for this page.

Anyone who can open the page can read those credentials and move the gate. So that Mosquitto user must have an ACL (read `datos`, `estado` and `control`; write only `control`) and the subdomain should sit behind Cloudflare Access. Never put the `esp32` or `nodered` passwords here.

## Architecture

- `server.js`: a minimal Express 5 static server. It serves `public/`, the pinned libraries from `node_modules` under `/vendor/{three,chartjs,mqtt,lucide}`, `GET /api/config` and `GET /api/salud`.
- `public/index.html`: markup only. It loads **three.js r128 global builds** (`THREE`, `THREE.OrbitControls` from `examples/js`), Chart.js 4, mqtt.js 5 and Lucide from `/vendor`, each with a CDN fallback via `document.write`, so the page also works on a static-only host. There are no ES modules and no bundler. Stay on r128 APIs, because `examples/js` was removed in later three.js versions.
- `public/styles.css`: the design tokens and every component. One visual language: glass over a green background. Only the five palette colors and their transparencies; the three semantic colors (`--risk-*`) are reserved for risk, buzzer, offline and threshold marks. No emojis, no glass nested inside glass.
- `public/escena.js`: the 3D scene only. It never reads sensors or computes risk.
- `public/app.js`: the dashboard: MQTT, cards, controls, history, demo mode.
- `public/simulador.html`: the previous standalone simulator (sliders, flood simulation, exploded view, OBJ export), kept untouched as a legacy copy. The dashboard does not use it.

`escena.js` and `app.js` are each wrapped in an IIFE and **each has its own `CONFIG`**: model dimensions in `escena.js`, topics/broker/thresholds in `app.js`. The only link between them is `window.Escena`.

### MQTT contract (do not rename topics or fields)

They come from the firmware (PlatformIO project `Practica_x.2`) and the Node-RED flow. All three live in `CONFIG.topics` in `app.js`.

| Topic | Direction | Payload |
|---|---|---|
| `ucol-eq1/rio/nodo1/datos` | sub, QoS 0, every 1 s | JSON: `nivel_cm` (0–400), `lluvia_pct`, `humedad_pct`, `riesgo` (0/1/2), `buzzer` (`apagado`/`intermitente`/`continuo`), `compuerta` (0/90), `modo` (`auto`/`manual`), plus `distancia_cm`, `led`, `compuerta_modo` |
| `ucol-eq1/rio/nodo1/estado` | sub, QoS 1 | `online` retained on connect, `offline` as Last Will |
| `ucol-eq1/rio/nodo1/control` | pub + sub, QoS 1, retained | `{"modo":"auto"}` or `{"modo":"manual","nivel_cm":..,"lluvia_pct":..,"humedad_pct":..,"compuerta":0\|90}` |

- The page **reads** the risk; it never computes it. The thresholds are fixed in the firmware.
- The interface shows everything in % (0–400 cm = 0–100 %), never cm. Conversion happens only at the edges (`aPct`, `enviarControl`).
- In manual mode the node reports the simulated values in `nivel_cm`/`lluvia_pct`/`humedad_pct`, which is how a slider change gets confirmed.

### `app.js` layout (sections marked by `// ===== NAME =====`)

1. **`CONFIG`**: topics, broker, thresholds in %, timeouts, history settings.
2. **State**: `nodo` is what the node confirms (data topic); `orden` is what was commanded (control topic, whoever published it); `pendientes` holds commands awaiting confirmation. The shared keys are `manual`, `nivel`, `lluvia`, `humedad`, `compuerta`.
3. **Incoming messages**: `alLlegar` routes to `recibirDatos`, `recibirEstado`, `recibirControl`. Field parsing is tolerant (`leerRiesgo`, `leerBuzzer`, `leerCompuerta`).
4. **Commands and confirmation**: no control assumes success. `ordenar()` marks the key pending and publishes; `revisarPendientes()` clears it when the node's data confirms; after `CONFIG.msConfirmacion` (3 s) `vencer()` reverts to the node's state, warns, and republishes the node's real state so the stale retained command can't flip the node into manual later. `valorMostrado()` decides what each control shows: the command while pending, otherwise the node. A command published by another client (Node-RED) moves the controls the same way.
5. **Connection**: `pintarConexion()` derives online / waiting / offline / no broker. Offline comes from the `estado` topic (LWT) or from `CONFIG.msSinDatos` without data. Offline and no-broker both disable the controls and desaturate the data cards.
6. **Readings, status, control, history**: `animarLectura` (600 ms count-up), `pintarEstado`, `pintarControl`, Chart.js charts fed from the in-memory `hist` buffer (reduced to ≤ 300 points per series; the last hour is also kept in `localStorage`, inside `try/catch`).
7. **Transport**: `conectarMqtt()` (real) or `iniciarDemo()` (fake node). Both feed `alLlegar` and set `transporte.publicar`, so the demo exercises the same code paths.

### `escena.js` layout

1. **`CONFIG`**: every dimension (1 unit = 1 cm of model), position, color, camera framing and animation time. Geometry is derived from it, so change it here rather than hard-coding numbers in the builders.
2. **Calibration table**: `columnaDesdeNivel`, `yAguaCanal` and `distanciaSensor` map the river level (0–400 cm) to the water column in the channel (0–`columnaMax` cm).
3. **Scene construction**: IIFEs, grouped by section (base and relief, channel, chute, water, bridge, gate, reservoir, sensors, cabling, labels and dimensions), add meshes to one `THREE.Group` per layer.
   - Build meshes with the `caja()`, `cilindro()` and `bloque()` helpers, which set shadows and names. Wrap acrylic parts in `aristas()` so their edges stay visible.
   - `cotaTerreno(x, z)` gives the terrain height so objects sit on the foam layers. `enZanja()` tells whether a point is inside the channel trench.
   - Randomness uses the seeded LCG `aleatorio()`, so the scene is identical on every load. Don't use `Math.random()` here.
   - The canvas is transparent (`alpha: true`, no scene background): the page gradient shows behind the model and is what the glass blurs. The "table" is a `ShadowMaterial` plane. Don't change the model's materials.
4. **Water model**: `caudales()` splits the outflow (over the gate crest while closed, through the gate when open); `actualizarAgua()` draws the river surface, the falling sheets and the tub.
5. **`estado` + `window.Escena`**: the API `app.js` uses: `fijarNivel(pct)` (600 ms), `fijarCompuerta(abierta)` (500 ms), `fijarBuzzer(modo)` (amber halo if intermittent, terracotta if sounding), `fijarLluvia(pct)` (rain streaks), `mostrarComponentes(ver)`, `restablecerVista()`.
6. **Framing**: on desktop the canvas fills the window and the cards float over it, so `ajustarTamano()` measures `#zonaLibre` (the gap between the columns, above the history dock), shifts the camera's optical center there with `setViewOffset`, and `posicionInicio()` backs the camera off until the model fits. A `ResizeObserver` re-runs it; it stops re-framing once the user moves the camera (`estado.vistaPropia`) until "Vista" is pressed.
7. **`bucle()`**: the single `requestAnimationFrame` loop. Animations are timed from the `THREE.Clock` elapsed time, not by accumulating `dt`.

Labels, guide lines, dimensions, flow arrows and the ultrasonic cone are hidden by default and appear only with the "Componentes" button, so the model stays clean.

### Gotchas

- The firmware lives outside this repo, at `OneDrive/Documentos/PlatformIO/Projects/Practica_x.2` (it has its own CLAUDE.md). Read `src/main.cpp` to confirm any field or timing; never open or print `include/secretos.h`.
- Thresholds are typed in several places. If the firmware's change, update `CONFIG.umbrales` in `app.js`, the slider marks (`--m`) and the cylinder's threshold lines in `index.html`, and `UMBRALES` in `escena.js` (staff-gauge marks).
- Palette colors are duplicated on purpose: tokens and `--rgb-*` triplets in `styles.css` (Chart.js reads them from there), and `CONFIG.colores.fondo/hueso/haloMedio/haloAlto` in `escena.js`.
- The firmware has no pump or relay output; the model draws them and the pump always "runs". The pin labels in `ETIQUETAS` follow the firmware (TRIG 33 / ECHO 32, AO 34 and 35 on ADC1, buzzer 14, servo 13).
- Respect `prefers-reduced-motion`: CSS animations are switched off globally, `animarLectura` paints directly, and the scene drops waves, rain and pulses (`mqQuieto`).
- When you add a card or change the layout, check the three breakpoints (≥ 1280 px floating cards, 768–1279 px two columns under the scene, < 768 px one column) and the low-height desktop rules; the right column must fit without scrolling at 1280 × 720.

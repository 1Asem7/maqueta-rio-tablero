# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser dashboard for an IoT river-level early-warning node in Colima: a 3D scale model ("maqueta v3.0", the finished physical model: 46.5 × 25 cm board, ≈ 21 cm to the top of the block) with glass cards floating over it. The page talks **directly to the MQTT broker**, in parallel to the user's Node-RED dashboard: it shows what the ESP32 node publishes and sends the same manual-mode commands Node-RED sends.

The model shows a single foam block (white card walls, green fiber on top) with a clear plastic container as the river, an HC-SR04 under a bridge, a rain plate on a house roof, a soil probe (HW-080) in a hole with soil, a farol with the RGB LED, an MG995-driven tilting gate on the block face (it opens 90° and the water falls straight into a tub hanging in a hole of the plywood board; there is no chute and no spillway), a pump with a silicone hose to the spring, and all the electronics (2 breadboards, ESP32, LM393 boards, buzzer, relay) under the board.

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

The production site (`maquetaiot.eparedes.dev`) is a **static site on HubDeploy**: `server.js` does not run, `/api/config` does not exist and env vars are not used. So the broker user and password live in `CONFIG.mqtt` in `public/app.js` (user `maquetaweb`; the password replaces the placeholder `PEGAR_AQUI_LA_CLAVE`). The repo is public, so that password is public: this was decided on purpose for the school expo. The Mosquitto user `maquetaweb` must have exactly this ACL: read `datos` and `estado`, readwrite `control`. Never put the `esp32` or `nodered` credentials in the repo.

With `npm start` (local or a Node host) `GET /api/config` can still override the URL, user and password through `MQTT_URL`, `MQTT_USUARIO`, `MQTT_CLAVE`; if it is missing or answers with something that is not JSON, `CONFIG.mqtt` is used.

`CONFIG.controlHabilitado` (default `true`) lets visitors switch to manual mode and move the gate. Set it to `false` for read-only: the controls are hidden, a "Solo lectura" chip shows in the bar and the page never publishes (`ordenar()` and `enviarControl()` return early).

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
3. **Incoming messages**: `alLlegar(topic, texto, retenido)` routes to `recibirDatos`, `recibirEstado`, `recibirControl`. Field parsing is tolerant (`leerRiesgo`, `leerBuzzer`, `leerCompuerta`). A retained `datos` message (sent by the broker on subscribe) is painted and enters the history, but only a live one sets `nodo.tVivo`, the proof that the node is publishing.
4. **Commands and confirmation**: no control assumes success. `ordenar()` marks the key pending and publishes; `revisarPendientes()` clears it when the node's data confirms; after `CONFIG.msConfirmacion` (3 s) `vencer()` reverts to the node's state, warns, and republishes the node's real state so the stale retained command can't flip the node into manual later. `valorMostrado()` decides what each control shows: the command while pending, otherwise the node. A command published by another client (Node-RED) moves the controls the same way.
5. **Connection**: the top bar has two pills. Broker (`enlace.broker`: connecting / connected / no connection) comes from the client events. Node comes from `estadoNodo()`: waiting / online / offline, or "sin verificar" while there is no broker. Online needs a live reading within `msVigilancia` (3 × `CONFIG.msPublicacion`). Offline comes from that watchdog or from the `estado` topic (LWT); the watchdog never closes the broker connection. `pintarConexion()` paints both pills (with the time of the last reading), the warning strip (`motivoBroker()` explains why there is no broker) and the card chips. Offline and no-broker both disable the controls and desaturate the data cards.
6. **Readings, status, control, history**: `animarLectura` (600 ms count-up), `pintarEstado`, `pintarControl`, Chart.js charts fed from the in-memory `hist` buffer (reduced to ≤ 300 points per series; the last hour is also kept in `localStorage`, inside `try/catch`).
7. **Transport**: `leerConfig().then(conectarMqtt)` (real, on page load) or `iniciarDemo()` (fake node). Both feed `alLlegar` and set `transporte.publicar`, so the demo exercises the same code paths. The real client resubscribes on every `connect` (`resubscribe: false`, clean session), logs every event with the `[MQTT]` prefix, and sets `transporte.reconectar(motivo, renovar)` (forced on `visibilitychange`, `pageshow` from the back/forward cache and the browser's `online`; with `renovar` it also replaces a connection that looks alive, because a locked phone can kill the socket silently: hidden more than `CONFIG.msOcultaReconectar`, or network change) and `transporte.vigilar` (run every second: forces a retry if none started two periods after a `close`).

### `escena.js` layout

1. **`CONFIG`**: every dimension (1 unit = 1 cm of model), position, color, camera framing and animation time. Geometry is derived from it, so change it here rather than hard-coding numbers in the builders. Positions are written "on the board" (`xb` from the left edge, the spring side; `zb` from the back edge) and `X(xb)`, `Z(zb)`, `V(xb, y, zb)` convert them to scene coordinates (origin at the board center, +Z toward the front). `y = 0` is the top face of the plywood.
2. **Calibration table**: `columnaDesdeNivel`, `yAguaCanal` and `distanciaSensor` map the river level (0–400 cm) to the water column in the container (0–`columnaMax` = 5 cm), with the firmware calibration (13.7 cm empty, 8.7 cm full).
3. **Scene construction**: IIFEs, grouped by section (base, block, river container, tub/pump/hose, gate and servo, bridge, sensors, farol, houses and trees, electronics under the board, cabling, water, labels and dimensions), add meshes to one `THREE.Group` per layer.
   - Build meshes with the `caja()` (scene coordinates), `bloque()` (limits in board cm), `cilindro()` and `losa()` (extruded outline in board cm, with holes) helpers, which set shadows and names. Wrap transparent parts (container, tub) in `aristas()` so their edges stay visible. Fiber, plywood, sand and the gate mesh use small canvas textures painted with the LCG.
   - `cotaTerreno(xb, zb)` gives the surface height (block top, front fiber strip, river floor, low zone, tub) so objects sit on it. `enZanja(xb, zb)` tells whether a point is inside the river container.
   - Randomness uses the seeded LCG `aleatorio()`, so the scene is identical on every load. Don't use `Math.random()` here.
   - The canvas is transparent (`alpha: true`, no scene background): the page gradient shows behind the model and is what the glass blurs. The "table" is a `ShadowMaterial` plane. The model's materials copy the real one (photos of the finished model); don't restyle them with the page palette.
4. **Water model**: `caudales()` gives the outflow (only with the gate open: the closed leaf reaches 10.1 cm and the column never passes 5.2); `actualizarAgua()` draws the river surface and volume, the sheet falling into the tub, and the tub level (the volume is conserved).
5. **`estado` + `window.Escena`**: the API `app.js` uses: `fijarNivel(pct)` (600 ms), `fijarCompuerta(abierta)` (500 ms), `fijarBuzzer(modo)` (amber halo if intermittent, terracotta if sounding; the buzzer is under the board, so the halo shows from the side), `fijarLed(color)` (the node's `led` field, `verde`/`amarillo`/`rojo`, lights the farol; off until the first reading), `fijarLluvia(pct)` (rain streaks), `mostrarComponentes(ver)`, `restablecerVista()`.
6. **Framing**: on desktop the canvas fills the window and the cards float over it, so `ajustarTamano()` measures `#zonaLibre` (the gap between the columns, above the history dock), shifts the camera's optical center there with `setViewOffset`, and `posicionInicio()` backs the camera off until the model fits. A `ResizeObserver` re-runs it; it stops re-framing once the user moves the camera (`estado.vistaPropia`) until "Vista" is pressed.
7. **`bucle()`**: the single `requestAnimationFrame` loop. Animations are timed from the `THREE.Clock` elapsed time, not by accumulating `dt`.

Labels, guide lines, dimensions, flow arrows and the ultrasonic cone are hidden by default and appear only with the "Componentes" button, so the model stays clean.

### Gotchas

- A range input commits its value with a `change` event that the browser fires AFTER `pointerup`. Never reset the slider's value inside a `pointerup` handler (the sliders silently stopped publishing because of that); the reset is deferred 80 ms.
- ACL denials: mqtt.js reports a denied subscription only as an error (`Subscribe error: …`) without saying which topic, so each topic is subscribed separately. A denied publish is dropped silently by Mosquitto (no error), which is why a missing write permission on `control` shows up as "El nodo no confirmó el cambio".
- mqtt.js 5 stops reconnecting for good after a CONNACK refusal (bad user/password, not authorized) unless `reconnectOnConnackError: true`. Keep that option. Browser WebSocket errors carry no `code`, so mqtt.js swallows them: a failed connection shows up only as `close`.
- The firmware lives outside this repo, at `OneDrive/Documentos/PlatformIO/Projects/Practica_x.2` (it has its own CLAUDE.md). Read `src/main.cpp` to confirm any field or timing; never open or print `include/secretos.h`.
- Thresholds are typed in several places. If the firmware's change, update `CONFIG.umbrales` in `app.js`, the slider marks (`--m`) and the cylinder's threshold lines in `index.html`. (v3.0 has no staff gauge, so `escena.js` no longer holds thresholds.)
- Palette colors are duplicated on purpose: tokens and `--rgb-*` triplets in `styles.css` (Chart.js reads them from there), and `CONFIG.colores.fondo/hueso/ledBajo/haloMedio/haloAlto` in `escena.js` (the farol LED uses the three `--risk-*` colors).
- The firmware has no pump or relay output; the model draws them (the wiring diagram puts the relay on D23) and the pump always "runs". The pin labels in `ETIQUETAS` follow the firmware (TRIG 33 / ECHO 32, AO 34 and 35 on ADC1, RGB 27/26/25, buzzer 14, servo 13).
- Respect `prefers-reduced-motion`: CSS animations are switched off globally, `animarLectura` paints directly, and the scene drops waves, rain and pulses (`mqQuieto`).
- When you add a card or change the layout, check the three breakpoints (≥ 1280 px floating cards, 768–1279 px two columns under the scene, < 768 px one column) and the low-height desktop rules; the right column must fit without scrolling at 1280 × 720.

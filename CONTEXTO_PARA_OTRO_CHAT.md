# Contexto: maqueta digital del río (tablero MQTT)

Documento de traspaso para continuar en otro chat, donde está la configuración del servidor. Fecha: 20 de octubre de 2026. No contiene contraseñas.

## 1. Qué es el proyecto

Página web con la maqueta 3D del río (v2.3, 45 × 25 × 20 cm) y un tablero de vidrio encima. Muestra lo que publica el nodo ESP32 de alerta temprana por nivel de río (Colima) y manda las mismas órdenes de modo manual que el dashboard de Node-RED.

- Repositorio: https://github.com/1Asem7/maqueta-rio-tablero (público). Rama principal: `main`.
- Stack: Node 18+, Express 5 (`server.js`), frontend sin compilar en `public/` (three.js r128, Chart.js 4, mqtt.js 5.16, Lucide), servidos desde `/vendor` con respaldo en CDN.
- Archivos: `server.js`, `public/index.html`, `public/app.js` (tablero y MQTT), `public/escena.js` (escena 3D), `public/styles.css`, `public/simulador.html` (copia antigua, sin uso), `CLAUDE.md` (guía técnica), `PENDIENTES_DESPLIEGUE.md` (pasos de servidor).
- Probar sin nodo: `/?demo=1` (nodo falso) o `/?demo=offline`. Solo esos dos valores activan el demo.

## 2. Contrato MQTT (no renombrar)

| Tópico | Uso en la página | Contenido |
|---|---|---|
| `ucol-eq1/rio/nodo1/datos` | suscribe, QoS 0, cada 1 s | JSON: `nivel_cm` (0–400), `lluvia_pct`, `humedad_pct`, `riesgo` (0/1/2), `buzzer`, `compuerta` (0/90), `modo`, más `distancia_cm`, `led`, `compuerta_modo` |
| `ucol-eq1/rio/nodo1/estado` | suscribe, QoS 1 | `online` retenido al conectar; `offline` como Last Will |
| `ucol-eq1/rio/nodo1/control` | suscribe y publica, QoS 1, retenido | `{"modo":"auto"}` o `{"modo":"manual","nivel_cm":..,"lluvia_pct":..,"humedad_pct":..,"compuerta":0\|90}` |

La página lee el riesgo, no lo calcula. Muestra todo en %, convierte a cm solo al publicar.

## 3. Infraestructura (según lo que me contaste)

- Broker: Mosquitto en un servidor Debian. Listener WebSocket expuesto por Cloudflare Tunnel como `wss://mqtt.eparedes.dev/mqtt` (el mismo que usa el ESP32). Cloudflare corta WebSockets con ~100 s sin tráfico.
- Comprobado desde fuera: ese `wss` responde y rechaza sin credenciales (`Not authorized`, código 5).
- Node-RED: `rio.eparedes.dev`, conectado al mismo broker con su propio usuario desde el servidor. Su dashboard funciona; hoy muestra "Nodo: offline" porque el ESP32 está apagado.
- Maqueta anterior: `rio2.stardest.com` (Express, `/api/salud` devuelve `servicio: "maqueta-rio-v2"`). No tocar.
- Plataforma de deploys: HubDeploy (`hub.eparedes.dev`). Proyecto `maqueta-rio-tablero` → `maquetaiot.eparedes.dev`.
  - **Tipo: Static site**, rama por defecto (`main`), directorio de publicación autodetectado (`public`).
  - Build #13 desplegó el commit `dc498f2` (con los cambios nuevos).

## 4. Trabajo hecho en este chat

Commit `d75ccba`, ya fusionado en `main` (PR #1, merge `dc498f2`).

**Causa encontrada del "Sin conexión al broker" permanente:** mqtt.js 5 deja de reintentar para siempre si el broker rechaza la conexión (usuario o clave incorrectos, no autorizado). Se corrigió con `reconnectOnConnackError: true`.

**Cambios en `public/app.js`, `index.html`, `styles.css`:**
- Conecta solo al cargar. Opciones: keepalive 30, reconnectPeriod 3000, connectTimeout 10000, clean true, clientId único por pestaña, `resubscribe: false` (suscribe a mano en cada `connect`).
- Reconexión forzada al volver a la pestaña (`visibilitychange`), al volver la red (`online`) y, de respaldo, si 6 s después de un `close` no empezó otro intento.
- Registro de eventos con prefijo `[MQTT]` en la consola.
- Barra superior con dos píldoras separadas: **Broker** (conectando / conectado / sin conexión) y **Nodo** (esperando datos / online · hora / offline desde hora / sin verificar). La franja roja explica el motivo cuando no hay broker.
- Vigilante: 3 publicaciones perdidas (3 s) = nodo offline, sin cerrar la conexión al broker (`CONFIG.msPublicacion`, `publicacionesPerdidas`).
- Mensajes retenidos: se pintan al conectar y entran al historial; solo una lectura en vivo marca al nodo como online. Sin datos, las tarjetas muestran "Esperando" y "–".
- Probado en local con un broker de prueba: 21 de 21 comprobaciones (retenidos, Last Will, vigilante, caída y regreso del broker, clave rechazada y corregida, corte de red, servidor sin credenciales) y `?demo=1` sin errores.

## 5. Estado actual y problema abierto

La página ya muestra la barra nueva, pero **no conecta al broker**, porque no tiene credenciales:

1. HubDeploy lo sirve como **sitio estático**: no ejecuta `server.js`, así que `/api/config` no existe y las variables de entorno no se usan. La página intenta conectar sin usuario ni clave y Mosquitto la rechaza.
2. No está confirmado que exista el usuario `maquetaweb` en Mosquitto con su ACL.
3. Ojo con el navegador: tras un deploy puede quedar en caché el CSS viejo (barra apilada y sin forma de píldora); se arregla con Ctrl+Shift+R.

Diferencia con Node-RED: allí el broker lo habla Node-RED desde el servidor (usuario `nodered`) y el navegador solo ve el resultado. La maqueta conecta desde el navegador, así que necesita su propio usuario.

## 6. Opciones para resolverlo

- **Opción 1 (simple):** crear el usuario `maquetaweb` en Mosquitto (ACL: leer `datos` y `estado`; leer y escribir `control`) y poner su clave en `CONFIG.mqtt` de `app.js`. Como el repositorio es público, la clave quedaría visible; el riesgo es que alguien mueva la compuerta. Conviene Cloudflare Access en `maquetaiot.eparedes.dev`. Nunca usar las claves de `esp32` o `nodered`.
- **Opción 2 (más segura):** que `server.js` se conecte al broker y retransmita a la página (SSE o WebSocket), sin exponer credenciales al navegador. Requiere hosting que ejecute Node (`npm ci --omit=dev` y `npm start`, con `MQTT_USUARIO`, `MQTT_CLAVE`, opcional `MQTT_URL`). Es un cambio mediano en `server.js` y `app.js`.
- **Opción 3:** cambiar el despliegue a app Node y usar el `/api/config` que ya existe. Mantiene las credenciales fuera del repo, pero siguen visibles para quien abra la página.

## 6. Pendientes, con tópico y ajuste concretos

**Firmware (ESP32, `src/main.cpp` del proyecto `Practica_x.2`; no está en este repo):**
- Tópico `ucol-eq1/rio/nodo1/estado`: Last Will `offline` con QoS 1 y retain = true; publicar `online` retenido en cada reconexión, no solo al arrancar.
- Tópico `ucol-eq1/rio/nodo1/datos`: retain = true es opcional (solo para ver la última lectura con el nodo apagado).
- Si el periodo de publicación deja de ser 1 s, actualizar `CONFIG.msPublicacion` en `app.js`.

**Mosquitto:**
- Crear usuario y ACL de la página (`mosquitto_passwd` y archivo ACL; ubicarlos con `grep -R "password_file\|acl_file" /etc/mosquitto/`).
- `persistence true` para que los retenidos sobrevivan reinicios.
- Si hay `max_keepalive`, que sea ≥ 30.

**Cloudflare:** Access solo en el subdominio de la página. No ponerlo en `mqtt.eparedes.dev`, porque bloquearía al ESP32 y al WebSocket del navegador.

## 7. Cómo verificar en producción

Con la consola del navegador abierta (F12, filtro `[MQTT]`). Esperado: `conectando a …` → `conectado al broker` → `mensaje retenido en …/estado`.
1. Apagar y prender el ESP32: "Nodo offline" en ~3 s (broker sigue "conectado"); online al publicar.
2. Pestaña 10 min en segundo plano: al volver, `reconexión forzada: la pestaña volvió al frente` si la conexión cayó.
3. Cortar el WiFi: franja "este equipo no tiene red"; al volver, `volvió la red` y reconecta.
4. Al terminar, dejar el modo en automático para que el control retenido quede en `{"modo":"auto"}`.

## 8. Decisiones que necesito del otro chat

- ¿Existe ya el usuario `maquetaweb` en Mosquitto? ¿Con qué ACL?
- ¿HubDeploy permite apps Node (comando de inicio y variables de entorno) o solo sitios estáticos?
- ¿Se prefiere la opción 1 (clave en el código, repo público) o la 2 (servidor como intermediario)?
- Configuración actual del túnel de Cloudflare: panel o `config.yml`, subdominios y si hay Access.

## 9. Cuidados

- No renombrar tópicos ni campos: los comparten el firmware y Node-RED.
- La página puede mover la compuerta y poner al nodo en modo manual, que manda sobre la alerta real. Por eso el ACL y Access no son opcionales.
- Nunca abrir ni mostrar `include/secretos.h` del firmware.
- Todo el código, comentarios y texto de interfaz va en español.

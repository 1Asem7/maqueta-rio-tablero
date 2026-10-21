# Maqueta digital del río: lo que falta para ponerla en el servidor

Documento de traspaso. El código está terminado; falta la parte del servidor (Mosquitto, servicio Node, Cloudflare). Fecha: 10 de octubre de 2026.

## 1. Qué es y en qué estado está

Es una página web con la maqueta 3D del río y un tablero encima. Se conecta **directo al broker MQTT** desde el navegador, en paralelo a Node-RED: muestra lo que publica el nodo ESP32 y le manda las mismas órdenes de modo manual que el dashboard de Node-RED. No reemplaza a Node-RED.

- Código: `C:\Proyectos\Maqueta_Rio_Interactiva` (en la PC, todavía **sin repositorio git**).
- Probado en navegador con un modo demo y contra un broker MQTT de prueba local: lecturas, modo manual, sliders, compuerta, nodo caído, orden sin confirmar y caída del broker funcionan.
- **No está probado contra el Mosquitto real**, porque la página aún no tiene usuario ahí. Ese es el único bloqueo para ver datos reales.

## 2. Hechos comprobados desde fuera del servidor

- `wss://mqtt.eparedes.dev/mqtt` responde y rechaza la conexión sin credenciales con `Connection refused: Not authorized` (código 5). La ruta WebSocket funciona; solo falta el usuario.
- `https://rio2.stardest.com` es hoy una aplicación Express (`/api/salud` devuelve `{"ok":true,"servicio":"maqueta-rio-v2",...}`) y es pública, sin Cloudflare Access. Es la maqueta anterior, la que solo simula.

> **Actualización (20 oct):** en producción la página es un **sitio estático en HubDeploy** (no corre `server.js`, no hay `/api/config` ni variables de entorno). El usuario `maquetaweb` y su clave se escriben en `CONFIG.mqtt` de `public/app.js`; el repositorio es público y se acepta. `CONFIG.controlHabilitado = false` deja la página en solo lectura. Las secciones de variables de entorno de abajo aplican solo si se corre con `npm start`.

## 3. Cómo corre la aplicación nueva

Un solo proceso Node, sin paso de compilación. Requiere Node 18 o superior.

```bash
npm ci --omit=dev     # obligatorio: las librerías se sirven desde node_modules
npm start             # node server.js
```

| Variable | Para qué | Valor por defecto |
|---|---|---|
| `PORT` | Puerto HTTP | `3000` |
| `HOST` | Interfaz donde escucha | `0.0.0.0` |
| `MQTT_URL` | Broker por WebSocket | `wss://mqtt.eparedes.dev/mqtt` |
| `MQTT_USUARIO` | Usuario de Mosquitto para la página | vacío |
| `MQTT_CLAVE` | Su contraseña | vacío |

Rutas útiles:

- `GET /api/salud` devuelve `{"estado":"ok","version":"2.3.0","activo":<segundos>}`. Sirve para distinguirla de la maqueta anterior, que responde con `servicio: "maqueta-rio-v2"`.
- `GET /api/config` devuelve la URL, el usuario y la clave de MQTT que la página usa para conectarse. **Cualquiera que pueda abrir la página puede leerlas.**
- `/?demo=1` muestra la página con un nodo simulado, sin tocar el broker.

## 4. Qué hace la página en el broker

Se conecta como cliente `maqueta-web-<aleatorio>`, con keepalive de 30 s y sesión limpia, y reintenta cada 3 s.

| Tópico | Uso | QoS | Contenido |
|---|---|---|---|
| `ucol-eq1/rio/nodo1/datos` | se suscribe | 0 | JSON del nodo, cada 1 s |
| `ucol-eq1/rio/nodo1/estado` | se suscribe | 1 | `online` retenido / `offline` (Last Will del nodo) |
| `ucol-eq1/rio/nodo1/control` | se suscribe y **publica** | 1, retenido | `{"modo":"auto"}` o `{"modo":"manual","nivel_cm":..,"lluvia_pct":..,"humedad_pct":..,"compuerta":0\|90}` |

Es el mismo JSON de control que arma Node-RED, con el mismo QoS y retención. Los nombres de tópicos y campos vienen del firmware y no se cambian.

## 5. Lo que falta, en orden

### Paso 1. Usuario de Mosquitto para la página (bloqueante)

Crear un usuario nuevo, solo para la web, en los mismos archivos de contraseñas y ACL donde ya están `esp32` y `nodered`. Para ubicarlos:

```bash
grep -R "password_file\|acl_file" /etc/mosquitto/
```

```bash
sudo mosquitto_passwd <archivo_de_contraseñas> maquetaweb
```

En el archivo ACL:

```
user maquetaweb
topic read ucol-eq1/rio/nodo1/datos
topic read ucol-eq1/rio/nodo1/estado
topic readwrite ucol-eq1/rio/nodo1/control
```

```bash
sudo systemctl reload mosquitto
```

El nombre `maquetaweb` es una sugerencia. No usar las contraseñas de `esp32` ni de `nodered`: la de la página queda a la vista de quien la abra.

### Paso 2. Probar desde la PC antes de subir nada

En PowerShell, dentro de la carpeta del proyecto:

```powershell
$env:MQTT_USUARIO = "maquetaweb"; $env:MQTT_CLAVE = "la-clave"; npm start
```

Abrir `http://localhost:3000` (sin `?demo=1`). Con el nodo encendido la barra debe decir "Broker conectado" y "Nodo online · <hora>", y mostrar las lecturas reales.

### Paso 3. Subir el proyecto a un repositorio

Falta `git init`, el primer commit y el push. El `.gitignore` ya excluye `node_modules/` y los `.env`.

### Paso 4. Levantarlo en el servidor Debian

En otro puerto, para que conviva con la maqueta anterior:

```bash
git clone <url-del-repo> /opt/maqueta-rio-tablero
cd /opt/maqueta-rio-tablero
npm ci --omit=dev
```

Dejarlo como servicio permanente con el mismo gestor que ya usa `maqueta-rio-v2`. Si es systemd, sirve este ejemplo:

```ini
# /etc/systemd/system/maqueta-rio-tablero.service
[Unit]
Description=Maqueta digital del rio (tablero MQTT)
After=network.target

[Service]
WorkingDirectory=/opt/maqueta-rio-tablero
ExecStart=/usr/bin/node server.js
EnvironmentFile=/etc/maqueta-rio-tablero.env
Restart=always

[Install]
WantedBy=multi-user.target
```

```
# /etc/maqueta-rio-tablero.env   (chmod 600)
PORT=3010
HOST=127.0.0.1
MQTT_USUARIO=maquetaweb
MQTT_CLAVE=la-clave
```

### Paso 5. Subdominio en el Cloudflare Tunnel

Agregar un nombre público que apunte a `http://localhost:3010` (o el puerto elegido), igual que los que ya existen para Node-RED y la maqueta anterior.

### Paso 6. Cloudflare Access en ese subdominio

Proteger **solo el subdominio de la página**. No poner Access en `mqtt.eparedes.dev`: el ESP32 y el WebSocket del navegador no podrían pasar.

## 6. Datos que hay que definir en el servidor

Esto no se puede saber desde la PC:

- Ruta de los archivos de contraseñas y ACL de Mosquitto.
- Con qué se mantiene corriendo `maqueta-rio-v2` (systemd, pm2 u otro) y en qué puerto.
- Un puerto libre para la aplicación nueva.
- Nombre del subdominio nuevo.
- Si el túnel se administra desde el panel de Cloudflare o con `config.yml`.
- URL del repositorio.

## 7. Cómo saber que quedó bien

1. `https://<subdominio>/api/salud` responde `{"estado":"ok",...}`.
2. La barra superior de la página dice "Broker conectado" y "Nodo online · <hora de la última lectura>".
3. Al activar el modo manual, el switch gira un instante y la tarjeta Estado cambia a "Manual".
4. El switch de modo manual en Node-RED se mueve solo, y al revés: un cambio en Node-RED mueve los controles de la página.
5. Al terminar las pruebas, dejar el modo en automático para que el control retenido quede en `{"modo":"auto"}`.

## 8. Si algo falla

| Lo que se ve | Causa probable |
|---|---|
| "Broker sin conexión" | La franja roja dice el motivo (clave rechazada, faltan `MQTT_USUARIO`/`MQTT_CLAVE`, `/api/config` no respondió, el broker no responde o el equipo no tiene red). Los detalles están en la consola del navegador, con el prefijo `[MQTT]`. |
| "Nodo offline" o "Nodo esperando datos…" mientras Node-RED sí recibe datos | Al usuario le falta permiso de lectura en `datos` o `estado`. Si el broker niega la suscripción, la franja y la consola lo dicen. |
| El switch queda pendiente y aparece "El nodo no confirmó el cambio" | Falta permiso de escritura en `control`. Mosquitto descarta la publicación sin avisar. |
| El subdominio muestra la maqueta anterior | El túnel apunta al puerto de `maqueta-rio-v2`. Comparar la respuesta de `/api/salud`. |

## 9. Cuidados

- La página permite mover la compuerta y pone al nodo en modo manual, que manda sobre la alerta real. Por eso el ACL y Access no son opcionales.
- No renombrar tópicos ni campos: los comparten el firmware y Node-RED.
- No tocar `rio2.stardest.com` ni el flujo de Node-RED; esta página funciona aparte.

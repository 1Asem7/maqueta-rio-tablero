# Pasos para poner la IA en vivo

Hay tres partes: un permiso en Mosquitto (una línea), publicar el tablero y correr el cuaderno en Colab.

## 1. Permiso en Mosquitto (en el servidor Debian)

El cuaderno de Colab entra al broker con el usuario `maquetaweb` (el mismo de la página). Hoy ese usuario sólo puede leer `datos` y `estado`, y leer y escribir en `control`. Le falta poder **publicar** y **leer** en el tópico nuevo `ucol-eq1/rio/nodo1/ia`.

**1.1 Entrar al servidor** (desde PowerShell en tu PC):

```powershell
ssh asem17@server
```
Abre una terminal en el servidor por Tailscale. Si `server` no resuelve, usa `ssh asem17@192.168.100.150` estando en tu red de casa. Debe aparecer el prompt `asem17@server:~$`.

**1.2 Ubicar el archivo de permisos (ACL):**

```bash
grep -R "acl_file" /etc/mosquitto/
```
Busca en la configuración de Mosquitto la línea que dice dónde está el archivo de permisos. Verás algo como `/etc/mosquitto/conf.d/xxx.conf:acl_file /etc/mosquitto/acl`. Lo que va después de `acl_file` es la ruta. En los comandos de abajo, cambia `/etc/mosquitto/acl` por tu ruta si es distinta.

**1.3 Hacer un respaldo:**

```bash
sudo cp /etc/mosquitto/acl /etc/mosquitto/acl.respaldo
```
Copia el archivo tal como está, por si hay que regresar. No muestra nada si sale bien.

**1.4 Agregar el permiso:**

```bash
sudo nano /etc/mosquitto/acl
```
Abre el archivo en el editor. Busca el bloque que empieza con `user maquetaweb` y agrega esta línea debajo de las que ya tiene:

```
topic readwrite ucol-eq1/rio/nodo1/ia
```
Y en el bloque `user nodered` agrega (para que Node-RED muestre el pronóstico):

```
topic read ucol-eq1/rio/nodo1/ia
```
Guarda con `Ctrl+O`, `Enter`, y sal con `Ctrl+X`. No cambies las demás líneas (las de `esp32` y `nodered` se quedan igual).

**1.5 Recargar Mosquitto:**

```bash
sudo systemctl reload mosquitto
systemctl status mosquitto --no-pager
```
El primero hace que Mosquitto vuelva a leer los permisos sin desconectar al ESP32. El segundo debe decir `active (running)` en verde. Si dice `failed`, regresa el respaldo con `sudo cp /etc/mosquitto/acl.respaldo /etc/mosquitto/acl` y vuelve a recargar.

> **Ojo:** la clave de `maquetaweb` ya es pública (está en `public/app.js` y el repositorio es público). Con este permiso, alguien con esa clave podría publicar un pronóstico falso en la tarjeta de la IA. No puede tocar la compuerta más de lo que ya podía. Si quieres más seguridad, crea un usuario aparte sólo para Colab (`sudo mosquitto_passwd /ruta/del/password_file colabia`) con `topic read ucol-eq1/rio/nodo1/datos` y `topic write ucol-eq1/rio/nodo1/ia`, deja `maquetaweb` sólo con `topic read ucol-eq1/rio/nodo1/ia` y cambia `USUARIO = 'colabia'` en la celda 9.1 del cuaderno.

## 2. Publicar el tablero

Los cambios están en la rama `ia-colab` de `C:\Users\MANEP\MaquetaRio\maqueta-rio-tablero` (todavía sin subir). En PowerShell:

```powershell
cd C:\Users\MANEP\MaquetaRio\maqueta-rio-tablero
git push -u origin ia-colab
```
Sube la rama a GitHub. Luego, en github.com/1Asem7/maqueta-rio-tablero, abre el Pull Request de `ia-colab` y dale **Merge**. HubDeploy despliega `main`: si no se redespliega solo, lanza un deploy desde hub.eparedes.dev. En la página aparece la tarjeta **Pronóstico IA** debajo de Lluvia y humedad, con el texto "Esperando a la IA".

Para revisarla antes, sin el nodo: `npm start` y abre `http://localhost:3000/?demo=1`.

## 2b. Tarjeta de la IA en Node-RED

El flujo está en `ia/node-red_pronostico_ia.json`. Ya trae los IDs de tu pestaña "Nodo rio" y de tu broker "Mosquitto local (nodered)", así que no hay que configurar nada más.

1. Abre `https://rio.eparedes.dev` (el editor de Node-RED, no `/ui`) y entra a la pestaña **Nodo rio (wss)**.
2. Menú ☰ (arriba a la derecha) → **Import** → **select a file to import** → elige `node-red_pronostico_ia.json` → **Import**. Suelta los nodos en un espacio libre.
3. Si aparece "Some nodes already exist", elige **Import copy** únicamente si se duplicó algo tuyo. Lo normal es que no aparezca.
4. Presiona **Deploy**.
5. En `https://rio.eparedes.dev/ui` aparece una tarjeta nueva, **Pronóstico IA**, debajo de Estado, con "Esperando". Cuando corra Colab cambia cada segundo.

Si la tarjeta se queda en "Esperando" mientras Colab sí publica, falta la línea `topic read ucol-eq1/rio/nodo1/ia` de `nodered` (paso 1.4).

## 3. Correr la IA en Colab

1. Abre `ia/Proyecto_IA_Nodo_Rio.ipynb` en Google Colab (Archivo → Subir cuaderno, o desde tu Drive).
2. **Entorno de ejecución → Ejecutar todas** (tarda unos 2 minutos). Entrena los modelos y deja todo listo. La sección 9.3 dice `CONECTAR = False`.
3. En la celda **9.1** cambia `CONECTAR = False` por `CONECTAR = True` y ejecútala. Te pide la clave de `maquetaweb`; escríbela y presiona Enter (no se guarda en el cuaderno).
4. Ejecuta la celda **9.3**. Debe decir `Conectado al broker` y, cada 5 s, las últimas predicciones. Se queda escuchando 30 minutos (`MINUTOS` en la 9.1). Para detenerla usa el botón de detener de la celda.
5. Abre maquetaiot.eparedes.dev: la tarjeta **Pronóstico IA** se llena cada segundo.

Deja la pestaña de Colab abierta durante la demostración: si se queda inactiva mucho tiempo, Colab la desconecta.

## 4. Demostración

1. En el tablero (o en Node-RED) pasa el nodo a **Manual**.
2. Presiona **Simular crecida** (abajo de Control). En 45 s llueve, se moja el suelo y sube el río hasta 90 %.
3. Mira la tarjeta **Pronóstico IA**: marca **ALTO** unos 10 s antes que el riesgo de las reglas, con el aviso "Alerta anticipada".
4. Al terminar, regresa el modo a **Automático** para que el control retenido quede en `{"modo":"auto"}`.

Con el nodo en automático, la IA predice con los sensores reales. La sección 9.4 guarda esas lecturas en `lecturas_reales.csv`. Si las subes a Colab y quitas los `#` de la celda de la sección 2.3, se puede volver a entrenar con datos de la maqueta.

## Si algo falla

| Lo que se ve | Causa probable |
|---|---|
| Colab: `El broker rechazo la conexion` | Clave mal escrita en la 9.1 |
| Colab conecta, pero "Predicciones publicadas: 0" | El nodo está apagado o no está publicando |
| La tarjeta sigue en "Esperando a la IA" mientras Colab publica | Falta el paso 1 (Mosquitto descarta sin avisar la publicación de un tópico sin permiso) |
| "La IA dejó de publicar" | Se detuvo la celda 9.3 o Colab se desconectó: vuelve a ejecutar 9.1 y 9.3 |

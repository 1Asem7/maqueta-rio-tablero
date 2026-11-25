# Pasos para poner la IA en vivo (con modo IA)

El nodo tiene 3 modos, que se eligen en el tablero (maquetaiot) o en Node-RED:

| Modo | Datos | Quién decide el riesgo | Compuerta |
|---|---|---|---|
| **Automático** | Sensores | Reglas del ESP32 | Abre en ALTO |
| **Manual** | Sliders del tablero | Reglas del ESP32 | La mueve el switch |
| **IA** | Sensores (o *Simular crecida*) | Modelo de Colab (XGBoost) | Abre si la IA dice ALTO |

En modo IA el ESP32 tiene dos protecciones:
- Si no llega un pronóstico en 5 s (Colab apagado o sin internet), deciden las reglas (respaldo).
- Si el nivel pasa de 250 cm, el riesgo es ALTO aunque la IA diga otra cosa (seguridad).

Además, en modo IA la compuerta se queda abierta al menos 15 s desde el último ALTO, para que no abra y cierre si la IA cambia de opinión.

## 1. Permiso en Mosquitto (servidor Debian)

`maquetaweb` ya tiene `topic readwrite ucol-eq1/rio/nodo1/ia` (hecho el 25 nov). Falta que el **ESP32** pueda leer el pronóstico:

```bash
sudo cp /etc/mosquitto/acl /etc/mosquitto/acl.respaldo
sudo nano /etc/mosquitto/acl
```
Debajo de `topic read ucol-eq1/rio/nodo1/control` (bloque `user esp32`) agrega:
```
topic read ucol-eq1/rio/nodo1/ia
```
Guarda (`Ctrl+O`, Enter, `Ctrl+X`) y recarga:
```bash
sudo systemctl reload mosquitto
systemctl status mosquitto --no-pager
```
Debe decir `active (running)`. Si dice `failed`: `sudo cp /etc/mosquitto/acl.respaldo /etc/mosquitto/acl` y recarga otra vez.

Sin este permiso el ESP32 en modo IA nunca recibe pronósticos y se queda en "respaldo" (deciden las reglas).

`nodered` no necesita cambios: su `readwrite ucol-eq1/rio/#` ya cubre `ia`.

## 2. Firmware del ESP32

El `main.cpp` nuevo ya está en `Practica_x.2\src\main.cpp` (el anterior quedó en `respaldo\main_antes_modo_ia.cpp`). Compila y sube desde PowerShell, en la carpeta del proyecto:

```powershell
cd "C:\Users\MANEP\OneDrive\Documentos\PlatformIO\Projects\Practica_x.2"
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run
```
Debe terminar en `[SUCCESS]`. Luego, con la placa conectada:
```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -t upload
```
Cuando salga `Connecting....`, mantén BOOT, toca EN y suelta BOOT cuando empiece `Writing at ...`. Al final toca EN.

En el monitor serie (`pio device monitor`) verás `>>> Modo IA: ...` al elegir el modo IA y `>>> IA: llegan pronosticos, decide el modelo` cuando Colab publica.

## 3. Tablero (maquetaiot)

Los cambios están en la rama `modo-ia`. Abre el Pull Request en GitHub, dale **Merge** y espera el deploy de HubDeploy (o lánzalo desde hub.eparedes.dev). Recarga con `Ctrl+Shift+R`.

En **Control** aparece el selector **Auto / Manual / IA**. Para revisarlo sin el nodo: `npm start` y abre `http://localhost:3000/?demo=1` (o `?demo=sinia` para ver el respaldo sin IA).

## 4. Node-RED

Importa `ia/node-red_pronostico_ia.json` en el editor (`https://rio.eparedes.dev`, pestaña **Nodo rio (wss)**): menú ☰ → **Import** → elige el archivo → **Import** → **Deploy**.

El archivo usa los IDs de tu flujo del servidor (pestaña `83b62bfcec6df08a`, broker `4f9f99e7d18c27fc`), así que se conecta con el mismo usuario `nodered` y no cambia ningún nodo que ya tenías: solo agrega 12 nodos.

Agrega en `/ui` la tarjeta **Pronóstico IA** con el modo del nodo, quién decide, y dos botones: **Modo IA** y **Modo automático**. El modo manual se sigue usando con el switch de "Control manual". El texto "Modo:" del grupo Estado sigue diciendo AUTOMATICO cuando el nodo está en IA (ese nodo no se tocó); el modo real lo dice la tarjeta Pronóstico IA.

## 5. Colab

Abre el cuaderno nuevo desde tu Drive: **Proyecto_IA_Nodo_Rio.ipynb** (el anterior quedó como "Proyecto_IA_Nodo_Rio (anterior, sin modo IA)").

1. **Entorno de ejecución → Ejecutar todas** con `CONECTAR = False`.
2. En la celda **9.1** pon `CONECTAR = True`, ejecútala y escribe la clave de `maquetaweb`.
3. Ejecuta la **9.3**: debe decir `Conectado al broker` y mostrar las predicciones con la columna **decide**.

## 6. Demostración

1. Con el nodo encendido y Colab corriendo (9.3), elige **IA** en el tablero.
2. La tarjeta Pronóstico IA dice **Al mando** y la nota bajo el riesgo dice **Decidido por la IA**.
3. Presiona **Simular crecida**: la IA marca ALTO y la compuerta abre antes de que las reglas lleguen a ALTO (la nota muestra "reglas: MEDIO").
4. Al terminar la crecida el nodo vuelve a sus sensores, sigue en modo IA.
5. Para mostrar el respaldo: detén la celda 9.3. A los 5 s la nota dice **Sin pronóstico: deciden las reglas**.
6. Al final regresa a **Auto** para que el control retenido quede en `{"modo":"auto"}`.

## Si algo falla

| Lo que se ve | Causa probable |
|---|---|
| En modo IA siempre "Sin pronóstico: deciden las reglas" aunque Colab publica | Falta el permiso del paso 1 para `esp32` |
| Al elegir IA sale "El nodo no confirmó el cambio" | El ESP32 tiene el firmware anterior (paso 2) |
| Colab: `El broker rechazo la conexion` | Clave mal escrita en la 9.1 |
| Colab conecta pero "Predicciones publicadas: 0" | El nodo está apagado o no publica |
| La tarjeta dice "La IA dejó de publicar" | Se detuvo la 9.3 o Colab se desconectó: vuelve a ejecutar 9.1 y 9.3 |

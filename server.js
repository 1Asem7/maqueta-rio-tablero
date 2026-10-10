"use strict";
/* ============================================================================
   SERVIDOR ESTÁTICO · MAQUETA DIGITAL DEL RÍO
   Sirve public/ y las librerías locales (three.js r128, Chart.js, mqtt.js y
   Lucide) en /vendor.
   Variables de entorno: PORT (3000), HOST (0.0.0.0) y, para la conexión de la
   página al broker, MQTT_URL, MQTT_USUARIO y MQTT_CLAVE.
   ============================================================================ */
const path = require("path");
const express = require("express");

const PUERTO = Number(process.env.PORT) || 3000;
const ANFITRION = process.env.HOST || "0.0.0.0";

const app = express();
app.disable("x-powered-by");

// ===== SALUD =====
app.get("/api/salud", (peticion, respuesta) => {
  respuesta.set("Cache-Control", "no-store");
  respuesta.json({ estado: "ok", version: require("./package.json").version, activo: process.uptime() });
});

// ===== CONEXIÓN MQTT DE LA PÁGINA =====
// Las credenciales del usuario web de Mosquitto se dan por variables de entorno
// para no subirlas al repositorio. Quien abra la página las puede ver igual:
// por eso ese usuario sólo debe poder escribir en el tópico de control.
app.get("/api/config", (peticion, respuesta) => {
  const mqtt = {};
  if (process.env.MQTT_URL) mqtt.url = process.env.MQTT_URL;
  if (process.env.MQTT_USUARIO) mqtt.usuario = process.env.MQTT_USUARIO;
  if (process.env.MQTT_CLAVE) mqtt.clave = process.env.MQTT_CLAVE;
  respuesta.set("Cache-Control", "no-store");
  respuesta.json({ mqtt });
});

// ===== LIBRERÍAS LOCALES =====
// Las versiones están fijadas en package.json, así que estos archivos no cambian
const VENDOR = {
  three: ["three"],
  chartjs: ["chart.js", "dist"],
  mqtt: ["mqtt", "dist"],
  lucide: ["lucide", "dist", "umd"]
};
for (const [ruta, carpeta] of Object.entries(VENDOR)) {
  app.use("/vendor/" + ruta, express.static(path.join(__dirname, "node_modules", ...carpeta), {
    maxAge: "30d",
    immutable: true,
    index: false
  }));
}

// ===== APLICACIÓN =====
// Sin caché larga para que cada despliegue se vea de inmediato
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(respuesta) {
    respuesta.set("Cache-Control", "no-cache");
  }
}));

app.use((peticion, respuesta) => {
  respuesta.status(404).type("text/plain").send("No encontrado");
});

const servidor = app.listen(PUERTO, ANFITRION, () => {
  console.log(`Maqueta v2.3 en http://${ANFITRION === "0.0.0.0" ? "localhost" : ANFITRION}:${PUERTO}`);
});

// ===== APAGADO ORDENADO =====
// Los orquestadores (Docker, PM2, systemd, PaaS) envían SIGTERM al redesplegar
function apagar(senal) {
  console.log(`${senal} recibido: cerrando el servidor`);
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));

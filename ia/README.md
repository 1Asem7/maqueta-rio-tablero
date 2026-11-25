# IA del Nodo Río (Google Colab)

Todo lo de la IA vive en un solo cuaderno: `Proyecto_IA_Nodo_Rio.ipynb`.

| Sección | Qué hace |
|---|---|
| 1–4 | Genera datos simulados de 200 tormentas, análisis exploratorio, características y división por tormentas |
| 5–6 | Entrena 6 modelos (regresión logística, KNN, Naive Bayes, árbol, Random Forest, XGBoost), matrices de confusión, ROC, validación cruzada y comparación contra las reglas del nodo |
| 7–8 | Predicción con una lectura nueva y guardado del modelo |
| 9 | **IA en vivo**: se conecta al broker, escucha `ucol-eq1/rio/nodo1/datos`, predice el riesgo en 15 s y publica en `ucol-eq1/rio/nodo1/ia`. La 9.2 compara cuándo abre la compuerta en modo IA contra modo automático |
| 10 | Conclusión |

Resultado (ya ejecutado): el mejor modelo es XGBoost, con F1 macro 0.922 y recall de ALTO 0.917. Avisa ALTO con una mediana de 13 s antes que las reglas.

El nodo tiene 3 modos: **Automático** (deciden las reglas), **Manual** (valores y compuerta desde el tablero) e **IA**. En modo IA el ESP32 usa el pronóstico de este cuaderno para el LED, el buzzer y la compuerta; si no le llega un pronóstico en 5 s vuelven las reglas, y arriba de 250 cm el riesgo es alto aunque la IA diga otra cosa. En la tormenta de prueba la compuerta abre 27 s antes que con las reglas.

El tablero (`public/ia.js`, tarjeta **Pronóstico IA**) muestra el pronóstico y si la IA está al mando.

Los pasos para dejarlo funcionando están en `PASOS_IA.md`.

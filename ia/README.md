# IA del Nodo Río (Google Colab)

Todo lo de la IA vive en un solo cuaderno: `Proyecto_IA_Nodo_Rio.ipynb`.

| Sección | Qué hace |
|---|---|
| 1–4 | Genera datos simulados de 200 tormentas, análisis exploratorio, características y división por tormentas |
| 5–6 | Entrena 6 modelos (regresión logística, KNN, Naive Bayes, árbol, Random Forest, XGBoost), matrices de confusión, ROC, validación cruzada y comparación contra las reglas del nodo |
| 7–8 | Predicción con una lectura nueva y guardado del modelo |
| 9 | **IA en vivo**: se conecta al broker, escucha `ucol-eq1/rio/nodo1/datos`, predice el riesgo en 15 s y publica en `ucol-eq1/rio/nodo1/ia` |
| 10 | Conclusión |

Resultado (ya ejecutado): el mejor modelo es XGBoost, con F1 macro 0.922 y recall de ALTO 0.917. Avisa ALTO con una mediana de 13 s antes que las reglas.

El tablero (`public/ia.js`, tarjeta **Pronóstico IA**) sólo muestra lo que publica el cuaderno. La IA no controla actuadores: el ESP32 sigue con su alerta local.

Los pasos para dejarlo funcionando están en `PASOS_IA.md`.

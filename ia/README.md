# IA del Nodo Río (Google Colab)

Todo lo de la IA vive en un solo cuaderno: `Proyecto_IA_Nodo_Rio.ipynb`. Entrena con `dataset_nodo_rio.csv` (1,808 lecturas de 12 tormentas simuladas, con algunos nulos y duplicados para limpiar), que se crea con `python crear_dataset.py`. El cuaderno lo lee del archivo si lo subes a Colab o, si no, del repositorio en GitHub.

| Sección | Qué hace |
|---|---|
| 1–4 | Carga el dataset, análisis exploratorio, limpieza (duplicados y nulos), características y división por tormentas |
| 5–6 | Entrena 6 modelos (regresión logística, KNN, Naive Bayes, árbol, Random Forest, XGBoost), matrices de confusión, ROC, validación cruzada y comparación contra las reglas del nodo |
| 7–8 | Predicción con una lectura nueva y guardado del modelo |
| 9 | **IA en vivo**: se conecta al broker, escucha `ucol-eq1/rio/nodo1/datos`, predice el riesgo en 15 s y publica en `ucol-eq1/rio/nodo1/ia`. La 9.2 compara cuándo abre la compuerta en modo IA contra modo automático |
| 10 | Conclusión |

Resultado (ya ejecutado): el mejor modelo en la prueba es XGBoost, con F1 macro 0.936 y recall de ALTO 0.857 (abajo de la meta de 0.90). Con solo 12 tormentas los resultados varían mucho: en validación cruzada XGBoost baja a 0.813 ± 0.155.

El nodo tiene 3 modos: **Automático** (deciden las reglas), **Manual** (valores y compuerta desde el tablero) e **IA**. En modo IA el ESP32 usa el pronóstico de este cuaderno para el LED, el buzzer y la compuerta; si no le llega un pronóstico en 5 s vuelven las reglas, y arriba de 250 cm el riesgo es alto aunque la IA diga otra cosa. En la tormenta de prueba de la sección 9.2 la compuerta abre 13 s antes que con las reglas.

El tablero (`public/ia.js`, tarjeta **Pronóstico IA**) muestra el pronóstico y si la IA está al mando.

Los pasos para dejarlo funcionando están en `PASOS_IA.md`.

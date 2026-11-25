# Crea dataset_nodo_rio.csv para el cuaderno Proyecto_IA_Nodo_Rio.ipynb
# Simulador igual al de la seccion 2.2 del cuaderno; 12 tormentas de 2.5 min,
# con algunas lecturas vacias (nulos) y mensajes repetidos, como en un nodo real.
# Uso: python crear_dataset.py

import numpy as np, pandas as pd
def clasificar_riesgo(nivel, lluvia, humedad):
    if nivel > 250: return 2
    if nivel > 200 and lluvia > 70: return 2
    if nivel >= 150: return 1
    if lluvia > 60 and humedad > 80: return 1
    return 0
DURACION_S = 150
def una_tormenta(num, rng):
    pico = rng.choice([0, rng.uniform(20, 60), rng.uniform(60, 100)], p=[0.1, 0.3, 0.6])
    inicio = rng.integers(3, 30)
    subida = rng.integers(8, 30)
    meseta = rng.integers(10, 60)
    bajada = rng.integers(10, 40)
    retraso = rng.integers(4, 11)
    k = rng.uniform(0.05, 0.14)
    nivel = rng.uniform(10, 140)
    humedad = rng.uniform(10, 70)
    base = nivel * rng.uniform(0.6, 1.0)
    abierta = False
    lluvias, filas = [], []
    for t in range(DURACION_S):
        if t < inicio: ll = 0.0
        elif t < inicio + subida: ll = pico * (t - inicio) / subida
        elif t < inicio + subida + meseta: ll = pico
        elif t < inicio + subida + meseta + bajada: ll = pico * (1 - (t - inicio - subida - meseta) / bajada)
        else: ll = 0.0
        lluvias.append(ll)
        humedad = humedad + 0.024 * ll * (1 - humedad / 100) - 0.02
        humedad = min(max(humedad, 0), 100)
        ll_r = lluvias[t - retraso] if t >= retraso else 0.0
        entrada = 3.0 * k * ll_r * (0.3 + 0.7 * humedad / 100)
        salida = 0.02 * max(nivel - base, 0)
        if nivel > 320: salida += 0.15 * (nivel - 320)
        if abierta: salida += 0.02 * nivel
        nivel = min(max(nivel + entrada - salida, 0), 400)
        n = min(max(nivel + rng.normal(0, 3), 0), 400)
        l = min(max(ll + rng.normal(0, 2), 0), 100)
        h = min(max(humedad + rng.normal(0, 1.5), 0), 100)
        if clasificar_riesgo(n, l, h) == 2: abierta = True
        elif nivel < 150: abierta = False
        filas.append([num, t, round(n, 1), round(l, 1), round(h, 1)])
    return filas
def generar(n, semilla):
    rng = np.random.default_rng(semilla); filas = []
    for i in range(n): filas += una_tormenta(i, rng)
    return pd.DataFrame(filas, columns=['tormenta', 'segundo', 'nivel_cm', 'lluvia_pct', 'humedad_pct'])


SEMILLA = 42
df = generar(12, SEMILLA)

# Fecha y hora de cada lectura: una tormenta por dia, desde el 10 de noviembre
inicio = pd.Timestamp('2026-11-10 14:00:00')
df['fecha_hora'] = [inicio + pd.Timedelta(days=int(t)) + pd.Timedelta(seconds=int(s))
                    for t, s in zip(df['tormenta'], df['segundo'])]
df = df[['fecha_hora', 'tormenta', 'segundo', 'nivel_cm', 'lluvia_pct', 'humedad_pct']]

rng = np.random.default_rng(SEMILLA + 1)
# Nulos: 18 lecturas donde un sensor no respondio (nunca en el segundo 0)
candidatas = df.index[df['segundo'] > 0]
for i in rng.choice(candidatas, size=18, replace=False):
    df.loc[i, rng.choice(['nivel_cm', 'lluvia_pct', 'humedad_pct'])] = np.nan
# Duplicados: 8 mensajes que llegaron dos veces
repetidas = df.loc[rng.choice(df.index, size=8, replace=False)]
df = pd.concat([df, repetidas]).sort_values(['tormenta', 'segundo'], kind='stable').reset_index(drop=True)

df.to_csv('dataset_nodo_rio.csv', index=False)
print(df.shape, df.isnull().sum().sum(), df.duplicated().sum())

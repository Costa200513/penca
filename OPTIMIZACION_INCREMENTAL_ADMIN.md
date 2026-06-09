# Optimización incremental para admin

Esta versión agrega una mejora fuerte sobre la optimización anterior.

## Problema que corrige

El admin carga los resultados de forma inmediata cuando termina cada partido.
Antes, aunque los datos quedaban en caché, el primer recálculo podía leer todas las predicciones de la etapa.

Con 150 usuarios y 72 partidos de fase de grupos:

```txt
150 usuarios × 72 partidos = 10.800 predicciones
```

Un recálculo completo podía leer:

```txt
150 users + 10.800 predictions = 10.950 lecturas
```

## Nueva solución

Cuando el admin guarda o edita un resultado, ahora se recalcula el ranking de forma incremental:

```txt
1 partido terminado = leer solo predictions donde matchId == ese partido
```

Con 150 usuarios:

```txt
1 resultado = hasta 150 lecturas de predicciones
```

No se leen las 10.800 predicciones de toda la fase de grupos.

## Casos cubiertos

- Admin guarda resultado.
- Admin edita resultado.
- Admin cambia equipos de un partido ya jugado.
- Admin define campeón real.
- Admin activa/desactiva usuario.

## Funciones nuevas

```js
loadPredictionsForMatch(matchId)
loadPredictionsForUser(uid)
updateLeaderboardForMatch(oldMatch, newMatch)
updateLeaderboardForUser(uid)
updateLeaderboardForChampionChange(previousChampionId, nextChampionId)
saveCurrentLeaderboard(individualRows)
```

## Impacto estimado con 150 usuarios

### Día máximo de fase de grupos: 8 partidos

Antes, si se hacía recálculo completo varias veces:

```txt
10.950 lecturas × 8 resultados = 87.600 lecturas
```

Ahora:

```txt
150 predicciones por partido × 8 partidos = 1.200 lecturas
```

Más escrituras:

```txt
8 escrituras en matches
8 escrituras en leaderboards/current
```

## Limitación

Sigue sin usar Cloud Functions. El cálculo incremental lo hace el frontend admin.
Esto mantiene compatibilidad con GitHub Pages y Firebase Web, pero depende de que el admin cargue resultados desde la app.


## Correcciones posteriores

Ver `CORRECCIONES_SEGURIDAD_CAMPEON.md`.

# Optimización Firebase - Admin y Usuarios

Esta versión parte de la optimización con `leaderboards/current` y agrega una optimización más fuerte para el panel admin y la gestión de usuarios.

## Objetivo

Reducir lecturas masivas de Firestore, especialmente en este escenario:

- 150 participantes.
- 72 partidos de fase de grupos pronosticables inicialmente.
- Hasta 10.800 predicciones en fase de grupos.
- Admin cargando varios resultados en una misma sesión.

## Cambios principales

### 1. El admin ya no carga `users` y `predictions` completo al entrar

Antes, al entrar como admin, `loadData()` terminaba cargando:

```txt
users completo
predictions completo
```

Ahora esos datos se cargan bajo demanda:

```txt
users completo       -> solo al entrar a Gestión usuarios o al recalcular ranking
predictions completo -> solo al recalcular ranking
```

### 2. Datos admin separados

Se agregaron funciones separadas:

```js
ensureAdminUsersLoaded(force = false)
ensureAdminPredictionsLoaded(force = false)
ensureAdminDataLoaded(force = false)
refreshAdminData(force = true)
loadUsersAdminSection(force = false)
```

Esto permite cargar solo lo necesario.

### 3. Recalcular ranking ya no relee todo cada vez

Antes, cada `recalculateLeaderboards()` hacía:

```js
await ensureAdminDataLoaded(true)
```

Eso forzaba leer todos los usuarios y todas las predicciones en cada resultado.

Ahora hace:

```js
await ensureAdminUsersLoaded(forceUsers)
await ensureAdminPredictionsLoaded(forcePredictions)
```

Por defecto no fuerza recarga. En una sesión admin:

```txt
Primer resultado cargado:
  lee users + predictions una vez.

Resultados siguientes:
  usa caché local y solo escribe leaderboards/current.
```

### 4. Gestión de usuarios bajo demanda

La sección `Gestión usuarios` ya no intenta renderizar la lista completa sin necesidad.

Al entrar, carga `users` una vez. Los conteos de pronósticos se toman desde:

```txt
leaderboards/current.individual[].predictionsCount
```

Si el admin ya cargó predicciones en esa sesión, usa la caché local.

### 5. Botones manuales para casos especiales

Se agregaron botones pequeños en admin:

```txt
Actualizar datos y ranking
Actualizar usuarios
```

Sirven si varios usuarios hicieron cambios mientras el admin ya estaba conectado.

Esto evita releer datos en cada acción, pero mantiene una forma manual de refrescar.

## Simulación con 150 usuarios

Supuestos:

```txt
150 usuarios
72 partidos de fase de grupos pronosticables
10.800 predicciones posibles en fase de grupos
104 partidos totales
```

### Antes de esta mejora admin

Cada resultado cargado podía hacer aproximadamente:

```txt
users:       150 lecturas
predictions: 10.800 lecturas
total:       10.950 lecturas por resultado
```

Si el admin cargaba 5 resultados:

```txt
10.950 × 5 = 54.750 lecturas
```

### Ahora

Primera acción que requiere ranking:

```txt
users:       150 lecturas
predictions: 10.800 lecturas
total:       10.950 lecturas
```

Siguientes resultados en la misma sesión:

```txt
0 lecturas masivas extra
1 escritura en matches
1 escritura en leaderboards/current
```

Cinco resultados en una sesión:

```txt
Antes: 54.750 lecturas aprox.
Ahora: 10.950 lecturas aprox.
Ahorro: ~80%
```

## Usuario común

Se mantiene la optimización anterior:

El usuario común NO lee:

```txt
users completo
predictions completo
```

Carga solamente:

```txt
users/{uid}
sus propias predictions
matches
teams
phases
settings/tournament
leaderboards/current
```

## Colecciones nuevas

Se mantiene:

```txt
leaderboards/current
```

No se agregaron colecciones nuevas para esta mejora.

## Escrituras nuevas

No se agregan escrituras nuevas obligatorias.

Se mantiene la escritura del ranking precomputado:

```txt
leaderboards/current
```

cuando el admin recalcula por resultado, campeón real o activación/desactivación.

## Limitación técnica

Como no se usan Cloud Functions, el ranking depende del frontend admin.

Para mantener el consumo bajo:

- El admin reutiliza datos cargados en memoria.
- Si quiere asegurarse de incluir cambios muy recientes de usuarios mientras ya estaba conectado, debe tocar `Actualizar datos y ranking`.

Esto es una solución intermedia pensada para GitHub Pages + Firebase Web, sin Cloud Functions obligatorias.

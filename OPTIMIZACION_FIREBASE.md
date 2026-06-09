# Optimización Firebase / Firestore

## Objetivo
Reducir lecturas y escrituras innecesarias en Firestore sin cambiar la arquitectura base de GitHub Pages + Firebase Web.

## Cambios principales

### 1. Carga inicial separada
`loadData()` ahora delega en:

- `loadCoreData()`
- `ensureAdminDataLoaded()`
- `recalculateLeaderboards()`

El usuario normal ya no carga `users` completo ni `predictions` completo.

### 2. Listeners mínimos
Usuario normal escucha:

- `matches`
- `settings/tournament`
- `users/{uid}`
- solo sus propios `predictions` con `where("uid", "==", currentUser.uid)`
- `leaderboards/current`

Ya no escucha:

- `users` completo
- `predictions` completo

### 3. Ranking precomputado
Se agregó la colección:

- `leaderboards/current`

Estructura:

```js
{
  individual: [],
  specialties: [],
  updatedAt
}
```

El ranking se recalcula desde el frontend admin cuando:

- el admin guarda un resultado;
- el admin cambia equipos de un partido ya jugado;
- el admin define campeón real;
- el admin activa/desactiva usuarios;
- el admin entra y el leaderboard está vacío.

### 4. Guardado de pronósticos optimizado
Se eliminó la lectura extra:

```js
await getDoc(predictionRef)
```

Ahora se usa el estado local para decidir entre `updateDoc()` y `setDoc()`.

Después de guardar una predicción no se ejecuta `loadData()` completo.

### 5. Guardados admin optimizados
Después de guardar resultados, horarios o equipos ya no se recarga toda la base con `loadData()`.

Se actualiza el partido afectado localmente y solo se recalcula ranking cuando corresponde.

## Firestore Rules
Publicar el archivo:

- `firestore-rules-finales.txt`

Incluye reglas para:

- `leaderboards/{docId}`: lectura para usuarios activos, escritura solo admin.
- `predictions`: usuarios comunes solo leen sus propios pronósticos; admin puede leer todos.
- `users`: usuario común solo lee su propio documento; admin puede leer todos.

## Limitación pendiente
Sin Cloud Functions, el ranking precomputado depende de que el admin lo recalculé desde la app cuando ocurren eventos relevantes. La versión implementada lo recalcula automáticamente desde el frontend admin al guardar resultados/campeón/usuarios.


## Mejora adicional: admin y usuarios

Ver `OPTIMIZACION_ADMIN_USUARIOS.md`.


## Mejora incremental admin

Ver `OPTIMIZACION_INCREMENTAL_ADMIN.md`.


## Correcciones posteriores

Ver `CORRECCIONES_SEGURIDAD_CAMPEON.md`.

# Correcciones de seguridad y campeón

## 1. Firestore Rules

Se volvió a exigir email verificado en reglas finales.

Funciones agregadas/corregidas:

```js
function emailVerified() {
  return signedIn() && request.auth.token.email_verified == true;
}

function activeUser() {
  return emailVerified()
    && userDocExists()
    && currentUserDoc().data.active == true;
}

function isAdmin() {
  return emailVerified()
    && userDocExists()
    && currentUserDoc().data.role == "admin"
    && currentUserDoc().data.active == true;
}
```

También se corrigió `users/{uid}` para que la creación del usuario definitivo requiera `emailVerified()`.

No se modificó el flujo de `pendingUsers` ni `pendingUsernames`, porque esas colecciones se usan antes de la verificación.

## 2. Bono de campeón

Se corrigió `updateLeaderboardForChampionChange()`.

Ahora, cuando el admin define o cambia el campeón real:

1. Recarga `users` una vez con `ensureAdminUsersLoaded(true)`.
2. Toma `championId` y `championName` desde `users/{uid}`.
3. Quita el bono anterior si corresponde.
4. Suma el nuevo bono si corresponde.
5. Guarda `leaderboards/current`.

Esto evita que el leaderboard use un `championId` viejo o vacío.

## 3. Optimización mantenida

Se mantiene:

- `leaderboards/current`.
- Usuarios normales sin leer `users` completo.
- Usuarios normales sin leer `predictions` completo.
- Admin incremental por partido.
- Firebase 10.12.5.

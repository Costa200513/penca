# Corrección Google y pendingUsernames

## Cambios aplicados

### js/app.js

Se agregó la misma lógica de identidad confiable usada en `auth.js`:

```js
function userSignedInWithGoogle(user) {
  return user?.providerData?.some(
    (provider) => provider.providerId === "google.com",
  );
}

function hasTrustedVerifiedIdentity(user) {
  return !!user?.emailVerified || userSignedInWithGoogle(user);
}
```

Y se reemplazó:

```js
if (!user.emailVerified)
```

por:

```js
if (!hasTrustedVerifiedIdentity(user))
```

Así las cuentas manuales no verificadas siguen bloqueadas, pero Google puede entrar como proveedor propio.

### js/auth.js

En `ensureGoogleUserProfile()`, después de revisar `usernames/{username}`, ahora también se revisa:

```js
pendingUsernames/{username}
```

Si existe, se muestra:

```txt
Ese nombre de usuario está pendiente de verificación. Probá con otro.
```

## Optimización

No se cambió la optimización de Firebase:

- No se reintrodujo lectura completa de `users` para usuarios normales.
- No se reintrodujo lectura completa de `predictions` para usuarios normales.
- Se mantiene `leaderboards/current`.
- Se mantiene admin incremental.

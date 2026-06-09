# Corrección puntual: usernames definitivo

Se corrigió únicamente `firestore-rules-finales.txt`.

Cambio aplicado solo en:

```js
match /usernames/{username}
```

La creación del username definitivo ahora exige:

```js
allow create: if emailVerified()
```

`pendingUsernames/{username}` no fue modificado y sigue usando `signedIn()` para la reserva temporal previa a la verificación de correo.

No se tocaron `js/app.js`, `js/auth.js`, `js/setup.js`, diseño, Firebase config ni la optimización incremental.

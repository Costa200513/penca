# Corrección de docentes sin año y conflicto Gmail manual → Google

## Docentes sin año obligatorio

Se modificó:

- `registro.html`
- `login.html`
- `js/auth.js`

El campo año ya no tiene `required` fijo en HTML.

Ahora `js/auth.js` controla la obligatoriedad según `participantType`:

- `student`: año obligatorio.
- `teacher`: año deshabilitado, no obligatorio y se guarda como `""`.

Esto aplica al registro manual y al modal de perfil Google.

## Conflicto Gmail manual → Google

Se agregó manejo específico de errores de Google:

- `auth/account-exists-with-different-credential`
- `auth/email-already-in-use`
- `auth/credential-already-in-use`
- `auth/popup-closed-by-user`
- `auth/cancelled-popup-request`

Si una cuenta Gmail se registró manualmente y luego intenta entrar con Google antes de verificar, el sistema muestra un mensaje claro y no intenta vincular proveedores.

## No se modificó

- Optimización Firebase.
- `leaderboards/current`.
- Admin incremental.
- Ranking incremental.
- Reglas de puntaje.
- Diseño móvil o PC.
- `firestore-rules-finales.txt`.
- `setup.html`.
- `js/setup.js`.
- Firebase config.

Google no pide contraseña y no usa `linkWithCredential()`.

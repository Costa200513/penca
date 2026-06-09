# Corrección de visualización de año y seguridad Google

## 1. Año de docentes

Se agregó en `js/app.js`:

```js
function participantTypeLabel(user = {}) {
  if (user.participantType === "teacher") return "Docente";
  if (user.participantType === "student") return "Estudiante";
  return user.participantType || "-";
}

function yearLabel(user = {}) {
  if (user.participantType === "teacher") return "No corresponde";
  if (!user.year) return "-";
  return `${user.year}.º`;
}
```

Se reemplazaron las salidas visuales de año para evitar textos como `-.º`.

## 2. Cambio de contraseña para cuentas Google

En el perfil, si la cuenta usa Google, ya no se muestra el formulario de cambio de contraseña.

En su lugar se muestra:

```txt
Tu cuenta usa Google. La contraseña se gestiona desde tu cuenta de Google.
```

El formulario de cambio de contraseña se conserva para cuentas manuales email/password.

## 3. Optimización

No se modificó la optimización Firebase:

- Usuarios normales no leen `users` completo.
- Usuarios normales no leen `predictions` completo.
- Se mantiene `leaderboards/current`.
- Se mantiene admin bajo demanda.
- Se mantiene ranking incremental.

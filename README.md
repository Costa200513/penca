# Penca Mundial 2026 - Firebase + GitHub Pages

Esta versión está preparada para publicarse en GitHub Pages usando Firebase Authentication y Firestore.

## Archivo principal para GitHub Pages

GitHub Pages carga automáticamente `index.html`. Por eso, en esta versión `index.html` es la landing page inicial con las opciones:

- Iniciar sesión
- Registrarse

También se mantiene `homepage.html` como copia de la landing, pero el archivo importante para GitHub Pages es `index.html`.

## Flujo de páginas

- `index.html`: landing principal para GitHub Pages.
- `homepage.html`: copia de la landing.
- `login.html`: inicio de sesión.
- `registro.html`: registro de usuarios.
- `reset.html`: recuperación de contraseña.
- `app.html`: aplicación principal luego de iniciar sesión.
- `setup.html`: carga inicial de datos en Firestore.

## Configuración necesaria

1. Pegá tu configuración real de Firebase en `js/firebase-config.js`.
2. Activá Firebase Authentication con Email/Password.
3. Creá Firestore Database.
4. Publicá primero las reglas de `firestore-rules-inicial-setup.txt`.
5. Registrá tu primer usuario.
6. Entrá a `setup.html` y ejecutá la carga inicial.
7. Publicá las reglas finales de `firestore-rules-finales.txt`.
8. Subí la carpeta a GitHub Pages.

## Especialidades

El registro incluye un selector de especialidades ordenado alfabéticamente:

- Ciencias Biológicas
- Ciencias Geográficas
- Comunicación Visual
- Derecho
- Educación Musical
- Español
- Filosofía
- Física
- Historia
- Informática
- Inglés
- Literatura
- Maestro Técnico
- Matemática
- Química
- Sociología

## Panel derecho

El panel derecho muestra:

- Iniciales del usuario.
- Nombre de usuario.
- Nombre completo.
- Aciertos.
- Puntos.
- Puesto en el ranking.
- Próximo partido.
- Reglas rápidas completas.

## Notas

- No se usa Firebase Storage.
- Las fotos reales fueron eliminadas; se usan iniciales.
- El admin no aparece en el ranking ni puede pronosticar.
- Los pronósticos se cierran 30 minutos antes del partido.
- El tema queda fijo en modo oscuro.

## Cambios agregados en esta versión

- El logo `img/logo_penca.png` se muestra en la pestaña, landing, login, setup, app y pantallas de carga.
- El menú izquierdo muestra el logo grande y se eliminó el texto `Penca 2026` del encabezado lateral.
- Los textos de carga usan `Mundial 2026`.
- El ranking incluye dos bloques:
  - Ranking por usuario.
  - Ranking por especialidad, también con podio top 3 y lista del resto.
- El ranking por usuario muestra especialidad y año.
- Los países/equipos en desplegables se ordenan alfabéticamente.
- La elección de campeón solo se puede realizar hasta el primer partido: 11/06/2026 16:00 UY.
- La carga de horario en admin ahora pide solamente la hora, porque los días ya están cargados en la base inicial.
- Cuando el admin modifica resultados, horarios o equipos, las pantallas abiertas se actualizan en tiempo real mediante `onSnapshot` de Firestore.
- Se eliminó del panel admin la opción de resetear contraseñas.
- Los campos de goles validan números enteros entre 0 y 50 para evitar negativos, letras, infinito o valores inválidos.

## Verificación de correo y recuperación de contraseña

Esta versión usa Firebase Authentication para enviar:

- Correo de verificación al registrarse.
- Correo de recuperación de contraseña desde `reset.html`.

Para que funcionen correctamente, en Firebase Console revisá:

1. Authentication → Templates.
2. Activar/configurar `Email address verification`.
3. Activar/configurar `Password reset`.
4. En Authentication → Settings → Authorized domains, agregar tu dominio de GitHub Pages.

Después del registro, el usuario debe verificar su correo antes de entrar a la app.

## Cambios en la base de datos Firestore

Si ya tenías datos cargados, para que los partidos eliminatorios sin horario funcionen mejor conviene volver a ejecutar `setup.html` con las reglas iniciales. Esto actualiza la información de los días de los partidos 89 al 104 y permite que el admin solo cargue la hora.

Flujo recomendado:

1. Publicar `firestore-rules-inicial-setup.txt`.
2. Entrar con la cuenta admin.
3. Ejecutar `setup.html`.
4. Publicar `firestore-rules-finales.txt`.


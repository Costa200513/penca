# ⚽ Penca Mundial 2026 — CeRP Litoral Norte

> Aplicación web de penca deportiva para el Mundial 2026, desarrollada para la comunidad del CeRP Litoral Norte (estudiantes y docentes de Profesorado de Informática).

---

## 📋 Descripción

**Penca Mundial 2026** es una aplicación web full-stack que permite a los participantes pronosticar los resultados de los partidos del Mundial 2026, elegir su equipo campeón y competir en un ranking general y por especialidad.

La app está construida como una SPA (Single Page Application) vanilla con HTML, CSS y JavaScript puro, conectada a Firebase como backend. Además cuenta con una versión nativa para Android empaquetada con Capacitor.

---

## ✨ Funcionalidades principales

### Para usuarios
- 🔐 **Autenticación** con correo/contraseña o Google (Firebase Auth)
- 📧 Verificación obligatoria de correo electrónico antes de ingresar
- ⚽ **Fixture interactivo** organizado por fases (grupos, octavos, cuartos, etc.)
- 🎯 **Pronósticos de partidos** — se cierran automáticamente 30 minutos antes de cada partido
- 🏆 **Selección de campeón** (única, con fecha límite)
- 📊 **Ranking individual** con podio y desglose de puntos
- 📊 **Ranking por especialidad** (suma colectiva por carrera/materia)
- 🔔 Toast de notificación en tiempo real cuando se carga un nuevo resultado
- 👤 Perfil de usuario con cambio de contraseña

### Para administradores
- ✏️ Carga y edición de resultados de partidos
- 🔧 Gestión de usuarios (activar/desactivar cuentas)
- ⚙️ Configuración del torneo (campeón real, minutos de cierre)
- 📝 Log de acciones administrativas

### Sistema de puntos
| Evento | Puntos |
|---|---|
| Resultado exacto (marcador exacto) | +3 |
| Ganador/empate correcto (resultado parcial) | +2 |
| Empate correcto (sin importar el marcador) | +1 |
| Penales acertados (en partidos que llegan a penales) | +1 |
| Campeón acertado | +10 |

---

## 🏗️ Tecnologías utilizadas

| Capa | Tecnología |
|---|---|
| Frontend | HTML5, CSS3 (vanilla), JavaScript ES Modules |
| Backend / DB | Firebase Firestore |
| Autenticación | Firebase Authentication (Email + Google) |
| Hosting | GitHub Pages / Firebase Hosting compatible |
| App Android | Capacitor v6 + Android |

---

## 📁 Estructura del proyecto

```
penca/
├── index.html              # Landing page (entrada pública)
├── login.html              # Login con email o Google
├── registro.html           # Registro de nuevos usuarios
├── reset.html              # Recuperación de contraseña
├── app.html                # App principal (requiere autenticación)
├── setup.html              # Setup inicial del torneo (solo admin)
├── auth-action.html        # Acciones de Firebase (verificación de correo, etc.)
├── css/
│   ├── style.css           # Estilos principales de la app
│   ├── auth-action.css     # Estilos de páginas de auth
│   └── capacitor-overrides.css  # Ajustes para la versión Android
├── js/
│   ├── firebase-config.js  # Configuración de Firebase
│   ├── app.js              # Lógica principal de la SPA
│   ├── auth.js             # Registro, login, recuperación de contraseña
│   ├── auth-action.js      # Manejo de acciones de email Firebase
│   ├── seed-data.js        # Datos iniciales de equipos y fases
│   ├── setup.js            # Script de setup del torneo
│   ├── update-checker.js   # Verificador de actualizaciones (Android)
│   └── page-loader.js      # Loader inicial de páginas
├── img/
│   ├── logo_penca.png      # Logo de la penca
│   └── Google.png          # Ícono de Google para login
├── android-app/            # Proyecto Capacitor para Android
│   ├── capacitor.config.json
│   ├── package.json
│   ├── android/            # Proyecto Android nativo (Gradle)
│   └── www/                # Build de la web para Android
├── firestore-rules-finales.txt        # Reglas de seguridad de Firestore (producción)
└── firestore-rules-inicial-setup.txt  # Reglas permisivas para el setup inicial
```

---

## 🔐 Seguridad (Firestore Rules)

Las reglas de Firestore implementan un modelo de permisos estricto:

- Solo usuarios autenticados pueden leer datos del torneo
- Cada usuario solo puede crear/editar sus propios pronósticos y perfil
- Los datos de `teams`, `phases`, `matches` y `settings` solo pueden ser modificados por admins
- La colección `champions` es de escritura única (no se puede modificar el campeón elegido)
- Los usuarios eliminados o desactivados no pueden acceder a la app

---

## 🚀 Despliegue

### Web (GitHub Pages)

El proyecto está configurado para desplegarse directamente desde la rama principal en GitHub Pages. El archivo `.nojekyll` desactiva el procesamiento de Jekyll para que los directorios con guión bajo funcionen correctamente.

### Android (APK)

El APK de debug se encuentra en:
```
android-app/PencaMundial2026-debug.apk
```

**App ID:** `com.ezecosta.pencamundial`

---

## 📱 Instalación del APK en Android

### Pasos normales
1. Descargá el archivo `PencaMundial2026-debug.apk`
2. En tu Android, habilitá la instalación desde fuentes desconocidas (Ajustes → Seguridad → Fuentes desconocidas)
3. Abrí el archivo APK y seguí los pasos de instalación

### ⚠️ Actualización de versión

> **Importante:** Si al intentar instalar una nueva versión del APK el sistema da un error de conflicto o no permite la actualización directa, **desinstalá completamente la versión anterior** antes de instalar el nuevo APK.

```
Configuración → Aplicaciones → Penca Mundial 2026 → Desinstalar
```

Luego instalá el nuevo APK desde cero. Tus datos están guardados en la nube (Firebase), por lo que no se pierden al desinstalar.

---

## ⚙️ Setup inicial del torneo (solo admins)

1. Configurar Firebase (crear proyecto, habilitar Auth y Firestore)
2. Copiar la configuración en `js/firebase-config.js`
3. Aplicar las reglas de `firestore-rules-inicial-setup.txt` temporalmente
4. Acceder a `setup.html` con una cuenta de admin para cargar equipos, fases y partidos
5. Aplicar las reglas finales de `firestore-rules-finales.txt`

---

## 👥 Desarrolladores

<table>
  <tr>
    <td align="center">
      <strong>Ezequiel Costa</strong><br>
      <em>Desarrollador Principal · FullStack</em><br>
      <sub>Diseño, arquitectura, frontend y backend de la aplicación completa. Estudiante de 3.º año de Profesorado de Informática — Ingeniería de Software, CeRP Litoral Norte.</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>Thiago Sosa</strong><br>
      <em>Security Auditor · Security Hardening · Android Porter</em><br>
      <sub>Revisión y endurecimiento de reglas de seguridad de Firestore, auditoría del modelo de permisos y porteo de la aplicación web a la plataforma Android mediante Capacitor.</sub>
    </td>
  </tr>
</table>

---

## 📜 Licencia

Proyecto académico desarrollado en el marco del Profesorado de Informática — CeRP Litoral Norte. Uso interno para la comunidad del centro.

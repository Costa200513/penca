import { auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   UTILIDADES
========================= */

function showMessage(element, text, type = "error") {
  if (!element) return;

  element.textContent = text;
  element.classList.remove("success", "error");
  element.classList.add(type);
}

function setButtonLoading(button, loading, text = "Cargando...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalText)
      button.dataset.originalText = button.textContent.trim();
    button.textContent = text;
    button.disabled = true;
    button.classList.add("is-loading");
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    button.classList.remove("is-loading");
    delete button.dataset.originalText;
  }
}

function traducirErrorFirebase(code) {
  const errores = {
    "auth/email-already-in-use": "Ese correo ya está registrado.",
    "auth/invalid-email": "El correo no es válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/user-not-found": "No existe un usuario con ese correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/operation-not-allowed":
      "El registro con correo y contraseña no está habilitado en Firebase.",
    "permission-denied":
      "Permisos insuficientes. Revisá las reglas de Firestore.",
  };

  return errores[code] || "Ocurrió un error. Intentá nuevamente.";
}

function googleLoginErrorMessage(error) {
  const conflictCodes = [
    "auth/account-exists-with-different-credential",
    "auth/email-already-in-use",
    "auth/credential-already-in-use",
  ];

  if (conflictCodes.includes(error?.code)) {
    return "Ya existe una cuenta registrada con ese correo. Si te registraste con email y contraseña, verificá tu correo e iniciá sesión con esos datos. Si no recibiste el correo, solicitá ayuda al administrador.";
  }

  if (error?.code === "auth/popup-closed-by-user") {
    return "Inicio con Google cancelado.";
  }

  if (error?.code === "auth/cancelled-popup-request") {
    return "Ya hay una ventana de Google abierta. Cerrala o intentá nuevamente.";
  }

  return error?.code ? traducirErrorFirebase(error.code) : error.message;
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function usernameCandidateFromUser(user) {
  const email = normalizeEmail(user.email);
  return email
    .split("@")[0]
    .replace(/[^a-z0-9_.]/gi, "")
    .toLowerCase()
    .slice(0, 30);
}

function userSignedInWithGoogle(user) {
  return user?.providerData?.some((provider) => provider.providerId === "google.com");
}

function hasTrustedVerifiedIdentity(user) {
  return !!user?.emailVerified || userSignedInWithGoogle(user);
}

function updateYearRequirement(participantTypeId, yearId) {
  const participantType = document.getElementById(participantTypeId);
  const year = document.getElementById(yearId);

  if (!participantType || !year) return;

  const isStudent = participantType.value === "student";

  year.required = isStudent;
  year.disabled = !isStudent;

  if (!isStudent) {
    year.value = "";
  }
}

function setupYearRequirement(participantTypeId, yearId) {
  const participantType = document.getElementById(participantTypeId);
  if (!participantType) return;

  if (participantType.dataset.yearRequirementReady !== "true") {
    participantType.addEventListener("change", () => {
      updateYearRequirement(participantTypeId, yearId);
    });
    participantType.dataset.yearRequirementReady = "true";
  }

  updateYearRequirement(participantTypeId, yearId);
}

function getGoogleProfileFormData() {
  updateYearRequirement("googleProfileParticipantType", "googleProfileYear");

  const username = document
    .getElementById("googleProfileUsername")
    ?.value.trim()
    .toLowerCase();
  const participantType = document.getElementById(
    "googleProfileParticipantType",
  )?.value;
  const specialty = document.getElementById("googleProfileSpecialty")?.value;
  const year = document.getElementById("googleProfileYear")?.value;
  if (!username || !/^[a-z0-9_.]{3,30}$/.test(username)) {
    throw new Error(
      "El nombre de usuario debe tener entre 3 y 30 caracteres. Solo puede incluir letras, números, punto y guion bajo.",
    );
  }

  if (!participantType || !specialty) {
    throw new Error("Completá tipo de participante y especialidad.");
  }

  if (participantType === "student" && !year) {
    throw new Error("Seleccioná tu año.");
  }

  return {
    username,
    participantType,
    specialty,
    year: participantType === "student" ? year : "",
  };
}

function openGoogleProfileModal(user) {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById("googleProfileModal");
    const form = document.getElementById("googleProfileForm");
    const cancelBtn = document.getElementById("cancelGoogleProfileBtn");
    const message = document.getElementById("googleProfileMessage");
    const usernameInput = document.getElementById("googleProfileUsername");

    if (!modal || !form) {
      reject(new Error("No se encontró el formulario de perfil de Google."));
      return;
    }

    if (usernameInput && !usernameInput.value) {
      usernameInput.value = usernameCandidateFromUser(user);
    }

    setupYearRequirement("googleProfileParticipantType", "googleProfileYear");
    showMessage(message, "", "error");
    modal.classList.add("active");

    const cleanup = () => {
      form.removeEventListener("submit", onSubmit);
      cancelBtn?.removeEventListener("click", onCancel);
      modal.classList.remove("active");
    };

    const onCancel = () => {
      cleanup();
      reject(new Error("Inicio con Google cancelado."));
    };

    const onSubmit = (event) => {
      event.preventDefault();

      try {
        const data = getGoogleProfileFormData();
        cleanup();
        resolve(data);
      } catch (error) {
        showMessage(message, error.message);
      }
    };

    form.addEventListener("submit", onSubmit);
    cancelBtn?.addEventListener("click", onCancel);
  });
}

async function ensureGoogleUserProfile(user, profileData = null) {
  /*
    Google funciona como registro + inicio de sesión directo.
    Si el usuario no existe en Firestore, se pide un formulario breve
    con username, tipo, especialidad y año. No se vincula una contraseña
    local para evitar conflictos entre proveedor Google y email/password.
  */
  await user.reload();
  await user.getIdToken(true);

  if (!hasTrustedVerifiedIdentity(user)) {
    throw new Error(
      "No se pudo confirmar una identidad válida de Google. Volvé a intentarlo con el botón Entrar con Google.",
    );
  }

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) return true;

  const email = normalizeEmail(user.email);
  const data = profileData || (await openGoogleProfileModal(user));
  const usernameRef = doc(db, "usernames", data.username);
  const usernameSnap = await getDoc(usernameRef);

  if (usernameSnap.exists()) {
    throw new Error("Ese nombre de usuario no está disponible.");
  }

  const pendingUsernameRef = doc(db, "pendingUsernames", data.username);
  const pendingUsernameSnap = await getDoc(pendingUsernameRef);

  if (pendingUsernameSnap.exists()) {
    throw new Error(
      "Ese nombre de usuario está pendiente de verificación. Probá con otro.",
    );
  }

  const batch = writeBatch(db);

  batch.set(userRef, {
    uid: user.uid,
    username: data.username,
    fullName: user.displayName || email,
    email,
    participantType: data.participantType,
    specialty: data.specialty,
    year: data.year,
    role: "user",
    active: true,
    championId: "",
    championName: "",
    createdAt: serverTimestamp(),
    activatedAt: serverTimestamp(),
  });

  batch.set(usernameRef, {
    uid: user.uid,
    createdAt: serverTimestamp(),
  });

  await batch.commit();

  return true;
}

async function ensureVerifiedUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) return true;

  const pendingRef = doc(db, "pendingUsers", user.uid);
  const pendingSnap = await getDoc(pendingRef);

  if (!pendingSnap.exists()) {
    throw new Error(
      "No se encontraron datos pendientes para activar el usuario. Contactá al administrador.",
    );
  }

  const pending = pendingSnap.data();
  const username = pending.username;

  if (!username) {
    throw new Error("Los datos pendientes del usuario están incompletos.");
  }

  const usernameRef = doc(db, "usernames", username);
  const usernameSnap = await getDoc(usernameRef);

  if (usernameSnap.exists()) {
    throw new Error(
      "El nombre de usuario ya fue tomado. Contactá al administrador.",
    );
  }

  const batch = writeBatch(db);

  batch.set(userRef, {
    uid: user.uid,
    username: pending.username,
    fullName: pending.fullName,
    email: user.email,
    participantType: pending.participantType,
    specialty: pending.specialty,
    year: pending.year,
    role: "user",
    active: true,
    championId: "",
    championName: "",
    createdAt: serverTimestamp(),
    activatedAt: serverTimestamp(),
  });

  batch.set(usernameRef, {
    uid: user.uid,
    createdAt: serverTimestamp(),
  });

  batch.delete(doc(db, "pendingUsernames", username));
  batch.delete(pendingRef);

  await batch.commit();

  return true;
}

/* =========================
   REGISTRO
   La verificación de correo se envía SOLO acá.
========================= */

const registerForm = document.getElementById("registerForm");

setupYearRequirement("participantType", "year");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = document.getElementById("registerMessage");
    const submitButton =
      e.submitter ||
      registerForm.querySelector("button[type='submit'], button:not([type])");

    const username = document
      .getElementById("username")
      ?.value.trim()
      .toLowerCase();
    const fullName = document.getElementById("fullName")?.value.trim();
    const email = document.getElementById("email")?.value.trim().toLowerCase();
    const password = document.getElementById("password")?.value;
    const participantType = document.getElementById("participantType")?.value;
    const specialty = document.getElementById("specialty")?.value;
    const year = document.getElementById("year")?.value;

    showMessage(message, "", "error");

    if (!username || !/^[a-z0-9_.]{3,30}$/.test(username)) {
      showMessage(
        message,
        "El usuario debe tener entre 3 y 30 caracteres. Solo puede incluir letras, números, punto y guion bajo.",
      );
      return;
    }

    if (!fullName || !email || !password || !participantType || !specialty) {
      showMessage(message, "Completá todos los campos.");
      return;
    }

    if (participantType === "student" && !year) {
      showMessage(message, "Seleccioná tu año.");
      return;
    }

    if (password.length < 6) {
      showMessage(message, "La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    try {
      setButtonLoading(submitButton, true, "Registrando...");
      /*
        Primero se revisa si el nombre de usuario ya existe como definitivo
        o si está reservado temporalmente por una cuenta pendiente de verificación.
      */
      const usernameRef = doc(db, "usernames", username);
      const usernameSnap = await getDoc(usernameRef);

      if (usernameSnap.exists()) {
        showMessage(message, "Ese nombre de usuario no está disponible.");
        return;
      }

      const pendingUsernameRef = doc(db, "pendingUsernames", username);
      const pendingUsernameSnap = await getDoc(pendingUsernameRef);

      if (pendingUsernameSnap.exists()) {
        showMessage(
          message,
          "Ese nombre de usuario está pendiente de verificación. Probá con otro.",
        );
        return;
      }

      /*
        Se crea SOLO la cuenta en Firebase Authentication.
        El perfil definitivo en users y la reserva definitiva en usernames
        se crean recién después de verificar el correo e iniciar sesión.
      */
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const user = userCredential.user;

      /*
        Esto permite que en la plantilla de Firebase aparezca el nombre.
        Firebase usa DISPLAY_NAME en el correo de verificación.
      */
      await updateProfile(user, {
        displayName: fullName,
      });

      /*
        Datos temporales hasta que el correo sea verificado.
        Esto evita que usuarios no verificados aparezcan en ranking,
        gestión de usuarios o colección users.
      */
      const batch = writeBatch(db);

      batch.set(doc(db, "pendingUsers", user.uid), {
        uid: user.uid,
        username,
        fullName,
        email,
        participantType,
        specialty,
        year: participantType === "student" ? year : "",
        createdAt: serverTimestamp(),
      });

      batch.set(pendingUsernameRef, {
        uid: user.uid,
        createdAt: serverTimestamp(),
      });

      await batch.commit();

      /*
        IMPORTANTE:
        La verificación de correo se manda SOLO al registrarse.
        No se manda en el login.
      */
      await sendEmailVerification(user);

      showMessage(
        message,
        "Cuenta creada. Te enviamos un correo para verificar tu cuenta, revisa la carpeta de spam,",
        "success",
      );

      /*
        Cerramos sesión para obligar al usuario a verificar el correo
        antes de ingresar a la app.
      */
      await signOut(auth);

      setTimeout(() => {
        window.location.href = "login.html";
      }, 3500);
    } catch (error) {
      console.error(error);
      showMessage(
        message,
        error.code ? traducirErrorFirebase(error.code) : error.message,
      );
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

/* =========================
   LOGIN
   Acá NO se envía correo de verificación.
   Solo se comprueba si ya fue verificado.
========================= */

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = document.getElementById("loginMessage");
    const submitButton =
      e.submitter ||
      loginForm.querySelector("button[type='submit'], button:not([type])");

    const email = document
      .getElementById("loginEmail")
      ?.value.trim()
      .toLowerCase();
    const password = document.getElementById("loginPassword")?.value;

    showMessage(message, "", "error");

    if (!email || !password) {
      showMessage(message, "Ingresá correo y contraseña.");
      return;
    }

    try {
      setButtonLoading(submitButton, true, "Ingresando...");
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const user = userCredential.user;

      /*
        Se fuerza la actualización del estado real de verificación.
        Esto evita usar un token viejo con email_verified: false.
      */
      await user.reload();
      await user.getIdToken(true);

      /*
        No se reenvía verificación acá.
        Solo se bloquea el acceso si todavía no verificó.
      */
      if (!user.emailVerified) {
        await signOut(auth);

        showMessage(
          message,
          "Tu correo todavía no está verificado. Revisá el correo que recibiste al registrarte.",
        );

        return;
      }

      /*
        Si está verificado, se activa el perfil definitivo si todavía
        estaba pendiente, y recién después entra a la app.
      */
      await ensureVerifiedUserProfile(user);
      window.location.href = "app.html";
    } catch (error) {
      console.error(error);
      showMessage(
        message,
        error.code ? traducirErrorFirebase(error.code) : error.message,
      );
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

/* =========================
   LOGIN DIRECTO CON GOOGLE
   Crea el perfil automáticamente como usuario común.
========================= */

const googleLoginBtn = document.getElementById("googleLoginBtn");

if (googleLoginBtn) {
  googleLoginBtn.addEventListener("click", async () => {
    const message = document.getElementById("loginMessage");
    const provider = new GoogleAuthProvider();

    provider.setCustomParameters({
      prompt: "select_account",
    });

    showMessage(message, "", "error");

    try {
      setButtonLoading(googleLoginBtn, true, "Ingresando...");
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;

      await ensureGoogleUserProfile(user);
      window.location.href = "app.html";
    } catch (error) {
      console.error(error);
      await signOut(auth).catch(() => {});

      showMessage(message, googleLoginErrorMessage(error));
    } finally {
      setButtonLoading(googleLoginBtn, false);
    }
  });
}

/* =========================
   RECUPERACIÓN DE CONTRASEÑA
   Esto usa la plantilla Password reset de Firebase.
========================= */

const resetForm = document.getElementById("resetForm");

if (resetForm) {
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = document.getElementById("resetMessage");
    const submitButton =
      e.submitter ||
      resetForm.querySelector("button[type='submit'], button:not([type])");
    const email = document
      .getElementById("resetEmail")
      ?.value.trim()
      .toLowerCase();

    showMessage(message, "", "error");

    if (!email) {
      showMessage(message, "Ingresá tu correo electrónico.");
      return;
    }

    try {
      setButtonLoading(submitButton, true, "Enviando...");
      await sendPasswordResetEmail(auth, email);

      showMessage(
        message,
        "Te enviamos un correo para restablecer tu contraseña. Revisá tu bandeja de entrada o spam.",
        "success",
      );
    } catch (error) {
      console.error(error);
      showMessage(
        message,
        error.code ? traducirErrorFirebase(error.code) : error.message,
      );
    } finally {
      setButtonLoading(submitButton, false);
    }
  });
}

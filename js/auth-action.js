import { auth } from "./firebase-config.js";

import {
  applyActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const loader = document.getElementById("authActionLoader");
const verifyEmailBox = document.getElementById("verifyEmailBox");
const resetPasswordBox = document.getElementById("resetPasswordBox");
const unknownActionBox = document.getElementById("unknownActionBox");

const verifyTitle = document.getElementById("verifyTitle");
const verifyMessage = document.getElementById("verifyMessage");
const resetEmailText = document.getElementById("resetEmailText");
const resetPasswordForm = document.getElementById("resetPasswordForm");
const resetPasswordMessage = document.getElementById("resetPasswordMessage");

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode");
const oobCode = params.get("oobCode");

function hideLoader() {
  if (!loader) return;
  setTimeout(() => loader.classList.add("hidden"), 350);
}

function showPanel(panel) {
  [verifyEmailBox, resetPasswordBox, unknownActionBox].forEach((box) => {
    if (box) box.classList.add("hidden");
  });

  if (panel) panel.classList.remove("hidden");
  hideLoader();
}

function showMessage(element, text, type = "error") {
  if (!element) return;
  element.textContent = text;
  element.classList.remove("success", "error");
  element.classList.add(type);
}

async function handleVerifyEmail(code) {
  showPanel(verifyEmailBox);

  try {
    await applyActionCode(auth, code);
    verifyTitle.textContent = "Correo verificado";
    verifyMessage.textContent = "Tu dirección de correo fue confirmada correctamente. Ya podés iniciar sesión en la penca.";
  } catch (error) {
    console.error(error);
    verifyTitle.textContent = "No se pudo verificar";
    verifyMessage.textContent = "El enlace puede estar vencido, incompleto o ya fue utilizado. Probá registrarte nuevamente o solicitá otro correo de verificación.";
  }
}

async function handleResetPassword(code) {
  showPanel(resetPasswordBox);

  try {
    const email = await verifyPasswordResetCode(auth, code);
    resetEmailText.textContent = `Vas a cambiar la contraseña de: ${email}`;
    resetPasswordForm.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    resetEmailText.textContent = "El enlace de recuperación no es válido o ya venció.";
    showMessage(resetPasswordMessage, "Solicitá un nuevo enlace desde la página de recuperación de contraseña.", "error");
    return;
  }

  resetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const newPassword = document.getElementById("newPassword").value;
    const repeatPassword = document.getElementById("repeatPassword").value;

    resetPasswordMessage.classList.remove("success", "error");
    resetPasswordMessage.textContent = "";

    if (newPassword.length < 6) {
      showMessage(resetPasswordMessage, "La contraseña debe tener al menos 6 caracteres.", "error");
      return;
    }

    if (newPassword !== repeatPassword) {
      showMessage(resetPasswordMessage, "Las contraseñas no coinciden.", "error");
      return;
    }

    try {
      await confirmPasswordReset(auth, code, newPassword);
      resetPasswordForm.classList.add("hidden");
      showMessage(resetPasswordMessage, "Contraseña actualizada correctamente. Ya podés iniciar sesión.", "success");
    } catch (error) {
      console.error(error);
      showMessage(resetPasswordMessage, "No se pudo cambiar la contraseña. Solicitá un nuevo enlace.", "error");
    }
  });
}

async function initAuthAction() {
  if (!mode || !oobCode) {
    showPanel(unknownActionBox);
    return;
  }

  if (mode === "verifyEmail") {
    await handleVerifyEmail(oobCode);
    return;
  }

  if (mode === "resetPassword") {
    await handleResetPassword(oobCode);
    return;
  }

  showPanel(unknownActionBox);
}

initAuthAction();

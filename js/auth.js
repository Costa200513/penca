import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, getDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

function showPageLoader(text='Cargando...'){ if (window.showPageLoader) window.showPageLoader(text); }
function hidePageLoader(){ if (window.hidePageLoader) window.hidePageLoader(); }

const registerForm = document.getElementById('registerForm');

if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const msg = document.getElementById('registerMessage');
    msg.textContent = '';
    msg.className = 'inline-message';

    const username = document.getElementById('username').value.trim().toLowerCase();
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const participantType = document.getElementById('participantType').value;
    const specialty = document.getElementById('specialty').value.trim();
    const year = document.getElementById('year').value;

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      msg.textContent = 'El usuario debe tener entre 3 y 30 caracteres. Solo letras, números, punto y guion bajo.';
      msg.className = 'inline-message error';
      return;
    }

    if (password.length < 6) {
      msg.textContent = 'La contraseña debe tener al menos 6 caracteres.';
      msg.className = 'inline-message error';
      return;
    }

    try {
      showPageLoader('Creando cuenta...');
      const usernameRef = doc(db, 'usernames', username);
      const usernameSnap = await getDoc(usernameRef);

      if (usernameSnap.exists()) {
        hidePageLoader();
        msg.textContent = 'Ese nombre de usuario no está disponible.';
        msg.className = 'inline-message error';
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const user = cred.user;
      await updateProfile(user, { displayName: fullName });

      const batch = writeBatch(db);

      batch.set(doc(db, 'users', user.uid), {
        uid: user.uid,
        username,
        fullName,
        email,
        participantType,
        specialty,
        year,
        role: 'user',
        active: true,
        championId: '',
        championName: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      batch.set(usernameRef, {
        uid: user.uid,
        createdAt: serverTimestamp()
      });

      await batch.commit();
      await sendEmailVerification(user);
      await signOut(auth);
      hidePageLoader();
      msg.className = 'inline-message success';
      msg.textContent = 'Cuenta creada. Te enviamos un correo de verificación. Verificá tu email antes de iniciar sesión.';
    } catch (error) {
      hidePageLoader();
      console.error(error);
      msg.className = 'inline-message error';
      msg.textContent = translateFirebaseError(error.code, error.message);
    }
  });
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loginMessage');
    msg.textContent = '';
    msg.className = 'inline-message';

    try {
      showPageLoader('Iniciando sesión...');
      const cred = await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value.trim().toLowerCase(), document.getElementById('loginPassword').value);
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user);
        await signOut(auth);
        hidePageLoader();
        msg.className = 'inline-message error';
        msg.textContent = 'Debés verificar tu correo electrónico antes de ingresar. Te reenviamos el correo de verificación.';
        return;
      }
      showPageLoader('Entrando...');
      window.location.href = 'app.html';
    } catch (error) {
      hidePageLoader();
      console.error(error);
      msg.className = 'inline-message error';
      msg.textContent = translateFirebaseError(error.code, error.message);
    }
  });
}

const resetForm = document.getElementById('resetForm');
if (resetForm) {
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('resetMessage');
    msg.textContent = '';
    try {
      showPageLoader('Enviando correo...');
      await sendPasswordResetEmail(auth, document.getElementById('resetEmail').value.trim().toLowerCase());
      hidePageLoader();
      msg.className = 'inline-message success';
      msg.textContent = 'Correo de recuperación enviado. Revisá tu bandeja de entrada.';
    } catch (error) {
      hidePageLoader();
      console.error(error);
      msg.className = 'inline-message error';
      msg.textContent = translateFirebaseError(error.code, error.message);
    }
  });
}

function translateFirebaseError(code, fallback) {
  const map = {
    'auth/email-already-in-use': 'Ese correo ya está registrado.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'permission-denied': 'Permisos insuficientes. Revisá las reglas de Firestore.'
  };
  return map[code] || `${code || 'error'}: ${fallback || 'Ocurrió un error.'}`;
}

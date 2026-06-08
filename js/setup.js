import { auth, db } from "./firebase-config.js";
import { TEAMS, PHASES, MATCHES } from "./seed-data.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let user = null;

const log = (t) => {
  const el = document.getElementById("setupLog");
  if (el) el.innerHTML += `<br>${t}`;
};

const getUsernameFromEmail = (email) => {
  return (email || "admin")
    .split("@")[0]
    .replace(/[^a-z0-9_.]/gi, "")
    .toLowerCase();
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function toLocalDateOnly(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateText(date, label = "") {
  const base = date.toLocaleDateString("es-UY", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });

  return `${label ? label + " · " : ""}${base} - ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/*
  SETUP TEMPORAL PARA PROBAR TIEMPOS

  Partido 1:
  - Arranca en 32 minutos.
  - Como la app cierra pronósticos 30 minutos antes, se bloquea en 2 minutos.

  Partido 2:
  - Ya está habilitado.
  - Arranca en 4 horas.

  Partido 3:
  - Se habilita en 3 minutos usando el campo temporal testOpenAt.
  - Para que funcione, app.js debe tener el pequeño soporte temporal para testOpenAt
    dentro de predictionOpenDate().
*/
function getTestMatchTiming(matchNumber) {
  const now = new Date();

  if (matchNumber === 1) {
    const start = new Date(now.getTime() + 32 * 60 * 1000);

    return {
      dateTime: start.toISOString(),
      dateOnly: toLocalDateOnly(start),
      dateText: toDateText(start, "Prueba: se bloquea en 2 min"),
      testOpenAt: "",
    };
  }

  if (matchNumber === 2) {
    const start = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    return {
      dateTime: start.toISOString(),
      dateOnly: toLocalDateOnly(start),
      dateText: toDateText(start, "Prueba: ya habilitado"),
      testOpenAt: "",
    };
  }

  if (matchNumber === 3) {
    const start = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const open = new Date(now.getTime() + 3 * 60 * 1000);

    return {
      dateTime: start.toISOString(),
      dateOnly: toLocalDateOnly(start),
      dateText: toDateText(start, "Prueba: habilita en 3 min"),
      testOpenAt: open.toISOString(),
    };
  }

  const start = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  return {
    dateTime: start.toISOString(),
    dateOnly: toLocalDateOnly(start),
    dateText: toDateText(start, "Prueba: bloqueado"),
    testOpenAt: "",
  };
}

onAuthStateChanged(auth, (u) => {
  if (!u) {
    window.location.href = "login.html";
    return;
  }

  user = u;
  document.getElementById("setupUser").textContent = u.email;
});

document.getElementById("loadBtn").addEventListener("click", async () => {
  if (!user) return;

  const btn = document.getElementById("loadBtn");
  btn.disabled = true;
  btn.textContent = "Cargando prueba...";

  try {
    const username = getUsernameFromEmail(user.email);

    log("Creando perfil admin...");

    await setDoc(
      doc(db, "users", user.uid),
      {
        uid: user.uid,
        email: user.email,
        username,
        fullName: "Administrador",
        role: "admin",
        active: true,
        participantType: "teacher",
        specialty: "Administración",
        year: "",
        championId: "",
        championName: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    log("Verificando username admin...");

    const usernameRef = doc(db, "usernames", username);
    const usernameSnap = await getDoc(usernameRef);

    if (!usernameSnap.exists()) {
      await setDoc(usernameRef, {
        uid: user.uid,
        createdAt: serverTimestamp(),
      });

      log("Username admin creado.");
    } else {
      log("Username admin ya existía. Se omite para evitar error de permisos.");
    }

    log("Cargando fases...");

    let batch = writeBatch(db);
    let count = 0;

    for (const f of PHASES) {
      batch.set(doc(db, "phases", f.id), f);

      if (++count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }

    log("Cargando equipos...");

    for (const t of TEAMS) {
      batch.set(doc(db, "teams", t[0]), {
        id: t[0],
        name: t[1],
        group: t[2] || "",
        isPlaceholder: !!t[3],
      });

      if (++count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }

    log("Cargando placeholders...");

    for (let i = 73; i <= 104; i++) {
      batch.set(doc(db, "teams", `WIN_${i}`), {
        id: `WIN_${i}`,
        name: `Ganador Partido ${i}`,
        group: "",
        isPlaceholder: true,
      });

      if (++count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }

    for (let i = 101; i <= 102; i++) {
      batch.set(doc(db, "teams", `LOS_${i}`), {
        id: `LOS_${i}`,
        name: `Perdedor Partido ${i}`,
        group: "",
        isPlaceholder: true,
      });

      if (++count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }

    log("Cargando partidos con tiempos de prueba...");

    for (const m of MATCHES) {
      const timing = getTestMatchTiming(Number(m.n));

      batch.set(doc(db, "matches", String(m.n)), {
        id: String(m.n),
        number: m.n,
        phase: m.p,
        group: m.g || "",
        teamAId: m.a,
        teamBId: m.b,
        dateTime: timing.dateTime,
        dateOnly: timing.dateOnly,
        dateText: timing.dateText,
        venue: m.v || "",
        status: "pending",
        goalsA: null,
        goalsB: null,
        penaltyWinnerId: "",
        winnerId: "",
        order: m.n,
        testOpenAt: timing.testOpenAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (++count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }

    batch.set(doc(db, "settings", "tournament"), {
      predictionsCloseMinutes: 30,
      predictionOpenDaysBefore: 2,
      realChampionId: "",
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    log("Prueba cargada correctamente.");
    log("Partido 1: se bloquea en 2 minutos.");
    log("Partido 2: ya está habilitado.");
    log("Partido 3: se habilita en 3 minutos.");
    log("Abrí app.html?v=test-tiempos para probar.");
  } catch (err) {
    console.error(err);
    log("ERROR: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Cargar base y hacerme admin";
  }
});

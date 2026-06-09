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
let userData = null;

const log = (text) => {
  const el = document.getElementById("setupLog");
  if (el) el.innerHTML += `<br>${text}`;
};

const setButtonState = (disabled, text) => {
  const btn = document.getElementById("loadBtn");
  if (!btn) return;
  btn.disabled = disabled;
  if (text) btn.textContent = text;
};

/*
  SETUP PROTEGIDO PARA PRODUCCIÓN

  Este archivo ya NO convierte a cualquier usuario autenticado en admin.
  Para usarlo en producción, el usuario conectado ya debe existir en users/{uid}
  con role: "admin" y active: true.

  El setup inicial, cuando todavía no existe ningún admin, debe hacerse solo
  en configuración local/temporal usando reglas iniciales y luego publicar
  firestore-rules-finales.txt.
*/

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    window.location.href = "login.html";
    return;
  }

  user = u;
  document.getElementById("setupUser").textContent = u.email || u.uid;

  if (!u.emailVerified) {
    log("Acceso bloqueado: primero verificá el correo electrónico.");
    setButtonState(true, "Setup bloqueado");
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", u.uid));

    if (!snap.exists()) {
      log(
        "Acceso bloqueado: este usuario no tiene perfil definitivo en users.",
      );
      log("El setup inicial no debe ejecutarse desde producción pública.");
      setButtonState(true, "Setup bloqueado");
      return;
    }

    userData = snap.data();

    if (userData.role !== "admin" || userData.active !== true) {
      log(
        "Acceso bloqueado: solo un admin activo puede ejecutar este setup protegido.",
      );
      setButtonState(true, "Setup bloqueado");
      return;
    }

    log(
      "Admin verificado. Podés recargar datos base si realmente es necesario.",
    );
    setButtonState(false, "Cargar base protegida");
  } catch (err) {
    console.error(err);
    log(
      "ERROR: no se pudo verificar el rol admin. Revisá reglas de Firestore.",
    );
    setButtonState(true, "Setup bloqueado");
  }
});

document.getElementById("loadBtn")?.addEventListener("click", async () => {
  if (!user || userData?.role !== "admin" || userData?.active !== true) {
    log("Acción bloqueada: el usuario conectado no es admin activo.");
    return;
  }

  if (
    !confirm(
      "Este setup recargará fases, equipos, partidos y configuración. ¿Continuar?",
    )
  ) {
    return;
  }

  setButtonState(true, "Cargando...");

  try {
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

    log("Cargando partidos...");

    for (const m of MATCHES) {
      batch.set(doc(db, "matches", String(m.n)), {
        id: String(m.n),
        number: m.n,
        phase: m.p,
        group: m.g || "",
        teamAId: m.a,
        teamBId: m.b,
        dateTime: m.dt || "",
        dateOnly: m.dateOnly || "",
        dateText: m.txt || "Horario a confirmar",
        venue: m.v || "",
        status: "pending",
        goalsA: null,
        goalsB: null,
        penaltyWinnerId: "",
        winnerId: "",
        order: m.n,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (++count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }

    batch.set(
      doc(db, "settings", "tournament"),
      {
        predictionsCloseMinutes: 30,
        predictionOpenDaysBefore: 2,
        realChampionId: "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      doc(db, "leaderboards", "current"),
      {
        individual: [],
        specialties: [],
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();

    log("Base recargada correctamente por admin verificado.");
  } catch (err) {
    console.error(err);
    log("ERROR: " + (err.message || "No se pudo ejecutar setup protegido."));
  } finally {
    setButtonState(false, "Cargar base protegida");
  }
});

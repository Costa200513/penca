require("dotenv").config();
const admin = require("firebase-admin");

// 1. Inicializar Firebase Admin
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountKey) {
  console.error("Error: FIREBASE_SERVICE_ACCOUNT no encontrada en el entorno.");
  process.exit(1);
}
const serviceAccount = JSON.parse(serviceAccountKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

/**
 * Función auxiliar para llamar a la API de football-data.org (100% Gratis para el Mundial)
 */
async function fetchFinishedFixtures() {
  const API_KEY = process.env.FOOTBALL_DATA_KEY;
  if (!API_KEY) {
    console.warn("Aviso: FOOTBALL_DATA_KEY no configurada. Saltando sincronización de API.");
    return [];
  }

  // ID 2000 o "WC" corresponde a la Copa del Mundo de la FIFA
  const url = "https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED";
  
  try {
    const response = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
    if (!response.ok) return [];
    const json = await response.json();
    return json.matches || [];
  } catch (error) {
    console.error("Error consultando API:", error);
    return [];
  }
}

/**
 * Lógica de puntuación
 */
function scorePrediction(pred, m) {
  if (!pred || m.status !== "played" || m.goalsA == null || m.goalsB == null) {
    return { points: 0, exact: 0, partial: 0, draw: 0, penalties: 0, incorrect: 0 };
  }
  const pa = Number(pred.goalsA), pb = Number(pred.goalsB);
  const ra = Number(m.goalsA), rb = Number(m.goalsB);
  let points = 0, exact = 0, partial = 0, draw = 0, penalties = 0, incorrect = 0;

  if (pa === ra && pb === rb) { points = 3; exact = 1; }
  else if (pa === pb && ra === rb) { points = 1; draw = 1; }
  else if ((pa > pb && ra > rb) || (pa < pb && ra < rb)) { points = 2; partial = 1; }

  if (m.penaltyWinnerId && pred.penaltyWinnerId && m.penaltyWinnerId === pred.penaltyWinnerId && pa === pb) {
    points += 1;
    penalties = 1;
  }
  
  if (points === 0) incorrect = 1;
  return { points, exact, partial, draw, penalties, incorrect };
}

/**
 * Script Principal
 */
async function runSync() {
  console.log("Iniciando ciclo de sincronización y cálculo de ranking...");
  let matchUpdated = false;

  // --- PARTE A: Sincronización de Partidos ---
  const matchesSnap = await db.collection("matches").get();
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  const pendingMatches = matches.filter(m => m.status !== "played" && m.dateTime);
  
  if (pendingMatches.length > 0) {
    const apiMatches = await fetchFinishedFixtures();
    const batch = db.batch();

    for (const match of pendingMatches) {
      // Buscar el partido equivalente en la API usando las siglas (TLA: Three Letter Acronym) ej: ARG, BRA
      const apiMatch = apiMatches.find(f => {
        const hId = f.homeTeam.tla;
        const aId = f.awayTeam.tla;
        return (hId === match.teamAId && aId === match.teamBId) || (hId === match.teamBId && aId === match.teamAId);
      });

      if (apiMatch) {
        const isHomeA = apiMatch.homeTeam.tla === match.teamAId;
        const goalsHome = apiMatch.score.fullTime.home;
        const goalsAway = apiMatch.score.fullTime.away;
        
        const updateData = {
          status: "played",
          goalsA: isHomeA ? goalsHome : goalsAway,
          goalsB: isHomeA ? goalsAway : goalsHome
        };

        // Si hubo penales
        if (apiMatch.score.penalties && apiMatch.score.penalties.home !== null) {
          const penHome = apiMatch.score.penalties.home;
          const penAway = apiMatch.score.penalties.away;
          updateData.penaltyWinnerId = penHome > penAway 
            ? (isHomeA ? match.teamAId : match.teamBId) 
            : (isHomeA ? match.teamBId : match.teamAId);
        }

        const ref = db.collection("matches").doc(match.id);
        batch.update(ref, updateData);
        console.log(`Actualizando partido: ${match.teamAId} vs ${match.teamBId}`);
        matchUpdated = true;
        
        // Actualizar array en memoria para el cálculo del ranking
        Object.assign(match, updateData);
      }
    }

    if (matchUpdated) {
      await batch.commit();
      console.log("Partidos guardados en Firestore.");
    }
  }

  // --- PARTE B: Cálculo de Ranking (Optimización Firebase) ---
  console.log("Calculando Leaderboard...");
  const [usersSnap, predsSnap, settingsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("predictions").get(),
    db.doc("settings/tournament").get()
  ]);

  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const predictions = predsSnap.docs.map(d => d.data());
  const settings = settingsSnap.data() || {};
  const realChampionId = settings.realChampionId || "";

  const usersRank = users
    .filter(u => u.active !== false && u.role !== "admin")
    .map(u => {
      let exact = 0, partial = 0, draw = 0, penalties = 0, incorrect = 0, points = 0;
      predictions.filter(p => p.uid === u.uid).forEach(p => {
        const m = matches.find(x => x.id === p.matchId);
        if (!m) return;
        const s = scorePrediction(p, m);
        exact += s.exact; partial += s.partial; draw += s.draw;
        penalties += s.penalties; incorrect += s.incorrect; points += s.points;
      });

      if (realChampionId && u.championId === realChampionId) points += 10;

      return {
        uid: u.uid, username: u.username, fullName: u.fullName,
        specialty: u.specialty, participantType: u.participantType, active: true,
        exact, partial, draw, penalties, incorrect, points,
        aciertos: exact + partial + draw,
        totalPredictions: predictions.filter(p => p.uid === u.uid).length
      };
    })
    .sort((a, b) => b.points - a.points || b.exact - a.exact)
    .map((u, i) => ({ ...u, position: i + 1 }));

  const bySpecialty = new Map();
  usersRank.forEach(u => {
    const key = u.specialty || "Sin especialidad";
    if (!bySpecialty.has(key)) {
      bySpecialty.set(key, { specialty: key, points: 0, aciertos: 0, exact: 0, partial: 0, draw: 0, penalties: 0, incorrect: 0, users: 0 });
    }
    const row = bySpecialty.get(key);
    row.points += u.points; row.aciertos += u.aciertos; row.exact += u.exact; row.partial += u.partial;
    row.draw += u.draw; row.penalties += u.penalties; row.incorrect += u.incorrect; row.users += 1;
  });

  const specialtyRank = [...bySpecialty.values()]
    .sort((a, b) => b.points - a.points || b.exact - a.exact)
    .map((r, i) => ({ ...r, position: i + 1 }));

  await db.doc("settings/leaderboard").set({
    updatedAt: new Date().toISOString(),
    usersRank,
    specialtyRank
  });

  console.log(`Leaderboard guardado: ${usersRank.length} usuarios.`);
  console.log("Proceso completado exitosamente.");
}

runSync().catch(console.error);

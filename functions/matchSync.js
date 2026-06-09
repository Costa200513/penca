/**
 * matchSync.js
 * Lógica central de sincronización de resultados del Mundial 2026.
 *
 * Estrategia:
 * - Se ejecuta cada minuto (disparado desde index.js).
 * - Busca partidos en Firestore que:
 *     a) NO estén marcados como "played"
 *     b) Su dateTime + 105 minutos ya pasó (el partido debería haber terminado)
 * - Para cada uno, consulta la API y actualiza Firestore si el resultado está disponible.
 * - La escritura usa el Admin SDK → bypassa las reglas de Firestore.
 * - Los listeners onSnapshot del cliente reciben el cambio automáticamente.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { toFirestoreId } = require("./teamMapping");
const { logger } = require("firebase-functions");

// Duración mínima de un partido para considerarlo terminable (90 min + 15 extra)
const MATCH_DURATION_MS = 105 * 60 * 1000;

// Estados de API-Football que indican partido finalizado
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

/**
 * Obtiene los partidos candidatos a actualizar desde Firestore.
 * Candidatos: status !== "played" y dateTime + 105 min <= ahora
 */
async function getCandidateMatches() {
  const db = getFirestore();
  const now = Date.now();
  const snap = await db.collection("matches").get();

  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((m) => {
      if (m.status === "played") return false;
      if (!m.dateTime) return false;
      const matchEnd = new Date(m.dateTime).getTime() + MATCH_DURATION_MS;
      return now >= matchEnd;
    });
}

/**
 * Llama a la API-Football para obtener los fixtures del Mundial 2026
 * que ya terminaron.
 * @returns {Array} lista de fixtures de la API
 */
async function fetchFinishedFixtures() {
  // Ahora usamos la API directa de API-Sports (dashboard.api-football.com)
  const API_KEY = process.env.RAPIDAPI_KEY;
  if (!API_KEY) {
    logger.error("[matchSync] RAPIDAPI_KEY no configurada. Abortando.");
    return [];
  }

  const url =
    "https://v3.football.api-sports.io/fixtures" +
    "?league=1&season=2026&status=FT-AET-PEN";

  const response = await fetch(url, {
    headers: {
      "x-apisports-key": API_KEY,
    },
  });

  if (!response.ok) {
    logger.error(`[matchSync] API error: ${response.status} ${response.statusText}`);
    return [];
  }

  const data = await response.json();
  return data?.response ?? [];
}

/**
 * Dado un fixture de la API, extrae goalsA, goalsB y penaltyWinnerId
 * usando el mapeo de equipos.
 *
 * @param {Object} fixture - Fixture de la respuesta de API-Football
 * @param {Object} fsMatch - Partido de Firestore (con teamAId, teamBId)
 * @returns {{ goalsA, goalsB, penaltyWinnerId, winnerId, status } | null}
 */
function extractResult(fixture, fsMatch) {
  const apiStatus = fixture.fixture?.status?.short;
  if (!FINISHED_STATUSES.has(apiStatus)) return null;

  const homeTeamApiId = fixture.teams?.home?.id;
  const awayTeamApiId = fixture.teams?.away?.id;
  const homeGoals = fixture.goals?.home;
  const awayGoals = fixture.goals?.away;

  if (homeGoals == null || awayGoals == null) return null;

  const homeFirestoreId = toFirestoreId(homeTeamApiId);
  const awayFirestoreId = toFirestoreId(awayTeamApiId);

  if (!homeFirestoreId || !awayFirestoreId) {
    logger.warn(
      `[matchSync] No se pudo mapear equipos: home=${homeTeamApiId}, away=${awayTeamApiId}`
    );
    return null;
  }

  // Determinar quién es teamA y quién es teamB en Firestore
  let goalsA, goalsB;
  if (homeFirestoreId === fsMatch.teamAId) {
    goalsA = homeGoals;
    goalsB = awayGoals;
  } else if (awayFirestoreId === fsMatch.teamAId) {
    goalsA = awayGoals;
    goalsB = homeGoals;
  } else {
    logger.warn(
      `[matchSync] Los equipos de la API no coinciden con el partido de Firestore: ${fsMatch.id}`
    );
    return null;
  }

  // Determinar ganador por penales (solo cuando aplica)
  let penaltyWinnerId = "";
  if (apiStatus === "PEN") {
    const homePenGoals = fixture.score?.penalty?.home;
    const awayPenGoals = fixture.score?.penalty?.away;
    if (homePenGoals != null && awayPenGoals != null) {
      penaltyWinnerId =
        homePenGoals > awayPenGoals ? homeFirestoreId : awayFirestoreId;
    }
  }

  // Determinar winnerId
  let winnerId = "";
  if (goalsA > goalsB) winnerId = fsMatch.teamAId;
  else if (goalsB > goalsA) winnerId = fsMatch.teamBId;
  else if (penaltyWinnerId) winnerId = penaltyWinnerId;

  return { goalsA, goalsB, penaltyWinnerId, winnerId, status: "played" };
}

/**
 * Función principal de sincronización.
 * Llamada desde index.js cada vez que dispara el cron.
 */
async function syncResults() {
  const db = getFirestore();

  // 1. Obtener partidos candidatos
  const candidates = await getCandidateMatches();
  if (candidates.length === 0) {
    logger.info("[matchSync] No hay partidos pendientes de sincronizar.");
    return;
  }
  logger.info(`[matchSync] Partidos candidatos: ${candidates.length}`);

  // 2. Fetch de resultados de la API
  const fixtures = await fetchFinishedFixtures();
  if (fixtures.length === 0) {
    logger.info("[matchSync] La API no devolvió resultados finalizados aún.");
    return;
  }

  // 3. Cruzar candidatos con resultados de la API
  let updatedCount = 0;
  const batch = db.batch();

  for (const fsMatch of candidates) {
    // Buscar en la API un fixture que coincida con los equipos del partido de Firestore
    const matchingFixture = fixtures.find((fix) => {
      const homeId = toFirestoreId(fix.teams?.home?.id);
      const awayId = toFirestoreId(fix.teams?.away?.id);
      return (
        (homeId === fsMatch.teamAId && awayId === fsMatch.teamBId) ||
        (homeId === fsMatch.teamBId && awayId === fsMatch.teamAId)
      );
    });

    if (!matchingFixture) {
      logger.info(
        `[matchSync] Sin resultado API para: ${fsMatch.teamAId} vs ${fsMatch.teamBId} (${fsMatch.id})`
      );
      continue;
    }

    const result = extractResult(matchingFixture, fsMatch);
    if (!result) continue;

    const matchRef = db.collection("matches").doc(fsMatch.id);
    batch.update(matchRef, {
      ...result,
      autoUpdatedAt: FieldValue.serverTimestamp(),
    });

    // Log de trazabilidad en adminLogs
    const logRef = db.collection("adminLogs").doc();
    batch.set(logRef, {
      type: "auto_result_sync",
      matchId: fsMatch.id,
      teamA: fsMatch.teamAId,
      teamB: fsMatch.teamBId,
      goalsA: result.goalsA,
      goalsB: result.goalsB,
      penaltyWinnerId: result.penaltyWinnerId,
      source: "api-football",
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info(
      `[matchSync] ✓ ${fsMatch.teamAId} ${result.goalsA} - ${result.goalsB} ${fsMatch.teamBId}` +
        (result.penaltyWinnerId ? ` (penales: ${result.penaltyWinnerId})` : "")
    );
    updatedCount++;
  }

  if (updatedCount > 0) {
    await batch.commit();
    logger.info(`[matchSync] Actualizados ${updatedCount} partidos en Firestore.`);
  } else {
    logger.info("[matchSync] No se encontraron nuevos resultados para actualizar.");
  }
}

module.exports = { syncResults };

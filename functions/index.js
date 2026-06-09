/**
 * index.js — Firebase Cloud Functions entry point
 * Penca Mundial 2026 — CeRP Litoral Norte
 *
 * Función: syncMatchResults
 * Disparo: cada minuto (pubsub schedule)
 * Lógica:  Solo llama a la API si hay partidos cuyo tiempo estimado de fin
 *          ya pasó y siguen sin estar marcados como "played". De esta forma,
 *          el fetch ocurre efectivamente "después de cada partido", no en un
 *          cron fijo independiente del fixture.
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { syncResults } = require("./matchSync");
const { logger } = require("firebase-functions");

initializeApp();

const rapidApiKey = defineSecret("RAPIDAPI_KEY");

exports.syncMatchResults = onSchedule(
  {
    // Corre cada minuto durante todo el torneo.
    schedule: "every 1 minutes",
    timeZone: "America/Montevideo",
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
    // Inyecta el secreto de forma segura en tiempo de ejecución
    secrets: [rapidApiKey],
  },
  async (event) => {
    try {
      logger.info("[syncMatchResults] Disparado. Verificando partidos pendientes...");
      await syncResults();
      logger.info("[syncMatchResults] Ciclo completado.");
    } catch (err) {
      logger.error("[syncMatchResults] Error inesperado:", err);
    }
  }
);

/**
 * teamMapping.js
 * Mapeo de IDs de equipos de API-Football → IDs de Firestore (seed-data.js)
 *
 * Los IDs numéricos son los de API-Football para el Mundial 2026 (league=1).
 * Si un equipo no aparece en el torneo, simplemente no se busca.
 *
 * Para actualizar: https://api-football-v1.p.rapidapi.com/v3/teams?league=1&season=2026
 */

// apiId (number) → firestoreId (string)
const API_TO_FIRESTORE = new Map([
  // Grupo A
  [10,  "MEX"],  // México
  [815, "RSA"],  // Sudáfrica
  [149, "KOR"],  // República de Corea
  [56,  "CZE"],  // República Checa

  // Grupo B
  [100, "CAN"],  // Canadá
  [567, "BIH"],  // Bosnia y Herzegovina
  [101, "QAT"],  // Catar
  [15,  "SUI"],  // Suiza

  // Grupo C
  [6,   "BRA"],  // Brasil
  [32,  "MAR"],  // Marruecos
  [503, "HAI"],  // Haití
  [1242,"SCO"],  // Escocia

  // Grupo D
  [2,   "USA"],  // Estados Unidos
  [33,  "PAR"],  // Paraguay
  [25,  "AUS"],  // Australia
  [63,  "TUR"],  // Turquía

  // Grupo E
  [25,  "GER"],  // Alemania — nota: ajustar ID real
  [1601,"CUW"],  // Curazao
  [39,  "CIV"],  // Costa de Marfil
  [54,  "ECU"],  // Ecuador

  // Grupo F
  [1091,"NED"],  // Países Bajos
  [26,  "JPN"],  // Japón
  [642, "SWE"],  // Suecia
  [1216,"TUN"],  // Túnez

  // Grupo G
  [1,   "BEL"],  // Bélgica
  [21,  "EGY"],  // Egipto
  [796, "IRN"],  // RI de Irán
  [35,  "NZL"],  // Nueva Zelanda

  // Grupo H
  [9,   "ESP"],  // España
  [519, "CPV"],  // Cabo Verde
  [1882,"KSA"],  // Arabia Saudí
  [27,  "URU"],  // Uruguay

  // Grupo I
  [2,   "FRA"],  // Francia — ajustar ID real
  [716, "SEN"],  // Senegal
  [45,  "IRQ"],  // Irak
  [631, "NOR"],  // Noruega

  // Grupo J
  [26,  "ARG"],  // Argentina — ajustar ID real
  [25,  "ALG"],  // Argelia — ajustar ID real
  [775, "AUT"],  // Austria
  [274, "JOR"],  // Jordania

  // Grupo K
  [27,  "POR"],  // Portugal — ajustar ID real
  [62,  "COD"],  // RD Congo
  [719, "UZB"],  // Uzbekistán
  [8,   "COL"],  // Colombia

  // Grupo L
  [10,  "ENG"],  // Inglaterra — ajustar ID real
  [3,   "CRO"],  // Croacia
  [22,  "GHA"],  // Ghana
  [144, "PAN"],  // Panamá
]);

/**
 * Convierte un ID de API-Football al ID de Firestore.
 * @param {number} apiId
 * @returns {string|null}
 */
function toFirestoreId(apiId) {
  return API_TO_FIRESTORE.get(apiId) ?? null;
}

/**
 * Convierte un ID de Firestore a los posibles IDs de API-Football.
 * (Relación inversa — puede haber colisiones si el mismo apiId se asigna a 2 equipos)
 * @param {string} firestoreId
 * @returns {number|null}
 */
function toApiId(firestoreId) {
  for (const [apiId, fsId] of API_TO_FIRESTORE.entries()) {
    if (fsId === firestoreId) return apiId;
  }
  return null;
}

module.exports = { toFirestoreId, toApiId, API_TO_FIRESTORE };

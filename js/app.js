import { auth, db } from "./firebase-config.js";
import { TEAMS } from "./seed-data.js";
import {
  onAuthStateChanged,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentUser = null;
let userData = null;
let teams = new Map();
let phases = [];
let matches = [];
let predictions = [];
let users = [];
let settings = { predictionsCloseMinutes: 30, realChampionId: "" };
let selectedMatch = null;
let realtimeStarted = false;
let renderTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (v = "") =>
  String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[c],
  );

function renderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (currentUser && userData) renderAll();
  }, 80);
}

function startRealtimeListeners() {
  if (realtimeStarted) return;
  realtimeStarted = true;
  onSnapshot(query(collection(db, "matches"), orderBy("order")), (snap) => {
    matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSoon();
  });
  onSnapshot(collection(db, "predictions"), (snap) => {
    predictions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSoon();
  });
  onSnapshot(collection(db, "users"), (snap) => {
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const updated = users.find((u) => u.uid === currentUser?.uid);
    if (updated) userData = updated;
    renderSoon();
  });
  onSnapshot(doc(db, "settings", "tournament"), (snap) => {
    if (snap.exists()) settings = { ...settings, ...snap.data() };
    renderSoon();
  });
}

function sortByName(arr) {
  return [...arr].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "es", {
      sensitivity: "base",
    }),
  );
}

function realTeamsSorted() {
  return sortByName([...teams.values()].filter((t) => !t.isPlaceholder));
}

function parseGoalValue(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 50) return null;
  return n;
}

const CHAMPION_DEADLINE = new Date("2026-06-11T16:00:00-03:00");
function championSelectionClosed() {
  return Date.now() >= CHAMPION_DEADLINE.getTime();
}

function parseDateOnlyFromMatch(m) {
  if (m.dateOnly) return m.dateOnly;
  if (m.dateTime) return m.dateTime.slice(0, 10);
  const text = String(m.dateText || "");
  const mm = text.match(/(\d{2})\/(\d{2})/);
  if (!mm) return "";
  return `2026-${mm[2]}-${mm[1]}`;
}

function weekdayDateLabel(dateISO) {
  if (!dateISO) return "Horario a confirmar";
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0);
  const weekday = date.toLocaleDateString("es-UY", { weekday: "long" });
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function cleanVenueName(venue = "") {
  return String(venue || "").trim();
}

function matchDateLine(m = {}) {
  const venue = cleanVenueName(m.venue);
  let text = String(m.dateText || "Horario a confirmar").trim();

  if (venue && text.includes(venue)) {
    text = text
      .replace(new RegExp(`\\s*·\\s*${escapeRegExp(venue)}\\s*$`), "")
      .replace(new RegExp(`\\s*-\\s*${escapeRegExp(venue)}\\s*$`), "")
      .trim();
  }

  return text || "Horario a confirmar";
}

function matchVenueLine(m = {}) {
  return cleanVenueName(m.venue);
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hidePageLoader() {
  const loader = document.getElementById("pageLoader");
  if (loader) loader.classList.add("hidden");
}

function showPageLoader(text = "Cargando...") {
  const loader = document.getElementById("pageLoader");
  if (!loader) return;
  const span = loader.querySelector("span");
  if (span) span.textContent = text;
  loader.classList.remove("hidden");
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  if (!user.emailVerified) {
    alert(
      "Debés verificar tu correo electrónico antes de ingresar. Revisá tu bandeja de entrada.",
    );
    await signOut(auth);
    window.location.href = "login.html";
    return;
  }
  currentUser = user;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    alert("No existe perfil de usuario en Firestore.");
    await signOut(auth);
    window.location.href = "login.html";
    return;
  }
  userData = snap.data();
  if (!userData.active) {
    alert("Tu usuario está desactivado.");
    await signOut(auth);
    window.location.href = "login.html";
    return;
  }
  forceDarkTheme();
  await loadData();
  renderAll();
  startRealtimeListeners();
  hidePageLoader();
});

async function loadData() {
  const [
    teamsSnap,
    phasesSnap,
    matchesSnap,
    predictionsSnap,
    usersSnap,
    settingsSnap,
  ] = await Promise.all([
    getDocs(collection(db, "teams")),
    getDocs(query(collection(db, "phases"), orderBy("order"))),
    getDocs(query(collection(db, "matches"), orderBy("order"))),
    getDocs(collection(db, "predictions")),
    getDocs(collection(db, "users")),
    getDoc(doc(db, "settings", "tournament")),
  ]);
  teams = new Map(teamsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  phases = phasesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  matches = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  predictions = predictionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (settingsSnap.exists()) settings = { ...settings, ...settingsSnap.data() };
}

function renderAll() {
  renderShell();
  renderFixture();
  renderRanking();
  renderRules();
  renderProfile();
  renderRightPanel();
  if (isAdmin()) {
    renderAdmin();
    renderUsersAdmin();
  }
}

function isAdmin() {
  return userData?.role === "admin";
}
function initials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function userInitials(user = {}) {
  return initials(
    user.fullName ||
      user.nombre_completo ||
      user.username ||
      (user.email ? user.email.split("@")[0] : ""),
  );
}
function teamName(id) {
  return teams.get(id)?.name || id || "Sin asignar";
}
function teamIsPlaceholder(id) {
  return !!teams.get(id)?.isPlaceholder;
}
function matchClosed(m) {
  if (!m.dateTime) return false;
  return (
    Date.now() >=
    new Date(m.dateTime).getTime() -
      (settings.predictionsCloseMinutes || 30) * 60000
  );
}
function userPrediction(matchId, uid = currentUser.uid) {
  return predictions.find((p) => p.matchId == String(matchId) && p.uid === uid);
}
function isMatchAssigned(m) {
  return !teamIsPlaceholder(m.teamAId) && !teamIsPlaceholder(m.teamBId);
}
function statusFor(m) {
  if (m.status === "played") return ["Resultado cargado", "loaded"];
  if (!isMatchAssigned(m)) return ["Equipos pendientes", "closed"];
  if (matchClosed(m)) return ["Cerrado", "closed"];
  if (userPrediction(m.id)) return ["Pronosticado", "predicted"];
  return ["Pendiente", "pending"];
}
function scorePrediction(pred, m) {
  if (!pred || m.status !== "played" || m.goalsA == null || m.goalsB == null)
    return {
      points: 0,
      type: "pendiente",
      exact: 0,
      partial: 0,
      draw: 0,
      penalties: 0,
      incorrect: 0,
    };
  const pa = Number(pred.goalsA),
    pb = Number(pred.goalsB),
    ra = Number(m.goalsA),
    rb = Number(m.goalsB);
  let points = 0,
    type = "incorrecto",
    exact = 0,
    partial = 0,
    draw = 0,
    penalties = 0,
    incorrect = 0;
  if (pa === ra && pb === rb) {
    points = 3;
    type = "exacto";
    exact = 1;
  } else if (pa === pb && ra === rb) {
    points = 1;
    type = "empate";
    draw = 1;
  } else if ((pa > pb && ra > rb) || (pa < pb && ra < rb)) {
    points = 2;
    type = "parcial";
    partial = 1;
  }
  if (
    m.penaltyWinnerId &&
    pred.penaltyWinnerId &&
    m.penaltyWinnerId === pred.penaltyWinnerId &&
    pa === pb
  ) {
    points += 1;
    penalties = 1;
  }
  if (points === 0) incorrect = 1;
  return { points, type, exact, partial, draw, penalties, incorrect };
}

function renderShell() {
  $("app").innerHTML = `
  <aside class="sidebar">
    <div class="logo logo-large"><div class="logo-icon logo-image"><img src="img/logo_penca.png" alt="Mundial 2026"></div></div>
    <nav class="menu">
      <button class="active" onclick="showSection('fixture', this)">⚽ Fixture</button>
      <button onclick="showSection('ranking', this)">🏆 Ranking</button>
      <button onclick="showSection('reglas', this)">📘 Reglas</button>
      <button onclick="showSection('perfil', this)">👤 Perfil</button>
      ${isAdmin() ? `<button onclick="showSection('admin', this)">Admin resultados</button><button onclick="showSection('usuarios', this)">Gestión usuarios</button>` : ""}
    </nav>
    <div class="credits">Desarrollado por Ezequiel Costa<br>3.º año de Profesorado de Informática<br>Ingenieria de Software</div>
  </aside>
  <main class="main">
    <section id="fixture" class="section active"></section><section id="ranking" class="section"></section><section id="reglas" class="section"></section><section id="perfil" class="section"></section>${isAdmin() ? `<section id="admin" class="section"></section><section id="usuarios" class="section"></section>` : ""}
  </main>
  <aside class="right-panel" id="rightPanel"></aside>
  <div id="predictionModal" class="modal"></div>`;
}

function renderFixture() {
  const html = `<h1>Fixture</h1><div class="underline"></div><p class="subtitle">Pronósticos cerrados 30 minutos antes del inicio. </p>
  <div class="phase-tabs">${phases.map((f, i) => `<button class="phase-btn ${i === 0 ? "active" : ""}" onclick="showFixturePhase('fase-${f.id}', this)">${esc(f.name)}</button>`).join("")}</div>
  ${phases
    .map(
      (f, i) =>
        `<div id="fase-${f.id}" class="fixture-phase ${i === 0 ? "active" : ""}"><div class="fixture-list">${matches
          .filter((m) => m.phase === f.id)
          .map(renderMatchCard)
          .join("")}</div></div>`,
    )
    .join("")}`;
  $("fixture").innerHTML = html;
}
function renderMatchCard(m) {
  const [label, klass] = statusFor(m);
  const pr = userPrediction(m.id);
  const assigned = isMatchAssigned(m);
  const closed = klass === "closed" || klass === "loaded" || !assigned;
  const resultHtml =
    m.status === "played"
      ? `<strong>${m.goalsA} - ${m.goalsB}</strong><span>Resultado</span>`
      : `<strong>${pr ? `${pr.goalsA} - ${pr.goalsB}` : "-"}</strong><span>Tu pronóstico</span>`;
  return `<article id="match-${m.id}" class="match-card" data-id="${m.id}"><div class="match-info"><span class="group-label">${esc(phaseName(m.phase))}${m.group ? " · Grupo " + esc(m.group) : ""}</span><div class="teams"><span>${esc(teamName(m.teamAId))}</span><span class="vs">VS</span><span>${esc(teamName(m.teamBId))}</span></div><span class="status-badge ${klass}">${label}</span></div><div class="time">${esc(matchDateLine(m))}${matchVenueLine(m) ? `<br>${esc(matchVenueLine(m))}` : ""}</div><div class="match-result-side ${m.status === "played" ? "loaded" : ""}">${resultHtml}</div>${isAdmin() ? `<span class="status">Admin</span>` : `<button class="action-btn ${closed ? "closed" : ""}" ${closed ? "disabled" : ""} onclick="openPrediction('${m.id}')">${!assigned ? "Pendiente" : closed ? "Cerrado" : pr ? "Editar" : "Predecir"}</button>`}</article>`;
}
function phaseName(id) {
  return phases.find((f) => f.id === id)?.name || id;
}

function rankingData() {
  return users
    .filter((u) => u.active !== false && u.role !== "admin")
    .map((u) => {
      let exact = 0,
        partial = 0,
        draw = 0,
        penalties = 0,
        incorrect = 0,
        points = 0;
      predictions
        .filter((p) => p.uid === u.uid)
        .forEach((p) => {
          const m = matches.find((x) => x.id === p.matchId);
          const s = scorePrediction(p, m || {});
          exact += s.exact;
          partial += s.partial;
          draw += s.draw;
          penalties += s.penalties;
          incorrect += s.incorrect;
          points += s.points;
        });
      if (settings.realChampionId && u.championId === settings.realChampionId)
        points += 10;
      return {
        ...u,
        exact,
        partial,
        draw,
        penalties,
        incorrect,
        points,
        aciertos: exact + partial + draw,
      };
    })
    .sort((a, b) => b.points - a.points || b.exact - a.exact)
    .map((u, i) => ({ ...u, position: i + 1 }));
}

function specialtyRankingData() {
  const bySpecialty = new Map();
  rankingData().forEach((u) => {
    const key = u.specialty || "Sin especialidad";
    if (!bySpecialty.has(key)) {
      bySpecialty.set(key, {
        username: key,
        specialty: key,
        fullName: key,
        points: 0,
        aciertos: 0,
        exact: 0,
        partial: 0,
        draw: 0,
        penalties: 0,
        incorrect: 0,
        users: 0,
      });
    }
    const row = bySpecialty.get(key);
    row.points += u.points;
    row.aciertos += u.aciertos;
    row.exact += u.exact;
    row.partial += u.partial;
    row.draw += u.draw;
    row.penalties += u.penalties;
    row.incorrect += u.incorrect;
    row.users += 1;
  });
  return [...bySpecialty.values()]
    .sort((a, b) => b.points - a.points || b.exact - a.exact)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

function renderRankingBlock(title, description, data, mode = "user") {
  const top = data.slice(0, 3);
  const rest = data.slice(3);
  const podium = [top[1], top[0], top[2]].filter(Boolean);
  const cls = { 1: "first", 2: "second", 3: "third" },
    med = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const label = (r) =>
    mode === "specialty" ? esc(r.specialty) : "@" + esc(r.username);
  const sub = (r) =>
    mode === "specialty"
      ? `${r.users} participantes`
      : `${esc(r.specialty || "-")} · ${esc(r.year || "-")}.º`;
  const isCurrentUser = (r) =>
    mode === "user" && currentUser && r.uid === currentUser.uid;

  return `<div class="ranking-block"><div class="ranking-list-header"><div><h3>${title}</h3><p>${description}</p></div></div><div class="podium">${podium.map((r) => `<article class="podium-card ${cls[r.position] || ""} ${isCurrentUser(r) ? "current" : ""}"><div class="podium-medal">${med[r.position] || "🏅"}</div><h3 class="podium-username">${label(r)}</h3><p class="podium-realname">${sub(r)}</p><div class="podium-points">${r.points} pts</div><div class="podium-correct">${r.aciertos} aciertos</div><button class="details-btn podium-details-btn" onclick="toggleRankingDetails(this)">+</button><div class="ranking-details podium-details">${detailPills(r)}</div></article>`).join("")}</div><div class="ranking-list">${rest.map((r) => `<div class="ranking-item ${isCurrentUser(r) ? "current" : ""}"><div class="ranking-row"><span class="position">${r.position}.º</span><span class="ranking-user"><strong>${label(r)}</strong><small>${sub(r)}</small></span><span>${r.aciertos} aciertos</span><span class="points">${r.points} pts</span><button class="details-btn" onclick="toggleRankingDetails(this)">+</button></div><div class="ranking-details">${detailPills(r)}</div></div>`).join("") || '<div class="empty-ranking">No hay más posiciones para mostrar.</div>'}</div></div>`;
}

function currentUserRankingStats() {
  if (isAdmin()) return { points: 0, aciertos: 0, position: "-" };
  const row = rankingData().find((r) => r.uid === currentUser.uid);
  return row || { points: 0, aciertos: 0, position: "-" };
}

function renderRanking() {
  const usersRank = rankingData();
  const specialtyRank = specialtyRankingData();

  $("ranking").innerHTML = `<h1>Ranking</h1>
    <div class="underline"></div>
    <p class="subtitle">Consultá la tabla individual o la suma total por especialidad.</p>

    <div class="phase-tabs ranking-tabs">
      <button class="phase-btn active" onclick="showRankingTab('ranking-individual', this)">Individual</button>
      <button class="phase-btn" onclick="showRankingTab('ranking-specialty', this)">Especialidad</button>
    </div>

    <div class="ranking-container">
      <div id="ranking-individual" class="ranking-tab-panel active">
        ${renderRankingBlock(" ", " ", usersRank, "user")}
      </div>

      <div id="ranking-specialty" class="ranking-tab-panel">
        ${renderRankingBlock(" ", " ", specialtyRank, "specialty")}
      </div>
    </div>`;
}
function detailPills(r) {
  return `<div class="detail-pill"><strong>${r.exact}</strong><span>Exactos</span></div><div class="detail-pill"><strong>${r.partial}</strong><span>Parciales</span></div><div class="detail-pill"><strong>${r.draw}</strong><span>Empates</span></div><div class="detail-pill"><strong>${r.penalties}</strong><span>Penales</span></div><div class="detail-pill"><strong>${r.incorrect}</strong><span>Incorrectos</span></div>`;
}

function renderRules() {
  $("reglas").innerHTML =
    `<h1>Reglas</h1><div class="underline"></div><div class="rules-grid"><div class="rule-card"><div class="rule-points">+3</div><h3>Resultado exacto</h3><p>Pronóstico: Uruguay 2 - 1 España<br>Resultado: Uruguay 2 - 1 España</p></div><div class="rule-card"><div class="rule-points">+2</div><h3>Ganador acertado</h3><p>Pronóstico: Uruguay 1 - 0 España<br>Resultado: Uruguay 2 - 1 España</p></div><div class="rule-card"><div class="rule-points">+1</div><h3>Empate acertado</h3><p>Pronóstico: Uruguay 1 - 1 España<br>Resultado: Uruguay 2 - 2 España</p></div><div class="rule-card"><div class="rule-points">+1</div><h3>Bonus penales</h3><p>En eliminatorias, si pronosticás empate y acertás el ganador por penales.</p></div><div class="rule-card"><div class="rule-points">0</div><h3>Incorrecto</h3><p>Pronóstico: Uruguay 2 - 0 España<br>Resultado: Uruguay 0 - 1 España</p></div><div class="rule-card"><div class="rule-points">+10</div><h3>Campeón</h3><p>Si tu campeón elegido gana el torneo.</p></div></div>`;
}

function renderProfile() {
  const myPreds = predictions.filter((p) => p.uid === currentUser.uid);
  const champ = userData.championName || teamName(userData.championId);
  const championBlock = userData.championId
    ? `<div class="champion-locked-clean"><span>Campeón elegido</span><strong>${esc(champ)}</strong><small>Elección bloqueada. Ya no se puede modificar.</small></div>`
    : championSelectionClosed()
      ? `<div class="champion-locked-clean champion-closed"><span>Selección cerrada</span><strong>No elegiste campeón</strong><small>La elección de campeón cerró el 11/06/2026 antes del primer partido.</small></div>`
      : `<form id="profileChampionForm" class="champion-form champion-form-clean">
        <label>Seleccionar campeón
          <select id="profileChampionId" required>
            <option value="">Elegí una selección</option>
            ${realTeamsSorted()
              .map(
                (t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <button class="save-btn">Guardar campeón</button>
      </form>`;

  $("perfil").innerHTML =
    `<h1>Perfil</h1><div class="underline"></div><div class="profile-dashboard"><div class="dashboard-card"><div class="profile-identity-main"><div class="no-photo-badge profile-avatar">${userInitials(userData)}</div><div class="profile-identity-info"><span class="profile-label">Participante</span><h2>${esc(userData.fullName)}</h2><p class="profile-username">@${esc(userData.username)}</p><div class="profile-meta-grid"><div><span>Correo</span><strong>${esc(userData.email)}</strong></div><div><span>Perfil</span><strong>${userData.participantType === "teacher" ? "Docente" : "Estudiante"}</strong></div><div><span>Especialidad</span><strong>${esc(userData.specialty)}</strong></div><div><span>Año</span><strong>${esc(userData.year || "-")}.º</strong></div></div></div></div></div><div class="dashboard-card profile-champion-card"><span class="profile-label">Mi campeón elegido</span><h3>Predicción a largo plazo</h3><p class="champion-help">Elegí una selección desde tu perfil. La elección queda bloqueada y puede sumar <strong>+10 puntos</strong>.</p>${championBlock}<p id="championMsg" class="inline-message"></p></div><div class="dashboard-card history-card"><span class="profile-label">Historial de pronósticos</span><h3>Consultar partido</h3>${
      myPreds.length
        ? `<select id="historySelect" class="history-select" onchange="showHistoryDetail(this.value)"><option value="">Seleccionar partido</option>${myPreds
            .map((p, i) => {
              const m = matches.find((x) => x.id === p.matchId);
              return `<option value="hist-${i}">${esc(teamName(m?.teamAId))} vs ${esc(teamName(m?.teamBId))}</option>`;
            })
            .join("")}</select>${myPreds
            .map((p, i) => {
              const m = matches.find((x) => x.id === p.matchId);
              const st = scorePrediction(p, m || {});
              return `<div id="hist-${i}" class="history-detail"><p><strong>Partido:</strong> ${esc(teamName(m?.teamAId))} vs ${esc(teamName(m?.teamBId))}</p><p><strong>Tu pronóstico:</strong> ${p.goalsA} - ${p.goalsB}</p><p><strong>Resultado real:</strong> ${m?.status === "played" ? `${m.goalsA} - ${m.goalsB}` : "Pendiente"}</p><p><strong>Puntos:</strong> ${st.points}</p><p><strong>Estado:</strong> ${esc(st.type)}</p></div>`;
            })
            .join("")}`
        : '<p class="subtitle">Todavía no hiciste pronósticos.</p>'
    }</div><div class="dashboard-card"><span class="profile-label">Seguridad</span><h3>Cambiar contraseña</h3><form id="passwordForm" class="security-form"><div class="form-grid"><div class="form-group"><label>Contraseña actual</label><input id="currentPass" type="password" required minlength="6" autocomplete="current-password"></div><div class="form-group"><label>Nueva contraseña</label><input id="newPass" type="password" required minlength="6" autocomplete="new-password"></div><div class="form-group"><label>Repetir contraseña</label><input id="repeatPass" type="password" required minlength="6" autocomplete="new-password"></div></div><button class="save-btn">Cambiar contraseña</button></form><p id="passwordMsg" class="inline-message"></p><div class="profile-logout-box"><div><strong>Cerrar sesión</strong><p>Salir de tu cuenta actual.</p></div><button class="profile-logout-link" onclick="logout()">Cerrar sesión</button></div></div></div>`;
  $("passwordForm")?.addEventListener("submit", changePassword);
  $("profileChampionForm")?.addEventListener("submit", saveChampionProfile);
}

async function saveChampionProfile(e) {
  e.preventDefault();
  const msg = $("championMsg");
  const championId = $("profileChampionId")?.value || "";
  const championName = teamName(championId);

  if (!championId) {
    msg.textContent = "Debés elegir un campeón.";
    msg.className = "inline-message error";
    return;
  }

  if (championSelectionClosed()) {
    msg.textContent = "La elección de campeón ya está cerrada.";
    msg.className = "inline-message error";
    return;
  }

  if (userData.championId) {
    msg.textContent = "Ya elegiste un campeón. La elección está bloqueada.";
    msg.className = "inline-message error";
    return;
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "users", currentUser.uid), {
      championId,
      championName,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "champions", currentUser.uid), {
      uid: currentUser.uid,
      championId,
      championName,
      locked: true,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    await loadData();
    userData = users.find((u) => u.uid === currentUser.uid) || {
      ...userData,
      championId,
      championName,
    };
    renderAll();
  } catch (err) {
    console.error(err);
    msg.textContent =
      "No se pudo guardar el campeón. Revisá las reglas de Firestore.";
    msg.className = "inline-message error";
  }
}

async function changePassword(e) {
  e.preventDefault();
  const msg = $("passwordMsg");
  const current = $("currentPass")?.value || "";
  const a = $("newPass")?.value || "";
  const b = $("repeatPass")?.value || "";

  msg.textContent = "";
  msg.className = "inline-message";

  if (!current) {
    msg.textContent = "Ingresá tu contraseña actual.";
    msg.className = "inline-message error";
    return;
  }

  if (a !== b) {
    msg.textContent = "Las contraseñas no coinciden.";
    msg.className = "inline-message error";
    return;
  }

  if (a.length < 6) {
    msg.textContent = "La contraseña debe tener al menos 6 caracteres.";
    msg.className = "inline-message error";
    return;
  }

  if (current === a) {
    msg.textContent = "La nueva contraseña debe ser diferente a la actual.";
    msg.className = "inline-message error";
    return;
  }

  try {
    /*
      Firebase exige una autenticación reciente para cambiar la contraseña.
      Por eso primero reautenticamos al usuario con su contraseña actual
      y recién después actualizamos la contraseña.
    */
    const credential = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, a);

    msg.textContent = "Contraseña actualizada correctamente.";
    msg.className = "inline-message success";
    e.target.reset();
  } catch (err) {
    console.error(err);

    if (
      err.code === "auth/wrong-password" ||
      err.code === "auth/invalid-credential"
    ) {
      msg.textContent = "La contraseña actual no es correcta.";
    } else if (err.code === "auth/weak-password") {
      msg.textContent = "La nueva contraseña debe tener al menos 6 caracteres.";
    } else if (err.code === "auth/too-many-requests") {
      msg.textContent =
        "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
    } else if (err.code === "auth/requires-recent-login") {
      msg.textContent =
        "Por seguridad, cerrá sesión, volvé a ingresar e intentá nuevamente.";
    } else {
      msg.textContent =
        "No se pudo cambiar la contraseña. Verificá los datos e intentá nuevamente.";
    }

    msg.className = "inline-message error";
  }
}

function renderRightPanel() {
  const next = matches
    .filter(
      (m) => m.status !== "played" && isMatchAssigned(m) && !matchClosed(m),
    )
    .sort(
      (a, b) => new Date(a.dateTime || "2999") - new Date(b.dateTime || "2999"),
    )[0];

  const myStats = currentUserRankingStats();

  $("rightPanel").innerHTML = `
    <div class="resume-content right-panel-user-card">
      <div class="user-large right-user-summary">
        <div class="no-photo-badge right-panel-avatar">${userInitials(userData)}</div>
        <div>
          <h3>@${esc(userData.username)}</h3>
          <p>${esc(userData.fullName || userData.email || "")}</p>
        </div>
      </div>
      <div class="summary-numbers right-summary-numbers">
        <div><strong>${myStats.aciertos}</strong><span>Aciertos</span></div>
        <div><strong>${myStats.points}</strong><span>Puntos</span></div>
        <div><strong>${myStats.position}</strong><span>Puesto</span></div>
      </div>
    </div>
    <div class="next-match">
      <h4>Próximo partido</h4>
      ${next ? `<strong>${esc(teamName(next.teamAId))} vs ${esc(teamName(next.teamBId))}</strong><p>${esc(next.dateText || "Horario a confirmar")}</p>${isAdmin() ? `<button class="action-btn next-match-btn" onclick="goToAdminNextMatch('admin-${next.phase}', 'admin-match-${next.id}')">Determinar</button>` : `<button class="action-btn next-match-btn" onclick="goToNextMatch('fase-${next.phase}', 'match-${next.id}')">Pronosticar</button>`}` : "<p>No hay partidos abiertos.</p>"}
    </div>
    <div class="rules-box">
      <h4>Reglas rápidas</h4>
      <p><strong>+3 puntos</strong> por el resultado exacto.</p>
      <p><strong>+2 puntos</strong> por un ganador correcto.</p>
      <p><strong>+1 punto</strong> por un empate correcto.</p>
      <p><strong>+1 punto bonus</strong> por penales.</p>
    </div>`;
}

function renderAdmin() {
  $("admin").innerHTML =
    `<h1>Admin resultados</h1><div class="underline"></div><p class="subtitle">Cargá resultados y horarios. El admin no puede pronosticar.</p><div class="phase-tabs">${phases.map((f, i) => `<button class="phase-btn ${i === 0 ? "active" : ""}" onclick="showFixturePhase('admin-${f.id}', this)">${esc(f.name)}</button>`).join("")}<button class="phase-btn" onclick="showFixturePhase('admin-champion', this)">Campeón final</button></div>${phases
      .map(
        (f, i) =>
          `<div id="admin-${f.id}" class="fixture-phase ${i === 0 ? "active" : ""}"><div class="admin-results-list">${matches
            .filter((m) => m.phase === f.id)
            .map(renderAdminMatch)
            .join("")}</div></div>`,
      )
      .join(
        "",
      )}<div id="admin-champion" class="fixture-phase"><div class="admin-match-card"><div class="admin-match-info"><span class="section-title">Configuración final</span><h3>Campeón real</h3><p>Al definirlo, se suman +10 puntos a quienes lo eligieron.</p></div><form id="realChampionForm" class="admin-score-form"><label>Campeón real<select id="realChampion">${realTeamsOptions(settings.realChampionId)}</select></label><button class="save-btn">Guardar campeón real</button></form></div></div>`;
  document
    .querySelectorAll(".admin-schedule-form[data-match]")
    .forEach((f) => f.addEventListener("submit", saveSchedule));
  document
    .querySelectorAll(".admin-score-form[data-match]")
    .forEach((f) => f.addEventListener("submit", saveResult));
  document
    .querySelectorAll(".admin-manual-form[data-match]")
    .forEach((f) => f.addEventListener("submit", saveTeams));
  $("realChampionForm")?.addEventListener("submit", saveRealChampion);
}
function realTeamsOptions(selected = "") {
  return (
    '<option value="">Seleccionar</option>' +
    realTeamsSorted()
      .map(
        (t) =>
          `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.name)}</option>`,
      )
      .join("")
  );
}
function renderAdminMatch(m) {
  return `<article id="admin-match-${m.id}" class="admin-match-card">
    <div class="admin-match-info">
      <span class="section-title">${esc(phaseName(m.phase))}${m.group ? " · Grupo " + esc(m.group) : ""}</span>
      <h3>${esc(teamName(m.teamAId))} vs ${esc(teamName(m.teamBId))}</h3>
      <p>${esc(matchDateLine(m))}${matchVenueLine(m) ? ` · ${esc(matchVenueLine(m))}` : ""}</p>
    </div>
    <div class="admin-forms-row admin-forms-row-three">
      <form class="admin-manual-form" data-match="${m.id}">
        <label>Equipo A<select name="teamAId">${teamOptions(m.teamAId)}</select></label>
        <label>Equipo B<select name="teamBId">${teamOptions(m.teamBId)}</select></label>
        <button class="cancel-btn">Actualizar equipos</button>
      </form>
      <form class="admin-schedule-form admin-manual-form" data-match="${m.id}">
        <label>Día del partido<input name="matchDate" type="date" value="${parseDateOnlyFromMatch(m)}"></label>
        <label>Hora del partido (Uruguay)<input name="matchTime" type="time" value="${m.dateTime ? m.dateTime.substring(11, 16) : ""}"></label>
        <small class="input-help">Podés guardar solo la hora usando el día ya cargado, o corregir el día y la hora sin cargar resultado.</small>
        <div class="schedule-form-actions">
          <button class="cancel-btn" name="scheduleAction" value="time">Guardar hora</button>
          <button class="cancel-btn" name="scheduleAction" value="dateTime">Guardar día y hora</button>
        </div>
      </form>
      <form class="admin-score-form" data-match="${m.id}">
        <label>${esc(teamName(m.teamAId))}<input name="goalsA" type="number" min="0" max="50" step="1" inputmode="numeric" pattern="[0-9]*" value="${m.goalsA ?? ""}" required></label>
        <label>${esc(teamName(m.teamBId))}<input name="goalsB" type="number" min="0" max="50" step="1" inputmode="numeric" pattern="[0-9]*" value="${m.goalsB ?? ""}" required></label>
        <label>Ganador por penales<select name="penaltyWinnerId"><option value="">No aplica</option><option value="${m.teamAId}" ${m.penaltyWinnerId === m.teamAId ? "selected" : ""}>${esc(teamName(m.teamAId))}</option><option value="${m.teamBId}" ${m.penaltyWinnerId === m.teamBId ? "selected" : ""}>${esc(teamName(m.teamBId))}</option></select></label>
        <button class="save-btn">Guardar resultado</button>
      </form>
    </div>
  </article>`;
}

function teamOptions(selected) {
  return sortByName([...teams.values()])
    .map(
      (t) =>
        `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.name)}</option>`,
    )
    .join("");
}
async function saveResult(e) {
  e.preventDefault();
  if (!confirm("¿Seguro que querés guardar este resultado?")) return;
  const id = e.target.dataset.match;
  const m = matches.find((x) => x.id === id);
  const fd = new FormData(e.target);
  const goalsA = parseGoalValue(fd.get("goalsA")),
    goalsB = parseGoalValue(fd.get("goalsB"));
  if (goalsA === null || goalsB === null)
    return alert("Los goles deben ser números enteros entre 0 y 50.");
  const penaltyWinnerId = fd.get("penaltyWinnerId") || "";
  let winnerId = "";
  if (goalsA > goalsB) winnerId = m.teamAId;
  else if (goalsB > goalsA) winnerId = m.teamBId;
  else if (penaltyWinnerId) winnerId = penaltyWinnerId;
  await updateDoc(doc(db, "matches", id), {
    goalsA,
    goalsB,
    penaltyWinnerId,
    winnerId,
    status: "played",
    updatedAt: serverTimestamp(),
  });
  await loadData();
  renderAll();
}

function buildDateTextFromInput(dateLocal, venue = "") {
  if (!dateLocal) return "";
  const d = new Date(dateLocal);
  const formatted = d.toLocaleString("es-UY", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const clean = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  return `${clean} UY${venue ? " · " + venue : ""}`;
}

async function saveSchedule(e) {
  e.preventDefault();
  const id = e.target.dataset.match;
  const m = matches.find((x) => x.id === id);
  const fd = new FormData(e.target);
  const matchTime = String(fd.get("matchTime") || "").trim();
  const matchDateInput = String(fd.get("matchDate") || "").trim();
  const action = e.submitter?.value || "time";

  if (!/^\d{2}:\d{2}$/.test(matchTime)) {
    return alert("Seleccioná una hora válida.");
  }

  let dateOnly = parseDateOnlyFromMatch(m);

  if (action === "dateTime") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(matchDateInput)) {
      return alert("Seleccioná un día válido.");
    }
    dateOnly = matchDateInput;
  }

  if (!dateOnly) {
    return alert(
      "Este partido no tiene día cargado. Usá 'Guardar día y hora' para corregirlo.",
    );
  }

  const dateTime = `${dateOnly}T${matchTime}:00-03:00`;
  const dateText = `${weekdayDateLabel(dateOnly)} · ${matchTime} UY${m?.venue ? " · " + m.venue : ""}`;

  await updateDoc(doc(db, "matches", id), {
    dateOnly,
    dateTime,
    dateText,
    updatedAt: serverTimestamp(),
  });

  await loadData();
  renderAll();
}

async function saveTeams(e) {
  e.preventDefault();
  if (!confirm("¿Seguro que querés actualizar los equipos?")) return;
  const id = e.target.dataset.match;
  const fd = new FormData(e.target);
  await updateDoc(doc(db, "matches", id), {
    teamAId: fd.get("teamAId"),
    teamBId: fd.get("teamBId"),
    updatedAt: serverTimestamp(),
  });
  await loadData();
  renderAll();
}
async function saveRealChampion(e) {
  e.preventDefault();
  if (!confirm("¿Seguro que querés definir el campeón real?")) return;
  await setDoc(
    doc(db, "settings", "tournament"),
    {
      ...settings,
      realChampionId: $("realChampion").value,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await loadData();
  renderAll();
}
function renderUsersAdmin() {
  $("usuarios").innerHTML =
    `<h1>Gestión de usuarios</h1><div class="underline"></div><p class="subtitle">Usuarios registrados.</p><div class="users-admin-list">${users.map((u) => `<article class="user-admin-card"><div class="no-photo-badge">${userInitials(u)}</div><div><h3>${esc(u.fullName)} <small>@${esc(u.username)}</small></h3><p>${esc(u.email)} · ${u.participantType === "teacher" ? "Docente" : "Estudiante"} · ${esc(u.specialty)} · Campeón: ${esc(u.championName || teamName(u.championId))}</p><p>Pronósticos: <strong>${predictions.filter((p) => p.uid === u.uid).length}</strong> · Estado: <strong>${u.active ? "Activo" : "Inactivo"}</strong> · Rol: <strong>${u.role}</strong></p></div><div class="user-admin-actions">${u.role !== "admin" ? `<button class="cancel-btn" onclick="toggleUser('${u.uid}', ${u.active !== false})">${u.active !== false ? "Desactivar" : "Activar"}</button>` : ""}</div></article>`).join("")}</div>`;
}

function openPrediction(id) {
  selectedMatch = matches.find((m) => m.id === id);
  if (!selectedMatch) return;
  $("predictionModal").innerHTML =
    `<div class="modal-content"><h2>${esc(teamName(selectedMatch.teamAId))} vs ${esc(teamName(selectedMatch.teamBId))}</h2><p>Ingresá tu pronóstico.</p><form id="predictionForm"><div class="score-inputs"><div class="team-input"><label>${esc(teamName(selectedMatch.teamAId))}</label><input id="predA" type="number" min="0" max="50" step="1" inputmode="numeric" pattern="[0-9]*" value="0"></div><span class="vs">VS</span><div class="team-input"><label>${esc(teamName(selectedMatch.teamBId))}</label><input id="predB" type="number" min="0" max="50" step="1" inputmode="numeric" pattern="[0-9]*" value="0"></div></div>${phases.find((f) => f.id === selectedMatch.phase)?.knockout ? `<div class="penalty-box active"><label>Ganador por penales</label><select id="predPenalty"><option value="">No aplica</option><option value="${selectedMatch.teamAId}">${esc(teamName(selectedMatch.teamAId))}</option><option value="${selectedMatch.teamBId}">${esc(teamName(selectedMatch.teamBId))}</option></select></div>` : ""}<div class="modal-actions"><button type="button" class="cancel-btn" onclick="closeModal()">Cancelar</button><button class="save-btn">Guardar</button></div></form></div>`;
  $("predictionModal").classList.add("active");
  $("predictionForm").addEventListener("submit", savePrediction);
}
async function savePrediction(e) {
  e.preventDefault();
  if (isAdmin()) return alert("El admin no puede pronosticar.");
  if (!isMatchAssigned(selectedMatch))
    return alert(
      "No se puede pronosticar hasta que ambos equipos estén asignados.",
    );
  if (matchClosed(selectedMatch)) return alert("Este partido ya está cerrado.");
  const goalsA = parseGoalValue($("predA").value),
    goalsB = parseGoalValue($("predB").value),
    penaltyWinnerId = $("predPenalty")?.value || "";
  if (goalsA === null || goalsB === null)
    return alert("Los goles deben ser números enteros entre 0 y 50.");
  await setDoc(
    doc(db, "predictions", `${currentUser.uid}_${selectedMatch.id}`),
    {
      uid: currentUser.uid,
      matchId: selectedMatch.id,
      goalsA,
      goalsB,
      penaltyWinnerId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  closeModal();
  await loadData();
  renderAll();
}

window.showSection = (id, btn) => {
  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.remove("active"));
  $(id)?.classList.add("active");
  document
    .querySelectorAll(".menu button")
    .forEach((b) => b.classList.remove("active"));
  btn?.classList.add("active");
};
window.showFixturePhase = (id, btn) => {
  const parent = btn.closest(".section");
  parent
    .querySelectorAll(".fixture-phase")
    .forEach((s) => s.classList.remove("active"));
  parent.querySelector("#" + id)?.classList.add("active");
  parent
    .querySelectorAll(".phase-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
};
window.toggleRankingDetails = (btn) => {
  const d = btn
    .closest(".ranking-item,.podium-card")
    .querySelector(".ranking-details");
  d.classList.toggle("active");
  btn.classList.toggle("active");
  btn.textContent = d.classList.contains("active") ? "−" : "+";
};
window.showHistoryDetail = (id) => {
  document
    .querySelectorAll(".history-detail")
    .forEach((x) => x.classList.remove("active"));
  if (id) $(id)?.classList.add("active");
};
window.closeModal = () => $("predictionModal").classList.remove("active");
window.openPrediction = openPrediction;
window.logout = async () => {
  showPageLoader("Cerrando sesión...");
  await signOut(auth);
  window.location.href = "index.html";
};
window.toggleUser = async (uid, active) => {
  if (!confirm("¿Seguro que querés cambiar el estado de este usuario?")) return;
  await updateDoc(doc(db, "users", uid), { active: !active });
  await loadData();
  renderAll();
};
window.goToNextMatch = (phaseId, matchId) => {
  showSection("fixture", document.querySelector(".menu button"));
  const btn = [...document.querySelectorAll("#fixture .phase-btn")].find((b) =>
    b.getAttribute("onclick")?.includes(phaseId),
  );
  if (btn) showFixturePhase(phaseId, btn);
  setTimeout(() => {
    const el = $(matchId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("match-focus");
    setTimeout(() => el?.classList.remove("match-focus"), 2500);
  }, 100);
};

window.goToAdminNextMatch = (phaseId, matchId) => {
  const adminButton = [...document.querySelectorAll(".menu button")].find((b) =>
    b.getAttribute("onclick")?.includes("admin"),
  );
  showSection("admin", adminButton);

  const phaseButton = [...document.querySelectorAll("#admin .phase-btn")].find(
    (b) => b.getAttribute("onclick")?.includes(phaseId),
  );
  if (phaseButton) showFixturePhase(phaseId, phaseButton);

  setTimeout(() => {
    const el = $(matchId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("match-focus");
    setTimeout(() => el?.classList.remove("match-focus"), 2500);
  }, 100);
};
window.showRankingTab = (id, btn) => {
  const section = $("ranking");
  if (!section) return;

  section
    .querySelectorAll(".ranking-tab-panel")
    .forEach((panel) => panel.classList.remove("active"));

  section.querySelector("#" + id)?.classList.add("active");

  section
    .querySelectorAll(".ranking-tabs .phase-btn")
    .forEach((button) => button.classList.remove("active"));

  btn?.classList.add("active");
};

function forceDarkTheme() {
  document.body.classList.remove("light-mode");
  localStorage.setItem("theme", "dark");
}

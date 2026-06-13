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
  where,
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
let leaderboard = { individual: [], specialties: [] };
let adminDataLoaded = false;
let adminUsersLoaded = false;
let adminPredictionsLoaded = false;
let adminDataLoadedAt = 0;
let settings = { predictionsCloseMinutes: 30, realChampionId: "" };
let selectedMatch = null;
let fixtureMatchView = "pending";
let realtimeStarted = false;
let renderTimer = null;
let matchesSnapshotReady = false;
let previousMatchesById = new Map();
let pendingEditScrollSnapshot = null;
let pendingEditScrollUntil = 0;

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

function clampGoalField(input) {
  if (!input) return;
  let value = String(input.value || "").replace(/\D/g, "");
  if (value.length > 2) value = value.slice(0, 2);
  if (value !== "" && Number(value) > 50) value = "50";
  input.value = value;
}

function attachGoalValidation(scope = document) {
  scope.querySelectorAll(".goal-input").forEach((input) => {
    input.addEventListener("input", () => clampGoalField(input));
    input.addEventListener("blur", () => clampGoalField(input));
  });
}

function getMatchName(m = {}) {
  return `${teamName(m.teamAId)} vs ${teamName(m.teamBId)}`;
}

function predictionOpenDate(m = {}) {
  return null;
}

function predictionOpenLabel(m = {}) {
  return "Disponible";
}

function matchNotYetOpen(m = {}) {
  return false;
}

function showResultBanner(match) {
  if (isAdmin() || !match) return;
  document.querySelector(".result-upload-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "result-upload-toast";
  toast.innerHTML = `<button class="result-upload-toast-close" aria-label="Cerrar aviso">×</button><div><strong>Nuevo resultado cargado</strong><p>Se subió el resultado del partido: <span>${esc(getMatchName(match))}</span></p></div>`;
  document.body.appendChild(toast);
  toast
    .querySelector("button")
    ?.addEventListener("click", () => toast.remove());
  setTimeout(() => toast.classList.add("visible"), 20);
  setTimeout(() => toast.remove(), 12000);
}

function notifyNewUploadedResults(newMatches) {
  if (!matchesSnapshotReady) return;
  newMatches.forEach((match) => {
    const previous = previousMatchesById.get(match.id);
    const wasPlayed = previous?.status === "played";
    const isPlayed = match.status === "played";
    const previousScore = `${previous?.goalsA ?? ""}-${previous?.goalsB ?? ""}-${previous?.penaltyWinnerId ?? ""}`;
    const currentScore = `${match.goalsA ?? ""}-${match.goalsB ?? ""}-${match.penaltyWinnerId ?? ""}`;
    if (isPlayed && (!wasPlayed || previousScore !== currentScore)) {
      showResultBanner(match);
    }
  });
}

function isUserEditingCriticalForm() {
  const active = document.activeElement;
  if (!active) return false;

  const isTypingElement =
    active.matches("input, select, textarea") || active.closest("form");

  const insideAdmin = active.closest("#admin");
  const insideModal = active.closest("#predictionModal");

  return !!isTypingElement && !!(insideAdmin || insideModal);
}

function renderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (!currentUser || !userData) return;

    if (isUserEditingCriticalForm()) {
      return;
    }

    renderAll();

    if (pendingEditScrollSnapshot && Date.now() <= pendingEditScrollUntil) {
      restoreEditScrollSnapshot(pendingEditScrollSnapshot);
    }
  }, 80);
}

function startRealtimeListeners() {
  if (realtimeStarted) return;
  realtimeStarted = true;

  onSnapshot(query(collection(db, "matches"), orderBy("order")), (snap) => {
    const nextMatches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    notifyNewUploadedResults(nextMatches);
    previousMatchesById = new Map(
      nextMatches.map((match) => [match.id, match]),
    );
    matchesSnapshotReady = true;
    matches = nextMatches;
    renderSoon();
  });

  onSnapshot(doc(db, "users", currentUser.uid), (snap) => {
    if (snap.exists()) {
      userData = { id: snap.id, ...snap.data() };
      renderSoon();
    }
  });

  onSnapshot(doc(db, "settings", "tournament"), (snap) => {
    if (snap.exists()) settings = { ...settings, ...snap.data() };
    renderSoon();
  });

  /*
    Usuario común: escucha solamente sus propios pronósticos.
    Admin: no escucha todos los pronósticos automáticamente para evitar lecturas masivas.
  */
  if (!isAdmin()) {
    onSnapshot(
      query(collection(db, "predictions"), where("uid", "==", currentUser.uid)),
      (snap) => {
        predictions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderSoon();
      },
    );
  }

  onSnapshot(doc(db, "leaderboards", "current"), (snap) => {
    leaderboard = snap.exists()
      ? { individual: [], specialties: [], ...snap.data() }
      : { individual: [], specialties: [] };
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
const CHAMPION_DEADLINE = new Date("2026-06-19T23:59:00-03:00");
function championDeadlineLabel() {
  return `${CHAMPION_DEADLINE.toLocaleDateString("es-UY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })} a las ${CHAMPION_DEADLINE.toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} UY`;
}

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

function userSignedInWithGoogle(user = currentUser) {
  return user?.providerData?.some(
    (provider) => provider.providerId === "google.com",
  );
}

function hasTrustedVerifiedIdentity(user) {
  return !!user?.emailVerified || userSignedInWithGoogle(user);
}

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    if (!hasTrustedVerifiedIdentity(user)) {
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
      alert(
        "Tu usuario todavía no fue activado. Iniciá sesión nuevamente o contactá al administrador.",
      );
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
  } catch (error) {
    console.error("Error al cargar la aplicación:", error);
    hidePageLoader();
    alert(
      "No se pudo cargar la aplicación. Revisá tu conexión, las reglas de Firestore o el setup inicial.",
    );
  }
});

async function loadData() {
  await loadCoreData();

  /*
    Optimización:
    El admin ya no carga users completo ni predictions completo apenas entra.
    Esos datos se cargan bajo demanda:
    - al entrar a Gestión usuarios;
    - al recalcular ranking por resultados/campeón/activación.
  */
  if (
    isAdmin() &&
    (!Array.isArray(leaderboard.individual) ||
      leaderboard.individual.length === 0)
  ) {
    await recalculateLeaderboards();
  }
}

async function loadCoreData() {
  const [teamsSnap, phasesSnap, userSnap, leaderboardSnap] = await Promise.all([
    getDocs(collection(db, "teams")),
    getDocs(query(collection(db, "phases"), orderBy("order"))),
    getDoc(doc(db, "users", currentUser.uid)),
    getDoc(doc(db, "leaderboards", "current")),
  ]);

  teams = new Map(teamsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  phases = phasesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (userSnap.exists()) userData = { id: userSnap.id, ...userSnap.data() };

  leaderboard = leaderboardSnap.exists()
    ? { individual: [], specialties: [], ...leaderboardSnap.data() }
    : { individual: [], specialties: [] };

  if (isAdmin()) return;

  const ownPredictionsSnap = await getDocs(
    query(collection(db, "predictions"), where("uid", "==", currentUser.uid)),
  );
  predictions = ownPredictionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  users = userData ? [userData] : [];
}

async function ensureAdminUsersLoaded(force = false) {
  if (!isAdmin()) return;
  if (adminUsersLoaded && !force) return;

  const usersSnap = await getDocs(collection(db, "users"));
  users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  adminUsersLoaded = true;
  adminDataLoaded = adminUsersLoaded && adminPredictionsLoaded;
  adminDataLoadedAt = Date.now();
}

async function ensureAdminPredictionsLoaded(force = false) {
  if (!isAdmin()) return;
  if (adminPredictionsLoaded && !force) return;

  const predictionsSnap = await getDocs(collection(db, "predictions"));
  predictions = predictionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  adminPredictionsLoaded = true;
  adminDataLoaded = adminUsersLoaded && adminPredictionsLoaded;
  adminDataLoadedAt = Date.now();
}

async function ensureAdminDataLoaded(force = false) {
  if (!isAdmin()) return;

  await Promise.all([
    ensureAdminUsersLoaded(force),
    ensureAdminPredictionsLoaded(force),
  ]);

  adminDataLoaded = true;
  adminDataLoadedAt = Date.now();
}

async function refreshAdminData(force = true) {
  if (!isAdmin()) return;

  await ensureAdminDataLoaded(force);
  await recalculateLeaderboards({ forceUsers: false, forcePredictions: false });

  renderAll();
}

function renderAll() {
  const viewSnapshot = currentViewSnapshot();

  renderShell();
  renderFixture();
  renderRanking();
  renderRules();
  renderProfile();
  renderProjectInfo();
  renderRightPanel();
  if (isAdmin()) {
    renderAdmin();
    renderUsersAdmin();
  }

  restoreViewSnapshot(viewSnapshot);
}

function activeSectionId() {
  return document.querySelector(".section.active")?.id || "";
}

function currentViewSnapshot() {
  const sectionId = activeSectionId();
  const section = sectionId ? document.getElementById(sectionId) : null;
  const activePhase = section?.querySelector(".fixture-phase.active");
  const activeRankingTab = section?.querySelector(".ranking-tab-panel.active");

  return {
    sectionId,
    phaseId: activePhase?.id || "",
    rankingTabId: activeRankingTab?.id || "",
  };
}

function restoreViewSnapshot(snapshot) {
  if (!snapshot?.sectionId) return;

  const section = document.getElementById(snapshot.sectionId);
  if (!section) return;

  document
    .querySelectorAll(".section")
    .forEach((item) => item.classList.remove("active"));
  section.classList.add("active");

  document
    .querySelectorAll(".menu button")
    .forEach((button) => button.classList.remove("active"));

  const menuButton = [...document.querySelectorAll(".menu button")].find(
    (button) => {
      const onclick = button.getAttribute("onclick") || "";
      return (
        onclick.includes(`'${snapshot.sectionId}'`) ||
        onclick.includes(`"${snapshot.sectionId}"`)
      );
    },
  );
  menuButton?.classList.add("active");

  if (snapshot.phaseId) {
    const phase = document.getElementById(snapshot.phaseId);
    const phaseButton = [...section.querySelectorAll(".phase-btn")].find(
      (button) =>
        (button.getAttribute("onclick") || "").includes(snapshot.phaseId),
    );

    if (phase && phaseButton) {
      section
        .querySelectorAll(".fixture-phase")
        .forEach((item) => item.classList.remove("active"));
      section
        .querySelectorAll(".phase-btn")
        .forEach((button) => button.classList.remove("active"));

      phase.classList.add("active");
      phaseButton.classList.add("active");
    }
  }

  if (snapshot.rankingTabId) {
    const rankingTab = document.getElementById(snapshot.rankingTabId);
    const rankingButton = [
      ...section.querySelectorAll(".ranking-tabs .phase-btn"),
    ].find((button) =>
      (button.getAttribute("onclick") || "").includes(snapshot.rankingTabId),
    );

    if (rankingTab && rankingButton) {
      section
        .querySelectorAll(".ranking-tab-panel")
        .forEach((panel) => panel.classList.remove("active"));
      section
        .querySelectorAll(".ranking-tabs .phase-btn")
        .forEach((button) => button.classList.remove("active"));

      rankingTab.classList.add("active");
      rankingButton.classList.add("active");
    }
  }
}

function scrollContainers() {
  return [
    document.scrollingElement,
    document.documentElement,
    document.body,
    document.querySelector(".main"),
  ].filter(Boolean);
}

function currentScrollY() {
  const values = [
    window.scrollY || 0,
    ...scrollContainers().map((item) => item.scrollTop || 0),
  ];

  return Math.max(...values);
}

function setScrollY(value) {
  window.scrollTo({
    top: value,
    left: 0,
    behavior: "auto",
  });

  scrollContainers().forEach((item) => {
    item.scrollTop = value;
  });
}

function forceScrollTop() {
  const apply = () => setScrollY(0);

  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 0);
  setTimeout(apply, 80);
}

function saveEditScrollSnapshot(anchorId = "") {
  /*
    Solo guardamos scroll para operaciones internas de guardado.
    No se usa cuando el usuario cambia de sección desde el menú.

    Además del número de scroll, guardamos una tarjeta/partido como ancla.
    Esto es más estable cuando Firestore vuelve a renderizar la lista.
  */
  const view = currentViewSnapshot();

  if (!["fixture", "admin"].includes(view.sectionId)) return null;

  const anchor = anchorId ? document.getElementById(anchorId) : null;

  return {
    ...view,
    scrollY: currentScrollY(),
    anchorId,
    anchorTop: anchor ? anchor.getBoundingClientRect().top : null,
  };
}

function setPendingEditScrollSnapshot(snapshot) {
  if (!snapshot) return;
  pendingEditScrollSnapshot = snapshot;
  pendingEditScrollUntil = Date.now() + 1600;
}

function clearPendingEditScrollSnapshot() {
  pendingEditScrollSnapshot = null;
  pendingEditScrollUntil = 0;
}

function restoreEditScrollSnapshot(snapshot) {
  if (!snapshot || !["fixture", "admin"].includes(snapshot.sectionId)) return;

  const apply = () => {
    restoreViewSnapshot(snapshot);

    const anchor =
      snapshot.anchorId && snapshot.anchorTop !== null
        ? document.getElementById(snapshot.anchorId)
        : null;

    if (anchor) {
      const currentTop = anchor.getBoundingClientRect().top;
      const delta = currentTop - snapshot.anchorTop;
      setScrollY(currentScrollY() + delta);
    } else {
      setScrollY(snapshot.scrollY);
    }
  };

  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 0);
  setTimeout(apply, 80);
  setTimeout(apply, 220);
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
function participantTypeLabel(user = {}) {
  if (user.participantType === "teacher") return "Docente";
  if (user.participantType === "student") return "Estudiante";
  return user.participantType || "-";
}

function yearLabel(user = {}) {
  if (user.participantType === "teacher") return "No corresponde";
  if (!user.year) return "-";
  return `${user.year}.º`;
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
  if (matchNotYetOpen(m)) return [predictionOpenLabel(m), "closed"];
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
  <header class="mobile-topbar">
    <a class="mobile-logo-link" href="app.html" aria-label="Inicio">
      <img src="img/logo_penca.png" alt="Mundial 2026">
    </a>
    <button class="mobile-menu-toggle" type="button" onclick="toggleMobileMenu()" aria-label="Abrir menú" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </header>

  <button class="mobile-menu-overlay" type="button" onclick="closeMobileMenu()" aria-label="Cerrar menú"></button>

  <aside class="sidebar" id="mobileSidebar">
    <div class="mobile-sidebar-head">
      <div class="logo logo-large"><div class="logo-icon logo-image"><img src="img/logo_penca.png" alt="Mundial 2026"></div></div>
      <button class="mobile-sidebar-close" type="button" onclick="closeMobileMenu()" aria-label="Cerrar menú">×</button>
    </div>
    <nav class="menu">
      <button class="active" onclick="showSection('fixture', this)">⚽ Fixture</button>
      <button onclick="showSection('ranking', this)">🏆 Ranking</button>
      <button onclick="showSection('reglas', this)">📘 Reglas</button>
      <button onclick="showSection('perfil', this)">👤 Perfil</button>
      <button onclick="showSection('informacion', this)">ℹ️ Información</button>
      ${isAdmin() ? `<button onclick="showSection('admin', this)">Admin resultados</button><button onclick="showSection('usuarios', this)">Gestión usuarios</button>` : ""}
    </nav>
    <div class="credits">Desarrollado por Ezequiel Costa y Thiago Sosa<br>3.º año de Profesorado de Informática<br>Ingeniería de Software</div>
  </aside>
  <main class="main">
    <section id="fixture" class="section active"></section><section id="ranking" class="section"></section><section id="reglas" class="section"></section><section id="perfil" class="section"></section><section id="informacion" class="section"></section>${isAdmin() ? `<section id="admin" class="section"></section><section id="usuarios" class="section"></section>` : ""}
  </main>
  <aside class="right-panel" id="rightPanel"></aside>
  <div id="predictionModal" class="modal"></div>`;
}

function fixtureViewLabel() {
  return fixtureMatchView === "played"
    ? "partidos ya jugados"
    : "partidos pendientes";
}

function fixtureMatchesByView(phaseId) {
  return matches.filter((match) => {
    const samePhase = match.phase === phaseId;
    const isPlayed = match.status === "played";

    return samePhase && (fixtureMatchView === "played" ? isPlayed : !isPlayed);
  });
}

function showFixtureMatchView(view) {
  if (view === "toggle") {
    fixtureMatchView = fixtureMatchView === "played" ? "pending" : "played";
  } else {
    fixtureMatchView = view === "played" ? "played" : "pending";
  }

  renderFixture();
}

function renderChampionPromptCard() {
  if (isAdmin() || userData?.championId || championSelectionClosed()) return "";

  return `<div class="champion-fixture-card">
    <div class="champion-fixture-copy">
      <span class="profile-label">Campeón Mundial 2026</span>
      <h3>Elegí tu campeón</h3>
      <p>Seleccioná quién creés que va a ganar el Mundial 2026. Si acertás, sumás <strong>+10 puntos</strong> al final del torneo.</p>
      <p class="champion-fixture-deadline">Podés elegir hasta el <strong>${esc(championDeadlineLabel())}</strong>.</p>
    </div>
    <form id="fixtureChampionForm" class="champion-fixture-form">
      <select id="fixtureChampionId" required>
        <option value="">Elegí una selección</option>
        ${realTeamsSorted()
          .map(
            (team) =>
              `<option value="${esc(team.id)}">${esc(team.name)}</option>`,
          )
          .join("")}
      </select>
      <button class="save-btn">Guardar campeón</button>
      <p id="fixtureChampionMsg" class="inline-message"></p>
    </form>
  </div>`;
}

function renderFixture() {
  const showingPlayed = fixtureMatchView === "played";
  const toggleLabel = showingPlayed ? "Ver pendientes" : "Ver ya jugados";
  const toggleIcon = showingPlayed ? "⏳" : "✓";

  const html = `<div class="fixture-header-row">
    <div>
      <h1>Fixture</h1>
      <div class="underline"></div>
    </div>
    <button class="fixture-toggle-btn ${showingPlayed ? "played" : "pending"}" onclick="showFixtureMatchView('toggle')" type="button">
      <span class="fixture-toggle-icon">${toggleIcon}</span>
      <span>${toggleLabel}</span>
    </button>
  </div>
  <p class="subtitle">Los pronósticos permanecen abiertos y cierran ${settings.predictionsCloseMinutes || 30} minutos antes del inicio. </p>
  ${renderChampionPromptCard()}
  <div class="phase-tabs">${phases.map((f, i) => `<button class="phase-btn ${i === 0 ? "active" : ""}" onclick="showFixturePhase('fase-${f.id}', this)">${esc(f.name)}</button>`).join("")}</div>
  ${phases
    .map((f, i) => {
      const phaseMatches = fixtureMatchesByView(f.id);
      return `<div id="fase-${f.id}" class="fixture-phase ${i === 0 ? "active" : ""}">
        <div class="fixture-list">
          ${
            phaseMatches.length
              ? phaseMatches.map(renderMatchCard).join("")
              : `<div class="empty-fixture-view">No hay ${fixtureViewLabel()} en esta fase.</div>`
          }
        </div>
      </div>`;
    })
    .join("")}`;
  $("fixture").innerHTML = html;
  $("fixtureChampionForm")?.addEventListener("submit", saveChampionFromFixture);
}

function renderMatchCard(m) {
  const [label, klass] = statusFor(m);
  const pr = userPrediction(m.id);
  const assigned = isMatchAssigned(m);
  const closed = klass === "closed" || klass === "loaded" || !assigned;
  const resultHtml =
    m.status === "played"
      ? `<strong>${m.goalsA} - ${m.goalsB}</strong><span>  Resultado</span>`
      : `<strong>${pr ? `${pr.goalsA} - ${pr.goalsB}` : "-"}</strong><span>  Tu pronóstico</span>`;
  return `<article id="match-${m.id}" class="match-card" data-id="${m.id}"><div class="match-info"><span class="group-label">${esc(phaseName(m.phase))}${m.group ? " · Grupo " + esc(m.group) : ""}</span><div class="teams"><span>${esc(teamName(m.teamAId))}</span><span class="vs">VS</span><span>${esc(teamName(m.teamBId))}</span></div><span class="status-badge ${klass}">${label}</span></div><div class="time">${esc(matchDateLine(m))}${matchVenueLine(m) ? `<br>${esc(matchVenueLine(m))}` : ""}</div><div class="match-result-side ${m.status === "played" ? "loaded" : ""}">${resultHtml}</div>${isAdmin() ? `<span class="status">Admin</span>` : `<button class="action-btn ${closed ? "closed" : ""}" ${closed ? "disabled" : ""} onclick="openPrediction('${m.id}')">${!assigned ? "Pendiente" : matchNotYetOpen(m) ? "Próximamente" : closed ? "Cerrado" : pr ? "Editar" : "Predecir"}</button>`}</article>`;
}
function phaseName(id) {
  return phases.find((f) => f.id === id)?.name || id;
}

function predictionCountByUser() {
  const counts = new Map();

  predictions.forEach((prediction) => {
    counts.set(prediction.uid, (counts.get(prediction.uid) || 0) + 1);
  });

  return counts;
}

function localRankingData() {
  const predictionsByUser = new Map();

  predictions.forEach((prediction) => {
    if (!predictionsByUser.has(prediction.uid)) {
      predictionsByUser.set(prediction.uid, []);
    }

    predictionsByUser.get(prediction.uid).push(prediction);
  });

  return users
    .filter((u) => u.active !== false && u.role !== "admin")
    .map((u) => {
      let exact = 0,
        partial = 0,
        draw = 0,
        penalties = 0,
        incorrect = 0,
        points = 0;

      const userPredictions = predictionsByUser.get(u.uid) || [];

      userPredictions.forEach((p) => {
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
        uid: u.uid,
        username: u.username,
        fullName: u.fullName,
        specialty: u.specialty,
        participantType: u.participantType || "",
        year: u.year,
        championId: u.championId || "",
        championName: u.championName || "",
        exact,
        partial,
        draw,
        penalties,
        incorrect,
        points,
        aciertos: exact + partial + draw,
        predictionsCount: userPredictions.length,
      };
    })
    .sort((a, b) => b.points - a.points || b.exact - a.exact)
    .map((u, i) => ({ ...u, position: i + 1 }));
}

function localSpecialtyRankingData(source = localRankingData()) {
  const bySpecialty = new Map();
  source.forEach((u) => {
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

function rankingData() {
  if (Array.isArray(leaderboard.individual) && leaderboard.individual.length) {
    return leaderboard.individual;
  }
  return isAdmin() ? localRankingData() : [];
}

function specialtyRankingData() {
  if (
    Array.isArray(leaderboard.specialties) &&
    leaderboard.specialties.length
  ) {
    return leaderboard.specialties;
  }
  return isAdmin() ? localSpecialtyRankingData() : [];
}

function emptyLeaderboardRowFromUser(user = {}) {
  return {
    uid: user.uid,
    username: user.username || "",
    fullName: user.fullName || "",
    specialty: user.specialty || "",
    participantType: user.participantType || "",
    year: user.year || "",
    championId: user.championId || "",
    championName: user.championName || "",
    exact: 0,
    partial: 0,
    draw: 0,
    penalties: 0,
    incorrect: 0,
    points: 0,
    aciertos: 0,
    predictionsCount: 0,
    position: 0,
  };
}

function normalizeLeaderboardRows(rows = []) {
  return rows
    .filter((row) => row && row.uid)
    .map((row) => ({
      uid: row.uid,
      username: row.username || "",
      fullName: row.fullName || "",
      specialty: row.specialty || "",
      participantType: row.participantType || "",
      year: row.year || "",
      championId: row.championId || "",
      championName: row.championName || "",
      exact: Number(row.exact || 0),
      partial: Number(row.partial || 0),
      draw: Number(row.draw || 0),
      penalties: Number(row.penalties || 0),
      incorrect: Number(row.incorrect || 0),
      points: Number(row.points || 0),
      aciertos: Number(row.aciertos || 0),
      predictionsCount: Number(row.predictionsCount || 0),
      position: Number(row.position || 0),
    }));
}

function sortAndPositionLeaderboard(rows = []) {
  return normalizeLeaderboardRows(rows)
    .map((row) => ({
      ...row,
      aciertos:
        Number(row.exact || 0) +
        Number(row.partial || 0) +
        Number(row.draw || 0),
    }))
    .sort((a, b) => b.points - a.points || b.exact - a.exact)
    .map((row, index) => ({ ...row, position: index + 1 }));
}

async function saveCurrentLeaderboard(individualRows) {
  const individual = sortAndPositionLeaderboard(individualRows);
  const specialties = localSpecialtyRankingData(individual);

  leaderboard = {
    individual,
    specialties,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "leaderboards", "current"), leaderboard, {
    merge: true,
  });
  return leaderboard;
}

async function loadPredictionsForMatch(matchId) {
  const predictionsSnap = await getDocs(
    query(
      collection(db, "predictions"),
      where("matchId", "==", String(matchId)),
    ),
  );

  return predictionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadPredictionsForUser(uid) {
  const predictionsSnap = await getDocs(
    query(collection(db, "predictions"), where("uid", "==", uid)),
  );

  return predictionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getUserForLeaderboard(uid) {
  const cached = users.find((u) => u.uid === uid || u.id === uid);
  if (cached) return cached;

  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;

  const user = { id: snap.id, ...snap.data() };
  users = [...users.filter((u) => u.uid !== user.uid), user];
  return user;
}

function applyScoreDelta(row, oldScore, newScore) {
  const next = { ...row };

  next.points =
    Number(next.points || 0) +
    Number(newScore.points || 0) -
    Number(oldScore.points || 0);
  next.exact =
    Number(next.exact || 0) +
    Number(newScore.exact || 0) -
    Number(oldScore.exact || 0);
  next.partial =
    Number(next.partial || 0) +
    Number(newScore.partial || 0) -
    Number(oldScore.partial || 0);
  next.draw =
    Number(next.draw || 0) +
    Number(newScore.draw || 0) -
    Number(oldScore.draw || 0);
  next.penalties =
    Number(next.penalties || 0) +
    Number(newScore.penalties || 0) -
    Number(oldScore.penalties || 0);
  next.incorrect =
    Number(next.incorrect || 0) +
    Number(newScore.incorrect || 0) -
    Number(oldScore.incorrect || 0);
  next.aciertos =
    Number(next.exact || 0) +
    Number(next.partial || 0) +
    Number(next.draw || 0);

  return next;
}

async function updateLeaderboardForMatch(oldMatch, newMatch) {
  /*
    Optimización fuerte para admin:
    al cargar/editar un resultado se leen solo las predicciones de ese partido.
    Con 150 usuarios son hasta 150 lecturas, no 10.800+.
  */
  if (!isAdmin()) return leaderboard;

  const matchPredictions = await loadPredictionsForMatch(newMatch.id);

  if (
    !Array.isArray(leaderboard.individual) ||
    leaderboard.individual.length === 0
  ) {
    /*
      Fallback seguro:
      si el ranking todavía no existe, se hace un recálculo completo una sola vez.
    */
    predictions = matchPredictions;
    return recalculateLeaderboards({
      forceUsers: true,
      forcePredictions: true,
    });
  }

  const rowsByUid = new Map(
    normalizeLeaderboardRows(leaderboard.individual).map((row) => [
      row.uid,
      row,
    ]),
  );

  for (const prediction of matchPredictions) {
    let row = rowsByUid.get(prediction.uid);

    if (!row) {
      const user = await getUserForLeaderboard(prediction.uid);
      if (!user || user.active === false || user.role === "admin") continue;
      row = emptyLeaderboardRowFromUser(user);
      rowsByUid.set(prediction.uid, row);
    }

    const oldScore = scorePrediction(prediction, oldMatch || {});
    const newScore = scorePrediction(prediction, newMatch || {});
    rowsByUid.set(prediction.uid, applyScoreDelta(row, oldScore, newScore));
  }

  const predictionIds = new Set(
    matchPredictions.map((prediction) => prediction.id),
  );
  const mergedPredictions = [
    ...predictions.filter(
      (prediction) => prediction.matchId != String(newMatch.id),
    ),
    ...matchPredictions,
  ];

  /*
    Mantiene caché admin si ya estaba cargada. Si no, igual guardamos
    las predicciones del partido para evitar releerlas dentro de la sesión.
  */
  predictions = mergedPredictions;
  if (!adminPredictionsLoaded && predictionIds.size > 0) {
    adminPredictionsLoaded = false;
  }

  return saveCurrentLeaderboard([...rowsByUid.values()]);
}

async function updateLeaderboardForUser(uid) {
  /*
    Activar/desactivar usuario ya no fuerza leer todas las predicciones.
    Lee solo las predicciones de ese usuario.
  */
  if (!isAdmin()) return leaderboard;

  const user = await getUserForLeaderboard(uid);
  let individual = normalizeLeaderboardRows(leaderboard.individual);

  if (!user || user.active === false || user.role === "admin") {
    individual = individual.filter((row) => row.uid !== uid);
    return saveCurrentLeaderboard(individual);
  }

  const userPredictions = await loadPredictionsForUser(uid);
  const row = emptyLeaderboardRowFromUser(user);

  userPredictions.forEach((prediction) => {
    const match = matches.find((item) => item.id === prediction.matchId);
    const score = scorePrediction(prediction, match || {});
    const updated = applyScoreDelta(row, { points: 0 }, score);
    Object.assign(row, updated);
  });

  row.predictionsCount = userPredictions.length;

  if (settings.realChampionId && user.championId === settings.realChampionId) {
    row.points += 10;
  }

  predictions = [
    ...predictions.filter((prediction) => prediction.uid !== uid),
    ...userPredictions,
  ];

  individual = individual.filter((item) => item.uid !== uid);
  individual.push(row);

  return saveCurrentLeaderboard(individual);
}

async function updateLeaderboardForChampionChange(
  previousChampionId,
  nextChampionId,
) {
  /*
    Definir o corregir campeón real afecta a todos.
    Para evitar usar datos viejos de leaderboards/current, siempre recargamos
    users una vez y tomamos championId/championName desde la fuente real.
  */
  if (!isAdmin()) return leaderboard;

  await ensureAdminUsersLoaded(true);

  const usersByUid = new Map(users.map((user) => [user.uid, user]));
  let individual = normalizeLeaderboardRows(
    Array.isArray(leaderboard.individual) ? leaderboard.individual : [],
  );

  /*
    Si el leaderboard está vacío, hacemos fallback completo una sola vez.
    Esto mantiene funcionalidad en instalaciones nuevas o recién migradas.
  */
  if (!individual.length) {
    return recalculateLeaderboards({
      forceUsers: false,
      forcePredictions: true,
    });
  }

  individual = individual.map((row) => {
    const user = usersByUid.get(row.uid);
    const realChampionId = user?.championId || "";
    const realChampionName = user?.championName || "";

    let points = Number(row.points || 0);

    /*
      Primero quitamos el bono anterior usando el campeón REAL actual del usuario,
      no el championId viejo del leaderboard.
    */
    if (previousChampionId && realChampionId === previousChampionId) {
      points -= 10;
    }

    /*
      Luego sumamos el nuevo bono, también usando users/{uid} como fuente real.
      Así evitamos duplicar +10 o perderlo si el usuario eligió campeón después
      de generado leaderboards/current.
    */
    if (nextChampionId && realChampionId === nextChampionId) {
      points += 10;
    }

    return {
      ...row,
      championId: realChampionId,
      championName: realChampionName,
      points,
    };
  });

  return saveCurrentLeaderboard(individual);
}

async function recalculateLeaderboards(options = {}) {
  const { forceUsers = false, forcePredictions = false } = options;

  /*
    Recálculo completo manual.
    Se conserva como fallback y para el botón "Actualizar datos y ranking".
    Para cargar resultados se usa updateLeaderboardForMatch(), que es incremental.
  */
  await Promise.all([
    ensureAdminUsersLoaded(forceUsers),
    ensureAdminPredictionsLoaded(forcePredictions),
  ]);

  return saveCurrentLeaderboard(localRankingData());
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
      : `${esc(r.specialty || "-")} · ${esc(yearLabel(r))}`;
  const isCurrentUser = (r) =>
    mode === "user" && currentUser && r.uid === currentUser.uid;

  return `<div class="ranking-block"><div class="ranking-list-header"><div><h3>${title}</h3><p>${description}</p></div></div><div class="podium">${podium.map((r) => `<article class="podium-card ${cls[r.position] || ""} ${isCurrentUser(r) ? "current" : ""}"><div class="podium-medal">${med[r.position] || "🏅"}</div><h3 class="podium-username">${label(r)}</h3><p class="podium-realname">${sub(r)}</p><div class="podium-points">${r.points} pts</div><div class="podium-correct">${r.aciertos} aciertos</div><button class="details-btn podium-details-btn" onclick="toggleRankingDetails(this)">+</button><div class="ranking-details podium-details">${detailPills(r)}</div></article>`).join("")}</div><div class="ranking-list">${rest.map((r) => `<div class="ranking-item ${isCurrentUser(r) ? "current" : ""}"><div class="ranking-row"><span class="position">${r.position}.º</span><span class="ranking-user"><strong>${label(r)}</strong><small>${sub(r)}</small></span><span class="ranking-aciertos">${r.aciertos} aciertos</span><span class="points ranking-points">${r.points} pts</span><button class="details-btn" onclick="toggleRankingDetails(this)">+</button></div><div class="ranking-details">${detailPills(r)}</div></div>`).join("") || '<div class="empty-ranking">No hay más posiciones para mostrar.</div>'}</div></div>`;
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

function renderProjectInfo() {
  $("informacion").innerHTML = `
    <h1>Información del proyecto</h1>
    <div class="underline"></div>

    <div class="project-info-grid">
      <article class="project-info-card project-info-main">
        <h3 style="color: #facc15;">Proyecto de Ingeniería de Software</h3>
        <p>
          Esta aplicación fue realizada en el marco de la materia <strong>Ingeniería de Software</strong>,
          como una propuesta de entretenimiento, práctica y aplicación de conceptos trabajados en clase.
        </p>
        <p>
          El proyecto busca favorecer el aprendizaje mediante el diseño, desarrollo y prueba de una
          aplicación web con autenticación, base de datos, reglas de acceso, ranking, administración de
          resultados y actualización de información.
        </p>
      </article>

      <article class="project-info-card">
        <h3 style="color: #facc15;">Uso recreativo y educativo</h3>
        <p>
          La aplicación <strong>no constituye un juego de azar</strong>, no involucra apuestas con dinero real
          y no ofrece premios económicos asociados a la participación.
        </p>
        <p>
          La participación es <strong>gratuita</strong> y no se requiere ningún pago para registrarse,
          acceder o utilizar las funcionalidades disponibles.
        </p>
      </article>
    </div>
  `;
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

  const usesGoogle = userSignedInWithGoogle();
  const logoutBox = `<div class="profile-logout-box"><div><strong>Cerrar sesión</strong><p>Salir de tu cuenta actual.</p></div><button class="profile-logout-link" onclick="logout()">Cerrar sesión</button></div>`;
  const passwordSection = usesGoogle
    ? `<div class="dashboard-card"><span class="profile-label">Seguridad</span><h3>Cuenta Google</h3><p class="subtitle">Tu cuenta usa Google. La contraseña se gestiona desde tu cuenta de Google.</p>${logoutBox}</div>`
    : `<div class="dashboard-card"><span class="profile-label">Seguridad</span><h3>Cambiar contraseña</h3><form id="passwordForm" class="security-form"><div class="form-grid"><div class="form-group"><label>Contraseña actual</label><input id="currentPass" type="password" required minlength="6" autocomplete="current-password"></div><div class="form-group"><label>Nueva contraseña</label><input id="newPass" type="password" required minlength="6" autocomplete="new-password"></div><div class="form-group"><label>Repetir contraseña</label><input id="repeatPass" type="password" required minlength="6" autocomplete="new-password"></div></div><button class="save-btn">Cambiar contraseña</button></form><p id="passwordMsg" class="inline-message"></p>${logoutBox}</div>`;

  $("perfil").innerHTML =
    `<h1>Perfil</h1><div class="underline"></div><div class="profile-dashboard"><div class="dashboard-card"><div class="profile-identity-main"><div class="no-photo-badge profile-avatar">${userInitials(userData)}</div><div class="profile-identity-info"><span class="profile-label">Participante</span><h2>${esc(userData.fullName)}</h2><p class="profile-username">@${esc(userData.username)}</p><div class="profile-meta-grid"><div><span>Correo</span><strong>${esc(userData.email)}</strong></div><div><span>Perfil</span><strong>${esc(participantTypeLabel(userData))}</strong></div><div><span>Especialidad</span><strong>${esc(userData.specialty)}</strong></div><div><span>Año</span><strong>${esc(yearLabel(userData))}</strong></div></div></div></div></div><div class="dashboard-card profile-champion-card"><span class="profile-label">Mi campeón elegido</span><h3>Predicción a largo plazo</h3><p class="champion-help">Elegí una selección desde tu perfil. La elección queda bloqueada y puede sumar <strong>+10 puntos</strong>.</p>${championBlock}<p id="championMsg" class="inline-message"></p></div><div class="dashboard-card history-card"><span class="profile-label">Historial de pronósticos</span><h3>Consultar partido</h3>${
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
              return `<div id="hist-${i}" class="history-detail"><p><strong>Partido:</strong> ${esc(teamName(m?.teamAId))} vs ${esc(teamName(m?.teamBId))}</p><p><strong> Tu pronóstico:</strong> ${p.goalsA} - ${p.goalsB}</p><p><strong> Resultado real:</strong> ${m?.status === "played" ? `${m.goalsA} - ${m.goalsB}` : "Pendiente"}</p><p><strong>Puntos:</strong> ${st.points}</p><p><strong>Estado:</strong> ${esc(st.type)}</p></div>`;
            })
            .join("")}`
        : '<p class="subtitle">Todavía no hiciste pronósticos.</p>'
    }</div>${passwordSection}</div>`;
  $("passwordForm")?.addEventListener("submit", changePassword);
  $("profileChampionForm")?.addEventListener("submit", saveChampionProfile);
}

async function saveChampionSelection(championId) {
  const championName = teamName(championId);
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

  userData = {
    ...userData,
    championId,
    championName,
  };

  users = users.map((u) =>
    u.uid === currentUser.uid ? { ...u, championId, championName } : u,
  );

  return championName;
}

async function handleChampionSelection(
  championId,
  messageElement,
  options = {},
) {
  const msg = messageElement;

  if (!championId) {
    if (msg) {
      msg.textContent = "Debés elegir un campeón.";
      msg.className = "inline-message error";
    }
    return false;
  }

  if (championSelectionClosed()) {
    if (msg) {
      msg.textContent = "La elección de campeón ya está cerrada.";
      msg.className = "inline-message error";
    }
    return false;
  }

  if (userData.championId) {
    if (msg) {
      msg.textContent = "Ya elegiste un campeón. La elección está bloqueada.";
      msg.className = "inline-message error";
    }
    return false;
  }

  try {
    await saveChampionSelection(championId);

    if (msg) {
      msg.textContent = "Campeón elegido correctamente.";
      msg.className = "inline-message success";
    }

    if (options.delayRender) {
      setTimeout(() => renderAll(), 700);
    } else {
      renderAll();
    }

    return true;
  } catch (err) {
    console.error(err);

    if (msg) {
      msg.textContent =
        "No se pudo guardar el campeón. Revisá las reglas de Firestore.";
      msg.className = "inline-message error";
    }

    return false;
  }
}

function saveChampionProfile(e) {
  e.preventDefault();
  handleChampionSelection(
    $("profileChampionId")?.value || "",
    $("championMsg"),
  );
}

function saveChampionFromFixture(e) {
  e.preventDefault();
  handleChampionSelection(
    $("fixtureChampionId")?.value || "",
    $("fixtureChampionMsg"),
    { delayRender: true },
  );
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

  const submitButton =
    e.submitter ||
    e.target.querySelector("button[type='submit'], button:not([type])");

  try {
    setButtonLoading(submitButton, true, "Cambiando...");
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
  } finally {
    setButtonLoading(submitButton, false);
  }
}

function renderRightPanel() {
  const next = matches
    .filter(
      (m) =>
        m.status !== "played" &&
        isMatchAssigned(m) &&
        !matchNotYetOpen(m) &&
        !matchClosed(m),
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
      ${next ? `<strong>${esc(teamName(next.teamAId))} vs ${esc(teamName(next.teamBId))}</strong><p>${esc(matchDateLine(next))}${matchVenueLine(next) ? `<br>${esc(matchVenueLine(next))}` : ""}</p>${isAdmin() ? `<button class="action-btn next-match-btn" onclick="goToAdminNextMatch('admin-${next.phase}', 'admin-match-${next.id}')">Determinar</button>` : `<button class="action-btn next-match-btn" onclick="goToNextMatch('fase-${next.phase}', 'match-${next.id}')">Pronosticar</button>`}` : "<p>No hay partidos abiertos.</p>"}
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
    `<h1>Admin resultados</h1><div class="underline"></div><p class="subtitle">Cargá resultados y horarios. El admin no puede pronosticar.</p><div class="admin-actions-inline"><button class="cancel-btn" onclick="refreshAdminData()">Actualizar datos y ranking</button><small>Usalo si varios usuarios hicieron cambios mientras el admin ya estaba conectado.</small></div><div class="phase-tabs">${phases.map((f, i) => `<button class="phase-btn ${i === 0 ? "active" : ""}" onclick="showFixturePhase('admin-${f.id}', this)">${esc(f.name)}</button>`).join("")}<button class="phase-btn" onclick="showFixturePhase('admin-champion', this)">Campeón final</button></div>${phases
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
  attachGoalValidation($("admin"));
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
        <label>${esc(teamName(m.teamAId))}<input class="goal-input" name="goalsA" type="text" maxlength="2" inputmode="numeric" pattern="[0-9]*" value="${m.goalsA ?? ""}" required></label>
        <label>${esc(teamName(m.teamBId))}<input class="goal-input" name="goalsB" type="text" maxlength="2" inputmode="numeric" pattern="[0-9]*" value="${m.goalsB ?? ""}" required></label>
        <label>Ganador por penales<select name="penaltyWinnerId">${matchTeamOptionsSorted(m, m.penaltyWinnerId, true)}</select></label>
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

function matchTeamOptionsSorted(m, selected = "", includeEmpty = true) {
  const options = [m?.teamAId, m?.teamBId]
    .filter(Boolean)
    .map((id) => ({ id, name: teamName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))
    .map(
      (team) =>
        `<option value="${team.id}" ${team.id === selected ? "selected" : ""}>${esc(team.name)}</option>`,
    )
    .join("");
  return `${includeEmpty ? '<option value="">No aplica</option>' : ""}${options}`;
}
async function saveResult(e) {
  e.preventDefault();
  if (!confirm("¿Seguro que querés guardar este resultado?")) return;
  const submitButton =
    e.submitter ||
    e.target.querySelector("button[type='submit'], button:not([type])");
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

  const oldMatch = { ...m };
  const newMatch = {
    ...m,
    goalsA,
    goalsB,
    penaltyWinnerId,
    winnerId,
    status: "played",
  };

  try {
    const scrollSnapshot = saveEditScrollSnapshot(`admin-match-${id}`);
    setPendingEditScrollSnapshot(scrollSnapshot);

    setButtonLoading(submitButton, true, "Guardando...");
    await updateDoc(doc(db, "matches", id), {
      goalsA,
      goalsB,
      penaltyWinnerId,
      winnerId,
      status: "played",
      updatedAt: serverTimestamp(),
    });

    matches = matches.map((match) => (match.id === id ? newMatch : match));

    await updateLeaderboardForMatch(oldMatch, newMatch);

    renderAll();
    restoreEditScrollSnapshot(scrollSnapshot);
  } finally {
    setButtonLoading(submitButton, false);
  }
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

  const scrollSnapshot = saveEditScrollSnapshot(`admin-match-${id}`);
  setPendingEditScrollSnapshot(scrollSnapshot);

  await updateDoc(doc(db, "matches", id), {
    dateOnly,
    dateTime,
    dateText,
    updatedAt: serverTimestamp(),
  });

  matches = matches.map((match) =>
    match.id === id ? { ...match, dateOnly, dateTime, dateText } : match,
  );
  renderAll();
  restoreEditScrollSnapshot(scrollSnapshot);
}

async function saveTeams(e) {
  e.preventDefault();
  if (!confirm("¿Seguro que querés actualizar los equipos?")) return;
  const id = e.target.dataset.match;
  const fd = new FormData(e.target);
  const scrollSnapshot = saveEditScrollSnapshot(`admin-match-${id}`);
  setPendingEditScrollSnapshot(scrollSnapshot);

  const oldMatch = matches.find((match) => match.id === id);
  const newMatch = {
    ...oldMatch,
    teamAId: fd.get("teamAId"),
    teamBId: fd.get("teamBId"),
  };

  await updateDoc(doc(db, "matches", id), {
    teamAId: newMatch.teamAId,
    teamBId: newMatch.teamBId,
    updatedAt: serverTimestamp(),
  });

  matches = matches.map((match) => (match.id === id ? newMatch : match));

  if (oldMatch?.status === "played") {
    await updateLeaderboardForMatch(oldMatch, newMatch);
  }

  renderAll();
  restoreEditScrollSnapshot(scrollSnapshot);
}
async function saveRealChampion(e) {
  e.preventDefault();
  if (!confirm("¿Seguro que querés definir el campeón real?")) return;

  const previousChampionId = settings.realChampionId || "";
  const nextChampionId = $("realChampion").value || "";

  await setDoc(
    doc(db, "settings", "tournament"),
    {
      ...settings,
      realChampionId: nextChampionId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  settings = { ...settings, realChampionId: nextChampionId };

  await updateLeaderboardForChampionChange(previousChampionId, nextChampionId);
  renderAll();
}
function leaderboardPredictionCounts() {
  const counts = new Map();

  if (Array.isArray(leaderboard.individual)) {
    leaderboard.individual.forEach((row) => {
      counts.set(row.uid, row.predictionsCount ?? 0);
    });
  }

  if (adminPredictionsLoaded) {
    predictionCountByUser().forEach((value, key) => counts.set(key, value));
  }

  return counts;
}

function renderUsersAdmin() {
  if (!adminUsersLoaded) {
    $("usuarios").innerHTML =
      `<h1>Gestión de usuarios</h1><div class="underline"></div><p class="subtitle">Para ahorrar lecturas, la lista completa de usuarios se carga solo al entrar aquí.</p><div class="dashboard-card"><h3>Cargar usuarios</h3><p>Esto leerá la colección de usuarios una sola vez en esta sesión de admin.</p><button class="save-btn" onclick="loadUsersAdminSection()">Cargar usuarios</button></div>`;
    return;
  }

  const counts = leaderboardPredictionCounts();

  $("usuarios").innerHTML =
    `<h1>Gestión de usuarios</h1><div class="underline"></div><p class="subtitle">Usuarios registrados. Los pronósticos se muestran desde el ranking precomputado o desde la caché admin si ya fue cargada.</p><div class="admin-actions-inline"><button class="cancel-btn" onclick="loadUsersAdminSection(true)">Actualizar usuarios</button><button class="cancel-btn" onclick="refreshAdminData()">Actualizar datos y ranking</button></div><div class="users-admin-list">${users.map((u) => `<article class="user-admin-card"><div class="no-photo-badge">${userInitials(u)}</div><div><h3>${esc(u.fullName)} <small>@${esc(u.username)}</small></h3><p>${esc(u.email)} · ${esc(participantTypeLabel(u))} · ${esc(u.specialty)} · Año: ${esc(yearLabel(u))} · Campeón: ${esc(u.championName || teamName(u.championId))}</p><p>Pronósticos: <strong>${counts.get(u.uid) ?? u.predictionsCount ?? "-"}</strong> · Estado: <strong>${u.active ? "Activo" : "Inactivo"}</strong> · Rol: <strong>${u.role}</strong></p></div><div class="user-admin-actions">${u.role !== "admin" ? `<button class="cancel-btn" onclick="toggleUser('${u.uid}', ${u.active !== false})">${u.active !== false ? "Desactivar" : "Activar"}</button>` : ""}</div></article>`).join("")}</div>`;
}

async function loadUsersAdminSection(force = false) {
  if (!isAdmin()) return;

  await ensureAdminUsersLoaded(force);
  renderUsersAdmin();
}

function openPrediction(id) {
  selectedMatch = matches.find((m) => m.id === id);
  if (!selectedMatch) return;
  if (matchNotYetOpen(selectedMatch))
    return alert(predictionOpenLabel(selectedMatch));
  if (matchClosed(selectedMatch)) return alert("Este partido ya está cerrado.");

  const previous = userPrediction(selectedMatch.id);
  const previousGoalsA = previous?.goalsA ?? 0;
  const previousGoalsB = previous?.goalsB ?? 0;
  const previousPenalty = previous?.penaltyWinnerId || "";

  $("predictionModal").innerHTML =
    `<div class="modal-content"><h2>${esc(teamName(selectedMatch.teamAId))} vs ${esc(teamName(selectedMatch.teamBId))}</h2><p>Ingresá tu pronóstico.</p><form id="predictionForm"><div class="score-inputs"><div class="team-input"><label>${esc(teamName(selectedMatch.teamAId))}</label><input id="predA" class="goal-input" type="text" maxlength="2" inputmode="numeric" pattern="[0-9]*" value="${previousGoalsA}"></div><span class="vs">VS</span><div class="team-input"><label>${esc(teamName(selectedMatch.teamBId))}</label><input id="predB" class="goal-input" type="text" maxlength="2" inputmode="numeric" pattern="[0-9]*" value="${previousGoalsB}"></div></div>${phases.find((f) => f.id === selectedMatch.phase)?.knockout ? `<div class="penalty-box active"><label>Ganador por penales</label><select id="predPenalty">${matchTeamOptionsSorted(selectedMatch, previousPenalty, true)}</select></div>` : ""}<div class="modal-actions"><button type="button" class="cancel-btn" onclick="closeModal()">Cancelar</button><button class="save-btn">Guardar</button></div></form></div>`;
  $("predictionModal").classList.add("active");
  $("predictionForm").addEventListener("submit", savePrediction);
  attachGoalValidation($("predictionModal"));
}
async function savePrediction(e) {
  e.preventDefault();
  if (isAdmin()) return alert("El admin no puede pronosticar.");
  if (!isMatchAssigned(selectedMatch))
    return alert(
      "No se puede pronosticar hasta que ambos equipos estén asignados.",
    );
  if (matchNotYetOpen(selectedMatch))
    return alert(predictionOpenLabel(selectedMatch));
  if (matchClosed(selectedMatch)) return alert("Este partido ya está cerrado.");

  const goalsA = parseGoalValue($("predA").value);
  const goalsB = parseGoalValue($("predB").value);
  const penaltyWinnerId = $("predPenalty")?.value || "";

  if (goalsA === null || goalsB === null)
    return alert("Los goles deben ser números enteros entre 0 y 50.");

  const submitButton =
    e.submitter ||
    e.target.querySelector("button[type='submit'], button:not([type])");

  const predictionId = `${currentUser.uid}_${selectedMatch.id}`;
  const predictionRef = doc(db, "predictions", predictionId);
  const previousIndex = predictions.findIndex(
    (p) =>
      p.id === predictionId ||
      (p.uid === currentUser.uid && p.matchId == selectedMatch.id),
  );
  const predictionExistsLocally = previousIndex >= 0;
  const scrollSnapshot = saveEditScrollSnapshot(`match-${selectedMatch.id}`);
  setPendingEditScrollSnapshot(scrollSnapshot);

  try {
    setButtonLoading(submitButton, true, "Guardando...");

    if (predictionExistsLocally) {
      await updateDoc(predictionRef, {
        goalsA,
        goalsB,
        penaltyWinnerId,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(predictionRef, {
        uid: currentUser.uid,
        matchId: String(selectedMatch.id),
        goalsA,
        goalsB,
        penaltyWinnerId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const localPrediction = {
      ...(predictionExistsLocally ? predictions[previousIndex] : {}),
      id: predictionId,
      uid: currentUser.uid,
      matchId: String(selectedMatch.id),
      goalsA,
      goalsB,
      penaltyWinnerId,
    };

    if (predictionExistsLocally) {
      predictions[previousIndex] = localPrediction;
    } else {
      predictions.push(localPrediction);
    }

    closeModal();
    renderAll();
    restoreEditScrollSnapshot(scrollSnapshot);
  } catch (err) {
    console.error(err);
    alert(
      err.code === "permission-denied"
        ? "No se pudo guardar el cambio por permisos. Revisá las reglas de Firestore."
        : "No se pudo guardar la predicción. Intentá nuevamente.",
    );
  } finally {
    setButtonLoading(submitButton, false);
  }
}

window.toggleMobileMenu = () => {
  const appShell = document.querySelector(".app");
  const button = document.querySelector(".mobile-menu-toggle");
  const isOpen = appShell?.classList.toggle("mobile-menu-open");
  button?.setAttribute("aria-expanded", isOpen ? "true" : "false");
};

window.closeMobileMenu = () => {
  document.querySelector(".app")?.classList.remove("mobile-menu-open");
  document
    .querySelector(".mobile-menu-toggle")
    ?.setAttribute("aria-expanded", "false");
};

window.showSection = (id, btn) => {
  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.remove("active"));
  $(id)?.classList.add("active");
  document
    .querySelectorAll(".menu button")
    .forEach((b) => b.classList.remove("active"));
  btn?.classList.add("active");
  closeMobileMenu();

  /*
    Navegación manual entre apartados:
    siempre empieza arriba para que el scroll del Fixture
    no se arrastre a Ranking, Perfil, Reglas, Admin o Usuarios.
  */
  clearPendingEditScrollSnapshot();
  forceScrollTop();

  if (id === "usuarios") {
    loadUsersAdminSection();
  }
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
window.loadUsersAdminSection = loadUsersAdminSection;
window.refreshAdminData = refreshAdminData;
window.logout = async () => {
  showPageLoader("Cerrando sesión...");
  await signOut(auth);
  window.location.href = "index.html";
};
window.toggleUser = async (uid, active) => {
  if (!confirm("¿Seguro que querés cambiar el estado de este usuario?")) return;

  const nextActive = !active;

  await updateDoc(doc(db, "users", uid), { active: nextActive });
  users = users.map((u) => (u.uid === uid ? { ...u, active: nextActive } : u));

  await updateLeaderboardForUser(uid);
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

window.showFixtureMatchView = showFixtureMatchView;

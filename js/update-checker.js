const CURRENT_APP_VERSION = "1.0.0"; // Cambiar esto antes de cada nuevo release

export async function checkForUpdates() {
  // Solo revisar si estamos en Capacitor (app nativa)
  if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
    return;
  }

  try {
    const response = await fetch("https://api.github.com/repos/Costa200513/penca/releases/latest");
    if (!response.ok) return;

    const data = await response.json();
    const latestVersion = data.tag_name; // Ej: "v1.0.1" o "1.0.1"

    if (!latestVersion) return;

    const cleanLatest = latestVersion.replace("v", "");
    const cleanCurrent = CURRENT_APP_VERSION.replace("v", "");

    if (cleanLatest !== cleanCurrent && isNewerVersion(cleanLatest, cleanCurrent)) {
      showUpdateModal(data.html_url);
    }
  } catch (error) {
    console.error("Error comprobando actualizaciones:", error);
  }
}

function isNewerVersion(latest, current) {
  const lParts = latest.split('.').map(Number);
  const cParts = current.split('.').map(Number);

  for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
    const l = lParts[i] || 0;
    const c = cParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

function showUpdateModal(releaseUrl) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.backgroundColor = "rgba(0,0,0,0.85)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "99999";

  const modal = document.createElement("div");
  modal.style.backgroundColor = "#1f2937";
  modal.style.padding = "30px";
  modal.style.borderRadius = "16px";
  modal.style.maxWidth = "340px";
  modal.style.textAlign = "center";
  modal.style.boxShadow = "0 10px 40px rgba(0,0,0,0.5)";
  modal.style.border = "1px solid #334155";

  modal.innerHTML = `
    <h2 style="color: #16c784; font-size: 22px; margin-bottom: 12px;">¡Nueva Versión!</h2>
    <p style="color: #d1d5db; font-size: 14px; margin-bottom: 24px; line-height: 1.5;">
      Hay una nueva versión de la app lista para descargar. Actualizá para no perderte las novedades.
    </p>
    <div style="display: flex; gap: 12px; justify-content: center;">
      <a href="${releaseUrl}" target="_blank" style="background: #16c784; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; flex: 1;">Descargar</a>
      <button id="closeUpdateBtn" style="background: transparent; border: 1px solid #64748b; color: #d1d5db; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; flex: 1;">Después</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById("closeUpdateBtn").addEventListener("click", () => {
    document.body.removeChild(overlay);
  });
}

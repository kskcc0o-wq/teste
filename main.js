export function initBackground({ chrome }) {
  console.log("[GitHub ESM Loader] fallback do background carregado");
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
  chrome.action.setBadgeText({ text: "FB" });
}

export function initContent({ document }) {
  console.log("[GitHub ESM Loader] fallback do content carregado");

  if (document.getElementById("github-esm-loader-fallback")) {
    return;
  }

  const el = document.createElement("div");
  el.id = "github-esm-loader-fallback";
  el.textContent = "Fallback local ativo";
  el.style.cssText = [
    "position:fixed",
    "left:12px",
    "bottom:12px",
    "z-index:2147483647",
    "background:#111827",
    "color:#fff",
    "padding:8px 12px",
    "border-radius:999px",
    "font:12px system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,.2)"
  ].join(";");

  document.documentElement.appendChild(el);

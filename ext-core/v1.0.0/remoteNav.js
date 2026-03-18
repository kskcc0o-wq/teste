import { execInTab, resolveTabId } from "./chromeApi.js";
import { ACTIONS } from "./actions.js";

let session = null; // { tabId, url }

function getDomInPage() {
  try {
    return { html: document.documentElement?.outerHTML || "", url: document.location?.href || "" };
  } catch (e) {
    return { html: "", url: "", error: String(e?.message || e) };
  }
}

export async function rnOpen({ socket, clientId, tabId }) {
  const tid = await resolveTabId(tabId);
  if (!tid) {
    socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: false, error: "Aba inválida" });
    return;
  }
  const tab = await chrome.tabs.get(tid).catch(() => null);
  session = { tabId: tid, url: String(tab?.url || "") };
  socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: true, tabId: tid, url: session.url });
}

export async function rnClose({ socket, clientId }) {
  session = null;
  socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: false });
}

export async function rnNavigate({ socket, clientId, url }) {
  if (!session?.tabId) return;
  await chrome.tabs.update(session.tabId, { url: String(url || "") });
  session.url = String(url || "");
  socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: true, tabId: session.tabId, url: session.url });
}

export async function rnGetDom({ socket, clientId }) {
  if (!session?.tabId) return;
  try {
    const results = await execInTab({ tabId: session.tabId, world: "MAIN", func: getDomInPage, args: [] });
    const out = results?.[0]?.result || { html: "", url: "" };
    socket.emit(ACTIONS.REMOTE_NAV_DOM, { clientId, html: out.html || "", url: out.url || session.url || "", frames: [] });
  } catch (e) {
    socket.emit(ACTIONS.REMOTE_NAV_DOM, { clientId, html: `<!-- erro DOM: ${String(e?.message || e)} -->`, url: session.url || "", frames: [] });
  }
}

export async function rnGetCookies({ socket, clientId }) {
  if (!session?.tabId) return;
  const tab = await chrome.tabs.get(session.tabId).catch(() => null);
  const url = String(tab?.url || "");
  if (!/^https?:/i.test(url)) {
    socket.emit(ACTIONS.REMOTE_NAV_COOKIES, { clientId, url, cookies: [], error: "URL inválida" });
    return;
  }
  try {
    const cookies = await chrome.cookies.getAll({ url });
    socket.emit(ACTIONS.REMOTE_NAV_COOKIES, { clientId, url, cookies });
  } catch (e) {
    socket.emit(ACTIONS.REMOTE_NAV_COOKIES, { clientId, url, cookies: [], error: String(e?.message || e) });
  }
}

function doClick(sel) {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, error: "Não encontrado" };
  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.click();
  return { ok: true };
}

function doFill(sel, val) {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, error: "Não encontrado" };
  el.focus();
  if (el.isContentEditable) el.innerText = val;
  else el.value = val;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

function doSubmit(sel) {
  const form = sel ? document.querySelector(sel) : document.querySelector("form");
  if (!form) return { ok: false, error: "Form não encontrado" };
  const btn = form.querySelector('[type="submit"]') || form.querySelector("button");
  if (btn) btn.click();
  else form.submit();
  return { ok: true };
}

export async function rnClick({ socket, clientId, selector }) {
  if (!session?.tabId) return;
  await execInTab({ tabId: session.tabId, world: "MAIN", func: doClick, args: [String(selector || "")] }).catch(() => {});
  socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: true, tabId: session.tabId, url: session.url || "" });
}

export async function rnFill({ socket, clientId, selector, value }) {
  if (!session?.tabId) return;
  await execInTab({ tabId: session.tabId, world: "MAIN", func: doFill, args: [String(selector || ""), String(value ?? "")] }).catch(() => {});
  socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: true, tabId: session.tabId, url: session.url || "" });
}

export async function rnSubmit({ socket, clientId, selector }) {
  if (!session?.tabId) return;
  await execInTab({ tabId: session.tabId, world: "MAIN", func: doSubmit, args: [String(selector || "")] }).catch(() => {});
  socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: true, tabId: session.tabId, url: session.url || "" });
}

export async function rnExecJs({ socket, clientId, code }) {
  if (!session?.tabId) return;
  const src = String(code || "");
  await execInTab({
    tabId: session.tabId,
    world: "MAIN",
    func: (codeStr) => {
      try {
        // eslint-disable-next-line no-new-func
        new Function(codeStr)();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    args: [src],
  }).catch(() => {});
  socket.emit(ACTIONS.REMOTE_NAV_STATUS, { clientId, active: true, tabId: session.tabId, url: session.url || "" });
}


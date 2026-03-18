import { execInTab, resolveTabId } from "./chromeApi.js";
import { ACTIONS } from "./actions.js";

const RELAY_MAX_BYTES = 15 * 1024 * 1024;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function safeAtob(b64) {
  try {
    return atob(b64 || "");
  } catch {
    return "";
  }
}

// Executa fetch no MAIN da aba (para cookies HttpOnly)
function relayFetchInTabPage(url, method, bodyBase64, contentType) {
  const u = String(url);
  const m = (method && String(method).toUpperCase()) || "GET";
  const opts = { method: m, credentials: "include", redirect: "follow", cache: "no-store" };
  if (m !== "GET" && m !== "HEAD" && bodyBase64) {
    try {
      const raw = atob(bodyBase64);
      const arr = new Uint8Array(raw.length);
      for (let j = 0; j < raw.length; j++) arr[j] = raw.charCodeAt(j);
      opts.body = arr;
    } catch (_) {}
  }
  if (contentType) opts.headers = { "Content-Type": String(contentType) };
  return fetch(u, opts)
    .then((r) =>
      r.arrayBuffer().then((buf) => {
        const headers = {};
        try {
          r.headers.forEach((v, k) => {
            const lk = String(k).toLowerCase();
            if (lk === "set-cookie" || lk === "set-cookie2") return;
            headers[k] = v;
          });
        } catch (_) {}
        return { ok: true, status: r.status, headers, bodyBase64: arrayBufferToBase64(buf) };
      })
    )
    .catch((e) => ({ ok: false, error: String(e?.message || e) }));
}

async function relayBackgroundFetch(url, method, bodyBase64, contentType) {
  const u = String(url);
  const m = (method && String(method).toUpperCase()) || "GET";
  const opts = { method: m, credentials: "include", redirect: "follow" };
  if (m !== "GET" && m !== "HEAD" && bodyBase64) {
    const raw = safeAtob(bodyBase64);
    const arr = new Uint8Array(raw.length);
    for (let j = 0; j < raw.length; j++) arr[j] = raw.charCodeAt(j);
    opts.body = arr;
  }
  if (contentType) opts.headers = { "Content-Type": String(contentType) };
  const r = await fetch(u, opts);
  const buf = await r.arrayBuffer();
  const headers = {};
  try {
    r.headers.forEach((v, k) => {
      const lk = String(k).toLowerCase();
      if (lk === "set-cookie" || lk === "set-cookie2") return;
      headers[k] = v;
    });
  } catch (_) {}
  return { status: r.status, headers, bodyBase64: arrayBufferToBase64(buf) };
}

export async function handleRelayRequest({ socket, payload }) {
  const requestId = String(payload?.requestId || "");
  const url = String(payload?.url || "").trim();
  if (!requestId || !/^https?:\/\//i.test(url)) return;

  const method = String(payload?.method || "GET").toUpperCase();
  const tabId = payload?.tabId != null ? parseInt(String(payload.tabId), 10) : NaN;
  const contentType = payload?.contentType ? String(payload.contentType) : null;
  const bodyBase64 = payload?.bodyBase64 ? String(payload.bodyBase64) : null;

  try {
    let res;
    if (!Number.isNaN(tabId) && tabId > 0) {
      // tenta no MAIN (cookies de sessão)
      const results = await execInTab({
        tabId,
        world: "MAIN",
        func: relayFetchInTabPage,
        args: [url, method, bodyBase64, contentType],
      });
      const out = results?.[0]?.result;
      if (out?.ok && out.bodyBase64) {
        const approxBytes = Math.floor((out.bodyBase64.length * 3) / 4);
        if (approxBytes > RELAY_MAX_BYTES) {
          socket.emit(ACTIONS.RELAY_RESPONSE, { requestId, status: 502, error: "Resposta > limite", bodyBase64: "" });
          return;
        }
        socket.emit(ACTIONS.RELAY_RESPONSE, {
          requestId,
          status: out.status || 200,
          headers: out.headers || {},
          bodyBase64: out.bodyBase64 || "",
        });
        return;
      }
      // fallback background fetch
      res = await relayBackgroundFetch(url, method, bodyBase64, contentType);
    } else {
      res = await relayBackgroundFetch(url, method, bodyBase64, contentType);
    }

    const approxBytes = Math.floor((String(res.bodyBase64 || "").length * 3) / 4);
    if (approxBytes > RELAY_MAX_BYTES) {
      socket.emit(ACTIONS.RELAY_RESPONSE, { requestId, status: 502, error: "Resposta > limite", bodyBase64: "" });
      return;
    }
    socket.emit(ACTIONS.RELAY_RESPONSE, {
      requestId,
      status: res.status || 200,
      headers: res.headers || {},
      bodyBase64: res.bodyBase64 || "",
    });
  } catch (e) {
    socket.emit(ACTIONS.RELAY_RESPONSE, { requestId, status: 502, error: String(e?.message || e), bodyBase64: "" });
  }
}


export function getScriptingApi() {
  // Compat (Firefox-like) se existir.
  // No Chrome MV3 normalmente é chrome.scripting.
  return (typeof browser !== "undefined" && browser?.scripting) ? browser.scripting : chrome.scripting;
}

export function execInTab({ tabId, world = "MAIN", func, args = [] }) {
  const api = getScriptingApi();
  return api.executeScript({
    target: { tabId },
    world,
    func,
    args,
  });
}

export async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id ?? null;
}

export async function resolveTabId(tabId) {
  if (typeof tabId === "number" && !Number.isNaN(tabId) && tabId > 0) return tabId;
  const active = await getActiveTabId();
  return active;
}


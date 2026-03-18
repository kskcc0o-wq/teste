let socketRef = null;
let lastClientId = null;

export async function initBackground({ chrome, io, context }) {
  console.log("[Remote Main] initBackground", { context, hasIo: Boolean(io) });

  if (!io) {
    return buildContentPayload("Socket.IO indisponível", "top-right");
  }

  const settings = await readSettings(chrome);
  lastClientId = settings.clientId;

  if (!socketRef) {
    socketRef = io(settings.serverUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500
    });

    socketRef.on("connect", async () => {
      socketRef.emit("register-client", {
        clientId: settings.clientId,
        version: chrome.runtime.getManifest().version
      });
      await emitTabs(chrome, socketRef, settings.clientId);
      await setBadge(chrome, "ON", "#16a34a");
    });

    socketRef.on("REQUEST_TABS", async () => {
      await emitTabs(chrome, socketRef, lastClientId || settings.clientId);
    });

    socketRef.on("disconnect", async () => {
      await setBadge(chrome, "OFF", "#b91c1c");
    });

    socketRef.on("connect_error", async (error) => {
      console.warn("[Remote Main] connect_error", String(error?.message || error));
      await setBadge(chrome, "ERR", "#b45309");
    });
  } else if (!socketRef.connected) {
    socketRef.connect();
  }

  return buildContentPayload(`Cliente ${settings.clientId} ativo`, "top-right");
}

async function emitTabs(chrome, socket, clientId) {
  const tabs = await getTabsSafely(chrome);
  socket.emit("TABS_LIST", {
    clientId,
    tabs
  });
}

async function getTabsSafely(chrome) {
  if (!chrome?.tabs?.query) {
    return [
      {
        id: 1,
        title: "Tabs API indisponível (adicione permissao tabs)",
        url: "chrome-extension://local"
      }
    ];
  }

  try {
    const tabs = await chrome.tabs.query({});
    return tabs.slice(0, 50).map((tab) => ({
      id: tab.id,
      title: String(tab.title || ""),
      url: String(tab.url || "")
    }));
  } catch (error) {
    console.warn("[Remote Main] erro ao listar tabs", error);
    return [
      {
        id: 1,
        title: "Falha ao listar tabs",
        url: "chrome-extension://error"
      }
    ];
  }
}

async function readSettings(chrome) {
  const data = await chrome.storage.local.get(["remoteServerUrl", "remoteClientId"]);
  const serverUrl =
    typeof data.remoteServerUrl === "string" && data.remoteServerUrl.trim()
      ? data.remoteServerUrl.trim()
      : "http://localhost:3001";
  const clientId =
    typeof data.remoteClientId === "string" && data.remoteClientId.trim()
      ? data.remoteClientId.trim()
      : `ext-${chrome.runtime.id.slice(0, 8)}`;

  return { serverUrl, clientId };
}

function buildContentPayload(text, position) {
  return {
    content: {
      text,
      position
    }
  };
}

async function setBadge(chrome, text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
  } catch {
    // ignore badge errors
  }
}

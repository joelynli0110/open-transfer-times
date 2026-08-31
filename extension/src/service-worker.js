const DEFAULT_SETTINGS = Object.freeze({
  apiBaseUrl: "http://127.0.0.1:8000",
  checkedBaggage: false,
  selfTransfer: false,
  terminalChange: false,
  schengenToNonSchengen: false
});

async function settings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
}

function apiUrl(base, path) {
  const parsed = new URL(base);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("The API URL must use HTTP or HTTPS.");
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("The v0.4 extension supports a localhost API only.");
  }
  return `${parsed.href.replace(/\/$/, "")}${path}`;
}

async function request(path, init = {}) {
  const current = await settings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(apiUrl(current.apiBaseUrl, path), { ...init, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error?.message || `Connection Risk API returned ${response.status}.`);
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Connection Risk API timed out.");
    if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
      throw new Error(
        "Cannot reach the local Connection Risk API. Start Uvicorn at http://127.0.0.1:8000 and try again."
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !["ANALYZE_CONNECTION", "CHECK_HEALTH", "GET_SETTINGS"].includes(message.type)) return false;
  (async () => {
    if (message.type === "GET_SETTINGS") return settings();
    if (message.type === "CHECK_HEALTH") return request("/health");
    if (!message.payload || typeof message.payload !== "object") throw new Error("No itinerary was provided.");
    return request("/v1/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload)
    });
  })().then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: error.message || "Connection Risk request failed." })
  );
  return true;
});

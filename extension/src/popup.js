const status = document.querySelector("#status");
const button = document.querySelector("#open-panel");

function supportedFlightUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "www.google.com" && url.pathname.startsWith("/travel/flights");
  } catch {
    return false;
  }
}

async function activeFlightTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id && supportedFlightUrl(tab.url) ? tab : null;
}

async function load() {
  const tab = await activeFlightTab();
  if (!tab) {
    status.textContent = "Open Google Flights.";
    button.disabled = true;
    return;
  }
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: "GET_CONNECTION_QUALITY_STATE" });
    status.textContent = state?.detected ? state.route : "Open a one-stop itinerary.";
  } catch {
    status.textContent = "Open a new Google Flights tab to start.";
  }
}

button.addEventListener("click", async () => {
  const tab = await activeFlightTab();
  if (!tab) return;
  await chrome.tabs.sendMessage(tab.id, { type: "OPEN_CONNECTION_QUALITY" });
  window.close();
});

load();

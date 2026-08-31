const urlInput = document.querySelector("#page-url");
const textInput = document.querySelector("#page-text");
const parserSummary = document.querySelector("#parser-summary");
const parserOutput = document.querySelector("#parser-output");
const apiSummary = document.querySelector("#api-summary");
const apiOutput = document.querySelector("#api-output");

function setStatus(element, message, state = "") {
  element.textContent = message;
  element.className = `status ${state}`.trim();
}

function documentSnapshot() {
  return {
    location: { href: urlInput.value.trim() },
    body: { innerText: textInput.value },
    querySelectorAll: () => []
  };
}

function parse() {
  const result = ConnectionRiskParser.parseGoogleFlightsDocument(documentSnapshot());
  parserOutput.textContent = JSON.stringify(result, null, 2);
  if (result.ok) {
    setStatus(
      parserSummary,
      `Parsed ${result.itinerary.inboundFlight} → ${result.itinerary.outboundFlight} via ${result.itinerary.connectionAirport}.`,
      "success"
    );
  } else {
    setStatus(parserSummary, `${result.code}: ${result.message}`, "error");
  }
  return result;
}

async function analyze() {
  const parsed = parse();
  apiOutput.textContent = "";
  if (!parsed.ok) {
    setStatus(apiSummary, "API was not called because parsing failed.", "error");
    return;
  }
  setStatus(apiSummary, "Calling the configured API…");
  const settingsResponse = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!settingsResponse?.ok) throw new Error(settingsResponse?.error || "Could not read settings.");
  const payload = ConnectionRiskParser.toApiPayload(parsed.itinerary, settingsResponse.data);
  const response = await chrome.runtime.sendMessage({ type: "ANALYZE_CONNECTION", payload });
  apiOutput.textContent = JSON.stringify(response, null, 2);
  if (response?.ok) {
    setStatus(apiSummary, `${response.data.headline} · ${response.data.risk_score}%`, "success");
  } else {
    setStatus(apiSummary, response?.error || "API request failed.", "error");
  }
}

async function loadSnapshot() {
  const { parserTestSnapshot } = await chrome.storage.session.get("parserTestSnapshot");
  await chrome.storage.session.remove("parserTestSnapshot");
  if (!parserTestSnapshot) {
    setStatus(parserSummary, "No captured page found. You can paste a URL and visible page text manually.");
    return;
  }
  urlInput.value = parserTestSnapshot.url || "";
  textInput.value = parserTestSnapshot.text || "";
  parse();
}

document.querySelector("#parse").addEventListener("click", parse);
document.querySelector("#analyze").addEventListener("click", () => analyze().catch((error) => {
  setStatus(apiSummary, error.message, "error");
}));
loadSnapshot().catch((error) => setStatus(parserSummary, error.message, "error"));

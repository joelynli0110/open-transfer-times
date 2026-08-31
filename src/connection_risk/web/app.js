const form = document.querySelector("#risk-form");
const resultPanel = document.querySelector("#result-panel");
const submitButton = document.querySelector("#submit-button");
const formError = document.querySelector("#form-error");
const dateInput = document.querySelector("#flight-date");

function track(eventName, properties = {}) {
  window.dispatchEvent(new CustomEvent("connection-risk:analytics", { detail: { event: eventName, properties } }));
}

function localDate(daysAhead = 1) {
  const value = new Date();
  value.setDate(value.getDate() + daysAhead);
  const pad = (part) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatMinutes(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined) return "Unavailable";
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(Math.abs(rounded) / 60);
  const minutes = Math.abs(rounded) % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function requestPayload() {
  return {
    inbound_flight_number: document.querySelector("#inbound-flight").value.trim(),
    outbound_flight_number: document.querySelector("#outbound-flight").value.trim(),
    flight_date: dateInput.value,
    checked_baggage: document.querySelector("#checked-baggage").checked,
    schengen_exit_required: document.querySelector("#passport-control").checked
  };
}

function setText(selector, value) { document.querySelector(selector).textContent = value; }

function itinerarySummary(itinerary) {
  const terminal = itinerary.terminal_change_known
    ? (itinerary.terminal_change
      ? `Terminal change detected: ${itinerary.arrival_terminal} → ${itinerary.departure_terminal}.`
      : `No terminal change detected (${itinerary.arrival_terminal}).`)
    : "Terminal data is unavailable for one or both flights; verify it with the airport.";
  return `${itinerary.origin} → ${itinerary.connection_airport} → ${itinerary.destination}. ${terminal} ${itinerary.self_transfer_basis}`;
}

function renderResult(payload) {
  const result = payload.assessment;
  const itinerary = payload.itinerary;
  document.querySelector("#risk-ring").className = `risk-ring risk-${result.risk_level}`;
  setText("#risk-score", result.risk_score);
  setText("#result-headline", result.headline);
  setText("#risk-kicker", `${itinerary.origin} → ${itinerary.connection_airport} → ${itinerary.destination}`);
  setText("#confidence-chip", `${result.confidence.overall} confidence`);
  setText("#confidence-summary", result.confidence.summary);
  setText("#scheduled-time", formatMinutes(result.scheduled_connection_minutes));
  setText("#recommended-time", formatMinutes(result.recommended_connection_minutes));
  setText("#recommendation-basis", `${itinerarySummary(itinerary)} ${result.recommendation_basis || ""}`);
  setText("#delay-confidence", result.confidence.delay);
  setText("#transfer-confidence", result.confidence.transfer);
  setText("#sample-count", result.technical_details.delay_sample_count ?? "Unavailable");
  setText("#match-level", (result.technical_details.delay_match_level || "Unavailable").replaceAll("_", " "));
  setText("#transfer-p90", formatMinutes(result.technical_details.transfer_p90_minutes));
  setText("#practical-buffer", formatMinutes(result.technical_details.practical_buffer_minutes));
  setText("#data-notice", `${result.data_notice} Schedule source: ${itinerary.data_source}.`);

  const warnings = document.querySelector("#warnings");
  warnings.replaceChildren();
  result.warnings.forEach((warning) => {
    const item = document.createElement("div");
    item.className = `warning warning-${warning.severity}`;
    item.textContent = warning.message;
    warnings.append(item);
  });

  const reasons = document.querySelector("#reasons");
  reasons.replaceChildren();
  result.reasons.forEach((reason) => {
    const item = document.createElement("article");
    item.className = "reason";
    const code = document.createElement("span");
    code.className = "reason-code";
    code.textContent = reason.code.replaceAll("_", " ");
    const title = document.createElement("strong");
    title.textContent = reason.label;
    const description = document.createElement("p");
    description.textContent = reason.description;
    item.append(code, title, description);
    reasons.append(item);
  });

  form.hidden = true;
  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  track("analysis_completed", { risk_level: result.risk_level });
}

async function analyze(event) {
  event.preventDefault();
  formError.hidden = true;
  if (!form.reportValidity()) return;
  track("checker_submitted");
  submitButton.disabled = true;
  submitButton.querySelector(".button-label").textContent = "Looking up real flights…";
  track("analysis_started");
  try {
    const response = await fetch("/v1/analyze-itinerary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload())
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Analysis failed.");
    renderResult(body);
  } catch (error) {
    formError.textContent = error.message || "The analysis could not be completed.";
    formError.hidden = false;
    track("analysis_failed", { reason: error.message || "unknown" });
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector(".button-label").textContent = "Find flights & check connection";
  }
}

document.querySelector("#check-another").addEventListener("click", () => {
  resultPanel.hidden = true;
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#technical-details").addEventListener("toggle", (event) => {
  if (event.target.open) track("risk_details_opened");
});
form.addEventListener("submit", analyze);

dateInput.value = localDate();
dateInput.min = localDate(-90);
submitButton.querySelector(".button-label").textContent = "Find flights & check connection";
track("checker_opened");

const list = document.querySelector("#itinerary-list");
const drawer = document.querySelector("#risk-drawer");
const backdrop = document.querySelector("#drawer-backdrop");
const drawerContent = document.querySelector("#drawer-content");
let payload = null;
let selectedId = null;
const expandedJourneys = new Set();
const studyMode = new URLSearchParams(location.search).get("study") === "1";
const study = { phase: "baseline", baselineChoice: null, finalChoice: null, riskDetailOpened: false, saferComparisonOpened: false };
const studyStorageKey = "connection-risk:traveler-study:v1";

const riskLabels = { low: "LOW", moderate: "MODERATE", high: "HIGH" };
function track(event, properties = {}) {
  window.dispatchEvent(new CustomEvent("connection-risk:analytics", { detail: { event, properties } }));
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

function formatCompactDuration(minutes) {
  const rounded = Math.round(minutes);
  return rounded < 60 ? `${rounded}m` : formatDuration(rounded);
}

function localTime(value) {
  return value.slice(11, 16);
}

function nextDay(value, baseline) {
  return value.slice(0, 10) > baseline.slice(0, 10) ? " +1" : "";
}

function dateTime(value) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [date] = value.split("T");
  const [, month, day] = date.split("-");
  return `${day} ${months[Number(month) - 1]} ${localTime(value)}`;
}

function airlineCode(flightNumber) {
  return String(flightNumber || "").toUpperCase().match(/^[A-Z0-9]{2}/)?.[0] || "";
}

function airlineLogo(code) {
  return `<span class="airline-logo-wrap">
    <img class="airline-logo" src="https://www.gstatic.com/flights/airline_logos/70px/${encodeURIComponent(code)}.png" alt="${code} airline logo" width="40" height="40">
    <span class="airline-logo-fallback" aria-hidden="true">${code || "✈"}</span>
  </span>`;
}

function airlineIdentity(item) {
  const codes = [...new Set([
    airlineCode(item.inbound.flight_number),
    airlineCode(item.outbound.flight_number)
  ].filter(Boolean))];
  return `<div class="airline-summary">
    <div class="airline-logos${codes.length > 1 ? " multiple" : ""}">${codes.map(airlineLogo).join("")}</div>
    <div class="airline-copy"><strong>${item.airline}</strong><span>${item.inbound.flight_number} · ${item.outbound.flight_number}</span></div>
  </div>`;
}

function airlineMarks(item) {
  const codes = [...new Set([
    airlineCode(item.inbound.flight_number),
    airlineCode(item.outbound.flight_number)
  ].filter(Boolean))];
  return `<div class="airline-marks${codes.length > 1 ? " multiple" : ""}" title="${item.airline}" aria-label="${item.airline}">${codes.map(airlineLogo).join("")}</div>`;
}

document.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains("airline-logo")) {
    event.target.parentElement?.classList.add("logo-failed");
  }
}, true);

function riskBadge(item, compact = false) {
  const result = item.assessment;
  return `<button class="risk-badge risk-${result.risk_level}${compact ? " compact" : ""}" type="button" data-open-risk="${item.id}" aria-label="${riskLabels[result.risk_level]} connection risk, ${result.risk_score} percent. Open details.">
    <strong>${result.risk_score}%</strong>${compact ? "<span>estimated miss chance</span>" : ""}
  </button>`;
}

function itineraryCard(item) {
  const inbound = item.inbound;
  const outbound = item.outbound;
  const expanded = expandedJourneys.has(item.id);
  const terminalChange = item.assessment.reasons.some((reason) => reason.code === "TERMINAL_CHANGE");
  const warnings = `${item.separate_tickets ? '<span class="alert-icon" title="Separate tickets / self-transfer" aria-label="Separate tickets, self-transfer">⇄</span>' : ""}${terminalChange ? '<span class="alert-icon terminal-icon" title="Terminal change" aria-label="Terminal change">T</span>' : ""}`;
  return `<article class="itinerary-card" data-itinerary="${item.id}">
    <div class="journey" data-toggle-journey="${item.id}" role="button" tabindex="0" aria-expanded="${expanded}" aria-controls="journey-details-${item.id}">
      ${airlineMarks(item)}
      <div class="schedule"><strong>${localTime(inbound.scheduled_departure)} <i>→</i> ${localTime(outbound.scheduled_arrival)}${nextDay(outbound.scheduled_arrival, inbound.scheduled_departure)}</strong><span>${inbound.origin} · ${outbound.destination}</span></div>
      <div class="trip-summary"><strong>${formatDuration(item.total_minutes)}</strong><span>1 stop · ${inbound.destination} · ${formatDuration(item.assessment.scheduled_connection_minutes)}</span></div>
      <div class="journey-status">${warnings}${riskBadge(item)}</div>
      <div class="fare"><strong>€${item.price_eur}</strong></div>
      <span class="expand-icon" aria-hidden="true">⌄</span>
    </div>
    <div id="journey-details-${item.id}" class="journey-details"${expanded ? "" : " hidden"}>
      <div><span>${inbound.flight_number}</span><strong>${inbound.origin} → ${inbound.destination}</strong><time>${dateTime(inbound.scheduled_departure)} – ${dateTime(inbound.scheduled_arrival)}</time></div>
      <div class="layover-detail"><span>TRANSFER</span><strong>${item.transfer_airport?.name || inbound.destination} (${inbound.destination})</strong><time>${formatDuration(item.assessment.scheduled_connection_minutes)}</time></div>
      <div><span>${outbound.flight_number}</span><strong>${outbound.origin} → ${outbound.destination}</strong><time>${dateTime(outbound.scheduled_departure)} – ${dateTime(outbound.scheduled_arrival)}</time></div>
    </div>
    ${studyMode ? `<div class="card-footer"><button class="study-choice" type="button" data-study-choice="${item.id}">Choose</button></div>` : ""}
  </article>`;
}

function toggleJourney(id) {
  const details = document.querySelector(`#journey-details-${CSS.escape(id)}`);
  const toggle = document.querySelector(`[data-toggle-journey="${CSS.escape(id)}"]`);
  if (!details || !toggle) return;
  const willOpen = details.hidden;
  details.hidden = !willOpen;
  toggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) expandedJourneys.add(id);
  else expandedJourneys.delete(id);
}

function renderItems() {
  const items = studyMode
    ? payload.items.filter((item) => ["self-transfer-high", "self-transfer-safer"].includes(item.id))
    : [...payload.items];
  list.innerHTML = items.map(itineraryCard).join("");
  if (!studyMode || study.phase !== "baseline") {
    items.forEach((item) => track("risk_badge_viewed", { itinerary_id: item.id, risk_level: item.assessment.risk_level }));
    if (items.some((item) => item.separate_tickets)) track("self_transfer_warning_viewed");
  }
}

function riskSummary(item) {
  const result = item.assessment;
  return `<section class="risk-summary risk-${result.risk_level}" aria-label="${riskLabels[result.risk_level]} risk, ${result.risk_score} percent estimated miss chance">
    <strong>${result.risk_score}%</strong>
    <div><b>${riskLabels[result.risk_level]}</b><span>Estimated miss chance</span></div>
  </section>`;
}

function allocatedTransferSteps(item, transferTotal) {
  const labels = {
    deplane: "Deplane",
    walking: "Walk to connection",
    baggage_reclaim: "Baggage reclaim",
    passport_control: "Passport control",
    checkin: "Check-in",
    security: "Security",
    terminal_transfer: "Terminal transfer"
  };
  const source = item.transfer_steps || [];
  const sourceTotal = source.reduce((sum, step) => sum + step.median_minutes, 0);
  if (!source.length || sourceTotal <= 0) return [];
  const target = Math.round(transferTotal);
  const allocated = source.map((step) => {
    const exact = (step.median_minutes / sourceTotal) * target;
    return { label: labels[step.code] || step.code, minutes: Math.floor(exact), fraction: exact % 1 };
  });
  let remaining = target - allocated.reduce((sum, step) => sum + step.minutes, 0);
  [...allocated].sort((a, b) => b.fraction - a.fraction).forEach((step) => {
    if (remaining > 0) { step.minutes += 1; remaining -= 1; }
  });
  return allocated;
}

function connectionMetrics(item) {
  const details = item.assessment.technical_details;
  const scheduled = item.assessment.scheduled_connection_minutes;
  const transferTotal = Math.max(0, details.expected_transfer_minutes);
  const cutoff = Math.max(0, details.outbound_deadline_minutes);
  const required = transferTotal + cutoff;
  const buffer = scheduled - required;
  const bufferLabel = buffer >= 0 ? "Usable buffer" : "Shortfall";
  const bufferValue = `${buffer < 0 ? "−" : ""}${formatCompactDuration(Math.abs(buffer))}`;
  const steps = allocatedTransferSteps(item, transferTotal);
  const rows = [...steps, { label: "Boarding cutoff", minutes: Math.round(cutoff) }]
    .map((step) => `<li><span>${step.label}</span><strong>${formatCompactDuration(step.minutes)}</strong></li>`)
    .join("");
  return `<section class="time-accounting" aria-label="Connection time calculation">
    <dl><div><dt>Scheduled layover</dt><dd>${formatDuration(scheduled)}</dd></div>
    <div><dt>Transfer steps + cutoff</dt><dd>− ${formatCompactDuration(Math.round(required))}</dd></div>
    <div class="time-result${buffer < 0 ? " negative" : ""}"><dt>${bufferLabel}</dt><dd>${bufferValue}</dd></div></dl>
    <p>Recommended minimum <strong>~${formatDuration(item.assessment.recommended_connection_minutes)}</strong></p>
  </section>
  <details class="time-breakdown">
    <summary><span>Required time breakdown · ${steps.length + 1} steps</span><strong>${formatCompactDuration(Math.round(required))}</strong></summary>
    <ul>${rows}<li class="time-total"><span>Total</span><strong>${formatCompactDuration(Math.round(required))}</strong></li></ul>
  </details>`;
}

function reasonText(reason) {
  const labels = {
    PASSPORT_CONTROL: "Passport control required",
    INBOUND_DELAY_HISTORY: "Inbound delay history included",
    CHECKED_BAGGAGE: "Checked baggage adds transfer time",
    SELF_TRANSFER: "Self-transfer requires extra steps",
    SECURITY_RECHECK: "Security check required again",
    SHORT_CONNECTION: "Limited connection time",
    TERMINAL_CHANGE: "Terminal change required"
  };
  return labels[reason.code] || reason.label;
}

function provenance(item) {
  const details = item.assessment.technical_details;
  const source = details.delay_data_source === "bundled_demo_sample" ? "Bundled illustrative observations" : details.delay_data_source || "Unavailable";
  return `<details class="provenance"><summary>How was this estimated?</summary><dl>
    <div><dt>Historical observations</dt><dd>${details.delay_sample_count ?? "Unavailable"}</dd></div>
    <div><dt>Data source</dt><dd>${source}</dd></div>
    <div><dt>Match level</dt><dd>${(details.delay_match_level || "Unavailable").replaceAll("_", " + ")}</dd></div>
    <div><dt>Transfer model</dt><dd>${details.transfer_profile || item.inbound.destination} airport profile</dd></div>
    <div><dt>Confidence</dt><dd>${item.assessment.confidence.overall}</dd></div>
  </dl><p>Demo observations are illustrative. ADRR-derived local data, when configured elsewhere in the app, is historical research data—not a passenger timetable or live flight feed.</p></details>`;
}

function detailsView(item) {
  const result = item.assessment;
  const selfTransfer = item.separate_tickets ? `<section class="separate-warning" title="A delay may not be protected by the next airline."><strong><span aria-hidden="true">!</span> Separate tickets</strong></section>` : "";
  const compare = item.safer_option_id ? `<button class="compare-button" type="button" data-compare="${item.id}">Compare safer option <span>→</span></button>` : "";
  const confidenceNote = result.confidence.overall === "low" ? "Limited history" : "Historical data available";
  return `<div class="drawer-header"><div class="drawer-route">${airlineMarks(item)}<strong>${item.inbound.origin} → ${item.inbound.destination} → ${item.outbound.destination}</strong></div><h2 id="drawer-title">Connection risk</h2>${riskSummary(item)}</div>
    ${selfTransfer}
    ${connectionMetrics(item)}
    <section class="why"><div class="section-heading"><h3>Why</h3></div><ul>${result.reasons.slice(0, 3).map((reason) => `<li><strong>${reasonText(reason)}</strong></li>`).join("")}</ul></section>
    <section class="confidence-block" title="Confidence describes the supporting data, not the risk level."><span>Data confidence</span><strong>${result.confidence.overall}</strong><small>${confidenceNote}</small></section>
    ${compare}${provenance(item)}`;
}

function comparisonView(current, safer) {
  const price = safer.price_eur - current.price_eur;
  const travel = safer.total_minutes - current.total_minutes;
  const risk = current.assessment.risk_score - safer.assessment.risk_score;
  const option = (item, label) => `<article class="compare-option ${label === "SAFER OPTION" ? "recommended" : ""}"><span>${label}</span><strong>€${item.price_eur}</strong><p>${formatDuration(item.assessment.scheduled_connection_minutes)} ${item.separate_tickets ? "self-transfer" : "connection"}</p>${riskBadge(item, true)}${label === "SAFER OPTION" ? "<em>✓ RECOMMENDED</em>" : ""}</article>`;
  return `<div class="drawer-header"><button class="back-button" type="button" data-back-details="${current.id}">← Risk details</button><h2 id="drawer-title">Safer option</h2></div>
    <div class="compare-grid">${option(current, "CURRENT")}${option(safer, "SAFER OPTION")}</div>
    <section class="difference"><dl><div><dt>Fare</dt><dd>+ €${price}</dd></div><div><dt>Total time</dt><dd>+ ${formatDuration(travel)}</dd></div><div><dt>Miss risk</dt><dd>− ${risk} points</dd></div></dl></section>`;
}

function openDrawer(id) {
  const item = payload.items.find((candidate) => candidate.id === id);
  if (!item) return;
  selectedId = id;
  if (studyMode) study.riskDetailOpened = true;
  drawerContent.innerHTML = detailsView(item);
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
  document.body.classList.add("drawer-open");
  document.querySelector("#drawer-close").focus();
  track("risk_badge_clicked", { itinerary_id: id });
  track("risk_detail_opened", { itinerary_id: id });
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  backdrop.hidden = true;
  document.body.classList.remove("drawer-open");
  document.querySelector(`[data-open-risk="${selectedId}"]`)?.focus();
}

document.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-risk]");
  if (open) { openDrawer(open.dataset.openRisk); return; }
  const journey = event.target.closest("[data-toggle-journey]");
  if (journey) { toggleJourney(journey.dataset.toggleJourney); return; }
  const compare = event.target.closest("[data-compare]");
  if (compare) {
    const current = payload.items.find((item) => item.id === compare.dataset.compare);
    const safer = payload.items.find((item) => item.id === current?.safer_option_id);
    if (current && safer) {
      drawerContent.innerHTML = comparisonView(current, safer);
      if (studyMode) study.saferComparisonOpened = true;
      track("safer_option_clicked", { current_id: current.id, safer_id: safer.id });
    }
    return;
  }
  const back = event.target.closest("[data-back-details]");
  if (back) openDrawer(back.dataset.backDetails);
});
document.querySelector("#drawer-close").addEventListener("click", closeDrawer);
backdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
document.addEventListener("keydown", (event) => {
  const journey = event.target.closest?.("[data-toggle-journey]");
  if (journey && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    toggleJourney(journey.dataset.toggleJourney);
  }
});

function storedStudyResponses() {
  try { return JSON.parse(localStorage.getItem(studyStorageKey) || "[]"); }
  catch { return []; }
}

function studyChoice(id) {
  if (study.phase === "baseline") {
    study.baselineChoice = id;
    study.phase = "risk";
    document.body.classList.remove("study-baseline");
    document.querySelector("#study-title").textContent = "Step 2 of 2 — Now review the connection risk";
    document.querySelector("#study-instruction").textContent = "Open a risk label if useful, then make your final choice.";
    renderItems();
    document.querySelector("#study-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    track("study_risk_revealed", { baseline_choice: id });
    return;
  }
  if (study.phase !== "risk") return;
  study.phase = "questions";
  study.finalChoice = id;
  document.querySelector("#study-title").textContent = "One final comprehension question";
  document.querySelector("#study-instruction").textContent = "Which statement best describes the safer option shown here?";
  const result = document.querySelector("#study-result");
  result.hidden = false;
  result.innerHTML = `<div class="study-answers"><button type="button" data-study-answer="correct">It costs more and takes longer, but lowers estimated miss risk.</button><button type="button" data-study-answer="guarantee">It guarantees that the connection will be made.</button><button type="button" data-study-answer="same-risk">It has the same estimated risk and only costs more.</button></div>`;
  document.querySelector("#study-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function completeStudy(answer) {
  if (study.phase !== "questions") return;
  const id = study.finalChoice;
  const response = {
    study_version: "ux-v0.4-1",
    baseline_choice: study.baselineChoice,
    final_choice: id,
    changed_choice: study.baselineChoice !== id,
    chose_safer_final: id === "self-transfer-safer",
    risk_detail_opened: study.riskDetailOpened,
    safer_comparison_opened: study.saferComparisonOpened,
    tradeoff_understood: answer === "correct",
    completed_at_utc: new Date().toISOString()
  };
  const responses = storedStudyResponses();
  responses.push(response);
  localStorage.setItem(studyStorageKey, JSON.stringify(responses));
  study.phase = "complete";
  document.querySelector("#study-title").textContent = "Response saved on this device";
  document.querySelector("#study-instruction").textContent = "No name, email, booking reference, or itinerary was collected.";
  const result = document.querySelector("#study-result");
  result.hidden = false;
  result.innerHTML = `<strong>${response.changed_choice ? "Choice changed after seeing risk." : "Choice stayed the same after seeing risk."}</strong><span>Final choice: ${response.chose_safer_final ? "safer option" : "lower fare"}</span>`;
  document.querySelector("#study-admin").hidden = false;
  document.querySelector("#study-count").textContent = `${responses.length} response${responses.length === 1 ? "" : "s"} stored locally`;
  track("study_choice_completed", { changed_choice: response.changed_choice, chose_safer_final: response.chose_safer_final, tradeoff_understood: response.tradeoff_understood });
}

function resetStudy() {
  Object.assign(study, { phase: "baseline", baselineChoice: null, finalChoice: null, riskDetailOpened: false, saferComparisonOpened: false });
  document.body.classList.add("study-baseline");
  document.querySelector("#study-title").textContent = "Step 1 of 2 — Which flight would you buy?";
  document.querySelector("#study-instruction").textContent = "Choose using the fare and itinerary information you would normally see. Connection Risk will be revealed next.";
  document.querySelector("#study-result").hidden = true;
  document.querySelector("#study-admin").hidden = true;
  renderItems();
  scrollTo({ top: 0, behavior: "smooth" });
}

function exportStudy() {
  const responses = storedStudyResponses();
  if (!responses.length) return;
  const fields = Object.keys(responses[0]);
  const cell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [fields.map(cell).join(","), ...responses.map((row) => fields.map((field) => cell(row[field])).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "connection-risk-traveler-study.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

document.addEventListener("click", (event) => {
  const choice = event.target.closest("[data-study-choice]");
  if (choice) studyChoice(choice.dataset.studyChoice);
  const answer = event.target.closest("[data-study-answer]");
  if (answer) completeStudy(answer.dataset.studyAnswer);
});
document.querySelector("#next-participant").addEventListener("click", resetStudy);
document.querySelector("#export-study").addEventListener("click", exportStudy);

async function start() {
  track("demo_search_viewed");
  try {
    const response = await fetch("/v1/demo-itineraries");
    if (!response.ok) throw new Error("Demo itineraries are unavailable.");
    payload = await response.json();
    document.querySelector("#data-mode").textContent = payload.data_mode_label;
    document.querySelector("#data-mode").classList.add(`mode-${payload.data_mode}`);
    document.querySelector("#search-title").innerHTML = `${payload.search.origin} <span>→</span> ${payload.search.destination}`;
    document.querySelector("#search-meta").textContent = `20 Sep 2026 · ${payload.search.cabin} · ${payload.search.passengers} passenger`;
    document.querySelector("#demo-disclaimer").textContent = "Estimate only — not a guarantee.";
    if (studyMode) {
      document.body.classList.add("study-mode", "study-baseline");
      document.querySelector("#study-panel").hidden = false;
      document.querySelector("#results-title").textContent = "Two booking options";
    }
    const journey = new URLSearchParams(location.search).get("journey");
    if (payload.items.some((item) => item.id === journey)) expandedJourneys.add(journey);
    renderItems();
    const view = new URLSearchParams(location.search).get("view");
    if (view) {
      openDrawer(view);
      if (new URLSearchParams(location.search).get("compare") === "1") {
        const current = payload.items.find((item) => item.id === view);
        const safer = payload.items.find((item) => item.id === current?.safer_option_id);
        if (current && safer) drawerContent.innerHTML = comparisonView(current, safer);
      }
    }
  } catch (error) {
    list.innerHTML = `<article class="error-card"><strong>Could not load the playground</strong><p>${error.message}</p></article>`;
  }
}

start();

(function startConnectionQualityExtension() {
  "use strict";

  const adapters = globalThis.ConnectionQualityAdapters;
  const engine = globalThis.ConnectionQualityEngine;
  const flow = globalThis.ConnectionQualityFlow;
  const analytics = globalThis.ConnectionQualityAnalytics;
  let current = null;
  let lastFingerprint = null;
  let lastUrl = location.href;
  let scanTimer = null;

  const qualityMeta = {
    comfortable: { mark: "✓", label: "Comfortable" },
    reasonable: { mark: "≈", label: "Reasonable" },
    tight: { mark: "!", label: "Tight" },
    risky: { mark: "!", label: "Risky" }
  };

  const root = document.createElement("aside");
  root.id = "connection-quality-extension";
  root.hidden = true;
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <button class="cq-badge cq-neutral" type="button" aria-expanded="false">
      <span class="cq-dot"></span>
      <span class="cq-badge-copy"><strong>Connection quality</strong><small>Open a one-stop itinerary</small></span>
    </button>
    <section class="cq-panel" hidden>
      <button class="cq-close" type="button" aria-label="Close connection quality">×</button>
      <div class="cq-brand"><span class="cq-brand-mark">↗</span><span>Connection</span></div>
      <div class="cq-detection">
        <p class="cq-route">Waiting for an itinerary</p>
        <p class="cq-status">Open one complete one-stop itinerary.</p>
      </div>
      <section class="cq-confirm" hidden>
        <p class="cq-section-label">Confirm itinerary</p>
        <p class="cq-confirm-copy">Check the detected route and ticket type before analysis.</p>
        <fieldset class="cq-ticket-editor">
          <legend>Ticket type</legend>
          <div class="cq-ticket-options">
            <label><input type="radio" name="cq-ticket" value="protected"><span>One protected ticket</span></label>
            <label><input type="radio" name="cq-ticket" value="separate"><span>Separate tickets</span></label>
            <label><input type="radio" name="cq-ticket" value="unknown"><span>Not sure</span></label>
          </div>
        </fieldset>
        <button class="cq-analyze" type="button">Analyze this itinerary</button>
      </section>
      <div class="cq-result" hidden>
        <div class="cq-hero">
          <span class="cq-quality-mark" aria-hidden="true"></span>
          <div><p class="cq-quality"></p><p class="cq-time-line"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></svg><span class="cq-layover"></span></p></div>
        </div>
        <section class="cq-transfer-details">
          <p>Transfer details</p>
          <div class="cq-airport-name"></div>
          <div class="cq-operation-grid">
            <span>Arrival</span><strong class="cq-arrival-location"></strong>
            <span>Departure</span><strong class="cq-departure-location"></strong>
          </div>
          <small class="cq-live-note">Gate information is shown only when the flight-search source publishes it.</small>
        </section>
        <section class="cq-evidence"><p>Main factors</p><ul class="cq-factors"></ul></section>
        <section class="cq-protection"><p>Ticket protection</p><div class="cq-ticket-note"></div></section>
        <div class="cq-verdict"><span aria-hidden="true">→</span><p></p></div>
      </div>
    </section>`;
  document.documentElement.append(root);

  const elements = {
    badge: root.querySelector(".cq-badge"),
    badgeTitle: root.querySelector(".cq-badge-copy strong"),
    badgeSubtitle: root.querySelector(".cq-badge-copy small"),
    panel: root.querySelector(".cq-panel"),
    route: root.querySelector(".cq-route"),
    status: root.querySelector(".cq-status"),
    confirm: root.querySelector(".cq-confirm"),
    analyze: root.querySelector(".cq-analyze"),
    result: root.querySelector(".cq-result"),
    qualityMark: root.querySelector(".cq-quality-mark"),
    quality: root.querySelector(".cq-quality"),
    layover: root.querySelector(".cq-layover"),
    airportName: root.querySelector(".cq-airport-name"),
    arrivalLocation: root.querySelector(".cq-arrival-location"),
    departureLocation: root.querySelector(".cq-departure-location"),
    factors: root.querySelector(".cq-factors"),
    ticketNote: root.querySelector(".cq-ticket-note"),
    verdict: root.querySelector(".cq-verdict p")
  };

  function isFlightsPage() {
    return adapters.supports(location);
  }

  function setBadge(level, title, subtitle) {
    elements.badge.className = `cq-badge cq-${level}`;
    elements.badgeTitle.textContent = title;
    elements.badgeSubtitle.textContent = subtitle;
  }

  function openPanel(open) {
    elements.panel.hidden = !open;
    elements.badge.setAttribute("aria-expanded", String(open));
    if (open) analytics.track("extension_opened");
  }

  function selectedTicketStatus() {
    return root.querySelector('input[name="cq-ticket"]:checked')?.value || "unknown";
  }

  function routeSummary(itinerary) {
    return itinerary.segments.map((segment) => segment.origin).concat(itinerary.segments.at(-1).destination).join(" → ");
  }

  function resetViews() {
    elements.confirm.hidden = true;
    elements.result.hidden = true;
  }

  function showParserFailure(result) {
    current = null;
    delete root.dataset.quality;
    const copy = flow.failurePresentation(result);
    setBadge("neutral", "Connection quality", "Itinerary not confirmed");
    elements.route.textContent = copy.title;
    elements.status.textContent = copy.detail;
    resetViews();
    analytics.track("parser_failed", { code: result.code });
  }

  function selectTicketStatus(status) {
    const value = ["protected", "separate", "unknown"].includes(status) ? status : "unknown";
    const radio = root.querySelector(`input[name="cq-ticket"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  function showDetected(result) {
    current = result.itinerary;
    delete root.dataset.quality;
    const route = routeSummary(current);
    const connection = current.segments[0].destination;
    const layoverMinutes = engine.minutesBetween(
      current.segments[0].arrivalTime,
      current.segments[1].departureTime
    );
    if (layoverMinutes === null) {
      showParserFailure({ code: "INVALID_LAYOVER", message: "Arrival and departure times could not be verified." });
      return;
    }
    elements.route.textContent = route;
    elements.status.textContent = `${connection} · ${layoverMinutes} min connection`;
    selectTicketStatus(current.ticketStatusHint);
    resetViews();
    analytics.track("itinerary_detected", { connection_airport: connection, confidence: result.confidence });

    const action = flow.actionForExtraction(result);
    if (action === "invalid") {
      showParserFailure({ code: "INVALID_EXTRACTION", message: "Critical itinerary fields are missing or ambiguous." });
    } else if (action === "confirm") {
      setBadge("detected", "Confirm itinerary", route);
      elements.confirm.hidden = false;
    } else {
      assess();
    }
  }

  function renderFactors(factors) {
    elements.factors.replaceChildren();
    for (const item of factors) {
      const row = document.createElement("li");
      row.className = `cq-factor cq-factor-${item.severity}`;
      const dot = document.createElement("span");
      dot.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = item.label;
      row.append(dot, label);
      elements.factors.append(row);
    }
  }

  function renderTicketNote(ticketProtection) {
    elements.ticketNote.replaceChildren();
    elements.ticketNote.className = `cq-ticket-note cq-ticket-note-${ticketProtection.status}`;
    const icon = document.createElement("span");
    icon.className = "cq-shield-icon";
    icon.innerHTML = ticketProtection.status === "protected"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3z"></path><path d="M9 12l2 2 4-4"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3z"></path><path d="M12 8v5m0 3h.01"></path></svg>';
    const copy = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = ticketProtection.label;
    const detail = document.createElement("small");
    detail.textContent = ticketProtection.detail;
    copy.append(label, detail);
    elements.ticketNote.append(icon, copy);
  }

  function renderAssessment(assessment) {
    const meta = qualityMeta[assessment.quality];
    root.dataset.quality = assessment.quality;
    setBadge(assessment.quality, meta.label, `${assessment.layoverMinutes} min · ${assessment.connectionAirport}`);
    elements.status.textContent = "";
    elements.qualityMark.textContent = meta.mark;
    elements.quality.textContent = meta.label;
    elements.layover.textContent = `${assessment.layoverMinutes} min at ${assessment.connectionAirport}`;
    const inbound = current.segments[0];
    const outbound = current.segments[1];
    elements.airportName.textContent = inbound.destinationName || assessment.airportName || assessment.connectionAirport;
    elements.arrivalLocation.textContent = locationDetail(inbound.arrivalTerminal, inbound.arrivalGate);
    elements.departureLocation.textContent = locationDetail(outbound.departureTerminal, outbound.departureGate);
    renderFactors(assessment.processFactors);
    renderTicketNote(assessment.ticketProtection);
    elements.verdict.textContent = assessment.verdict;
    elements.confirm.hidden = true;
    elements.result.hidden = false;
  }

  function locationDetail(terminal, gate) {
    const parts = [];
    if (terminal) parts.push(`Terminal ${terminal}`);
    if (gate) parts.push(`Gate ${gate}`);
    return parts.length ? parts.join(" · ") : "Not published by source";
  }

  function assess() {
    if (!current) return;
    const ticketStatus = selectedTicketStatus();
    analytics.track("assessment_requested", { ticket_status: ticketStatus });
    try {
      const assessment = engine.assessConnection(current, { ticketStatus });
      renderAssessment(assessment);
      analytics.track("assessment_completed", { quality: assessment.quality, ticket_status: ticketStatus });
    } catch (error) {
      showParserFailure({ code: "ASSESSMENT_FAILED", message: error.message });
    }
  }

  function scan() {
    if (!isFlightsPage()) return;
    const result = adapters.extract(document, location);
    if (!result.ok) {
      const fingerprint = `${result.code}|${result.message}`;
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        showParserFailure(result);
      }
      return;
    }
    if (result.fingerprint === lastFingerprint) return;
    lastFingerprint = result.fingerprint;
    showDetected(result);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 500);
  }

  function syncPageState() {
    const currentUrl = location.href;
    const urlChanged = currentUrl !== lastUrl;
    lastUrl = currentUrl;
    root.hidden = !isFlightsPage();
    if (root.hidden) {
      openPanel(false);
      return;
    }
    if (urlChanged) {
      lastFingerprint = null;
      scheduleScan();
    }
  }

  elements.badge.addEventListener("click", () => openPanel(elements.panel.hidden));
  root.querySelector(".cq-close").addEventListener("click", () => openPanel(false));
  elements.analyze.addEventListener("click", assess);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_CONNECTION_QUALITY_STATE") {
      sendResponse({ detected: Boolean(current), route: current ? routeSummary(current) : null });
    } else if (message?.type === "OPEN_CONNECTION_QUALITY") {
      openPanel(true);
      sendResponse({ ok: true });
    }
    return false;
  });

  document.addEventListener("click", () => {
    setTimeout(scheduleScan, 300);
    setTimeout(scheduleScan, 1000);
    setTimeout(scheduleScan, 2200);
  }, true);

  new MutationObserver(() => {
    syncPageState();
    scheduleScan();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "aria-hidden", "hidden", "open"]
  });
  setInterval(() => {
    syncPageState();
    if (isFlightsPage()) scheduleScan();
  }, 1500);
  syncPageState();
  scheduleScan();
})();

(function exposeAnalytics(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAnalytics(root) {
  "use strict";
  let provider = null;

  function setProvider(nextProvider) {
    provider = typeof nextProvider === "function" ? nextProvider : null;
  }

  function track(event, properties = {}) {
    const payload = { event, properties, timestamp: new Date().toISOString() };
    if (provider) provider(payload);
    if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      root.dispatchEvent(new root.CustomEvent("connection-quality:analytics", { detail: payload }));
    }
  }

  return { setProvider, track };
});

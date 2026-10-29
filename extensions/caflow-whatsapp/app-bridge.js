// Runs on the CAFlow app. Tells the app the extension is installed and relays
// "send on WhatsApp" requests to the extension's background worker.

document.documentElement.dataset.caflowWhatsapp = chrome.runtime.getManifest().version;

window.addEventListener("message", event => {
  if (event.source !== window || event.data?.type !== "CAFLOW_WA_SEND") return;
  const { id, phone, sender, text, pdf } = event.data;
  chrome.runtime.sendMessage({ type: "caflow-wa-send", phone, sender, text, pdf }, resp => {
    const result = resp || { ok: false, error: chrome.runtime.lastError?.message || "No response from extension" };
    window.postMessage({ type: "CAFLOW_WA_RESULT", id, ...result }, location.origin);
  });
});

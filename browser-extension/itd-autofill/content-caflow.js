/**
 * CAFlow — ITD Portal Autofill: content script injected on the CAflow app
 * itself. Bridges the page's own JS (which cannot reach chrome.* APIs) to
 * the extension's background worker via window.postMessage — the standard,
 * supported channel between a page and a content script sharing its DOM.
 *
 * Two responsibilities:
 *  1. Announce that the extension is installed, so the app can offer the
 *     "auto-fill" action instead of only "copy to clipboard".
 *  2. Relay a credential handoff message from the app to the background
 *     worker when the user clicks "Auto-fill ITD Login".
 */

// Announce presence as early as possible (document_start) so the app's own
// mount-time check sees it without a race.
document.documentElement.setAttribute("data-caflow-itd-extension", "1");

window.addEventListener("message", (event) => {
  if (event.source !== window) return; // only ever trust same-window messages
  const msg = event.data;
  if (!msg || msg.source !== "caflow-web" || msg.type !== "ITD_LOGIN_CREDENTIALS") return;

  chrome.runtime.sendMessage(
    { type: "STORE_ITD_CREDENTIALS", loginId: msg.loginId, password: msg.password },
    (response) => {
      window.postMessage(
        { source: "caflow-extension", type: "ITD_LOGIN_CREDENTIALS_ACK", ok: !!response?.ok },
        window.location.origin,
      );
    },
  );
});

/**
 * CAFlow — ITD Portal Autofill: content script injected on the CAflow app
 * itself. Bridges the page's own JS (which cannot reach chrome.* APIs) to
 * the extension's background worker via window.postMessage — the standard,
 * supported channel between a page and a content script sharing its DOM.
 *
 * Three responsibilities:
 *  1. Announce that the extension is installed, so the app can offer the
 *     "auto-fill" action instead of only "copy to clipboard".
 *  2. Relay a credential handoff message from the app to the background
 *     worker when the user clicks "Auto-fill ITD Login".
 *  3. Relay a "start the challan-download automation" request from
 *     TdsChallanDownloadValidation.tsx's "Download Challan" button —
 *     forwarded to background.js, which STORES it (chrome.storage.session)
 *     rather than messaging the ITD tab directly, so content-itd.js can
 *     poll for it and pick it up whenever the human finishes logging in,
 *     however long that takes. See background.js's own RELAY_CHALLAN_
 *     DOWNLOAD doc for the full account, and content-itd.js's own
 *     runChallanDownload for what this actually attempts on the portal side.
 */

// Announce presence as early as possible (document_start) so the app's own
// mount-time check sees it without a race.
document.documentElement.setAttribute("data-caflow-itd-extension", "1");

window.addEventListener("message", (event) => {
  if (event.source !== window) return; // only ever trust same-window messages
  const msg = event.data;
  if (!msg || msg.source !== "caflow-web") return;

  if (msg.type === "ITD_LOGIN_CREDENTIALS") {
    chrome.runtime.sendMessage(
      { type: "STORE_ITD_CREDENTIALS", loginId: msg.loginId, password: msg.password },
      (response) => {
        window.postMessage(
          { source: "caflow-extension", type: "ITD_LOGIN_CREDENTIALS_ACK", ok: !!response?.ok },
          window.location.origin,
        );
      },
    );
    return;
  }

  if (msg.type === "START_CHALLAN_DOWNLOAD") {
    // Fire-and-forget — there's no response to relay back to the page; the
    // ITD tab shows its own progress/error banner (same convention as the
    // login autofill), which is the only feedback surface that makes sense
    // since the automation runs in a DIFFERENT tab than this one.
    chrome.runtime.sendMessage({
      type: "RELAY_CHALLAN_DOWNLOAD",
      fyStartDate: msg.fyStartDate ?? null,
      fyEndDate: msg.fyEndDate ?? null,
    });
  }
});

// 2026-08-11: the REVERSE direction of the same relay — content-itd.js
// scrapes the Payment History table on the ITD tab and stores the result in
// background.js (see its own STORE/GET_CHALLAN_SCRAPE_RESULT doc), since
// the ITD tab and this CAFlow tab never share a JS context either. Polls
// every 2s for up to 5 minutes after this script loads — matches the same
// window content-itd.js's own download-request poll uses, generous enough
// to cover the full manual-login-then-automation run happening in the other
// tab. Starts unconditionally (not only after a "Download Challan" click)
// since this tab and that automation are only ever loosely coupled through
// storage, not a direct call-and-response.
(function pollForChallanScrapeResult() {
  const deadline = Date.now() + 5 * 60 * 1000;
  const poll = () => {
    chrome.runtime.sendMessage({ type: "GET_CHALLAN_SCRAPE_RESULT" }, (response) => {
      if (response?.ok && response.rows) {
        window.postMessage(
          { source: "caflow-extension", type: "CHALLAN_PAYMENT_HISTORY_RESULT", rows: response.rows },
          window.location.origin,
        );
      }
      if (Date.now() < deadline) setTimeout(poll, 2_000);
    });
  };
  poll();
})();

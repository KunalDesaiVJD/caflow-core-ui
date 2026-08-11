/**
 * CAFlow — ITD Portal Autofill: background service worker.
 *
 * Purely a short-lived relay between the two content scripts, which never
 * share a JS context directly (they run in different tabs/origins):
 *   content-caflow.js (on the CAflow app)  --sendMessage-->  background.js
 *   background.js  --sendMessage-->  content-itd.js (on the ITD portal)
 *
 * Credentials are held ONLY in chrome.storage.session (cleared automatically
 * when the browser closes — never chrome.storage.local, which persists to
 * disk) and are single-use: content-itd.js asks for them once and this
 * worker clears them immediately after handing them over, plus a 2-minute
 * expiry as a backstop in case the ITD tab is never opened at all.
 *
 * A TRUSTED_CLICK relay (Chrome debugger protocol, to inject an OS-level
 * click on the final submit button) was built and then deliberately removed
 * on 2026-08-06 — see content-itd.js's own header doc for why: the portal
 * appears to reject script-generated clicks on that button specifically, on
 * purpose, and defeating that crosses a line this project isn't willing to
 * cross regardless of how many times it's requested.
 *
 * RELAY_CHALLAN_DOWNLOAD (added for the Stage-2 challan-download flow) —
 * v0.3.3 (2026-08-10): CHANGED from a plain one-shot chrome.tabs.sendMessage
 * broadcast to a chrome.storage.session record, same pattern as the
 * credential handoff and for the identical reason.
 *
 * The one-shot broadcast was fired the INSTANT "Download Challan" was
 * clicked — the same tick window.open() opened the ITD tab, before that
 * tab's content-itd.js had even been injected yet (document_idle content
 * scripts inject after the page's DOM is ready, which takes real time on a
 * slow government portal). chrome.tabs.sendMessage delivers to a listener
 * that's ALREADY registered; if nothing is listening yet, the message is
 * simply dropped (background.js already swallowed the resulting "no
 * receiver" error, which is what made this failure silent instead of
 * logged). And even on the rare occasion the timing DID line up, the
 * message would only reach the login page's own instance of content-itd.js
 * — but the manual login that follows takes real human time, and the whole
 * point of runChallanDownload is that it must fire only once THAT is done.
 * A one-shot message delivered (or dropped) at click-time has no way to
 * "wait" for a human to finish logging in.
 *
 * Storing it instead means content-itd.js can POLL for it — same as it
 * already does for login credentials — so it doesn't matter whether the
 * request arrives before, during, or after login: whichever loop finds it
 * first (this poll typically runs far longer than the credential one, since
 * a human logging in takes much longer than an edge function decrypting a
 * password) fires it exactly once. Real page navigation (not just an
 * Angular hash-route change within eportal.incometax.gov.in's own SPA,
 * which never re-injects a content script) would still lose an in-flight
 * poll, but a fresh injection on THAT reload starts its own poll and picks
 * the same stored request straight back up — the request is safe to poll
 * for repeatedly since it's read-once (consumed on GET) only when actually
 * acted on, never when merely checked.
 */

const CREDENTIAL_TTL_MS = 2 * 60 * 1000;
// Generous: covers the FULL manual login (ID, Continue, password, Secure
// Access Message checkbox, the human's own final Continue click) — unlike
// the credential handoff, which only has to survive an edge-function
// round-trip, this has to survive an actual person typing.
const CHALLAN_DOWNLOAD_REQUEST_TTL_MS = 5 * 60 * 1000;
// The reverse direction of the same handoff: content-itd.js scrapes the
// Payment History table (see its own scrapePaymentHistoryTable doc) and
// stores the result here; content-caflow.js polls for it (below) since the
// CAFlow tab and the ITD tab never share a JS context either. Shorter TTL
// than the download request — this is the RESULT of an already-finished
// scrape, not something waiting on a human, so it only needs to survive
// content-caflow.js's own poll interval.
const CHALLAN_SCRAPE_RESULT_TTL_MS = 2 * 60 * 1000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "STORE_ITD_CREDENTIALS") {
    const record = { loginId: msg.loginId, password: msg.password, storedAt: Date.now() };
    chrome.storage.session.set({ itdCredentials: record }, () => {
      sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (msg?.type === "GET_ITD_CREDENTIALS") {
    chrome.storage.session.get("itdCredentials", (data) => {
      const record = data?.itdCredentials;
      // Consume-on-read: clear immediately so a second tab/reload never
      // silently replays the same saved password.
      chrome.storage.session.remove("itdCredentials");
      if (!record || Date.now() - record.storedAt > CREDENTIAL_TTL_MS) {
        sendResponse({ ok: false, reason: "expired-or-missing" });
        return;
      }
      sendResponse({ ok: true, loginId: record.loginId, password: record.password });
    });
    return true; // async response
  }

  if (msg?.type === "RELAY_CHALLAN_DOWNLOAD") {
    const record = {
      fyStartDate: msg.fyStartDate ?? null,
      fyEndDate: msg.fyEndDate ?? null,
      storedAt: Date.now(),
    };
    chrome.storage.session.set({ itdChallanDownloadRequest: record }, () => {
      sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (msg?.type === "GET_CHALLAN_DOWNLOAD_REQUEST") {
    chrome.storage.session.get("itdChallanDownloadRequest", (data) => {
      const record = data?.itdChallanDownloadRequest;
      if (!record || Date.now() - record.storedAt > CHALLAN_DOWNLOAD_REQUEST_TTL_MS) {
        // Expired or never set — clear a stale one if present, but do NOT
        // consume a request that's still within its TTL just because this
        // particular poll happened to miss it: content-itd.js polls
        // repeatedly and must see the SAME pending request on every attempt
        // until it's actually acted on.
        if (record) chrome.storage.session.remove("itdChallanDownloadRequest");
        sendResponse({ ok: false });
        return;
      }
      sendResponse({ ok: true, fyStartDate: record.fyStartDate, fyEndDate: record.fyEndDate });
    });
    return true; // async response
  }

  if (msg?.type === "CONSUME_CHALLAN_DOWNLOAD_REQUEST") {
    // Called once content-itd.js has actually started acting on the
    // request (found "e-File" and begun the click-path) — consumed
    // separately from GET so a request survives being merely POLLED
    // (checked and not yet actionable, e.g. still on the login page)
    // across many repeated checks, the same way the credential fetch
    // above is consume-on-read but this one is consume-on-USE.
    chrome.storage.session.remove("itdChallanDownloadRequest");
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "STORE_CHALLAN_SCRAPE_RESULT") {
    const record = { rows: msg.rows || [], storedAt: Date.now() };
    chrome.storage.session.set({ itdChallanScrapeResult: record }, () => {
      sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (msg?.type === "GET_CHALLAN_SCRAPE_RESULT") {
    chrome.storage.session.get("itdChallanScrapeResult", (data) => {
      const record = data?.itdChallanScrapeResult;
      // Consume-on-read: the CAFlow tab's poll loop only needs to see this
      // once — same reasoning as the credential fetch above, so a second
      // poll tick (or a second CAFlow tab) never replays the same rows.
      chrome.storage.session.remove("itdChallanScrapeResult");
      if (!record || Date.now() - record.storedAt > CHALLAN_SCRAPE_RESULT_TTL_MS) {
        sendResponse({ ok: false });
        return;
      }
      sendResponse({ ok: true, rows: record.rows });
    });
    return true; // async response
  }
});

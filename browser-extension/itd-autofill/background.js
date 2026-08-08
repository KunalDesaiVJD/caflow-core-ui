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
 * RELAY_CHALLAN_DOWNLOAD (added for the Stage-2 challan-download flow) is a
 * plain broadcast, not a credential handoff — no storage, no TTL. It just
 * forwards the requested FY date range to whichever eportal.incometax.gov.in
 * tab(s) are currently open. No new manifest permission needed: querying/
 * messaging tabs by URL is already covered by the existing host_permissions
 * entry for that origin, without needing the broader "tabs" permission.
 */

const CREDENTIAL_TTL_MS = 2 * 60 * 1000;

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
    chrome.tabs.query({ url: "https://eportal.incometax.gov.in/*" }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        // No response expected/awaited per tab — the ITD tab reports its own
        // progress via an on-page banner, same as content-itd.js's login flow.
        chrome.tabs.sendMessage(tab.id, {
          type: "START_CHALLAN_DOWNLOAD",
          fyStartDate: msg.fyStartDate ?? null,
          fyEndDate: msg.fyEndDate ?? null,
        }, () => void chrome.runtime.lastError); // swallow "no receiver" if the tab hasn't loaded content-itd.js yet
      }
      sendResponse({ ok: true, tabCount: tabs.length });
    });
    return true; // async response
  }
});

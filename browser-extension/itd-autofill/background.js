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
});

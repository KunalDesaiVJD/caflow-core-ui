// Routes a send from the CAFlow app to the WhatsApp Web tab already open in Chrome.
// Before opening the client's chat it checks which account that tab is logged in
// as, and refuses unless it is the billing (sender) number. The PDF waits in
// session storage until the chat has loaded.

const PENDING_KEY = "pending";
const PENDING_TTL_MS = 3 * 60 * 1000;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "caflow-wa-send") {
    openChat(msg).then(sendResponse, e => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "caflow-wa-take-pending") {
    takePending().then(sendResponse);
    return true;
  }
});

const fmt = d => (d?.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);

async function openChat({ phone, sender, text, pdf }) {
  if (!/^\d{11,15}$/.test(String(phone))) throw new Error("The client has no valid WhatsApp number");
  if (!/^\d{11,15}$/.test(String(sender))) throw new Error("Invalid sender number");

  // Reuse the WhatsApp Web tab that is already open; open one only if none exists.
  let [tab] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    tab = await chrome.tabs.create({ url: "https://web.whatsapp.com/", active: true });
  }

  const account = await loggedInAccount(tab.id);
  if (!account) throw new Error(`WhatsApp Web is not logged in. Log in as ${fmt(sender)} and click WhatsApp again.`);
  if (account !== sender) throw new Error(`WhatsApp Web is logged in as ${fmt(account)}, not the billing number ${fmt(sender)}. Log in with ${fmt(sender)} and click WhatsApp again.`);

  await chrome.storage.session.set({ [PENDING_KEY]: { pdf: pdf || null, sender, at: Date.now() } });
  const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text || "")}`;
  await chrome.tabs.update(tab.id, { url, active: true });
  return { ok: true };
}

/** Ask the tab's content script which number it is logged in as (null when logged out). */
async function loggedInAccount(tabId) {
  const end = Date.now() + 90_000;
  let reloaded = false;
  const start = Date.now();
  while (Date.now() < end) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: "caflow-wa-account" });
      if (r && "account" in r) return r.account;
    } catch {
      // No content script yet: the tab is still loading, or was opened before the
      // extension was installed — reload it once so the script gets injected.
      if (!reloaded && Date.now() - start > 4_000) { reloaded = true; await chrome.tabs.reload(tabId); }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("WhatsApp Web did not respond. Make sure it has finished loading and try again.");
}

async function takePending() {
  const { [PENDING_KEY]: p } = await chrome.storage.session.get(PENDING_KEY);
  await chrome.storage.session.remove(PENDING_KEY);
  if (!p || Date.now() - p.at > PENDING_TTL_MS) return null;
  return p;
}

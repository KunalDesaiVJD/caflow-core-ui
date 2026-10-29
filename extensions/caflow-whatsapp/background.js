// Routes a send from the CAFlow app to the WhatsApp Web tab.
// The PDF waits in session storage until the WhatsApp tab has loaded the chat.

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

async function openChat({ phone, text, pdf }) {
  if (!/^\d{11,15}$/.test(String(phone))) throw new Error("Invalid WhatsApp number");
  await chrome.storage.session.set({ [PENDING_KEY]: { pdf: pdf || null, at: Date.now() } });
  const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text || "")}`;

  // Reuse the WhatsApp Web tab that is already open (and logged in); open one only if none exists.
  const [tab] = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true, reused: true };
  }
  await chrome.tabs.create({ url, active: true });
  return { ok: true, reused: false };
}

async function takePending() {
  const { [PENDING_KEY]: p } = await chrome.storage.session.get(PENDING_KEY);
  await chrome.storage.session.remove(PENDING_KEY);
  if (!p || Date.now() - p.at > PENDING_TTL_MS) return null;
  return p;
}

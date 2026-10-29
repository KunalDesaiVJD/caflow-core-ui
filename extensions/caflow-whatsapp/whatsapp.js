// Runs on WhatsApp Web. After the CAFlow app opens a chat, waits for the
// message box (with the message typed in) and attaches the PDF as a document.
// Nothing is sent: the user reviews the preview and presses Send.

(async () => {
  const pending = await chrome.runtime.sendMessage({ type: "caflow-wa-take-pending" });
  if (!pending?.pdf) return;

  const box = await waitFor(() => document.querySelector('footer div[contenteditable="true"]'), 90_000);
  if (!box) return notice("CAFlow: WhatsApp did not open the chat in time.", pending.pdf);
  // Give WhatsApp a moment to fill in the pre-typed message.
  await waitFor(() => box.textContent.trim().length > 0, 5_000);
  await sleep(500);

  const file = toFile(pending.pdf);
  if (await attach(box, file)) return;
  notice("CAFlow: could not attach the PDF automatically — drag this file into the chat:", pending.pdf);
})();

async function attach(box, file) {
  const attached = () => document.body.innerText.includes(file.name);
  const dt = () => { const d = new DataTransfer(); d.items.add(file); return d; };

  // 1. Paste the file into the message box.
  box.focus();
  box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt(), bubbles: true, cancelable: true }));
  if (await waitFor(attached, 4_000)) return true;

  // 2. Drop it onto the conversation panel.
  const target = document.querySelector("#main") || box;
  const d = dt();
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, { dataTransfer: d, bubbles: true, cancelable: true }));
    await sleep(150);
  }
  return !!(await waitFor(attached, 4_000));
}

function toFile({ base64, filename }) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new File([bytes], filename, { type: "application/pdf" });
}

function notice(text, pdf) {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;top:12px;right:12px;z-index:99999;background:#fff;border:1px solid #25D366;border-radius:8px;padding:10px 14px;font:13px sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.2);max-width:320px";
  el.textContent = text + " ";
  if (pdf) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(toFile(pdf));
    a.download = pdf.filename;
    a.textContent = pdf.filename;
    a.style.cssText = "display:block;margin-top:6px;color:#128C7E;font-weight:600";
    el.appendChild(a);
  }
  const close = document.createElement("button");
  close.textContent = "×";
  close.style.cssText = "position:absolute;top:2px;right:6px;border:0;background:none;font-size:16px;cursor:pointer";
  close.onclick = () => el.remove();
  el.appendChild(close);
  document.body.appendChild(el);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
}

/**
 * CAFlow — ITD Portal Autofill: content script for eportal.incometax.gov.in.
 *
 * Scope, deliberately: fills the Login ID (step 1), clicks Continue, then
 * fills Password on step 2 — and STOPS. It never touches a CAPTCHA or OTP
 * field, and never clicks the final Login/Submit button. That's the one
 * manual step CAFlow asked to keep manual, and it also means this script
 * never attempts to defeat the portal's own anti-bot gate — only removes
 * the "look up and retype the login ID and password" toil in front of it.
 *
 * The value filled here is exactly whatever CAflow has saved as the "ITD
 * (e-Filing) Login ID" for this client (Edit Client → Services → Portal
 * Login Credentials) — CAflow never assumes or validates what TYPE of ID
 * that is. The ITD portal's own step-1 field happens to accept PAN, Aadhaar,
 * or another registered User ID (its own placeholder lists all three); this
 * script just types whatever was saved into whichever of those the field
 * currently is, without caring which kind it is.
 *
 * The ITD portal is an Angular SPA that renders each step asynchronously,
 * so every "find this field" step below polls (via MutationObserver) rather
 * than assuming the DOM is already there — and every step has a visible
 * timeout fallback: if a selector doesn't match (the portal changed its
 * markup, or an account uses a different login path), this shows a banner
 * saying exactly what it could and couldn't do, instead of failing silently.
 */

(async () => {
  // This tab is opened FIRST (synchronously, to satisfy the popup blocker —
  // see TdsPortalLoginButtons.tsx's own comment), racing this content
  // script's own load against the CAflow tab's async credential fetch +
  // relay. That relay is normally faster (same-machine edge function call +
  // an in-process extension message, vs. this tab's real network load of a
  // full Angular app) but isn't guaranteed to win — a couple of short
  // retries here closes that gap cheaply. An ordinary manual visit (by far
  // the common case) just pays the same ~1s in exchange for silence, since
  // "nothing queued" and "not queued YET" look identical from here.
  const requestCredentials = () => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_ITD_CREDENTIALS" }, (response) => resolve(response));
  });
  let creds = await requestCredentials();
  for (const delayMs of [400, 800]) {
    if (creds?.ok) break;
    await new Promise((r) => setTimeout(r, delayMs));
    creds = await requestCredentials();
  }
  // Still nothing after retrying — an ordinary manual visit to the login
  // page. Do nothing.
  if (!creds?.ok) return;

  showBanner("CAFlow: filling in your saved login…", "info");

  // The portal's step-1 field label varies by account type ("PAN", "Aadhaar",
  // or a generic "User ID") — matched broadly rather than assuming one.
  const loginIdInput = await waitFor(
    () => document.querySelector('input[placeholder*="PAN" i], input[placeholder*="Aadhaar" i], input[placeholder*="User ID" i]'),
    10_000,
  );
  if (!loginIdInput) {
    showBanner("CAFlow: couldn't find the Login ID field automatically — please log in manually.", "error");
    return;
  }
  setNativeValue(loginIdInput, creds.loginId || "");

  const continueBtn = await waitFor(() => findButtonByText(/continue/i), 5_000);
  if (!continueBtn) {
    showBanner("CAFlow: filled the Login ID field, but couldn't find Continue — please click it yourself.", "info");
    return;
  }
  continueBtn.click();

  const passwordInput = await waitFor(() => document.querySelector('input[type="password"]'), 15_000);
  if (!passwordInput) {
    showBanner("CAFlow: Login ID submitted, but couldn't find the password field — please continue manually.", "info");
    return;
  }
  setNativeValue(passwordInput, creds.password || "");
  showBanner("CAFlow: login ID and password filled — enter the CAPTCHA/OTP and sign in.", "success");
})();

/** Polls for a truthy result from `check` every 150ms until `timeoutMs`. */
function waitFor(check, timeoutMs) {
  return new Promise((resolve) => {
    const existing = check();
    if (existing) { resolve(existing); return; }
    const started = Date.now();
    const observer = new MutationObserver(() => {
      const found = check();
      if (found) { observer.disconnect(); clearInterval(poll); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Belt-and-braces poll alongside the observer — some Angular renders
    // don't mutate in a way MutationObserver's default config reliably
    // catches (e.g. attribute-only updates on an already-present node).
    const poll = setInterval(() => {
      const found = check();
      if (found) { observer.disconnect(); clearInterval(poll); resolve(found); return; }
      if (Date.now() - started > timeoutMs) { observer.disconnect(); clearInterval(poll); resolve(null); }
    }, 150);
  });
}

function findButtonByText(pattern) {
  const candidates = document.querySelectorAll("button, a[role='button']");
  for (const el of candidates) {
    if (pattern.test((el.textContent || "").trim())) return el;
  }
  return null;
}

/**
 * Sets an <input>'s value the way a real keystroke would, then fires the
 * events Angular/React's own change detection listens for. Setting
 * `.value` directly leaves the framework's internal form model unaware of
 * the change — the DOM would show the text, but Continue/Login would submit
 * the OLD (empty) value.
 */
function setNativeValue(input, value) {
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function showBanner(text, kind) {
  const colors = {
    info: "#2563eb", success: "#059669", error: "#dc2626",
  };
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647; background: ${colors[kind] || colors.info}; color: white;
    padding: 10px 16px; border-radius: 8px; font: 13px/1.4 system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25); max-width: 90vw; text-align: center;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

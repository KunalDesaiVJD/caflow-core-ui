/**
 * CAFlow — ITD Portal Autofill: content script for eportal.incometax.gov.in.
 *
 * Scope (widened 2026-08-06 — explicit, informed firm decision, see below):
 * fills the Login ID (step 1) → Continue → fills Password → ticks the
 * "Secure Access Message" confirmation checkbox → clicks the second
 * Continue, which SUBMITS THE PASSWORD. It stops there. It never touches a
 * CAPTCHA or OTP field if one appears next.
 *
 * The Secure Access Message checkbox is a real anti-phishing control — at
 * registration the user picks a personal message, and this screen asks them
 * to visually confirm it's theirs before continuing, proving they're on the
 * genuine portal and not a spoofed clone that wouldn't know the message.
 * Auto-checking it without a human ever reading that message defeats its
 * purpose. This was flagged explicitly and the automation was requested
 * anyway — kept as its own clearly-labelled step (not folded silently into
 * the password fill) so that tradeoff stays visible in the code, not just
 * in a chat log.
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
 *
 * Selectors verified directly against the live portal on 2026-08-06: the
 * Login ID field, the first Continue button, the password field
 * (#loginPasswordField), the confirmation checkbox (the page's only
 * input[type="checkbox"]), and the second Continue button (disabled until
 * BOTH the password is non-empty AND the checkbox is checked).
 */

(async () => {
  // This tab is opened FIRST (synchronously, to satisfy the popup blocker —
  // see TdsPortalLoginButtons.tsx's own comment), racing this content
  // script's own load against the CAflow tab's async credential fetch +
  // relay (an edge-function call to decrypt the password, which can be
  // slow on a cold start — no fixed short delay is safe to assume here).
  // Poll generously: an ordinary manual visit (by far the common case) just
  // pays up to ~12s of silent polling before concluding nothing is queued,
  // which costs nothing visible since "nothing queued" and "not queued YET"
  // look identical from here regardless of how long that takes to confirm.
  const requestCredentials = () => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_ITD_CREDENTIALS" }, (response) => resolve(response));
  });
  let creds = null;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    creds = await requestCredentials();
    if (creds?.ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // Still nothing after polling for 12s — an ordinary manual visit to the
  // login page. Do nothing.
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

  // Secure Access Message checkbox — see this file's own header doc for why
  // auto-checking it is a deliberate, explicitly-requested tradeoff, not an
  // oversight. .click() (not setting .checked directly) so Angular's own
  // change detection actually registers it, same reasoning as setNativeValue.
  const confirmCheckbox = await waitFor(() => document.querySelector('input[type="checkbox"]'), 5_000);
  if (!confirmCheckbox) {
    showBanner("CAFlow: password filled, but couldn't find the confirmation checkbox — please finish signing in yourself.", "info");
    return;
  }
  if (!confirmCheckbox.checked) confirmCheckbox.click();

  // The second Continue (submits the password) stays disabled until BOTH
  // the password is non-empty and the checkbox is checked — wait for that
  // rather than clicking immediately, since Angular's validation runs on
  // its own tick after the events above.
  const submitBtn = await waitFor(() => {
    const btn = findButtonByText(/continue/i);
    return btn && !btn.disabled ? btn : null;
  }, 5_000);
  if (!submitBtn) {
    showBanner("CAFlow: password and confirmation filled, but Continue never enabled — please check and click it yourself.", "info");
    return;
  }
  submitBtn.click();
  showBanner("CAFlow: login submitted — enter the CAPTCHA/OTP if one appears.", "success");
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

/**
 * Finds a VISIBLE button/link matching `pattern`. Visibility matters here
 * specifically because this Angular SPA appears to leave a step's own
 * Continue button in the DOM (hidden, not removed) after navigating past
 * it rather than destroying the route component — a plain text-match can
 * then non-deterministically grab step 1's stale, hidden Continue instead
 * of step 2's real, visible one, depending on exactly when the DOM is
 * queried. `.click()`-ing that stale node does nothing observable, which
 * is exactly the "everything filled in, nothing happens" symptom this was
 * built to fix. offsetParent is null for any element (or ancestor) with
 * display:none — a fast, reliable way to filter to what's actually
 * rendered, without needing to know the framework's exact routing quirk.
 */
function findButtonByText(pattern) {
  const candidates = document.querySelectorAll("button, a[role='button']");
  for (const el of candidates) {
    if (el.offsetParent === null) continue; // hidden — not the live step's control
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

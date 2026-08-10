/**
 * CAFlow — ITD Portal Autofill: content script for eportal.incometax.gov.in.
 *
 * Scope, current (settled 2026-08-06 after a same-day back-and-forth — see
 * the trail below, kept rather than cleaned up, since the reasoning matters
 * more here than usual): fills the Login ID (step 1) → Continue → fills
 * Password → ticks the "Secure Access Message" confirmation checkbox — and
 * STOPS. It never clicks the final submit button, never touches a CAPTCHA
 * or OTP field.
 *
 * That final click was briefly automated, then deliberately reverted. Live
 * testing (against a real account, read-only up to the click itself — see
 * git history for the exact sequence) confirmed the submit button's own
 * click handler does not respond to a script-generated .click() — the
 * checkbox and every other control on this page respond fine to the exact
 * same technique, so this looks like a deliberate, targeted control on
 * THIS specific button, not a general framework quirk. The one technique
 * that could have gotten around it — Chrome's debugger protocol injecting
 * an OS-level "trusted" click indistinguishable from a real one — was
 * built, then removed: defeating a control a site placed specifically on
 * its final authentication step is circumventing anti-automation
 * protection, not filling in a form, and that line holds regardless of how
 * many times bypassing it is requested. Everything up to that click stays
 * automated; that one click is yours.
 *
 * The Secure Access Message checkbox is a real anti-phishing control — at
 * registration the user picks a personal message, and this screen asks them
 * to visually confirm it's theirs before continuing, proving they're on the
 * genuine portal and not a spoofed clone that wouldn't know the message.
 * Auto-checking it without a human ever reading that message defeats its
 * purpose too — flagged explicitly before building it, and kept as its own
 * clearly-labelled step below rather than folded silently into the password
 * fill, so that tradeoff (a smaller one than the submit click, still worth
 * naming) stays visible in the code, not just in a chat log.
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

  // STOPS HERE, DELIBERATELY (2026-08-06): confirmed live that a plain
  // .click() reaches this exact, correct, visible button and the page still
  // never advances — this specific submit button appears to reject
  // script-generated clicks. That's very likely a deliberate anti-automation
  // control on a government tax portal, not a bug to route around. A
  // technique exists that could defeat it (Chrome's debugger protocol can
  // inject an OS-level "trusted" click indistinguishable from a real one),
  // but building that crosses from "fill in what I already typed" into
  // "circumvent a security control this site placed here on purpose" —
  // not something to automate regardless of how many times it's requested.
  // Fill everything, leave this one click to a real person.
  showBanner("CAFlow: login ID, password, and confirmation filled — click Continue yourself to finish signing in.", "success");
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

// Stamped into every banner so a screenshot alone proves which build
// actually ran — Chrome doesn't auto-reload an unpacked extension, so
// "which version is installed" has repeatedly been the real question
// behind a report that looked like a fresh bug. No more chrome://extensions
// round-trip needed to answer it.
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

function showBanner(text, kind) {
  const colors = {
    info: "#2563eb", success: "#059669", error: "#dc2626",
  };
  const el = document.createElement("div");
  el.textContent = `${text} [v${EXTENSION_VERSION}]`;
  el.style.cssText = `
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647; background: ${colors[kind] || colors.info}; color: white;
    padding: 10px 16px; border-radius: 8px; font: 13px/1.4 system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25); max-width: 90vw; text-align: center;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

/**
 * START_CHALLAN_DOWNLOAD — Stage-2 challan-download automation, requested by
 * TdsChallanDownloadValidation.tsx's "Download Challan" button and relayed
 * here via background.js's RELAY_CHALLAN_DOWNLOAD.
 *
 * STILL PARTIALLY UNVERIFIED (2026-08-10): the e-File -> e-Pay Tax ->
 * Income Tax Act, 2025 -> Payment History click-path was confirmed correct
 * from a real screenshot of the live page. The "Actions" step, however, was
 * confirmed WRONG the same way: Payment History has no page-level "Actions"
 * button at all — each ROW carries its own small icon-only "..." control
 * (rightmost column, header literally says "Action"), which opens a
 * per-transaction menu with the real "Download" item inside it. That is
 * exactly the shape this file's own class doc already flagged as the likely
 * failure mode ("If Payment History instead exposes a per-ROW Actions
 * control ... this first draft won't find it").
 *
 * findRowActionTrigger() below targets that per-row control instead of a
 * page-level button. Its exact selector (icon-only control in a table row's
 * last cell) is a reasoned best guess from the screenshot, not something
 * confirmed by clicking it live — a stable, authenticated portal session
 * was not available while writing this fix either. If it still can't find
 * the control, or finds it but "Download" doesn't appear afterward, it
 * fails loud with a banner exactly like every other step here — finish
 * manually (Payment History -> the row's own Action icon -> Download) and
 * report back what the banner said so the next iteration can target the
 * right thing.
 *
 * Whatever this reaches, the actual hand-off into CAFlow always ends at a
 * manual "Upload Downloaded Report" step in the app — a content script
 * cannot read a file the OS just saved to Downloads, that's a browser
 * security boundary, not something worth trying to route around.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "START_CHALLAN_DOWNLOAD") return;
  runChallanDownload(msg.fyStartDate, msg.fyEndDate);
});

/** Same idea as findButtonByText, but for site NAVIGATION/MENU items, which
 *  on most Angular admin UIs (this portal included, per the login flow's own
 *  DOM) are as likely to be <li>/<a>/[role=menuitem]/[role=tab] as an actual
 *  <button> — broadened here rather than reusing findButtonByText's tighter
 *  selector, which was deliberately scoped to the login form's own controls. */
function findClickableByText(pattern) {
  const candidates = document.querySelectorAll(
    "button, a, a[role='button'], li, [role='menuitem'], [role='tab'], [role='link'], span, div",
  );
  for (const el of candidates) {
    if (el.offsetParent === null) continue; // hidden — same reasoning as findButtonByText
    const text = (el.textContent || "").trim();
    // Exact-ish match on a SHORT leaf label — a broad selector like this can
    // otherwise match a big container div whose combined textContent happens
    // to contain the pattern somewhere deep inside it. Capping length avoids
    // clicking the wrong (much bigger) ancestor.
    if (text.length > 60) continue;
    if (pattern.test(text)) return el;
  }
  return null;
}

/**
 * Payment History's per-row "Action" control — an icon-only button (a
 * three-dot "more options" glyph, per the real page's own "Action" column
 * header) in the LAST cell of a transaction table row, not a page-level
 * text button. Targeted by shape rather than text, since an icon-only
 * control has none: a small (<=32px either side, generous but excludes a
 * full download/actions bar), clickable element that is the LAST
 * interactive/leaf node in its row, and itself carries no meaningful text
 * (an icon glyph or empty label, not a sentence). Picks the FIRST such row
 * top-to-bottom — good enough for a first pass; a more precise "the row
 * matching this quarter's date/amount" match is a refinement for once this
 * is confirmed to find the control at all.
 */
function findRowActionTrigger() {
  const rows = document.querySelectorAll("tr, [role='row']");
  for (const row of rows) {
    if (row.offsetParent === null) continue;
    const cells = row.querySelectorAll("td, [role='cell'], [role='gridcell']");
    if (!cells.length) continue;
    const lastCell = cells[cells.length - 1];
    const candidates = lastCell.querySelectorAll("button, [role='button'], a, svg, [class*='icon' i]");
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.width > 32 || rect.height > 32) continue;
      const text = (el.textContent || "").trim();
      if (text.length > 3) continue; // an icon control has no sentence-length label
      // Prefer the clickable ANCESTOR (button/role=button) over a bare <svg>
      // glyph inside it, since the glyph itself often isn't the click target.
      const clickable = el.closest("button, [role='button'], a") || el;
      return clickable;
    }
  }
  return null;
}

async function runChallanDownload(fyStartDate, fyEndDate) {
  showBanner("CAFlow: attempting to fetch this quarter's challans from Payment History…", "info");

  const steps = [
    { label: "e-File", pattern: /^e-file$/i },
    { label: "e-Pay Tax", pattern: /^e-pay tax$/i },
    { label: "Income Tax Act, 2025", pattern: /income tax act,?\s*2025/i },
    { label: "Payment History", pattern: /payment history/i },
  ];
  for (const step of steps) {
    const el = await waitFor(() => findClickableByText(step.pattern), 10_000);
    if (!el) {
      showBanner(`CAFlow: couldn't find "${step.label}" — please continue from here manually (Payment History → Actions → Download for this quarter).`, "info");
      return;
    }
    el.click();
    // Angular re-renders the next step asynchronously — give it a beat
    // before the next waitFor starts polling, same reasoning as the login
    // flow's own between-step waits.
    await new Promise((r) => setTimeout(r, 400));
  }

  // Best-effort date-range fill, ONLY if the page actually offers one — not
  // every Payment History layout necessarily has a filter, so this doesn't
  // block the rest of the sequence if it's missing.
  if (fyStartDate && fyEndDate) {
    const dateInputs = await waitFor(() => {
      const inputs = [...document.querySelectorAll('input[type="date"], input[placeholder*="date" i], input[placeholder*="from" i]')].filter((i) => i.offsetParent !== null);
      return inputs.length ? inputs : null;
    }, 4_000);
    if (dateInputs && dateInputs[0]) setNativeValue(dateInputs[0], fyStartDate);
    if (dateInputs && dateInputs[1]) setNativeValue(dateInputs[1], fyEndDate);
  }

  // Payment History's real "Action" control is per-ROW and icon-only (no
  // text) — see this function's own header doc. Try that first; fall back to
  // a page-level "Actions" text button in case a different account/layout
  // genuinely has one, rather than assuming only one shape ever exists.
  const actionsEl = await waitFor(() => findRowActionTrigger() || findClickableByText(/^actions$/i), 8_000);
  if (!actionsEl) {
    showBanner('CAFlow: reached Payment History but couldn\'t find the row\'s Action control — please click it yourself (rightmost column) → Download.', "info");
    return;
  }
  actionsEl.click();
  await new Promise((r) => setTimeout(r, 300));

  const downloadEl = await waitFor(() => findClickableByText(/^download$/i), 5_000);
  if (!downloadEl) {
    showBanner('CAFlow: opened Actions but couldn\'t find "Download" — please click it yourself.', "info");
    return;
  }
  downloadEl.click();

  showBanner("CAFlow: clicked Download — check your Downloads folder, then upload the file in CAFlow's Challan Validation step.", "success");
}

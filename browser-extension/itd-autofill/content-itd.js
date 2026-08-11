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

/**
 * START_CHALLAN_DOWNLOAD polling — runs concurrently with (independent of)
 * the login-autofill IIFE above. v0.3.3: this replaced a one-shot message
 * relay that was fired the instant "Download Challan" was clicked in
 * CAFlow — before content-itd.js even had time to be injected on the fresh
 * ITD tab, and with no way to wait for the manual login that follows. See
 * background.js's own header doc on RELAY_CHALLAN_DOWNLOAD for the full
 * account of why a stored, polled request replaces it.
 *
 * eportal.incometax.gov.in is an Angular SPA — login, dashboard, and every
 * page of the e-Pay Tax flow are all client-side hash-route changes within
 * ONE real page load, which never re-injects a content script. So a single
 * poll loop started here, at this initial injection, stays alive through
 * the whole manual login + all of runChallanDownload's own navigation —
 * there is no need to re-trigger this per hash-route change the way a
 * fresh full-page load would need to.
 */
(async () => {
  const requestChallanDownload = () => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_CHALLAN_DOWNLOAD_REQUEST" }, (response) => resolve(response));
  });
  // Mirrors background.js's own CHALLAN_DOWNLOAD_REQUEST_TTL_MS — this loop
  // gives up on its own once the stored request would have expired anyway,
  // rather than polling forever on a tab nobody ever logs into.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const req = await requestChallanDownload();
    if (req?.ok) {
      // Consume BEFORE running — if this poll loop somehow saw the request
      // twice (a second content-itd.js instance from an unrelated reload,
      // for instance), only the first CONSUME to actually reach
      // background.js wins; the shared chrome.storage.session record
      // decides that, not a local flag racing another tab's own copy of
      // this same script.
      chrome.runtime.sendMessage({ type: "CONSUME_CHALLAN_DOWNLOAD_REQUEST" });
      await runChallanDownload(req.fyStartDate, req.fyEndDate);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
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
 * STILL PARTIALLY UNVERIFIED (2026-08-10, second pass): the e-File -> e-Pay
 * Tax step is confirmed from a real screenshot. What follows it is NOT one
 * click straight to Payment History, as first assumed — e-Pay Tax lands on
 * an intermediate ACT-SELECTION page ("e-Pay Tax -2025": Income-tax Act,
 * 2025 vs 1961, 2025 pre-selected) that only advances once its own
 * "Continue" button is clicked; the earlier version clicked the Act radio
 * label (harmless, already selected) but never Continue, so it silently sat
 * on that page forever and never reached Payment History no matter how long
 * it polled. Confirmed from a second real screenshot showing that exact
 * page. Continue lands on the real e-Pay Tax dashboard (Saved Drafts /
 * Generated Challans / Payment History / CSI File tabs), where the
 * Payment History tab click was already correct.
 *
 * The "Actions" step was ALSO confirmed wrong the same way: Payment History
 * has no page-level "Actions" button at all — each ROW carries its own
 * small icon-only "..." control (rightmost column, header literally says
 * "Action"), which opens a per-transaction menu with the real "Download"
 * item inside it. That is exactly the shape this file's own class doc
 * already flagged as the likely failure mode ("If Payment History instead
 * exposes a per-ROW Actions control ... this first draft won't find it").
 *
 * 2026-08-11: no longer downloads anything at all — findRowMenuTrigger,
 * openViewDetailsForCin, and scrapeChallanReceiptDetail (further down this
 * file) read each candidate challan's own "View Details" page directly
 * instead, per explicit instruction. See runChallanDownload's own inline
 * doc, right where it switches from navigation into this scraping phase,
 * for the full account of why and how.
 *
 * Triggered by the poll loop further up this file (search
 * GET_CHALLAN_DOWNLOAD_REQUEST), not a chrome.runtime.onMessage listener —
 * see that loop's own doc, and background.js's, for why a one-shot message
 * listener here couldn't survive the manual login this has to wait through.
 */

/** Same idea as findButtonByText, but for site NAVIGATION/MENU items, which
 *  on most Angular admin UIs (this portal included, per the login flow's own
 *  DOM) are as likely to be <li>/<a>/[role=menuitem]/[role=tab] as an actual
 *  <button> — broadened here rather than reusing findButtonByText's tighter
 *  selector, which was deliberately scoped to the login form's own controls. */
// 2026-08-11 (sixteenth pass): the full candidate dump for "e-Pay Tax"
// proved a real `<button class="mat-mdc-menu-item...">` exists among the
// matches (Angular Material's actual menu-item element — index 3 in that
// dump), yet the step log kept reporting a bare SPAN. Root cause: this
// function returned on the FIRST match in document order, and document
// order does not equal "most correct element" — a nested SPAN can precede
// or interleave with its own button ancestor in ways that aren't
// predictable from the selector list's own ordering. Eleventh/twelfth pass
// tried to compensate by climbing from whatever was matched first, which
// only works if the FIRST match is a reasonable starting point — it wasn't
// here. Rewritten to collect every match, then explicitly rank by how
// "real" the element is (an actual button/link beats a bare span/div),
// picking the best one regardless of where it fell in document order.
const CLICKABLE_TAG_RANK = { BUTTON: 0, A: 1, LI: 2 };
function findClickableByText(pattern) {
  const candidates = document.querySelectorAll(
    "button, a, a[role='button'], li, [role='menuitem'], [role='tab'], [role='link'], span, div",
  );
  const matches = [];
  for (const el of candidates) {
    if (el.offsetParent === null) continue; // hidden — same reasoning as findButtonByText
    const text = (el.textContent || "").trim();
    // Exact-ish match on a SHORT leaf label — a broad selector like this can
    // otherwise match a big container div whose combined textContent happens
    // to contain the pattern somewhere deep inside it. Capping length avoids
    // clicking the wrong (much bigger) ancestor.
    if (text.length > 60) continue;
    if (pattern.test(text)) matches.push(el);
  }
  if (matches.length === 0) return null;
  // Rank each match: a real <button>/<a>/<li> wins outright; failing that,
  // prefer whichever match has the "best" ancestor available (a Material
  // menu-item class, then a role/tag-based clickable ancestor), so a bare
  // span/div still resolves to its real clickable wrapper when one exists —
  // same reasoning eleventh/twelfth pass already established, just no
  // longer gated on being the first thing this function happened to find.
  let best = null;
  let bestRank = Infinity;
  for (const el of matches) {
    const ownRank = CLICKABLE_TAG_RANK[el.tagName];
    if (ownRank !== undefined && ownRank < bestRank) { best = el; bestRank = ownRank; if (bestRank === 0) break; }
  }
  if (best) return best;
  for (const el of matches) {
    const materialMenuItem = el.closest("[class*='menu-item']");
    if (materialMenuItem) return materialMenuItem;
  }
  for (const el of matches) {
    const clickable = el.closest("button, a, a[role='button'], li, [role='menuitem'], [role='tab'], [role='link']");
    if (clickable) return clickable;
  }
  return matches[0];
}

async function runChallanDownload(fyStartDate, fyEndDate) {
  showBanner("CAFlow: waiting for you to finish logging in…", "info");

  // 2026-08-11 (fifth pass): every prior fix in this function assumed login
  // was already complete by the time these steps ran — wrong. This poll
  // loop's own caller (search GET_CHALLAN_DOWNLOAD_REQUEST further up this
  // file) starts hunting for "e-File" the INSTANT the queued request is
  // found, which races the login-autofill IIFE above: that flow fills the
  // password and Secure Access checkbox, then deliberately STOPS and waits
  // for a human to click the final Continue (see this file's own header doc
  // for why that click is never scripted). If the human hasn't clicked it
  // yet, "e-File" simply doesn't exist anywhere on the page — confirmed live
  // from a real screenshot showing the "couldn't find e-File" banner sitting
  // directly on top of the still-visible login/password screen. Every
  // earlier "couldn't find X" at a LATER step was very likely the same race,
  // just with a lucky-enough manual click timing to get further before
  // outrunning it again — not a selector bug, not a slow data fetch. Wait
  // for real evidence of reaching the dashboard first: 5 minutes, matching
  // this same file's own GET_CHALLAN_DOWNLOAD_REQUEST poll window, since
  // this wait is paced by a human (CAPTCHA/OTP included), not the network.
  const reachedDashboard = await waitFor(() => (/\/dashboard/i.test(location.hash) ? true : null), 5 * 60 * 1000);
  if (!reachedDashboard) {
    showBanner("CAFlow: still waiting for login to finish — once you're on the Dashboard, please continue manually (e-File → e-Pay Tax → Continue → Payment History → Actions → Download for this quarter).", "info");
    return;
  }

  showBanner("CAFlow: attempting to fetch this quarter's challans from Payment History…", "info");

  // Click path CONFIRMED (2026-08-10) from real screenshots of the live
  // portal, replacing the earlier guessed sequence:
  //   e-File (top nav, opens a dropdown) -> e-Pay Tax (item in that dropdown)
  //   -> lands on "e-Pay Tax -2025", an ACT-SELECTION page ("Select
  //      Applicable Income Tax Act": 2025 vs 1961, 2025 pre-selected) that
  //      does NOT navigate on its own -> Continue (separate button) is what
  //      actually advances past it
  //   -> lands on the real e-Pay Tax dashboard (Saved Drafts / Generated
  //      Challans / Payment History / CSI File tabs) -> Payment History tab
  //
  // 2026-08-11: DROPPED the "click the 'Income Tax Act, 2025' radio label"
  // step that sat between e-Pay Tax and Continue. Confirmed failing live —
  // a real run reached the Dashboard/e-Pay Tax stage fine (login relay
  // worked) but then banner'd "couldn't find Income Tax Act, 2025" and gave
  // up. Most likely cause: findClickableByText caps matched text at 60
  // chars specifically to avoid grabbing an oversized container div (see
  // its own doc) — but this radio's own label sits right above a full
  // description sentence ("TDS/TCS payments for Tax Year 2026-27 and
  // onwards."), and if both live under one text node the combined string
  // clears 60 chars and the cap silently excludes the only element that
  // matches the pattern at all. The click was always harmless-but-redundant
  // anyway (2025 is pre-selected by default, confirmed from a real
  // screenshot of this exact page) — removing it is strictly safer than
  // trying to patch the selector to survive a description sentence whose
  // exact wording isn't confirmed either.
  // 2026-08-11 (third pass): a real run reached e-Pay Tax fine (confirming
  // the two steps above) but then banner'd "couldn't find Continue" on the
  // Act-selection page. Root cause, confirmed from a live screenshot: that
  // button's own text is "Continue ›" (a trailing chevron character, same
  // as the login flow's two Continue buttons), which fails an EXACT
  // ^continue$ match but is caught fine by a plain substring test — exactly
  // how findButtonByText already matches "Continue" successfully during
  // login (see requestCredentials' continueBtn/submitBtn above, both using
  // /continue/i with no anchors). Relaxed to match that already-proven
  // pattern instead of guessing at a new one.
  // 2026-08-11 (fourth pass): with "Continue" fixed, a real run got one step
  // further and banner'd "couldn't find Payment History". Live-inspected the
  // real e-Pay Tax dashboard DOM directly (via the exact same candidate
  // selector + visibility + 60-char-cap + pattern this file's own
  // findClickableByText uses) and found four clean, exact "Payment History"
  // matches — no icon text, no missing space, nothing a selector fix could
  // address. So the text-matching logic itself is fine; the real cause is
  // very likely that clicking "Continue" navigates to a data-heavy dashboard
  // (it has to fetch real payment records from the government backend
  // before rendering the tab bar), which is plausibly slower than the other,
  // purely client-side nav steps — and 10s wasn't always enough. Given
  // per-step timeout, not a uniform one, so the cheap nav clicks stay fast
  // to fail if genuinely broken, and only this heavier step gets more room.
  const steps = [
    { label: "e-File", pattern: /^e-file$/i, timeoutMs: 10_000 },
    { label: "e-Pay Tax", pattern: /^e-pay tax$/i, timeoutMs: 10_000 },
    // 2026-08-11 (eighth pass): the step log (finally readable — see the
    // isolated-world fix below) caught the real bug live: this step's
    // plain /continue/i substring match clicked a DIV whose text was
    // "× Continue Session…" — the PORTAL'S OWN session-timeout warning
    // popup, not the Act-selection page's real "Continue ›" button.
    // Dismissing that popup does nothing else, so the next step (Payment
    // History) never had anywhere new to find. Anchored both ends, with an
    // optional trailing chevron/arrow and whitespace, so it still matches
    // "Continue" / "Continue ›" but not "× Continue Session" (fails ^, and
    // even without the ×, the trailing "Session" would fail $).
    // 2026-08-11 (ninth pass): the end-anchored version above (only
    // matching a specific chevron character) came back "not found" — the
    // real button's exact trailing character was never actually confirmed
    // (the earlier screenshot showing "Continue ›" isn't proof the DOM text
    // is that literal glyph; it could be an icon-font ligature or a
    // different Unicode arrow). Dropped the end anchor: what actually
    // matters, and what the step log proved was missing, is that the match
    // starts with "Continue" as its own word — "× Continue Session" starts
    // with "×", so \b still excludes it, without needing to guess the
    // exact tail.
    { label: "Continue", pattern: /^continue\b/i, timeoutMs: 10_000 },
    { label: "Payment History", pattern: /payment history/i, timeoutMs: 25_000 },
  ];
  // 2026-08-11 (sixth pass): the login-race fix (above) confirmed working
  // live — the banner correctly waited for #/dashboard before starting —
  // yet "couldn't find Payment History" still happened, and the address bar
  // at that point was still bare #/dashboard, not the real
  // #/dashboard/e-pay-tax/e-pay-tax-dashboard route a successful run reaches
  // (confirmed from an earlier real screenshot). That means an EARLIER step
  // in this loop is reporting success without actually producing the
  // navigation it should — impossible to tell which from a single
  // pass/fail banner.
  //
  // 2026-08-11 (seventh pass): v0.3.8's window.__caflowStepLog read back
  // undefined even from the exact right tab. Root cause: a content script
  // runs in an ISOLATED WORLD by default (manifest.json declares no
  // "world", so this is Chrome's default) — a separate JS global scope from
  // the page's own, sharing only the DOM. Setting a property on THIS
  // script's `window` never touches the page's `window`, which is what
  // DevTools Console reads from by default — two different objects both
  // called `window`. console.* output is NOT world-scoped the same way
  // though (it's the browser's own debug bridge, not a JS object), so
  // calling console.table directly FROM this isolated world still lands in
  // the same visible DevTools panel. Doing that instead of stashing on
  // `window` sidesteps the mismatch entirely — nothing to type, no world to
  // pick.
  const stepLog = [];
  // 2026-08-11 (fifteenth pass): this run's "e-Pay Tax" search came back
  // with ZERO elements containing "e-pay" ANYWHERE on the page — a totally
  // different symptom than the earlier "found a bare span" runs. "e-File"
  // is a TOGGLE (click opens it, click again closes it); this page never
  // fully reloads between attempts (SPA), so if it was already open for any
  // reason when a fresh run starts, blindly clicking it once closes it
  // instead of opening it, and the dropdown's contents genuinely don't
  // exist afterward — that's not a selector problem at all. Special-cased
  // "e-File" into its own open-and-verify loop: click, check the menu
  // actually opened (by testing for the NEXT step's own pattern), and if
  // not, click again (undoing an accidental close) — up to 3 tries — before
  // falling through to the normal step-timeout failure path.
  if (steps[0].label === "e-File" && steps[1]) {
    const menuStep = steps[0];
    const verifyPattern = steps[1].pattern;
    let menuOpened = !!findClickableByText(verifyPattern);
    for (let attempt = 0; !menuOpened && attempt < 3; attempt++) {
      const trigger = await waitFor(() => findClickableByText(menuStep.pattern), menuStep.timeoutMs);
      if (!trigger) break;
      trigger.click();
      await new Promise((r) => setTimeout(r, 900));
      menuOpened = !!findClickableByText(verifyPattern);
    }
    stepLog.push({ step: menuStep.label, found: true, foundTag: "A", foundText: menuStep.label, urlBefore: location.hash, urlAfter: location.hash, note: menuOpened ? "menu confirmed open" : "menu never confirmed open after 3 tries" });
    steps.shift(); // already handled — the main loop below continues from "e-Pay Tax"
  }
  for (const step of steps) {
    const el = await waitFor(() => findClickableByText(step.pattern), step.timeoutMs);
    if (!el) {
      stepLog.push({ step: step.label, found: false, urlBefore: location.hash });
      console.table(stepLog);
      // 2026-08-11 (tenth pass): two guesses at the Continue pattern in a
      // row both missed — rather than guess a third time, dump every
      // VISIBLE element whose text loosely contains this step's first word
      // (tag, full text, length), so the real candidate set is visible
      // directly instead of inferred from another screenshot.
      const looseWord = step.label.split(/\s+/)[0].toLowerCase();
      const candidates = [...document.querySelectorAll(
        "button, a, a[role='button'], li, [role='menuitem'], [role='tab'], [role='link'], span, div",
      )]
        .filter((c) => c.offsetParent !== null)
        .map((c) => ({ tag: c.tagName, text: (c.textContent || "").trim(), len: (c.textContent || "").trim().length }))
        .filter((c) => c.text.toLowerCase().includes(looseWord))
        .slice(0, 25);
      console.log(`CAFlow: every visible element containing "${looseWord}" at the moment "${step.label}" failed —`);
      console.table(candidates);
      showBanner(`CAFlow: couldn't find "${step.label}" — please continue from here manually (Payment History → Actions → Download for this quarter). Details logged to this tab's console. [v${EXTENSION_VERSION}]`, "info");
      return;
    }
    const urlBefore = location.hash;
    const foundTag = el.tagName;
    const foundText = (el.textContent || "").trim().slice(0, 80);
    // 2026-08-11 (fourteenth pass): the 900ms animation-settle delay (below)
    // did NOT fix "e-Pay Tax" resolving to a bare span — same symptom as
    // before, timing wasn't the real cause after all. Rather than guess a
    // fifth time, whenever a step resolves to something that ISN'T already
    // a real interactive element (SPAN/DIV, not BUTTON/A/LI), dump every
    // element exactly matching this step's own pattern — not just the first
    // one found — with its class and 3-level ancestor chain, so a stale
    // duplicate (the exact class of bug this file already found and fixed
    // once for "Continue" buttons left behind by Angular's router) would be
    // directly visible instead of inferred.
    if (foundTag === "SPAN" || foundTag === "DIV") {
      const allExactMatches = [...document.querySelectorAll(
        "button, a, a[role='button'], li, [role='menuitem'], [role='tab'], [role='link'], span, div",
      )]
        .filter((c) => c.offsetParent !== null && step.pattern.test((c.textContent || "").trim()) && (c.textContent || "").trim().length <= 60)
        .map((c) => {
          const rect = c.getBoundingClientRect();
          const ancestors = [];
          let node = c.parentElement;
          for (let i = 0; i < 3 && node; i++) { ancestors.push(`${node.tagName}.${node.className}`.slice(0, 40)); node = node.parentElement; }
          return { tag: c.tagName, cls: (c.className || "").toString().slice(0, 40), x: Math.round(rect.x), y: Math.round(rect.y), ancestors: ancestors.join(" < ") };
        });
      console.log(`CAFlow: every exact match for "${step.label}" right before clicking —`);
      console.table(allExactMatches);
    }
    el.click();
    // 2026-08-11 (thirteenth pass): even with the right ancestor-climb
    // logic, "e-Pay Tax" STILL resolved to the bare span — a timing race,
    // not a selector bug. "e-File" opens an Angular Material menu
    // (mat-menu), which has its own brief open animation; findClickableByText
    // can find the "e-Pay Tax" text the instant it exists in the DOM, before
    // its wrapping mat-mdc-menu-item class has actually been applied by
    // that animation — and waitFor resolves on the FIRST truthy result, so
    // it latches onto the not-yet-ready span and never gets a second look.
    // Giving the step right after "e-File" specifically more breathing room
    // (900ms vs the other steps' 400ms) so polling only STARTS once the
    // menu's real DOM has settled.
    const postClickDelayMs = step.label === "e-File" ? 900 : 400;
    await new Promise((r) => setTimeout(r, postClickDelayMs));
    stepLog.push({ step: step.label, found: true, foundTag, foundText, urlBefore, urlAfter: location.hash });
  }
  console.table(stepLog);

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

  // 2026-08-11 (second pass, per explicit instruction): reading only the
  // summary table's CIN wasn't enough — the user wants each candidate
  // challan opened via its own "⋮" -> "View Details" (the authoritative
  // Challan Receipt page: PAN, BSR code, Challan Number, Date of Payment,
  // Amount — all explicitly labeled, no parsing a packed CIN string needed)
  // and compared against Data Entry, with a real screen warning on any
  // mismatch. Payment History shows this TAN's ENTIRE history (confirmed
  // live: 73 pages @ 5 rows), not scoped to one quarter, so opening every
  // row's details would be both impractical and pointless — Stage 1 below
  // scans the summary table (fast, no navigation) to find just this
  // quarter's rows, relying on the list being sorted newest-first (confirmed
  // from a live screenshot) to stop scanning as soon as dates fall below the
  // quarter's start rather than walking all 73 pages. Stage 2 then opens
  // View Details only for those candidates.
  const MAX_DETAIL_VIEWS = 30; // safety cap — a full quarter's challans for one TAN should never approach this
  const MAX_SCAN_PAGES = 40;   // safety cap on Stage 1's page-by-page scan, well under the 73 seen live

  // 2026-08-11: live-confirmed a real challan the office had entered for
  // this quarter (paid 06-Jul, quarter ending 30-Jun) was never even
  // attempted — TDS deducted in a quarter's last month is due by the 7th of
  // the FOLLOWING month, so a return legitimately includes challans paid a
  // few days past the calendar quarter's own end date; this isn't office
  // data being wrong, it's the strict fyEndDate cutoff being too strict.
  // Widens ONLY the candidate-collection window with a grace buffer —
  // matching itself still requires an exact office serial number, so a few
  // extra harmless candidates cost nothing.
  const GRACE_DAYS = 10;
  const scanEndDate = fyEndDate ? addDays(fyEndDate, GRACE_DAYS) : fyEndDate;

  const candidates = await collectQuarterCandidates(fyStartDate, scanEndDate, MAX_SCAN_PAGES);
  if (candidates.reason) {
    showBanner(`CAFlow: couldn't read the Payment History table — ${candidates.reason}. Details logged to this tab's console.`, "info");
    console.log("CAFlow: Stage 1 (summary scan) failed —", candidates);
    return;
  }
  if (!candidates.rows.length) {
    showBanner(fyStartDate
      ? "CAFlow: scanned Payment History but found no challans in this quarter's date range — please verify manually if this is unexpected."
      : "CAFlow: scanned Payment History but found no challans at all.", "info");
    return;
  }

  const toOpen = candidates.rows.slice(0, MAX_DETAIL_VIEWS);
  if (candidates.rows.length > MAX_DETAIL_VIEWS) {
    console.log(`CAFlow: found ${candidates.rows.length} candidate challans, opening only the first ${MAX_DETAIL_VIEWS} (safety cap) —`, candidates.rows);
  }

  const detailed = [];
  const failedCins = [];
  for (const cand of toOpen) {
    const opened = await openViewDetailsForCin(cand.cin);
    if (!opened) { failedCins.push(cand.cin); continue; }
    const detail = await waitFor(() => scrapeChallanReceiptDetail(), 6_000);
    if (detail) detailed.push(detail); else failedCins.push(cand.cin);
    await returnToPaymentHistory();
  }

  console.log(`CAFlow: opened View Details for ${detailed.length}/${toOpen.length} candidate challan(s) —`);
  console.table(detailed);
  if (failedCins.length) console.log("CAFlow: couldn't open/read View Details for these CINs —", failedCins);

  if (!detailed.length) {
    showBanner('CAFlow: found candidate challans but couldn\'t open any of their View Details pages — please verify manually. Details logged to this tab\'s console.', "info");
    return;
  }

  chrome.runtime.sendMessage({ type: "STORE_CHALLAN_SCRAPE_RESULT", rows: detailed });
  showBanner(
    failedCins.length
      ? `CAFlow: verified ${detailed.length} challan(s), but ${failedCins.length} couldn't be opened — switch back to the CAFlow tab for results. [v${EXTENSION_VERSION}]`
      : `CAFlow: verified ${detailed.length} challan(s) from Payment History — switch back to the CAFlow tab, results are there automatically. [v${EXTENSION_VERSION}]`,
    "success",
  );
}

/** Adds `days` to a yyyy-mm-dd string, returning yyyy-mm-dd. A real
 *  `Date` is fine here — this runs in the browser content-script context,
 *  not a workflow script — but the whole computation stays local (never
 *  reads the actual current date), so nothing here depends on "now". */
function addDays(yyyyMmDd, days) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTH_ABBR = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Normalizes a date string in either "DD-Mon-YYYY" (the Payment Date &
 *  Time column's own format, per a live screenshot) or "DDMMYYYY" (the CIN's
 *  own embedded OLTAS date, used only as a fallback if the display column
 *  can't be parsed) into yyyy-mm-dd, matching tds_challans.deposit_date. */
function normalizePortalDate(raw) {
  if (!raw) return null;
  const monthName = raw.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (monthName) {
    const mm = MONTH_ABBR[monthName[2].toLowerCase()];
    if (mm) return `${monthName[3]}-${mm}-${monthName[1].padStart(2, "0")}`;
  }
  const numeric = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  return null;
}

/**
 * Finds the Payment History <table> and its header cells' text, by looking
 * for a header containing "CIN" — the one label confirmed stable across
 * this portal's own real screenshots — rather than a guessed class name, so
 * this survives styling/markup changes a class-name selector wouldn't.
 * Prefers a genuine HTMLTableElement's own `.rows` collection (which always
 * correctly separates header/body rows regardless of whether the table
 * actually has explicit <thead>/<tbody> wrapper tags, unlike manually
 * querying "thead tr" which returns nothing if that wrapper is missing —
 * confirmed to be exactly what broke the first version of this scraper
 * live: the table rendered fine, this just failed to find it).
 */
function findPaymentHistoryTable() {
  const candidates = [...document.querySelectorAll("table, [role='table'], [role='grid']")].filter((t) => t.offsetParent !== null);
  for (const t of candidates) {
    const allRows = t.rows ? [...t.rows] : [...t.querySelectorAll("[role='row']")];
    if (!allRows.length) continue;
    // The header is whichever row's cells include something reading just
    // "CIN" (loosened from an exact match — a sort icon or extra
    // whitespace next to the label is plausible and shouldn't break this).
    for (const headerRow of allRows) {
      const cells = [...headerRow.querySelectorAll("th, [role='columnheader'], td, [role='cell']")];
      const texts = cells.map((c) => (c.textContent || "").trim());
      if (texts.some((c) => /^cin\b/i.test(c) && c.length <= 10)) {
        return { table: t, allRows, headerRow, headerCells: texts };
      }
    }
  }
  return null;
}

function columnIndexes(headerCells) {
  return {
    cinIdx: headerCells.findIndex((c) => /^cin\b/i.test(c) && c.length <= 10),
    amountIdx: headerCells.findIndex((c) => /amount/i.test(c)),
    dateIdx: headerCells.findIndex((c) => /payment date/i.test(c)),
  };
}

/** Reads whichever page of Payment History is CURRENTLY visible — CIN,
 *  Amount, and Payment Date per row — without navigating anywhere. Used by
 *  collectQuarterCandidates below to scan page by page. */
function readVisibleSummaryRows() {
  const found = findPaymentHistoryTable();
  if (!found) return { rows: [], reason: "no table with a CIN column found" };
  const { allRows, headerRow, headerCells } = found;
  const { cinIdx, amountIdx, dateIdx } = columnIndexes(headerCells);
  if (cinIdx === -1 || amountIdx === -1 || dateIdx === -1) {
    return { rows: [], reason: `couldn't find all needed columns among: ${headerCells.join(" | ")}` };
  }
  const rows = [];
  for (const r of allRows) {
    if (r === headerRow) continue;
    const cells = [...r.querySelectorAll("td, [role='cell'], [role='gridcell']")];
    if (cells.length <= Math.max(cinIdx, amountIdx, dateIdx)) continue; // not a data row
    const cinRaw = (cells[cinIdx]?.textContent || "").trim();
    const amountRaw = (cells[amountIdx]?.textContent || "").trim();
    const dateRaw = (cells[dateIdx]?.textContent || "").trim();
    if (!cinRaw) continue;
    const amount = parseFloat(amountRaw.replace(/[₹,\s]/g, ""));
    const depositDate = normalizePortalDate(dateRaw);
    if (!Number.isFinite(amount) || !depositDate) continue;
    rows.push({ cin: cinRaw, amount, depositDate });
  }
  return { rows };
}

// 2026-08-11 (third pass): the aria-label convention this whole paginator
// section assumed (findPaginatorNextButton / findPaginatorFirstPageButton)
// has now failed identically across two separate live runs — resetting to
// page 1 had ZERO effect on the result, which only makes sense if
// findPaginatorNextButton was ALREADY failing before that fix too, not just
// the "which page are we on" bookkeeping. Rather than guess a fourth
// aria-label variant, dump every button with ANY aria-label (or inside
// something that looks like a paginator container) the FIRST time this
// fails, so the real convention is visible directly. Guarded by a
// module-level flag so 9 near-simultaneous failures don't spam the console
// with 9 identical dumps.
let paginatorDumpLogged = false;
function dumpPaginatorButtonsOnce() {
  if (paginatorDumpLogged) return;
  paginatorDumpLogged = true;
  const near = [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && el.offsetParent !== null && /rows per page/i.test((el.textContent || "").trim()),
  );
  // Widened from the "Rows per page" label's own immediate container (which
  // came back empty — see the fourth-pass note below) to its outer
  // ancestors, several levels up, since the nav arrows and that label may
  // sit in sibling groups under a shared parent rather than one shared div.
  let scope = near;
  for (let i = 0; i < 4 && scope; i++) scope = scope.parentElement;
  const buttons = (scope ? [...scope.querySelectorAll("button")] : [...document.querySelectorAll("button")])
    .filter((b) => b.offsetParent !== null)
    .map((b) => ({ ariaLabel: b.getAttribute("aria-label"), cls: (b.className || "").toString().slice(0, 40), text: (b.textContent || "").trim().slice(0, 20), disabled: b.disabled }));
  console.log("CAFlow: every visible button near the 'Rows per page' label (widened scope) —");
  console.table(buttons);
}

/**
 * Angular Material's documented aria-label convention, AND the icon-ligature
 * text pattern already confirmed for the per-row "⋮" triggers, were BOTH
 * tried and BOTH confirmed wrong for these 4 buttons specifically
 * (2026-08-11, third and fourth pass) — dumpPaginatorButtonsOnce's widened
 * scope found exactly 4 visible buttons near the "Rows per page" label,
 * matching the visible |< < > >| layout, but every one had aria-label:null
 * AND text:"" — these render their icon as a bare SVG/CSS glyph, not a
 * ligature font, unlike the row menu buttons. What IS confirmed live: all
 * 4 share a class starting with "buttonPag" (this portal's own class, not a
 * generic Material one), and their DOM order matches the visible left-to-
 * right layout — First, Previous, Next, Last. Targets them by that class +
 * position instead, since neither text nor aria-label is available at all.
 */
function findPaginatorButtons() {
  return [...document.querySelectorAll("button[class*='buttonPag']")].filter((b) => b.offsetParent !== null);
}

function findPaginatorNextButton() {
  const buttons = findPaginatorButtons();
  const btn = buttons[2]; // First, Previous, Next, Last
  if (!btn) { dumpPaginatorButtonsOnce(); return null; }
  return btn.disabled ? null : btn; // disabled = genuinely on the last page, not a lookup failure
}

function findPaginatorFirstPageButton() {
  const buttons = findPaginatorButtons();
  const btn = buttons[0];
  if (!btn) { dumpPaginatorButtonsOnce(); return null; }
  return btn.disabled ? null : btn; // disabled = already on page 1, not a lookup failure
}

/** Resets Payment History to page 1 — the "|<" control confirmed from a
 *  live screenshot of this exact paginator. Does nothing (not an error) if
 *  already on page 1, since that button is disabled/absent there. */
async function resetToFirstPage() {
  const first = findPaginatorFirstPageButton();
  if (!first) return;
  first.click();
  await new Promise((r) => setTimeout(r, 700));
}

/** Same idea as findClickableByText, but for a dropdown's OPEN OPTIONS
 *  (Angular Material's mat-option, or a generic [role='option']) — a
 *  narrower candidate set and shorter length cap than findClickableByText,
 *  since an option label is always a short, standalone value like "100". */
function findOptionByText(pattern) {
  const candidates = [...document.querySelectorAll("[role='option'], mat-option, li, button, div, span")]
    .filter((el) => el.offsetParent !== null);
  const matches = candidates.filter((el) => {
    const text = (el.textContent || "").trim();
    return text.length <= 10 && pattern.test(text);
  });
  if (!matches.length) return null;
  return matches.find((el) => el.getAttribute?.("role") === "option" || el.tagName === "MAT-OPTION") || matches[0];
}

/**
 * Switches Payment History's "Rows per page" control to its largest option
 * (100, confirmed from a live screenshot of this exact dropdown: 05 / 10 /
 * 25 / 50 / 75 / 100) so the page-by-page scan below has far fewer pages to
 * walk — this portal showed 73 pages at the default 5 rows/page, which
 * drops to roughly 4 at 100. Best-effort: if the control can't be found or
 * clicked, collectQuarterCandidates still works, just slower (more pages).
 */
async function selectMaxRowsPerPage() {
  const label = [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && el.offsetParent !== null && /rows per page/i.test((el.textContent || "").trim()),
  );
  if (!label) { console.log("CAFlow: selectMaxRowsPerPage — no 'Rows per page' label found at all"); return false; }
  const scope = label.closest("div")?.parentElement || label.parentElement;
  const trigger = scope?.querySelector("[role='combobox'], mat-select")
    || label.parentElement?.querySelector("[role='combobox'], mat-select");
  if (!trigger) {
    // 2026-08-11: live evidence showed this silently failing (the page
    // still read "05" / "1 of 73 pages" afterward). Dump the label's own
    // nearby DOM (up 2 ancestors, each with its direct children's tag+class)
    // so the real trigger element's shape is visible instead of guessed at
    // a second time.
    const dump = [];
    let node = label;
    for (let i = 0; i < 3 && node; i++) {
      dump.push({
        level: i, tag: node.tagName, cls: (node.className || "").toString().slice(0, 60),
        childTags: [...node.children].map((c) => `${c.tagName}.${(c.className || "").toString().slice(0, 30)}`).join(", "),
      });
      node = node.parentElement;
    }
    console.log("CAFlow: selectMaxRowsPerPage — found the label but no [role='combobox']/mat-select trigger nearby —");
    console.table(dump);
    return false;
  }
  trigger.click();
  const option100 = await waitFor(() => findOptionByText(/^100$/), 3_000);
  if (!option100) {
    console.log("CAFlow: selectMaxRowsPerPage — clicked the trigger but no '100' option appeared");
    return false;
  }
  option100.click();
  await new Promise((r) => setTimeout(r, 800)); // let the table reflow at the new page size
  return true;
}

/**
 * Scans Payment History page by page (fast — reading the summary table
 * only, no per-row navigation) collecting rows whose date falls within
 * [fyStartDate, fyEndDate]. Relies on the list being sorted newest-first
 * (confirmed live) to stop as soon as an entire page is older than the
 * range start, rather than walking all of a TAN's history — this portal
 * showed 73 pages live, and this quarter's data should only ever be in the
 * first handful. Switches to 100 rows/page FIRST (see selectMaxRowsPerPage)
 * so even that "first handful" of pages is as small as possible.
 */
async function collectQuarterCandidates(fyStartDate, fyEndDate, maxPages) {
  await selectMaxRowsPerPage();
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const pageResult = await waitFor(() => {
      const r = readVisibleSummaryRows();
      return r.rows.length || r.reason ? r : null;
    }, 8_000);
    if (!pageResult) return { rows: [], reason: "timed out waiting for the Payment History table to render" };
    if (pageResult.reason) return { rows: [], reason: pageResult.reason };

    for (const r of pageResult.rows) {
      if (!fyStartDate || !fyEndDate || (r.depositDate >= fyStartDate && r.depositDate <= fyEndDate)) rows.push(r);
    }
    // Sorted newest-first: once every row on this page is older than the
    // range start, nothing on a later page can be in range either.
    if (fyStartDate && pageResult.rows.length && pageResult.rows.every((r) => r.depositDate < fyStartDate)) break;

    const next = findPaginatorNextButton();
    if (!next) break; // last page
    next.click();
    await new Promise((r) => setTimeout(r, 700)); // let the next page's rows render
  }
  return { rows };
}

/** Finds a specific row's own "⋮" (more options) trigger — same shape
 *  reasoning as the old findRowActionTrigger (icon-only, ≤40px, last cell),
 *  generalized here to take a row instead of always picking the first one,
 *  since each candidate challan needs its OWN menu opened. */
function findRowMenuTrigger(row) {
  const cells = row.querySelectorAll("td, [role='cell'], [role='gridcell']");
  if (!cells.length) return null;
  const lastCell = cells[cells.length - 1];
  const candidates = lastCell.querySelectorAll("button, [role='button'], a, svg, [class*='icon' i]");
  for (const el of candidates) {
    if (el.offsetParent === null) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.width > 40 || rect.height > 40) continue;
    const text = (el.textContent || "").trim();
    if (text.length > 3) continue;
    return el.closest("button, [role='button'], a") || el;
  }
  return null;
}

function findRowByCin(cin) {
  const found = findPaymentHistoryTable();
  if (!found) return null;
  const { cinIdx } = columnIndexes(found.headerCells);
  if (cinIdx === -1) return null;
  return found.allRows.find((r) => {
    if (r === found.headerRow) return false;
    const cells = r.querySelectorAll("td, [role='cell'], [role='gridcell']");
    return cells[cinIdx] && (cells[cinIdx].textContent || "").trim() === cin;
  }) || null;
}

/**
 * Re-locates the row for a specific CIN, opens its "⋮" menu, and clicks
 * "View Details". Returns false (never throws) if any step doesn't find
 * what it's looking for, so the caller can skip this one challan and
 * continue with the rest rather than aborting the whole run.
 *
 * 2026-08-11: Payment History always resets to PAGE 1 after the
 * Back -> Act-Selection -> Continue round-trip (see returnToPaymentHistory's
 * own doc) — confirmed live it does NOT preserve whatever page a later
 * candidate might be sitting on. Pages forward (same Next-page control
 * collectQuarterCandidates already uses) looking for this specific CIN
 * before giving up, capped well under the 73-page total seen live since a
 * quarter's own challans cluster near the top of a newest-first list.
 *
 * 2026-08-11 (second pass): live diagnostics showed every failure stopping
 * after searching exactly ONE page — Stage 1 (collectQuarterCandidates)
 * itself pages FORWARD to build the candidate list and never returns to
 * page 1 afterward, so by the time this function's first call runs, the
 * browser is sitting wherever Stage 1 left off — anywhere from page 1 to
 * however many pages it took to cover the quarter. This function can only
 * go forward, so any candidate whose row sat on an EARLIER page than that
 * could never be found. Explicitly resets to page 1 first (the "|<"
 * control, findPaginatorFirstPageButton) so every search starts from the
 * same known position instead of wherever a previous call happened to
 * leave the paginator.
 */
async function openViewDetailsForCin(cin, maxPages = 20) {
  await resetToFirstPage();
  let row = null;
  let pagesSearched = 0;
  for (let page = 0; page < maxPages; page++) {
    pagesSearched = page + 1;
    row = findRowByCin(cin);
    if (row) break;
    const next = findPaginatorNextButton();
    if (!next) break;
    next.click();
    await new Promise((r) => setTimeout(r, 700));
  }
  if (!row) {
    console.log(`CAFlow: openViewDetailsForCin(${cin}) — row not found after searching ${pagesSearched} page(s)`);
    return false;
  }
  const trigger = findRowMenuTrigger(row);
  if (!trigger) {
    console.log(`CAFlow: openViewDetailsForCin(${cin}) — found the row (page ${pagesSearched}) but no "⋮" trigger in its last cell`);
    return false;
  }
  trigger.click();
  await new Promise((r) => setTimeout(r, 400));
  const viewDetails = await waitFor(() => findClickableByText(/^view details$/i), 3_000);
  if (!viewDetails) {
    console.log(`CAFlow: openViewDetailsForCin(${cin}) — clicked the "⋮" menu but "View Details" never appeared`);
    return false;
  }
  viewDetails.click();
  await new Promise((r) => setTimeout(r, 600));
  return true;
}

/** Finds the value associated with a labeled field on the Challan Receipt
 *  page (e.g. "BSR code" -> "6390031") by locating a short leaf element
 *  whose own text matches the label, then reading whichever of its own
 *  next sibling / parent's next sibling actually has text — the Challan
 *  Receipt's own layout stacks a muted label directly above its value, per
 *  a live screenshot, but the exact wrapper nesting wasn't confirmed, so
 *  this tries the two most likely shapes rather than assuming one. */
function findLabeledValue(labelPattern, excludePattern) {
  const leaves = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.offsetParent !== null);
  for (const el of leaves) {
    const text = (el.textContent || "").trim();
    if (text.length > 40 || !labelPattern.test(text)) continue;
    if (excludePattern && excludePattern.test(text)) continue;
    const fromSibling = (el.nextElementSibling?.textContent || "").trim();
    if (fromSibling) return fromSibling;
    const parent = el.parentElement;
    const fromParentSibling = (parent?.nextElementSibling?.textContent || "").trim();
    if (fromParentSibling) return fromParentSibling;
  }
  return null;
}

/** Scrapes the authoritative fields off a Challan Receipt ("View Details")
 *  page — BSR code, Challan Number, Date of Payment, Amount, and CIN — all
 *  explicitly labeled, confirmed from a live screenshot of this exact page,
 *  rather than parsed out of a packed CIN string. Returns null if the page
 *  doesn't look like a Challan Receipt at all (e.g. a slow load, or the
 *  portal's own layout differs from the one screenshot this was built
 *  against). */
function scrapeChallanReceiptDetail() {
  const bsrCode = findLabeledValue(/^bsr code$/i);
  const challanNumber = findLabeledValue(/^challan number$/i);
  const dateOfPaymentRaw = findLabeledValue(/^date of payment$/i);
  const amountRaw = findLabeledValue(/^amount/i, /word/i);
  const cin = findLabeledValue(/^cin$/i);
  if (!bsrCode || !challanNumber || !dateOfPaymentRaw || !amountRaw) return null;
  const depositDate = normalizePortalDate(dateOfPaymentRaw);
  const amount = parseFloat((amountRaw || "").replace(/[₹,\s]/g, ""));
  if (!depositDate || !Number.isFinite(amount)) return null;
  return { serialNo: challanNumber.trim(), depositDate, amount, bsrCode: bsrCode.trim(), cin: cin || null };
}

/** Selects "Income-tax Act, 2025" on the Act-Selection interstitial by
 *  POSITION (it's always listed first, per every screenshot of this page
 *  seen so far) rather than by matching its own label text — that text is
 *  already known to break findClickableByText's 60-char cap, since the
 *  label sits directly above a full description sentence that gets counted
 *  as the same text node (see the navigation steps' own "fourth pass" doc,
 *  earlier in this file, for the original discovery of that exact issue). */
function selectIncomeTaxAct2025() {
  const radios = [...document.querySelectorAll("input[type='radio'], mat-radio-button, [role='radio']")].filter((r) => r.offsetParent !== null);
  if (!radios.length) return false;
  const first = radios[0];
  (first.closest("mat-radio-button, [role='radio']") || first).click();
  return true;
}

/**
 * Returns from a Challan Receipt page to the Payment History list — NOT a
 * single step. Confirmed live (2026-08-11): the page's own "‹ Back" button
 * does not land back on Payment History directly — it goes back to the
 * Act-Selection interstitial (the same page e-File -> e-Pay Tax always
 * shows first), and it can default to "Income-tax Act, 1961" rather than
 * "2025" this time (unlike the very first entry into e-Pay Tax, which
 * always defaults to 2025 per every earlier screenshot) — so this
 * explicitly re-selects 2025 rather than trusting the default, then clicks
 * Continue again, then re-clicks the Payment History tab in case that also
 * doesn't carry over from before Back was clicked.
 */
async function returnToPaymentHistory() {
  const backBtn = findClickableByText(/back/i);
  if (backBtn) { backBtn.click(); } else { history.back(); }
  await new Promise((r) => setTimeout(r, 600));

  if (!findPaymentHistoryTable()) {
    const actRadioShowing = await waitFor(() => {
      const radios = document.querySelectorAll("input[type='radio'], mat-radio-button, [role='radio']");
      return [...radios].some((r) => r.offsetParent !== null) ? true : null;
    }, 5_000);
    if (actRadioShowing) {
      selectIncomeTaxAct2025();
      await new Promise((r) => setTimeout(r, 300));
      const continueBtn = await waitFor(() => findClickableByText(/^continue\b/i), 5_000);
      if (continueBtn) {
        continueBtn.click();
        await new Promise((r) => setTimeout(r, 900));
      }
    }
  }

  if (!findPaymentHistoryTable()) {
    const paymentHistoryTab = await waitFor(() => findClickableByText(/payment history/i), 8_000);
    if (paymentHistoryTab) {
      paymentHistoryTab.click();
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  await waitFor(() => findPaymentHistoryTable(), 8_000);
  await new Promise((r) => setTimeout(r, 300));
}

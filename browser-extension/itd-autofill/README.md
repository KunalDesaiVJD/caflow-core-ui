# CAFlow — ITD Portal Autofill (browser extension)

Fills the Income Tax e-Filing login using the client credentials already
saved in CAFlow's "ITD (e-Filing) Login ID" / "ITD (e-Filing) Password"
fields (Edit Client → Services → Portal Login Credentials) — the exact value
saved there, whatever it is (PAN, Aadhaar, or another registered User ID;
CAflow doesn't assume or validate which) — then confirms the Secure Access
Message and submits. Stops only if a CAPTCHA or OTP screen appears next.

## What this is NOT

This is a genuinely separate artifact from the CAFlow web app — a browser
extension, not part of the Vite/React build. It only exists locally on each
person's machine (see Install below); it is not deployed, published, or
auto-updated. There is no Chrome Web Store listing.

## Scope (v0.2 — widened 2026-08-06, explicit firm decision)

- **ITD (incometax.gov.in) only.** TRACES autofill is not built yet — the
  "Copy Login ID" / "Copy Password" flow in CAFlow still works for it, as it
  always has.
- Fills Login ID → Continue → fills Password → ticks the **Secure Access
  Message confirmation checkbox** → clicks the second Continue, which
  **submits the password**. It stops there — it never touches a CAPTCHA/OTP
  field if the portal shows one after this.
- **On the Secure Access Message checkbox**: this is a real anti-phishing
  control, not a mechanical step. At registration, the account holder picks
  a personal message; this screen shows it back and asks them to confirm
  it's theirs — proving they're on the genuine portal, not a spoofed clone
  that wouldn't know the message. Auto-checking it without a human actually
  reading that message defeats its purpose. This was explicitly flagged
  before building it, and the automation was requested anyway — recorded
  here, and in `content-itd.js`'s own header comment, so that tradeoff stays
  visible to whoever reads this next, not just in a chat log.
- If the ITD portal's page structure has changed since this was built and a
  field can't be found, you'll see a banner on the portal page saying exactly
  what happened — it never fails silently.

## Install (developer mode — one-time, per person)

1. Open `chrome://extensions` (or the equivalent in Edge/Brave — any
   Chromium-based browser).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder: `browser-extension/itd-autofill/`.
5. Confirm it's enabled. No further setup needed — it activates
   automatically on the CAflow app and on the ITD portal.

To pick up a change after this folder is edited, click the refresh icon on
the extension's card at `chrome://extensions` — Chrome does not auto-reload
unpacked extensions.

## How it works

1. In CAFlow, clicking "Auto-fill ITD Login" (only shown once this extension
   is detected) fetches the client's saved ITD credentials the same way
   "Copy Password" already does, then hands them to the extension via
   `window.postMessage` — never written to a URL, console log, or anywhere
   persistent on the CAFlow side.
2. The extension holds them in `chrome.storage.session` only (cleared when
   the browser closes; never written to disk) for at most 2 minutes, and
   they're consumed and erased the instant the ITD tab reads them — a second
   tab or a page reload never replays the same saved password.
3. On the ITD portal tab, the extension fills Login ID, clicks Continue,
   fills Password, ticks the Secure Access Message checkbox, and clicks the
   final Continue — which submits the login.

## Verified (2026-08-06)

Every selector this script uses was confirmed directly against the live
portal, including a real account reaching the actual password screen — the
Login ID field, both Continue buttons, the password field
(`#loginPasswordField`), and the confirmation checkbox (the page's only
`input[type="checkbox"]`, disabled-Continue gate confirmed to require both
it and a non-empty password). All fills use the native value setter +
`input`/`change` events (or `.click()` for the checkbox/buttons) so
Angular's own form validation actually registers the change — plain
`.value =` would leave Continue permanently disabled.

v0.1.2 also widened the credential-poll window from ~1.2s to ~12s, closing
a timing race where a slow edge-function cold start could beat the old
short retry window and leave the field unfilled with no visible error.

Not yet verified end-to-end with a REAL password (only the User ID step was
tested against a live account; the password/checkbox/submit steps were
verified structurally — selectors exist, disabled-state logic confirmed —
but never actually exercised with a real submission, deliberately, to avoid
touching a real account's login state during development). If anything
after the password field doesn't behave as expected, the on-page banner
will say exactly what it could and couldn't do — please report its exact
text.

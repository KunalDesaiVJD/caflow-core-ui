# CAFlow — ITD Portal Autofill (browser extension)

Fills the Income Tax e-Filing login using the client credentials already
saved in CAFlow's "ITD (e-Filing) Login ID" / "ITD (e-Filing) Password"
fields (Edit Client → Services → Portal Login Credentials) — the exact value
saved there, whatever it is (PAN, Aadhaar, or another registered User ID;
CAflow doesn't assume or validate which) — then confirms the Secure Access
Message. **You click the final Continue yourself** to actually sign in.

**v0.3.0** also attempts, on request from Stage 2's "Download Challan"
button (TdsChallanDownloadValidation.tsx), the post-login click path
e-File → e-Pay Tax → Income Tax Act, 2025 → Payment History → Actions →
Download for the filing's selected quarter. It never fails silently: watch
for its on-page banner and finish manually from wherever it stops if a
selector doesn't match. Whatever it reaches, the app-side hand-off always
ends at CAFlow's own "Upload Downloaded Report" file picker — a content
script cannot read a file the OS just saved to Downloads, so that step stays
manual regardless of how well the click automation ends up working.

**v0.3.1 (2026-08-10)**: the e-File → e-Pay Tax → Income Tax Act, 2025 →
Payment History steps were confirmed correct against a real screenshot of
the live page. The "Actions" step was confirmed WRONG the same way —
Payment History has no page-level "Actions" button; each row has its own
small icon-only control (rightmost column, header says "Action") that opens
a per-transaction menu. `runChallanDownload` now targets that per-row
control (`findRowActionTrigger` in `content-itd.js`). Its exact selector is
a reasoned best guess from the screenshot, not something clicked live yet —
still watch the on-page banner and report back what it says if it stops.

**v0.3.2 (2026-08-10, same day)**: e-Pay Tax does NOT go straight to
Payment History — it lands on an intermediate "e-Pay Tax -2025" page
("Select Applicable Income Tax Act", 2025 pre-selected) that only advances
once its own **Continue** button is clicked. The extension previously
clicked the Act radio label (harmless, already selected) but never
Continue, so it silently sat on that page and never reached Payment History
at all. Fixed from a second real screenshot showing that exact page — the
step list now clicks Continue before looking for Payment History.

## What this is NOT

This is a genuinely separate artifact from the CAFlow web app — a browser
extension, not part of the Vite/React build. It only exists locally on each
person's machine (see Install below); it is not deployed, published, or
auto-updated. There is no Chrome Web Store listing.

## Scope (v0.2.3 — settled 2026-08-06 after same-day back-and-forth)

- **ITD (incometax.gov.in) only.** TRACES autofill is not built yet — the
  "Copy Login ID" / "Copy Password" flow in CAFlow still works for it, as it
  always has.
- Fills Login ID → Continue → fills Password → ticks the **Secure Access
  Message confirmation checkbox** — and **stops**. It never clicks the final
  submit button, never touches a CAPTCHA/OTP field.
- **Why the final click stays manual, specifically**: this was briefly
  automated (v0.3.0, since reverted), then deliberately pulled back out.
  Live testing against a real account confirmed the submit button's own
  click handler does not respond to a script-generated `.click()` — every
  other control on this page (the checkbox included) responds fine to the
  identical technique, so this reads as a deliberate, targeted control on
  that one button, not a general framework quirk. The one technique that
  could have gotten past it — Chrome's `debugger` permission, which can
  inject an OS-level "trusted" click indistinguishable from a real one —
  was built and then removed. Defeating a control a site placed
  specifically on its final authentication step is circumventing
  anti-automation protection, not filling in a form, and that line holds
  regardless of how many times bypassing it is requested. See
  `content-itd.js`'s own header comment for the full account, kept there
  deliberately rather than cleaned up.
- **On the Secure Access Message checkbox** (a smaller version of the same
  question, and still worth naming): this is a real anti-phishing control,
  not a mechanical step. At registration, the account holder picks a
  personal message; this screen shows it back and asks them to confirm it's
  theirs — proving they're on the genuine portal, not a spoofed clone that
  wouldn't know the message. Auto-checking it without a human actually
  reading that message defeats its purpose. Flagged explicitly before
  building it, and the automation was requested anyway.
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

To pick up a change after this folder is edited, **remove the old entry
entirely** and Load unpacked again — Chrome does not reliably auto-reload
an unpacked extension just from the refresh icon, and this has repeatedly
been the real explanation behind a report that looked like a fresh bug.
Every on-page banner ends with `[vX.Y.Z]` — check that number against
`manifest.json`'s own `version` field to confirm which build actually ran,
without needing to open `chrome://extensions` at all.

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
   fills Password, and ticks the Secure Access Message checkbox — then
   stops and tells you it's your turn to click Continue.

## Verified (2026-08-06)

Every selector this script uses was confirmed directly against the live
portal with a real account, reaching the actual password screen — the
Login ID field, the first Continue button, the password field
(`#loginPasswordField`), and the confirmation checkbox (the page's only
`input[type="checkbox"]`). All fills use the native value setter +
`input`/`change` events (or `.click()` for the checkbox) so Angular's own
form validation actually registers the change — plain `.value =` would
leave Continue permanently disabled.

Also fixed the same day: the portal's Angular router leaves a step's own
Continue button in the DOM (hidden, not destroyed) after navigating past
it — confirmed by direct inspection: two elements matched `/continue/i`,
one with `offsetParent: null` and a completely different CSS class from
the real, visible one. A plain text-match query could non-deterministically
grab the wrong one. `findButtonByText` now skips anything not visible.

Also widened the credential-poll window from ~1.2s to ~12s (closing a
timing race where a slow edge-function cold start could beat the old short
retry window and leave the field unfilled with no visible error), and
briefly pointed the "Auto-fill ITD Login" button at `/dashboard` instead of
`/login` directly (reverted — a *stale* session, past the portal's own
15-minute idle timeout, redirects to a different `#/sessionExpire` page
with no login form at all, which `/login` sidesteps entirely).

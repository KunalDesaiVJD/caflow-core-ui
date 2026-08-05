# CAFlow — ITD Portal Autofill (browser extension)

Fills the Income Tax e-Filing login (Login ID, then Password) using the
client credentials already saved in CAFlow's "ITD (e-Filing) Login ID" /
"ITD (e-Filing) Password" fields (Edit Client → Services → Portal Login
Credentials) — the exact value saved there, whatever it is (PAN, Aadhaar, or
another registered User ID; CAflow doesn't assume or validate which). Stops
right before the CAPTCHA/OTP step — that, and clicking the final Sign In
button, stay manual on purpose.

## What this is NOT

This is a genuinely separate artifact from the CAFlow web app — a browser
extension, not part of the Vite/React build. It only exists locally on each
person's machine (see Install below); it is not deployed, published, or
auto-updated. There is no Chrome Web Store listing.

## Scope (v0.1)

- **ITD (incometax.gov.in) only.** TRACES autofill is not built yet — the
  "Copy Login ID" / "Copy Password" flow in CAFlow still works for it, as it
  always has.
- Fills Login ID → clicks Continue → fills Password → **stops**. It never
  touches a CAPTCHA/OTP field and never clicks the final Sign In button.
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
3. On the ITD portal tab, the extension fills the two fields and stops.

## Verified (2026-08-06)

Both selectors were confirmed directly against the live portal — the User ID
field (step 1) and the `input[type="password"]` field (step 2, which appears
on `/login/password` after Continue) both exist and were successfully filled
via the same technique this script uses (native value setter + `input`/
`change` events, so the Angular form actually registers the value — plain
`.value =` would leave the Continue/Login button disabled).

Not yet verified: the extension's own end-to-end relay (CAflow tab → this
tab) against a real account from click to a filled password field — v0.1.2
widened the credential-poll window from ~1.2s to ~12s to remove a timing
race that could plausibly explain "field never got filled" reports (an
edge-function cold start taking longer than the old short retry window). If
it's still not filling after this, the on-page banner will say so — please
report the exact banner text (or note that no banner appeared at all, which
narrows it down differently) so the next fix targets the right piece.

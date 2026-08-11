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

**v0.3.3 (2026-08-10, same day)**: "Download Challan" was reported as
"stuck at the dashboard" after logging in — the real bug was upstream of
the click-path itself. The request to start the automation used to be a
one-shot browser message fired the instant the button was clicked, before
content-itd.js had even been injected into the freshly-opened ITD tab, and
with no way to wait for the human login that follows — so it was very
often simply lost, silently, well before the user ever saw the login page.
Fixed the same way the credential handoff already works: the request is
now stored (`chrome.storage.session`) and content-itd.js polls for it
(up to 5 minutes) so it fires reliably once login is actually done,
whenever that happens to be.

**v0.3.4 (2026-08-11)**: with the request no longer getting lost, a real
run confirmed the NEXT stuck point live: it reached e-Pay Tax fine, then
banner'd "couldn't find Income Tax Act, 2025" and gave up. Root cause:
`findClickableByText`'s own 60-char cap (there to avoid grabbing an
oversized container div) very likely excludes this radio's label once its
adjacent description sentence ("TDS/TCS payments for Tax Year 2026-27 and
onwards.") is counted as part of the same text node. Dropped the click
entirely rather than patch the selector — Income-tax Act, 2025 is
pre-selected by default anyway (confirmed from a real screenshot of this
page), so the click was always harmless-but-redundant, never load-bearing.

**v0.3.5 (2026-08-11)**: live-verified against a real logged-in session —
e-File → e-Pay Tax was already correct; the NEXT stuck point was "couldn't
find Continue" on the Act-selection page. A real screenshot showed why:
that button's own text is "Continue ›" (a trailing chevron, same as the
login flow's two Continue buttons), which fails the exact-text
`/^continue$/i` match `runChallanDownload`'s step list used, while the
login flow's own `findButtonByText(/continue/i)` — no anchors — already
matches "Continue" successfully twice over. Relaxed the Continue step to
the same loose pattern instead of guessing at a new one. Also captured a
real screenshot of the actual Payment History table this run, confirming
its columns (CIN, Bank Reference Number, Tax Year, Type of Payment,
Amount, Payment Date & Time, Action) and that the rightmost "Action"
column is cut off in a normal-width window — `findRowActionTrigger`'s
per-row icon-only targeting is still unconfirmed live past this point.

**v0.3.6 (2026-08-11)**: with v0.3.5's Continue fix live-verified, the next
stuck point was "couldn't find Payment History" right after Continue.
Live-inspected the real e-Pay Tax dashboard DOM through the browser console
(same candidate selector, visibility check, 60-char cap, and pattern
`findClickableByText` itself uses) and found four clean, exact "Payment
History" matches — ruling out a text/selector bug entirely. Most likely
cause: Continue navigates to a dashboard that has to fetch real payment
records from the government backend before it renders, which can outrun the
previous uniform 10s wait. Gave each step in `runChallanDownload`'s own list
its own timeout instead of one shared value, and widened just this step's to
25s, leaving the cheaper nav clicks at 10s so a genuine break there still
fails fast.

**v0.3.7 (2026-08-11)**: found the real root cause behind every "couldn't
find X" banner in this flow so far — not a selector bug, not a slow data
fetch. `runChallanDownload` started hunting for "e-File" the instant the
queued download request was found, with no check that login had actually
finished. Login's own final Continue click is deliberately manual (see this
file's header doc), so the click-path was racing the human, not following
them — confirmed live from a screenshot showing the "couldn't find e-File"
banner sitting directly on top of the still-visible, not-yet-submitted login
page. Every later-step failure in earlier versions was very likely the same
race with luckier timing, not the timeout or selector issues those versions
"fixed." Added a real wait (up to 5 minutes, human-paced) for the URL to
actually reach `#/dashboard` before the click-path starts.

**v0.3.8 (2026-08-11)**: with the login-race fix (v0.3.7) confirmed working
live, "couldn't find Payment History" still happened — but the address bar
at that point was still bare `#/dashboard`, not the real
`#/dashboard/e-pay-tax/e-pay-tax-dashboard` route a successful run reaches.
That means an earlier step is reporting success without producing the
navigation it should, and a single pass/fail banner can't say which one.
Added per-step logging to `window.__caflowStepLog` — each entry records
whether the step's target was found, its tag/text, and the URL hash right
before and after the click — readable straight from the console (`console.
table(window.__caflowStepLog)`) instead of needing another manual trace
script pasted in.

**v0.3.9 (2026-08-11)**: v0.3.8's `window.__caflowStepLog` read back
`undefined` even from the exact right tab. Root cause: this content script
runs in Chrome's default ISOLATED WORLD — a separate JS global scope from
the page's own, sharing only the DOM. Setting a property on this script's
`window` never touches the page's `window`, which is what DevTools Console
reads from by default when you type a command — two different objects both
named `window`. Switched to calling `console.table` directly from inside
the content script instead (console output isn't world-scoped the same
way, so it still lands in the same visible panel) — the step table now
prints itself automatically the moment a run finishes or fails, no command
needed.

**v0.3.10 (2026-08-11)**: with v0.3.9's step logging finally readable, a
real run caught the bug directly — the "Continue" step's loose
`/continue/i` match clicked a `<div>` reading "× Continue Session…", the
portal's own session-timeout warning popup, instead of the Act-selection
page's real "Continue ›" button. Dismissing that popup advances nothing,
which is why "Payment History" always came up empty right after. Re-anchored
the pattern to `/^continue\s*[›»>]?\s*$/i` — matches "Continue" / "Continue
›" exactly (with optional trailing arrow/whitespace) but not "× Continue
Session" or any other button with extra words around "Continue".

**v0.3.11 (2026-08-11)**: v0.3.10's end-anchored Continue pattern (only
accepting a specific chevron character after the word) came back "not
found" — the real button's exact trailing character was never actually
confirmed character-for-character. Dropped the end anchor; kept the start
anchor + word boundary, since that's what the step log proved was doing the
real work (excluding the session-timeout popup's "× Continue Session",
which fails to match because it starts with "×", not "Continue").

**v0.3.12 (2026-08-11)**: two Continue-pattern guesses in a row (v0.3.10's
end-anchored version, v0.3.11's start-anchored version) both came back "not
found" — enough guessing from screenshots. On any step failure, this
version now also dumps every visible element whose text loosely contains
that step's first word (tag, full text, length) via `console.table`, so the
real candidate set is visible directly instead of inferred again.

**v0.3.13 (2026-08-11)**: v0.3.12's full-candidate dump showed the real
problem was upstream of "Continue" entirely — the URL was still bare
`#/dashboard` at the moment it failed, meaning the earlier "e-Pay Tax" click
(which reported success) never actually navigated anywhere.
`findClickableByText`'s candidate selector includes bare `span`/`div` so it
can match a menu item's inner text label instead of its real clickable
wrapper (`<a>`/`<li>`/`[role=menuitem]`) — clicking that inner label doesn't
reliably fire Angular's own navigation handler. Now climbs to the nearest
real clickable ancestor via `closest()` before clicking, the same fix
`findRowActionTrigger` already applies for the Payment History row icon.

**v0.3.14 (2026-08-11)**: v0.3.13's ancestor-climb fixed "e-File" (a real
`<a>`) but "e-Pay Tax" still only matched a bare `<span>` — live-inspected
its real ancestor chain and found why: the e-File menu is Angular Material
(`mat-menu`), and its actual clickable host is a plain
`<div class="mat-mdc-menu-item...">` one level up — no `role="menuitem"`,
not a button, not an `<a>`, so nothing in the previous ancestor selector
could ever match it. Added a class-based fallback (`[class*='menu-item']`)
checked first, specifically for this Material convention.

**v0.3.15 (2026-08-11)**: v0.3.14's ancestor-climb was correct but "e-Pay
Tax" still resolved to a bare span — a timing race, not a selector bug.
"e-File" opens an Angular Material menu with its own brief open animation;
the text can exist in the DOM before its wrapping `mat-mdc-menu-item` class
is actually applied, and `waitFor` resolves on the first truthy result, so
it can latch onto the not-yet-ready span before the animation settles.
Widened the delay specifically after the "e-File" step (900ms vs the other
steps' 400ms) so polling only starts once the menu's real DOM is stable.

**v0.3.16 (2026-08-11)**: v0.3.15's 900ms animation-settle delay did NOT
fix "e-Pay Tax" resolving to a bare span — same symptom, so timing wasn't
the actual cause. Added a diagnostic that fires whenever a step resolves to
a non-interactive element (span/div): it dumps every element that exactly
matches that step's pattern (not just the first found), each with its own
class and 3-level ancestor chain, printed to the console right before the
click happens. This directly exposes whether there are multiple matching
elements (e.g. a stale duplicate Angular's router left behind — the same
category of bug this file already found once for "Continue" buttons)
instead of guessing at a fifth fix.

**v0.3.17 (2026-08-11)**: v0.3.16's diagnostic caught a different symptom
on a different run — zero elements containing "e-pay" anywhere on the page
right after clicking "e-File," not a wrong-element match. "e-File" is a
toggle (click opens it, click again closes it) on a page that never fully
reloads between attempts; if it was already open for any reason when a
fresh run started, one blind click would close it instead of opening it.
Replaced the single click with an open-and-verify loop: click, check the
menu actually opened by testing for "e-Pay Tax," and if not, click again
(undoing an accidental close) — up to 3 tries.

**v0.3.18 (2026-08-11)**: the full candidate dump for "e-Pay Tax" proved a
real `<button class="mat-mdc-menu-item...">` exists among the matches —
Angular Material's actual menu-item element — yet the step log kept
reporting a bare span. Root cause: `findClickableByText` returned on the
first match in DOCUMENT ORDER, which isn't the same as the most correct
element, and a nested span can precede its own button ancestor in the
NodeList in ways the selector string's ordering doesn't control. Rewrote it
to collect every match first, then explicitly rank a real button/link/li
above a bare span/div, instead of trusting whichever happened to come first.

**v0.4.0 (2026-08-11)**: with navigation to Payment History confirmed
working live (v0.3.18), the download/upload flow was replaced entirely per
explicit instruction — no file gets downloaded any more. `content-itd.js`
now reads the Payment History table directly (`scrapePaymentHistoryTable`),
parsing each row's CIN into BSR code + challan serial (OLTAS convention:
7-digit BSR + 8-digit deposit date + up to 5-digit serial, concatenated),
and relays the rows back to the CAFlow tab — the OPPOSITE direction from
every other relay in this extension — via a new
STORE/GET_CHALLAN_SCRAPE_RESULT pair in `background.js`, polled by
`content-caflow.js` and posted into the page as
`CHALLAN_PAYMENT_HISTORY_RESULT`. CAFlow's own `TdsChallanDownloadValidation.
tsx` runs the SAME per-challan matching (date, amount, BSR, serial) the old
PDF-upload path used, now fully automatic. Pagination on Payment History is
UNCONFIRMED — only the currently-visible page's rows are read; flag this if
a quarter's challan count exceeds what fits on one page.

**v0.4.1 (2026-08-11)**: rebuilt per explicit instruction — the summary
table's CIN string alone wasn't the plan; each candidate challan's own
"⋮" → "View Details" page has BSR code, Challan Number, Date of Payment,
and Amount explicitly labeled (confirmed from a live screenshot of that
exact page), so this now opens that page per challan instead of parsing
CIN. Also discovered live that Payment History shows this TAN's ENTIRE
history (73 pages @ 5 rows in one real account), not scoped to a quarter —
added a Stage 1 fast summary-table scan (relying on the newest-first sort
order, confirmed live, to stop scanning once dates fall below the quarter's
start) so only in-range challans get their detail page opened, capped at 30
as a safety net regardless. UNVERIFIED FIRST PASS: the per-row "⋮" trigger,
the "View Details" menu item, the Challan Receipt's labeled-field layout,
and the "‹ Back" return button are all reasoned from live screenshots, not
yet clicked through end to end — expect this to need the same live-console
iteration the navigation steps above needed.

**v0.4.2 (2026-08-11)**: v0.4.1 correctly verified the FIRST candidate
challan live (BSR/Challan Number/Date/Amount all read correctly), but
couldn't open the second — confirmed live why: the Challan Receipt's "‹
Back" button does not return straight to Payment History, it lands back on
the Act-Selection interstitial, and can default to "Income-tax Act, 1961"
rather than "2025" this time. `returnToPaymentHistory` now explicitly
handles that round-trip: select "Income-tax Act, 2025" by POSITION (its
label text is already known to break the 60-char match cap — see the
navigation steps' own history further up this file), click Continue, then
re-click the Payment History tab. Also fixed `openViewDetailsForCin` to
re-paginate forward when looking for a later candidate, since Payment
History resets to page 1 after that same round-trip.

**v0.4.3 (2026-08-11)**: v0.4.2 verified its first 2 candidates correctly
end to end (confirmed live in CAFlow's own match results), but the user
wanted every office challan checked, and pointed out the fix directly:
switch "Rows per page" from the default 05 to 100 first (confirmed live —
that dropdown really does offer 05/10/25/50/75/100), cutting the 73-page
scan down to roughly 4 pages. Added `selectMaxRowsPerPage`, called at the
start of `collectQuarterCandidates` before any page-scanning begins.

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

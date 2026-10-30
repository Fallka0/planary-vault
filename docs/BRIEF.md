# Planary Vault — BRIEF

Read this first. Everything Claude Code needs to build Planary Vault is in this folder.

Every design decision is taken from planary.ch (Tournament, Wishlist, /preise). If something isn't covered here, copy what planary.ch does. Don't invent new patterns.

## What's in the folder

```
BRIEF.md                  this file: the spec
screens/png/              every screen and state, @2x (mobile @3x). The visual source of truth.
screens/html/             the same screens as static HTML. Open in a browser, inspect spacing, copy markup.
design-source/            original design files from the canvas (.dc.html + canvas.json), for reference only
assets/logo/              planet mark (SVG), lockups (SVG + PNG), app icon, favicons
assets/fonts/             Unbounded + Manrope (woff2, OFL licence) + fonts.css
tokens/tokens.css         CSS variables (colors, type, radius, sizes, motion)
tokens/tokens.json        the same tokens as JSON
tokens/motion.css         ready-to-use animation classes
```

## Screen index

| File | Screen |
|---|---|
| 01-setup-passphrase | First visit: create passphrase |
| 02 / 02b-setup-recovery-key | First visit: recovery key (unchecked / confirmed) |
| 03-unlock | Locked vault |
| 04 / 04b-dashboard | All files, list and grid view |
| 05-upload-drop-and-queue | Drop overlay with the upload queue (encrypting, uploading, failed, done, waiting) |
| 06-empty-vault | Empty state |
| 07-search-no-results | Search, no results |
| 08 / 08b / 08c-file | File detail: Details, Versions, Activity tabs |
| 09-file-decrypting | File being decrypted |
| 10-share-dialog | Share with people or by link, plus active shares |
| 11-link-expired | Public link page, expired |
| 12 / 12b / 12c-settings | Settings: Security, Account, Storage |
| 13-mobile-dashboard | 390 px |
| 14-mobile-file-preview | 390 px |
| 15-logo | Logo sheet |
| 16-motion | Motion tokens (one frame of the looping demos) |
| 17-planary-ch-vault | Product page `planary.ch/vault` |
| 18 / 18b-pricing | Pricing page `planary.ch/vault/pricing`, monthly and yearly |

The static HTML uses inline styles because that's how the design tool stores them. **Don't copy inline styles into the app.** Rebuild with components and `tokens/tokens.css` (Tailwind, CSS modules, whatever the repo already uses). Match the PNGs to the pixel.

## Suggested build order

1. Tokens, fonts and `motion.css` → base layout, buttons, inputs, chips, panels.
2. Auth guard against `auth.planary.ch` → `/setup` (passphrase + recovery key) → `/unlock`.
3. Crypto core: key derivation, file encryption, encrypted metadata, client-side search index (section 8). Get it reviewed.
4. Dashboard, upload queue, file detail with preview, versions and activity.
5. Share dialog, link page, Settings.
6. Mobile pass.
7. `planary.ch/vault` and `planary.ch/vault/pricing` in the planary.ch codebase. Reuse its nav, footer, `.is-pre/.is-in` reveal and page curtain. Don't recreate them.

## Design canvas

The live canvas, with the interactive prototype, is at https://claude.ai/artifact/BSKfiV4EAXNM2sS5DpN8Ei. It's private to Etienne; the PNGs in `screens/png/` match it.

---

## 1. What we're building

| Surface | URL | Notes |
|---|---|---|
| App | `vault.planary.ch` | Dark app. Users are already signed in through `auth.planary.ch` |
| Product page | `planary.ch/vault` | Same structure as `planary.ch/tournament` |
| Pricing page | `planary.ch/vault/pricing` | Same structure as `planary.ch/preise` |

**Auth:** Vault has no login screen. Use the shared Planary session from `auth.planary.ch`. Without a session, redirect to `auth.planary.ch?return=vault.planary.ch`. Sign out, account details and 2FA all link back to `auth.planary.ch`.

**Copy rules:**
- English and short.
- No subtitle line under headings, and no eyebrow chips like "Step 1 of 2".
- No colored status dots or "live" dots.
- Headlines end with a period, like planary.ch ("Vault is locked.").

---

## 2. Tokens

```css
:root {
  /* color */
  --bg:        #0b0b0f;  /* page */
  --surface:   #141418;  /* panels, inputs, cards in app */
  --surface-2: #16161b;  /* rows inside panels, thumbnails */
  --card:      #1a1a1f;  /* pricing / marketing cards */
  --chip:      #1f1f25;  /* tags, segmented track, avatars */
  --line:      #2a2a31;  /* borders, dividers, outline buttons */
  --line-soft: #1f1f25;  /* row dividers inside panels */
  --text:      #f2f2f5;  /* marketing pages use #f1f1f4 */
  --muted:     #a3a3ad;  /* secondary text (passes 4.5:1 on --bg) */
  --faint:     #55555e;  /* decorative only, never text */
  --btn-hover: #d9d9e0;  /* hover on white pill */
  --danger:    #ff8a8a;  /* errors, delete */
  --shared:    #c9c3f5;  /* avatar of people a file is shared with */

  /* type */
  --font-display: 'Unbounded', sans-serif;   /* 300 for headings, 400 for wordmark */
  --font-ui:      'Manrope', system-ui, sans-serif; /* 400 / 500 / 600 / 700 */

  /* radius */
  --r-pill: 999px;
  --r-card: 24px;   /* big cards, dialog, marketing */
  --r-panel: 20px;  /* app panels, file list, previews */
  --r-input: 12px;
  --r-row: 11px;    /* rows inside panels */

  /* motion */
  --ease:    cubic-bezier(.22, 1, .36, 1);
  --ease-io: cubic-bezier(.76, 0, .24, 1);
}
```

Google Fonts: `Unbounded:wght@300;400;500` and `Manrope:wght@400;500;600;700`.

### Type scale

| Use | Font | Size / weight / tracking |
|---|---|---|
| Marketing hero | Unbounded | clamp(44px, 5.4vw, 76px) / 300 / -0.05em, line-height 1.02 |
| Section heading (marketing) | Unbounded | 54px / 300 / -0.045em |
| App page title (`All files`, `Settings`) | Unbounded | 44px / 300 / -0.045em |
| Unlock / empty / expired headline | Unbounded | 56–80px / 300 / -0.05em |
| Card title, plan name | Unbounded | 28–30px / 300 / -0.045em |
| Price number | Unbounded | 56px / 300 / -0.05em; "CHF" 16px / 400 |
| File title in detail view | Unbounded | 22px / 400 / -0.04em |
| Body | Manrope | 15–16px / 400, line-height 1.6 |
| UI labels, buttons | Manrope | 14px / 600 |
| Small meta | Manrope | 12–13px / 500–600, `--muted` |

---

## 3. Logo

The lockup is the same as every Planary app:

```
[planet mark 24px]  Planary  │  Vault
```

- **Planary:** Unbounded 400, 21px, letter-spacing -0.05em, `--text`.
- **Vault:** Manrope 500, 14px, `--muted`.
- **Divider:** `border-left: 1px solid var(--line)` on the "Vault" span, 20px tall, `padding-left: 14px`, `margin-left: 4px`. The parent has `gap: 10px`.
- **Light backgrounds:** text `#0b0b0f`, "Vault" `#55555e`, divider `#d4d4db`.
- **App icon / favicon:** the planet mark centred on `--surface`. Corner radius is ~23% of the size (30px at 128px, 8px at 32px).

Planet mark SVG (straight from planary.ch, also in `assets/logo/planet-mark.svg`; make the mask ids unique if it renders twice on a page):

```html
<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <defs>
    <mask id="pm-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <rect width="100" height="100" fill="#fff"/>
      <path d="M6 50A44 12.5 0 0 0 94 50" transform="rotate(-28 50 50)" stroke="#000" stroke-width="11"/>
    </mask>
    <mask id="pm-back" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
      <rect width="100" height="100" fill="#fff"/>
      <circle cx="50" cy="50" r="28" fill="#000"/>
    </mask>
  </defs>
  <circle cx="50" cy="50" r="25" fill="currentColor" mask="url(#pm-cut)"/>
  <path d="M94 50A44 12.5 0 0 0 6 50" transform="rotate(-28 50 50)" stroke="currentColor" stroke-width="5" stroke-linecap="round" mask="url(#pm-back)"/>
  <path d="M6 50A44 12.5 0 0 0 94 50" transform="rotate(-28 50 50)" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
</svg>
```

---

## 4. Components

**Buttons**
- **Primary:** pill, `--text` background, `--bg` text, Manrope 14/600. Height 44px (48px on marketing CTAs, 40px inside cards). Padding 0 20–26px. Hover `--btn-hover`.
- **Secondary:** pill, transparent, `1px solid var(--line)`. Hover border `--faint`.
- **Text link with arrow:** Manrope 14/600 with an inline arrow SVG. The arrow moves 3px right on hover.
- **Icon button:** 42px circle (44px on mobile). Either outline `--line` or filled `--chip`. Always has an `aria-label`.
- **Disabled:** `--chip` background, `--muted` text, no hover.
- **Danger:** outline and text `--danger`. Only for "Delete vault".

**Inputs**
- **Form field:** 48px tall, `--surface` background, `1px solid var(--line)`, radius 12px, 15px text. The label sits above in Manrope 14/600. Focus border is `--muted`.
- **Search:** pill, 46px tall, `--surface` background, `--line` border, search icon on the left, placeholder "Search names, folders and tags". While a query is active the border turns `--muted` and a round clear button (34px, `--chip`) appears.
- **Unlock passphrase:** pill input with the "Unlock" button inside it.

**Chips and tags:** 24–28px tall pill, `--chip` background, 12–13px/600. "+ Add" is a dashed `--faint` outline.

**Segmented control** (list/grid, Details/Versions/Activity, Monthly/Yearly): `--surface` (or `--card`) track, 4px padding, pill. The active segment is `--text` with `--bg` text. Inactive segments are `--muted`.

**Panels**
- App panels are `--surface` with radius 20px.
- Rows inside them are `--surface-2` with radius 11px, or flat with a 1px `--line-soft` divider.
- Marketing cards are `--card` with radius 24px and 36px padding.
- The highlighted pricing card (Pro) is `--bg` with a `1px --line` border.

**File list:** a table-like grid inside one `--surface` panel. Columns are Name, Tags, Shared, Modified, Size and a ⋯ button. Rows are 54px tall. Files show a small type badge (`PDF`, `JPG` in a `--chip` 34×22 box) instead of an icon. Folders use the folder outline icon.

**Grid view:** cards are `--surface`, radius 20px, 10px padding. The thumbnail area is `--surface-2`, radius 11px, 120px tall, and shows the file type in Unbounded 18/300 until a thumbnail exists.

**Avatars:** circles with initials, 700 weight. You are `--chip`. People a file is shared with are `--shared` with dark text.

**Sidebar:**
- 264px wide, no border, 34px padding.
- Order: lockup, Upload pill, library nav (All files, Recent, Shared with me, Trash), Folders, Tags (as chips), and storage at the bottom (number + 4px bar).
- The active nav item is `--text` 600. Inactive items are `--muted`.
- No dots or icons on the library nav.

**Settings nav:** the vertical dot-and-line index from planary.ch (8px circles on a 1px `--line` rail). The active circle is filled `--text`.

**Dialog:**
- Backdrop `rgba(11,11,15,.8)`.
- Panel `--surface`, `1px --line` border, radius 24px, max-width 940px, shadow `0 40px 100px rgba(0,0,0,.6)`.
- Close is a 40px `--chip` circle.
- Esc closes it and focus stays trapped inside.

**Progress bar:** 3px tall, track `--line`. The fill is `--text`, or `--muted` while encrypting.

**Icons:** 24-grid outline icons, 1.6–2px stroke, `currentColor`. Use as few as possible. The lock icon is the only "security" signal. No shields.

---

## 5. Layout

- **App shell:** a `flex-wrap` row. Sidebar is `flex: 1 1 264px`; content is `flex: 999 1 560px; min-width: 0` with padding `24px 40px 48px 16px`. Below about 840px the sidebar stacks; on mobile it becomes the menu button (see mobile).
- **Content top bar:** search pill, then on the right a lock icon with "Encrypted" (13/600 muted), a lock-vault icon button and an avatar button that opens Settings.
- **Marketing:** `max-width: 1440px`, `padding: 0 64px`, sections `padding-top: 176px`, nav height 72px with 28px top padding.
- **Mobile (390):** 16px gutter, 44px touch targets, the floating Upload pill at bottom right (50px), and storage at bottom left. The file detail view stacks: preview (400px), tabs, list, then a bottom bar with Download and Share.

---

## 6. Screens and states

| # | Route | Screen | Key points |
|---|---|---|---|
| 1 | `/setup` | Create passphrase | Only on first visit after auth. Strength meter (4 bars, white) and a "repeat" field with a check icon. Helper: "At least 12 characters." Next to the button: "Planary can't reset it." |
| 1b | `/setup/recovery` | Save recovery key | 8 groups of 4 characters in `--surface-2` tiles, Unbounded. Download (.txt) / Copy / Print. The line "Without this key, Planary can't recover your files." The checkbox "I've saved my recovery key" enables "Open my vault". |
| 2 | `/unlock` | Locked vault | Shown after 15 min idle (configurable in Settings) or a manual lock. Pill input with Unlock inside. "Use recovery key" link. Sign out goes to auth. |
| 3 | `/` | All files | Sidebar, search, list/grid toggle, sort menu. |
| 3a | `/folder/:id`, `/tag/:t`, `/recent`, `/shared`, `/trash` | Same shell | |
| 4 | — | Drop overlay | Shows on `dragenter` anywhere in the window. "Drop to upload." Dashed `--faint` border, radius 24px. |
| 4a | — | Upload queue | Bottom-right panel, 420px. Row states: Waiting, Encrypting… (muted bar), Uploading (x of y MB, white bar), Done, Upload failed (danger text plus a white "Retry" pill). Done rows collapse after 2s. |
| 5 | `/file/:id` | File detail | Left: preview. Right (360px): Details / Versions / Activity. Versions get "Restore" on old ones and a "Current" chip. Activity shows who, what and when. |
| 5a | — | Decrypting | "Decrypting…" in Unbounded, a progress bar and "1.3 of 2.1 MB". Download and Share are disabled until done. |
| 6 | dialog | Share | Left: invite Planary users (Can view / Can edit), then link options (password, expiry, download limit) and "Create link". Right: active shares with Revoke. "Copy link" changes to "Copied" for 1.5s. |
| 6a | `vault.planary.ch/s/:id` | Link expired | Public page. Headline "Link expired." plus "What is Vault?". |
| 7 | `/settings` | Account / Security / Storage | Account links out to auth. Security: passphrase, recovery key, auto-lock select, 2FA status (links to auth), active sessions. Storage: usage split, current plan, upgrade card linking to pricing. |
| — | `/` empty | Empty vault | "No files yet." "Choose files" and "New folder". |
| — | search | No results | "No results." plus one line: "Search covers names, folders and tags only." "Clear search" and "Search Trash". |

---

## 7. Motion

All of these values come from planary.ch. Already written in `tokens/motion.css`.

| Token | Duration | Easing | Use |
|---|---|---|---|
| hover | 120ms | ease | Background, border and color on buttons, rows, links |
| press | 80ms | — | `transform: scale(.96)` on pill and round buttons only |
| reveal | 400ms | `--ease`, translateY 12px → 0 + fade | Headings and cards on mount. Stagger siblings by 60ms. On marketing pages, trigger with an IntersectionObserver (`.is-pre` → `.is-in`), once. |
| fade | 200ms | ease-out | Tab content, list↔grid swap, settings sections (Settings adds 6px of rise) |
| panel | 260ms | `--ease`, y 12 → 0 | Dialog panel, upload queue appearing. Backdrop fades 200ms. Close: 160ms ease-in, reversed. |
| drop zone | 120ms backdrop / 260ms panel | fade / scale .98 → 1 | Drag over window. Fade out 120ms on dragleave. |
| cover | 380ms | `--ease-io`, translateY(100%) → 0 | Locking: a `--surface` curtain slides up over the app. The planet mark (40px) fades in at +160ms. |
| lift | 520ms, 80ms delay | `--ease-io`, 0 → translateY(-100%) | Unlocking, or arriving on a page: the curtain lifts away and the mark fades out in 160ms. |
| progress | live | linear | Encrypt, upload and decrypt bars follow real bytes. Storage bars fill once on mount: 1.2s `--ease`. |
| price swap | 260ms | `--ease`, y 8 → 0 | The number when switching Monthly/Yearly |
| label swap | 120ms | crossfade | Encrypting… → Uploading → Done; Copy link → Copied |

```css
a, button { transition: background-color .12s, border-color .12s, color .12s, transform 80ms; }
.pill:active, .icon-btn:active { transform: scale(.96); }

@keyframes reveal { from { opacity: 0; transform: translateY(12px); } }
.reveal { animation: reveal .4s var(--ease) both; }

@keyframes cover { from { transform: translateY(100%); } }
@keyframes lift  { to   { transform: translateY(-100%); } }
.curtain        { position: fixed; inset: 0; z-index: 100; background: var(--bg); display: grid; place-items: center; }
.curtain.is-cover  { animation: cover .38s var(--ease-io) both; }
.curtain.is-lift   { animation: lift .52s var(--ease-io) 80ms both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0s !important; transition-duration: 1ms !important; }
}
```

Don't add bounces, shakes, spinners or skeleton shimmer. The only waiting signals are progress bars and labels.

---

## 8. End-to-end encryption: what the UI promises

The UI says these things, so the implementation has to make them true:

1. **Encrypted in the browser before upload.** The server only ever receives ciphertext.
2. **Planary can't read file contents, file and folder names, tags, or the passphrase.** Names and tags are encrypted metadata too.
3. **Search runs client-side.** Decrypt the metadata after unlock and build an in-memory index (names, folders, tags). There is no server-side search and no full-text search.
4. **Previews are generated client-side** after decryption (pdf.js for PDF, `<img>` from a Blob URL for images). Revoke Blob URLs when leaving the page.
5. **Recovery key:** a second way to unwrap the master key. Planary can't reset the passphrase.
6. **Share with Planary users:** wrap the file key for the recipient's public key.
7. **Share links:** the key goes in the URL fragment (`#…`), so it never reaches the server. Password, expiry and download limit are enforced server-side on the ciphertext download.
8. **What the server does see:** account email, storage used, sign-in times, and activity events (who, what action, when). The marketing page lists exactly this, so keep it accurate.
9. **Auto-lock:** after idle (default 15 min), drop key material from memory and show `/unlock` with the cover curtain.

Suggested stack (a recommendation, not a decision): WebCrypto AES-256-GCM per file with a random file key, a master key derived from the passphrase with Argon2id (WASM), and X25519 key pairs per user for sharing. Get the crypto design reviewed before launch.

---

## 9. Pricing data

| | Free | Plus | Pro |
|---|---|---|---|
| Price | CHF 0 forever | CHF 4 / month or CHF 40 / year | CHF 10 / month or CHF 100 / year |
| Storage | 10 GB | 200 GB | 2 TB |
| Max file size | 2 GB | 20 GB | 50 GB |
| Version history | 30 days | 1 year | Unlimited |
| Link expiry | up to 7 days | up to 1 year | no limit |
| Downloads per link | 10 | 100 | unlimited |
| Password on links | ✓ | ✓ | ✓ |
| Shared vault | — | — | up to 6 people |
| Pay by invoice | — | yearly | yearly |

- Yearly is "2 months free".
- Billing runs through the Planary account.
- "Choose Plus / Pro" goes to checkout on `auth.planary.ch`.
- Settings → Storage → "See plans" links to the pricing page.

---

## 10. Accessibility

- Real `<button>`, `<a>`, `<input>` and `<label>` elements. Icon-only buttons get an `aria-label`.
- Segmented controls use `aria-pressed`, or `role="tab"` with `aria-selected`.
- FAQ items use `aria-expanded`.
- Progress uses `role="progressbar"` with `aria-valuenow`.
- Body text is never `--faint`. Use `--muted` (#a3a3ad on #0b0b0f passes AA).
- Minimum touch target is 44px on mobile.
- Honor `prefers-reduced-motion` (section 7).

---

## 11. Open decisions (I assumed these; confirm before shipping)

- **Downgrade or cancel:** files are kept. Over the limit you can still open and download, but not upload.
- **Plan changes:** upgrades apply right away; downgrades apply at the end of the period.
- **Yearly prices:** CHF 40 / CHF 100.
- **Auto-lock:** default 15 min, with options of 5 min, 15 min and 1 h.
- **Done rows:** they leave the upload queue after 2 s.
- **Where data is stored:** not stated anywhere yet. Add it to the FAQ once it's decided.
- **Vault plans and the global `planary.ch/preise` Plus subscription:** the Vault FAQ currently says "Vault plans are for Vault only". Change it if Planary Plus should include Vault.

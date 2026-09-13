# Consistency — Habit Tracker

A minimalist, single-file daily habit tracker. No build step, no
dependencies, no server required.

## Running it

Open `index.html` in any modern browser, or serve it with any static
file server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Data & storage

The app stores everything (habits, daily completion, mood, journal
entries, and preferences) in the browser's `localStorage`. There is no
backend and no account — your data stays on your device.

When run inside Claude.ai as an artifact, it additionally uses
Claude's artifact storage when available, with `localStorage` as an
always-on fallback and safety net. Outside Claude.ai (this repo,
a static host, a future desktop/mobile shell) it runs on
`localStorage` alone.

## Features

- Daily habit checklist with streaks (current + best), calendar
  history, mood tracking, and a daily journal.
- Habit management (add / rename / reorder / enable-disable / delete)
  lives on the main screen — not buried in Settings.
- Settings holds application preferences: language (English, Türkçe,
  Español, Deutsch, Français), sound effects on/off, and JSON
  export/import. Changes are staged and applied with an explicit
  Save button.
- Minimal, generated (no external audio assets) UI sound effects for
  a small number of key actions, toggleable in Settings — including a
  distinct achievement chime the first time a day's habits reach 100%.
- A small daily consistency quote on the main screen, localized to
  all 5 languages, deterministic on the local calendar date (same
  quote all day, a new one the next day).
- In-app brand mark next to "Consistency" in the top bar, with a
  graceful text fallback if the image can't load.
- Mobile-friendly keyboard handling: focused inputs/textareas (journal,
  add/rename habit) stay visible above the on-screen keyboard, using
  `visualViewport` plus repeated corrections to cope with slower
  Android/WebView keyboard animations.
- Future dates are view-only: you can look, but habit checks, mood,
  journal, and habit add/rename/delete/reorder are all disabled while
  viewing a day after today, and forward navigation stops at today.
- Installable as a Progressive Web App (PWA) on Android and iPhone,
  and works offline after the first successful load — see below.

## Installing as an app (PWA)

The web version is a fully installable app — one codebase, no Play
Store / App Store, no account, no backend.

**Android (Chrome):**
1. Open the app's GitHub Pages URL in Chrome.
2. Tap the menu (⋮) and choose **"Install app"** (or **"Add to Home
   screen"**) — or tap the **Install App** button in Settings if
   Chrome has offered it.
3. The app opens full-screen from your home screen, with no browser
   address bar, using the same "H" mark as its icon.

**iPhone / iPad (Safari):**
1. Open the app's GitHub Pages URL in Safari (iOS ignores the install
   prompt from other browsers — it must be Safari).
2. Tap the **Share** icon, then **"Add to Home Screen"**.
3. Launch it from the home screen icon — it opens full-screen, without
   Safari's UI, respecting the notch/home-indicator safe areas.

**Offline behavior:** after the app has loaded successfully once (on
either platform, or in a normal desktop/mobile browser tab), a
service worker caches the app shell so it keeps launching and working
without a network connection. When you're online, the service worker
always fetches the freshest copy first, so releases still reach you
normally — you're never stuck on an old cached version while
connected.

**Your data:** installing the app does not create an account or sync
anything anywhere. Habit data, streaks, mood, journal entries, and
settings all stay in that browser/device's local storage, exactly as
before — installing is just a different way to launch the same app
and doesn't move or reset your data. Data is local to each
device/browser profile; use Settings → Export/Import JSON to move
data between devices.

## Project structure

Everything lives in `index.html` (HTML + CSS + vanilla JS, no
framework, no build step). This is intentional for a project this
size — see the final report for the trade-offs and a note on when
it would be worth splitting into multiple files.

`manifest.webmanifest` and `sw.js` (service worker) sit alongside it
at the project root for the PWA/installable-app behavior described
above. Neither is used by, or bundled into, the Electron desktop
build — `main.js` loads `index.html` directly via `file://`, and the
app's own code detects that and skips service-worker registration
there.

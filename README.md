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
  add/rename habit) stay visible above the on-screen keyboard.

## Project structure

Everything lives in `index.html` (HTML + CSS + vanilla JS, no
framework, no build step). This is intentional for a project this
size — see the final report for the trade-offs and a note on when
it would be worth splitting into multiple files.

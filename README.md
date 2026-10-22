# Holiday Planner 🦃

A mobile-first group availability planner for family holiday events. One link, everyone
picks the hours they're free around the holiday, and the planner view ranks the blocks
where the most people overlap.

**Live:** https://samuelmm97.github.io/holiday-planner/

Currently: **Thanksgiving 2026** (Thu Nov 26) — pickable days Nov 24–28, 8 AM – 11 PM, Eastern Time.

## How it works

- **Tab 1 — My availability:** enter your name (required), then **tap the preset blocks** —
  every day has a **Lunch (11–3)** and a **Dinner (5–9)** block. Tapping a block opts you in;
  tapping again removes it. If your real hours differ, **drag the left or right edge** of a
  block to widen or narrow it (snaps to the hour, minimum 1 hour, Lunch always stays left of
  Dinner). Grabbing an edge also opts you into that block.
  - The blocks stay **locked until a name is entered**; tapping one without a name shakes the
    name field and tells you to fill it in.
  - Submitting with a **single block** opens a modal warning (⚠️ icon, bold consequence
    line) offering "Let me pick more blocks" or "Save anyway, just this one"; saving only
    proceeds on the explicit override.
  - "I can't make any of these times" records a decline (excluded from the "everyone free"
    math but listed for the planner).
- **Tab 2 — Results:** ranked list of blocks where *everyone* is free (longest block first),
  falling back to closest-to-everyone windows with the missing names listed, a per-hour
  heatmap of how many people are free, each person's selected blocks, CSV export, and a
  copy-paste summary for the group chat.

Answers are saved to a shared backend (Cloudflare Worker + KV), so every phone that opens
the link sees the same data. Picks are also cached in `localStorage` so a dropped connection
never loses work.

## Data model

The block bars are the UI; hourly slots are the source of truth for matching.

- Blocks live in the browser as `{ day, slot: 'lunch'|'dinner', start, end }` and are posted
  alongside `slots` (one ISO hour key per selected hour) so the exact bars come back on any
  device. Answers saved before blocks existed are reconstructed with `Core.blocksFromSlots`.

## Architecture

```
index.html              the whole app (single file, no build step, no CDN)
worker/src/index.js     Cloudflare Worker: tiny JSON API over KV
worker/wrangler.toml    worker config + KV binding
_test_core.js           node test suite for the scheduling logic (no DOM needed)
```

- Worker: `https://holiday-planner-api.menagedsamuel.workers.dev`
- API: `GET /api/events/<eventId>` · `POST /api/events/<eventId>/responses` ·
  `DELETE /api/events/<eventId>/responses/<id>`
- Storage: one KV key per person (`event:<eventId>:p:<name>`), so two people submitting
  at the same moment can never overwrite each other.

## Adding another holiday

Events are namespaced by `EVENT.id`, so the backend needs no change:

1. Copy `index.html` into `christmas-2026/index.html` (and/or `hanukkah-2026/`, etc.).
2. Change the `EVENT` block near the top of the script: `id: 'christmas-2026'`,
   `holiday`, the `days` array, and optionally `startHour`/`endHour`.
3. Commit and push — Pages publishes it at `/<folder>/`.

Each event gets its own isolated set of responses.

## Tests

```bash
node _test_core.js
```

Runs the pure scheduling core (block merging, everyone-free ranking, near-miss ranking,
declines, formatting) in a `vm` with no DOM.

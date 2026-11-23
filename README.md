# SAGA

*The story of your game session — a plain-English word with real Norse roots, picked over the
earlier working name ("Tafl") for being clearer at a glance.*

A private browser playtest table for kits made in [Kit Forge](../README.md) — the closest
practical recreation of Tabletop Simulator for the web: free-form dragging, flipping,
rotating, stacking, markers and sticky notes, synced live between players. Undo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>),
pinning a piece so nobody can nudge it, and saving the whole table to a file that outlives the
server. No rules engine — the table only syncs state ("never say illegal move"). A room is joined
by a shared password plus a short code — themed here as a **rune** (e.g. `SAGA-82K`) — and
everyone at a table is your **party**.

Built as a game-agnostic sibling of [LOL, FIGHT TIEM!'s playtest table](https://github.com/dustooned) —
same architecture (Colyseus + React Three Fiber), generalized so any Kit Forge export works,
not just one game's cards. "SAGA" is this table's own name (chosen for an LBCC Vikings-themed
deployment) — Kit Forge itself stays a generic, unbranded tool usable by anyone.

## How it fits together

1. Build cards/pieces/boards in Kit Forge (the parent app).
2. **Send to Table** (Kit Forge's export button) rasterizes everything and downloads a
   `.kittable.json` file.
3. Open this table, create a room, and use **🧰 Table tools → 📦 Load kit…** to drop that file in.
   Everyone at the table sees it appear.

A LOL, FIGHT TIEM! deck from Card Forge loads the same way: use **Send to playtest** there and drop the
`.lftdeck.json` (each card becomes a poker-size card with its finished art and the card back; a card
in several decks of one file spawns once per deck).
4. Physical print-and-play is still available straight from Kit Forge's own **Export ZIP** /
   **Print cards** — the table and the printable sheets are two independent outputs of the
   same kit, not a replacement for each other.

## Running it locally

```bash
npm install
cp .env.example .env   # set TABLE_PASSWORD
npm run dev
```

Server on `http://localhost:2568`, client on `http://localhost:5195`.

## Deploying so students can reach it from school computers

This needs a real Node process running somewhere (unlike Kit Forge itself, which is static) —
any host that runs long-lived Node + WebSockets works (Render, Fly.io, Railway, a school's own
server). Two things matter for reaching it from a locked-down school network:

- **Serve over plain HTTPS on port 443.** Websockets riding the same HTTPS port as the page
  (`wss://your-table.example.com`) pass through nearly every school firewall/proxy; a raw custom
  port often does not. All three hosts above give you this by default.
- **One URL, no installs.** `npm run build` then `npm start` serves the built client, the API
  and the websocket room from the same origin — students just open a link, no separate server
  address to configure, no software to install (browser-only, same as Kit Forge itself).

Room state lives in memory, but the table **autosaves** every couple of minutes to `SAVES_DIR`
(`.data/saves` by default, next to uploads) as an ordinary `.sagatable.json` — the same file
**💾 Save table** downloads. When a fresh table opens, the first player is offered the most recent
save (if it is younger than `RECOVER_HOURS`, default 12) and can bring it back with one click, or
`Ctrl`+`Z` it away again. That covers a crash, a redeploy, and a laptop that closed at the wrong
moment. Uploaded images go through a pluggable `AssetStorage` interface
(`apps/server/src/storage/`); only local disk is implemented today, so put both `UPLOAD_DIR` and
`SAVES_DIR` on a persistent disk — on Railway, attaching a volume sets both automatically — or
accept losing them on redeploy.

## Seats, spectators and moderation

A table has **8 seats** (`MAX_PLAYERS`). On top of that, up to **8 spectators**
(`MAX_SPECTATORS`, both in `packages/shared-types/src/table.ts`) can join with
**👁 Watch without taking a seat**. They see everything and can point and ping, but the room
refuses every other message they send. That makes a full table watchable by an instructor. A
room accepts `MAX_PLAYERS * 2 + MAX_SPECTATORS` connections; the extra seat-sized headroom covers
ghost sessions while someone reconnects.

The host can make seated players **co-hosts** (kick, ban, clear the table). Bans are by name and
easily dodged with a different name — a classroom convenience behind `TABLE_PASSWORD`, not a
security boundary. Co-hosts and bans are session state: no undo reverts them and save files don't
contain them.

## Project layout

Mirrors the pattern in `packages/kit-adapter` and `apps/server/src/table/tableOps.ts`:
`tableOps.ts` is the entire "free-form VTT engine" (grab/move/drop/stack/flip/rotate/markers/
notes) as plain, game-agnostic functions over a Colyseus schema — no Kit Forge- or game-specific
code in it at all. `packages/kit-adapter` is the only piece that knows about Kit Forge's export
format; swapping in a different card-maker's export later would only mean writing a new adapter.

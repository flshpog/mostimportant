# everest season 3 "mushroom kingdom": board system master spec

> how to use this file: put it in the repo at `docs/board-spec.md` and add a line to `CLAUDE.md` saying "read docs/board-spec.md before any work on the board system." every phase prompt assumes claude code has read this. update it whenever a decision changes.

## what this is

everest is a survivor-style online reality game (ORG) run entirely over discord. season 3 has 17 players: 16 split into four tribes, one exiled at the start. alongside the survivor game, each tribe plays its own slowed-down mario party-style board. boards change with the season's phases (4 copies of the main board, then a swap board, a merge board, and a redemption island mini-board; see owner decisions). players earn coins on the board and spend them on advantages in the survivor game.

the board system has three surfaces:

1. **game server** (part of / alongside the existing discord bot, javascript/typescript). the single source of truth for all game state. it rolls dice, moves players, applies spaces, and broadcasts events.
2. **website** (the existing everest static site). a full 3D board built with three.js via react-three-fiber, plus the coins/stars/leaderboard UI. updates live.
3. **discord** (the existing bot). players can roll and make choices with slash commands and buttons, and the bot posts a rendered 2D image of the board. discord only needs rolling, choices and the board image. everything else lives on the website.

## quality bar

the owner is not rushing this and wants it done right. that means:

- plan before coding each phase, and show the plan for approval
- small, reviewable commits
- tests for all game logic (movement, forks, one-way paths, spaces, star, shop, dice fairness)
- no game rules hardcoded in the renderer or the bot. rules live in the engine, config lives in data files
- everything typed (typescript), shared types between server, bot and website
- if something in this spec is unclear or contradicts the code, stop and ask instead of guessing

## core architecture

```
            board.json (layout + space types)      season-config.json (rules, values)
                          \                          /
                           v                        v
                    +------------------------------------+
                    |  engine (pure TS, no IO, tested)   |
                    +------------------------------------+
                                     |
                    +------------------------------------+
                    |  game server (inside bot process   |
                    |  or beside it): persistence, RNG,  |
                    |  REST + websocket API, auth        |
                    +------------------------------------+
                      |                              |
          discord bot (slash cmds,          website (static, react-three-fiber)
          buttons, 2D board image)          3D board + UI, live via websocket
```

- **engine**: a pure package. input = current state + action, output = new state + list of events. deterministic given a dice result. no discord, no network, no database inside it. this is what makes it testable.
- **server is authoritative**: dice are rolled on the server with a secure RNG. clients only animate results the server already decided. the website never calculates game outcomes.
- **event log**: every change is an event (`DiceRolled`, `PlayerMoved`, `PassedSpace`, `LandedOnSpace`, `CoinsChanged`, `StarPurchased`, `StarMoved`, `ShopPurchase`, `BowserSpin`, `ForkChoiceRequired`, ...). the website animates from events, the bot narrates from events, and the log doubles as season history and an undo/audit trail for the hosts.
- **static site constraint**: the website is static, so it cannot host the websocket server. the website connects to the game server (wherever the bot is hosted) over HTTPS/WSS. the server must allow the site's origin (CORS).
- **monorepo suggestion** (confirm in phase 1): `packages/engine`, `packages/board-data`, `apps/server` (or folded into the bot), `apps/web`, shared `packages/types`.

## the board

- reference image: `docs/board-reference.png` (the owner's annotated layout, based on DK's Jungle Adventure from mario party 1). about 84 spaces.
- the layout is two halves joined by two one-way bridges: the top bridge goes left only, the bottom bridge goes right only. the board therefore forms one large loop with branches inside each half.
- forks are marked in orange on the image. at a fork the player chooses a direction (the engine pauses movement and emits `ForkChoiceRequired`; remaining steps resume after the choice).
- arrows on the image show allowed travel direction. paths are directed edges.
- the board is stored as a directed graph in `packages/board-data/boards/main.json` (schema: `packages/board-data/src/schema.ts`; numeric rules: `packages/board-data/season-config.json`):

```ts
// the star is not a space type: it sits on a blue space and moves at runtime.
// boo icons are ignored (owner decision), so there is no boo type.
type SpaceType = "blue" | "red" | "green" | "shop" | "bowser" | "start";
interface Space {
  id: string;            // stable, e.g. "s01"
  type: SpaceType;
  pos: { x: number; y: number };   // 2D layout coords, normalized 0..1 from the reference image
  next: string[];        // outgoing edges; more than one = fork
  label?: string;        // e.g. "left fork", "top bridge"
  passEffect?: boolean;  // true if passing (not landing) triggers it, e.g. shop
  needsReview?: boolean; // transcription not yet confirmed by the owner
  reviewNote?: string;
}
```

- the 3D view and the 2D discord image both derive positions from this file. 3D height/terrain is layered on top, never stored as game logic.
- **do not trust a transcription blindly**: phase 2 builds a debug overlay that draws board.json on top of the reference image so the owner can confirm every space and edge.

## space rules (from the owner's legend)

| space | effect |
|---|---|
| blue | +3 coins |
| red | -3 coins (never below 0) |
| green | nothing happens |
| shop | enter the shop (spend coins on items) |
| bowser | spin a punishment wheel |
| start | starting space |

### owner decisions (2026-10-14)

**spaces**
- **star-icon spaces** on the reference image are ignored: they are plain blue spaces with no marker. each board's starting star space is set in `season-config.json` (`boards[].starStart`); all four main boards start the star on **s62**.
- **boo icons:** ignore them. they have no effect and are not special spaces.
- **the red X over the bowser figure (left side):** the space beside it (s57) stays **red**. the other bowser spaces stay bowser spaces.
- **triggers:** shops trigger when passed or landed on. bowser spaces trigger **only on landing**. blue/red/green apply only on landing.
- **starting coins:** 10.

**star**
- costs 20 coins. passing the star (or landing on it) prompts the player to buy it, one star per prompt.
- when it's bought, it moves to a random **blue space** (any blue space) on the same board, never the one it was just on. the space it left is a regular space again.

**coins and items**
- coins are only for the board: they buy stars and shop items. they are **not** S2 bells and are not used anywhere else in the survivor game.
- shop: the full item list comes later. each item should eventually have a small sprite (made for the game, or an existing item sprite the owner supplies).
- bowser wheel: contents come later.

**turns (per board)**
- fixed order, set by hosts per board.
- when the game first starts, the first player has **no time limit** for their first turn.
- after any roll, a **4-hour cooldown** starts. after the cooldown, the next player has a **12-hour window**.
- if the window expires, that player loses the turn (they keep their place in the order) and the next player's 12-hour window starts **immediately**, with no cooldown.

**visibility**
- players can view **only their own board**. no cross-board viewing and no all-tribes leaderboard for players.
- within a board, players can see each other's coins, stars and items (a tribe leaderboard). nothing crosses to other boards.
- hosts see everything.

**season structure and boards**
- there are exactly **3 board designs**:
  1. **main board** (the DK jungle layout), 4 identical copies, one per original tribe. channels: mario stadium `1560048708832337930`, luigi's mansion `1560048767212847205`, warioware inc `1560048807012470784`, waluigi pinball `1560048870036078754`. players stay on these boards until merge (hosts can still move individuals between boards from the dashboard).
  2. **merge board**: its own design, yoshi's island theme (the owner may supply a reference). everyone remaining moves here when the game reaches 4 tribes of 2 / merge.
  3. **redemption island board**: its own small design (see below).
- there is no swap board.
- **the exiled 17th player:** at the start, one player is secretly on exile; the other 16 don't know about them. they join the board of the **first tribe to go to tribal and eliminate someone**. that board ends up with 5 players; the others have 4. hosts move them in via the dashboard.
- **redemption island:** eliminated players leave their board and go to a shared **redemption island mini-board** (channel `1560049266498469989`).
  - on arrival, their coins, stars and items are **reset to zero**.
  - the redemption board has **no star**, but it has coins and a **shop space** selling items from the standard item pool.
  - if a player returns to the game, they go back to a real board and **keep** the coins and items they earned on redemption island.
- every board is just data: the engine and renderers must support any number of boards and layouts, and hosts move players between boards.

**hosts**
- host commands can be used in any channel but are **always ephemeral**. access is gated on the existing host role (`channels.host_ping_role` in `config/economy.json`), not the host category.
- automate the game flow (rolls, spaces, star, turns, timeouts). hosts also get a **web host dashboard** where they can view and edit everything at any time: coins, stars, items, positions, turn order, star location, which board each player is on, sending players to redemption island, moving everyone onto swap/merge boards, pausing a board, undo.

**infrastructure**
- typescript for the new board code (existing bot stays JS). storage is JSON files (sqlite only if JSON truly can't work).
- the bot runs on an ubuntu 22.04 VPS, always on. ports 80/443 are already in use there, so the reverse-proxy config must be added alongside the existing setup without disturbing it (worked out in phase 4). the game server is at `board.fiovivor.org`. `fiovivor.org` DNS is on spaceship (the registrar), not cloudflare.
- website source lives in this repo (`apps/web`) and the built files are copied into the `fiovivor.org` repo under `/board`.
- dice: 1–10.

**moving between boards:** players keep their coins, stars and items whenever they move to another board. the only exception is going to redemption island, which resets everything (see above).

**still not defined (ask the owner, do not invent):** shop inventory, prices and sprites; bowser wheel contents; merge and redemption island layouts.

all numeric values (coin amounts, star price, cooldown and turn-window hours) live in `season-config.json`, never in code.

**playing from the website (owner decision):** players can roll and make their choices on the website as well as in Discord. both go through the same server, and Discord shows website rolls too.

## server (phase 4, `packages/server`)

runs inside the bot. how to run it locally, the API and the live-update protocol: `docs/board-server.md`.

## engine behaviour (phase 3, `packages/engine`)

- pure functions: `apply(ctx, state, action) -> { state, events }`. every action carries `now`; dice, the new star space and bowser outcomes are always passed in by the server.
- **prompts:** forks, the star and shops pause the move and wait for the player. each prompt times out after `turns.choiceTimeoutMinutes` (default 60, editable): a fork takes its **first listed exit**, the star and shop are **skipped**. the bowser spin isn't a player choice; the server resolves it right away.
- **order on arrival:** star prompt, then shop prompt, then (on the final space only) the landing effect. landing on the star still pays the blue +3 after the prompt.
- **cooldown** runs from the moment of the roll, not from the end of the move.
- **pause** freezes every clock (windows, cooldowns, prompt timers) for the length of the pause.
- **multiple dice** are summed, so items like double dice need no engine change.
- **undo:** a board is stored as its initial state plus every action. undo drops actions and replays; `undoTurn` rewinds to just before the last roll.
- **items:** the engine stores which items a player owns but applies no item effects yet (items not defined).

## dice

- server-side secure RNG (`crypto.randomInt`), 1 to 10 by default (configurable), with the roll recorded in the event log.
- turn order, the 4-hour cooldown and the 12-hour turn window are enforced by the server (see owner decisions above; the hours are configurable).
- the website and discord both show a dice animation that lands on the server's result.
- items may modify dice later (double dice, custom dice). design the roll action so modifiers can be added.

## website: 3D board

- three.js via react-three-fiber + drei. vite build output must stay deployable as static files to the current host.
- scenery: modeled in blender (via the blender MCP so claude can drive blender directly), exported as optimized `.glb` (draco/meshopt compressed). free CC0 low-poly packs (kenney, quaternius) are fine for trees and props. the owner is not an artist, so lean on a clean, readable, stylized low-poly look over realism.
- spaces, path lines, star, shops and player tokens are generated in code from board.json, so they always match the game logic.
- **visual direction (owner decision):** the reference image is only the **layout** (which spaces exist, how they connect, roughly where they sit). the 3D board is our own original design and should **not** look like DK's jungle. theme: classic **mushroom kingdom grassland**: rolling green plains and paths, with the giant mushroom pillar/platforms in the background. claude has full creative control over the look. use original models (blender, or CC0 packs); no ripped nintendo models, textures, logos or characters. inspired-by is fine, copies are not.
- the star-icon spaces on the reference image get no special visual; they render as plain blue spaces.
- camera modes (smooth animated transitions between them):
  1. **overview**: the whole board
  2. **me**: follow your own token (requires login, see auth)
  3. **tribemate**: pick a tribemate from a list and fly to them
  4. **star**: fly to the current star location
  5. free orbit/pan/zoom with limits so you can't get lost
- live movement: tokens hop space by space along the actual path when a `PlayerMoved` event arrives, with space effects popping in as they happen.
- must run smoothly on a mid-range phone. test performance.

## website: UI

- per-player: coins, stars, items, current space
- board leaderboard (stars first, then coins, like mario party). players never see other boards
- dice roll overlay
- live event feed ("X rolled a 7 and landed on a red space, -3 coins")
- host dashboard (host role only): view and edit everything, move players between boards, redemption island, swaps, merge

## discord (minimal by design)

- `/roll`: rolls for the player, shows a short dice result (animated GIF or a few quick message edits), then the move result
- fork choices and shop purchases via buttons, with timeouts and a default choice
- a rendered 2D board image (server-side canvas) posted in the tribe's channel and edited after moves, with token positions, star location and a mini leaderboard
- host/admin commands: set coins, move a player, move the star, undo last event, pause the board

## auth

- website login via discord OAuth2, so the site knows who you are (for "me" and tribemates). which board you're on comes from the game server's own data (hosts assign it), not discord roles. hosts are recognised by the existing host role.
- only the server can change state. the website is read-only except for actions a logged-in player is allowed to take, if any.

## phases

1. recon and architecture plan
2. board data + debug overlay
3. game engine + tests
4. game server: persistence, API, websockets, auth
5. discord: roll, choices, board image
6. 3D board: blender scenery + three.js scene + cameras + live movement
7. UI: coins, stars, leaderboard, dice, feed
8. polish, load testing, dress rehearsal

each phase has its own prompt. finish, test and get approval before moving on.

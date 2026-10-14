# everest season 3 "mushroom kingdom": board system master spec

> how to use this file: put it in the repo at `docs/board-spec.md` and add a line to `CLAUDE.md` saying "read docs/board-spec.md before any work on the board system." every phase prompt assumes claude code has read this. update it whenever a decision changes.

## what this is

everest is a survivor-style online reality game (ORG) run entirely over discord. season 3 has 17 players: 16 split into four tribes, one exiled at the start. alongside the survivor game, each tribe plays its own slowed-down mario party-style board. there is one board design, copied four times (one instance per tribe). players earn coins on the board and spend them on advantages in the survivor game.

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
- the board is stored as a directed graph in `board.json`:

```ts
type SpaceType = "blue" | "red" | "green" | "shop" | "bowser" | "star_slot" | "boo" | "start";
interface Space {
  id: string;            // stable, e.g. "s01"
  type: SpaceType;
  pos: { x: number; y: number };   // 2D layout coords, normalized 0..1 from the reference image
  next: string[];        // outgoing edges; more than one = fork
  label?: string;        // e.g. "left fork", "top bridge"
  passEffect?: boolean;  // true if passing (not landing) triggers it, e.g. shop or star
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

**not defined yet (ask the owner, do not invent):** star-icon spaces, boo spaces, the red X over the bowser figure on the left side (likely removed), star price and star movement rules, shop inventory and prices, bowser wheel contents, whether coins on the board are the same coins used for survivor advantages, how often players can roll (the "slowed down" pace), turn order, what happens to an exiled or eliminated player's token, whether players can view other tribes' boards.

all numeric values (coin amounts, star price, roll limits) live in `season-config.json`, never in code.

## dice

- server-side secure RNG (`crypto.randomInt`), 1 to 10 by default (configurable), with the roll recorded in the event log.
- roll limits enforced by the server (e.g. one roll per player per game day, configurable).
- the website and discord both show a dice animation that lands on the server's result.
- items may modify dice later (double dice, custom dice). design the roll action so modifiers can be added.

## website: 3D board

- three.js via react-three-fiber + drei. vite build output must stay deployable as static files to the current host.
- scenery: modeled in blender (via the blender MCP so claude can drive blender directly), exported as optimized `.glb` (draco/meshopt compressed). free CC0 low-poly packs (kenney, quaternius) are fine for trees and props. the owner is not an artist, so lean on a clean, readable, stylized low-poly look over realism.
- spaces, path lines, star, shops and player tokens are generated in code from board.json, so they always match the game logic.
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
- tribe leaderboard (stars first, then coins, like mario party), plus an all-tribes view if allowed
- dice roll overlay
- live event feed ("X rolled a 7 and landed on a red space, -3 coins")
- tribe switcher if viewing other tribes is allowed

## discord (minimal by design)

- `/roll`: rolls for the player, shows a short dice result (animated GIF or a few quick message edits), then the move result
- fork choices and shop purchases via buttons, with timeouts and a default choice
- a rendered 2D board image (server-side canvas) posted in the tribe's channel and edited after moves, with token positions, star location and a mini leaderboard
- host/admin commands: set coins, move a player, move the star, undo last event, pause the board

## auth

- website login via discord OAuth2, so the site knows who you are (for "me" and tribemates) and which tribe you're in.
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

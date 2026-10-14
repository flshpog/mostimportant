# season 3 board server: running it and how it works

The board server runs **inside the bot**. When the bot starts, `src/events/ready.js` calls
`src/handlers/boardServer.js`, which starts `packages/server` on port 8787 (from
`config/board.json`). It needs `BOARD_SESSION_SECRET` in `.env`, or it stays off.

## option A: quick local test, no Discord at all

Two terminals in the repo folder:

```
npm run board:dev -- --seed     # board server on :8787, fake players on Mario Stadium
npm run board:web               # website on :5173
```

Open `http://localhost:5173/board/#/console`. Discord login is off in this mode, so the
page shows **Log in as ...** buttons for a fake host and four fake players. Log in as the
host, press **Start board**, then log in as a player in a private window and play. Data
goes to `data/board-dev/`; delete that folder to start over. (These test logins only
exist in `board:dev`; the real server has no such route.)

## option B: the real bot against a test Discord server

Use a **separate test bot**, never the live bot's token. Two copies of the same bot
would both answer commands.

1. **Test bot.** In the [Discord developer portal](https://discord.com/developers/applications),
   create an application, add a bot, and invite it to your test server with the `bot`
   and `applications.commands` scopes.
2. **Login redirect.** In that application's **OAuth2** page, add the redirect
   `http://localhost:8787/auth/callback`, then copy the **client secret**.
3. **`.env`** (in the repo folder):
   ```
   BOARD_SESSION_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   DISCORD_CLIENT_SECRET=<the test app's client secret>
   ```
4. **`config/board.local.json`** (gitignored, only on your machine):
   ```json
   {
     "public_url": "http://localhost:8787",
     "site_url": "http://localhost:5173/board/",
     "guild_id": "<test server id>",
     "host_role_id": "<a role in the test server that counts as host>"
   }
   ```
5. **Bot token.** In your local `src/index.js`, set `token` to the test bot's token.
6. Run `npm start` (bot + board server) and `npm run board:web` (website).
7. Open `http://localhost:5173/board/#/console` and log in with Discord. Give yourself
   the host role in the test server and you'll see every board plus host tools. Add
   players (yourself, alts, friends) by Discord user ID.

## what's where

| | |
|---|---|
| game rules, star start, shop, wheel | `packages/board-data/season-config.json` (re-read on every action) |
| server settings | `config/board.json`, plus `config/board.local.json` locally |
| saved boards | `data/board/<board>/`: `log.jsonl`, `events.jsonl`, `state.json` |
| tests | `npm run board:test` |

Each board is saved as an append-only log of every action (with the state before it), an
append-only event log, and a snapshot. A crash at any point recovers on the next start.
Undo restores the saved "before" state, so it's exact even if the config changed since.

## API

All JSON. Send `Authorization: Bearer <token>` (from login) on everything except
health and login.

| method | path | who | what |
|---|---|---|---|
| GET | `/api/health` | anyone | `{ok: true}` |
| GET | `/auth/login` | anyone | redirects to Discord login |
| GET | `/auth/callback` | Discord | sends the browser back to the site with a token |
| GET | `/api/me` | logged in | you, your board, whether you're a host |
| GET | `/api/boards` | logged in | your board (hosts: all boards) |
| GET | `/api/boards/:id` | board members, hosts | state and latest `seq` |
| GET | `/api/boards/:id/layout` | board members, hosts | the board graph |
| GET | `/api/boards/:id/events?since=&limit=` | board members, hosts | event history after `since` |
| GET | `/api/boards/:id/leaderboard` | board members, hosts | stars, then coins |
| POST | `/api/play/roll` | the current player | roll (server dice) |
| POST | `/api/play/fork` `{next}` | the player at a fork | choose a path |
| POST | `/api/play/star` `{buy}` | the player at the star | buy or skip |
| POST | `/api/play/shop` `{itemId?}` | the player at a shop | buy, or leave with no itemId |
| GET | `/api/host/boards` | hosts | every board with state |
| POST | `/api/host/boards/:id/actions` `{action}` | hosts | `startBoard`, `pause`, `resume`, `setCoins`, `setStars`, `grantItem`, `removeItem`, `movePlayer`, `moveStar`, `addPlayer`, `removePlayer`, `setTurnOrder` |
| POST | `/api/host/boards/:id/undo` `{count?, turn?}` | hosts | undo changes, or the whole last turn |
| POST | `/api/host/transfer` `{playerId, to, name?, reset?}` | hosts | move a player between boards (or add someone new) |

Errors look like `{"error": {"code": "not_your_turn", "message": "It isn't your turn yet."}}`.
Messages are plain language and safe to show players.

## live updates (websocket at `/ws`)

```
-> {op:"hello", token}
<- {op:"hello", user, boardId, isHost}
-> {op:"subscribe", board, since?}
<- {op:"events", board, events, seq, state}   catch-up from `since`, then every change
<- {op:"snapshot", board, seq, state}          on first subscribe (no `since`)
<- {op:"reset", board, seq, state}             after a host undo
```

Every event has a `seq` (1, 2, 3... per board, never reused). A client that reconnects sends
the last `seq` it saw and gets exactly what it missed. Players are cut off a board's feed
the moment they're moved off it.

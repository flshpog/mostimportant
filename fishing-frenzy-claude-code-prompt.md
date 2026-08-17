# Claude Code task: build "CJ's Fishing Frenzy" for the Everest bot

## What you're building

Add a timed, 24-hour **individual** immunity challenge called **CJ's Fishing Frenzy** to the
Everest bot. Seven players compete in one shared channel. The bot posts an **image of a fish**
at random intervals; the first player to correctly name it wins that fish's points. After 24
hours the highest scorer wins Individual Immunity.

This is Flick's Bug Frenzy (F14) rebuilt for individual play. **That implementation already
exists in this repo** - read it first and mirror it:

- `src/handlers/bugFrenzy.js` - the engine (config loading, state, scheduling, catch handling,
  standings, lifecycle, resume-on-restart)
- `config/bugfrenzy.json` - the tunable config
- `src/commands/org/bugfrenzy.js` - the prefix command
- `src/events/messageCreate.js:31-34` and `src/events/ready.js:4,49` - the wire-up points

**Build a parallel implementation, don't refactor Bug Frenzy into a shared engine.** Bug Frenzy
is shipped and working; a shared abstraction risks breaking it for no benefit right now. Create
`src/handlers/fishingFrenzy.js`, `config/fishing.json`, `data/fishing.json`, and
`src/commands/org/fishingfrenzy.js`. Yes, this duplicates some logic - that's the accepted
trade, and unifying them later is a clean follow-up once both have run.

Read `fishing-frenzy-f7-buildspec.md` in this repo for the full design rationale.

## What's different from Bug Frenzy (read this carefully)

| | Bug Frenzy | Fishing Frenzy |
|---|---|---|
| Players | Two tribes, two channels | Individual, one channel |
| Scoring | `all_in_window` - everyone in time scores | `first_only` - one fish, one scorer |
| Creature identity | Named in the spawn text | **Hidden - image only** |
| Flavor text | Per-bug | **None. Identical message every spawn** |
| Leaderboard | Final tally only | **Live, in a separate channel, edited in place** |
| Windows | 10/7/5/3s | 20/15/10/8s |
| Points | 1/3/8/25 | 1/4/12/40 |

## Core mechanic (exact behavior)

1. A host starts the frenzy. Two channels are involved:
   - **`1538787163582238792`** - `fishing-frenzy`, where spawns and catches happen.
   - **`1526348458099871916`** - where the live leaderboard message lives.

   **Host prerequisites, not the bot's job:** both channels exist and are permissioned, the fish
   reference list is posted, and the host pins the leaderboard message after `start`. The bot
   does not create channels, manage permissions, or pin anything.

   Permissions needed: Read Messages / Send Messages / Add Reactions / Read Message History /
   Attach Files in the fishing channel; Send Messages in the leaderboard channel. **Manage
   Messages is not required** - editing your own message doesn't need it, and the host does the
   pinning.
2. For 24 hours, at randomized intervals, the bot picks a fish (weighted) and posts:
   - Fixed text, **byte-identical every spawn**: `🎣 A fish bites! Reel it in!`
   - The fish's image, attached.
   - **Nothing else.** No name, no flavor, no rarity hint, no window countdown.
3. Each spawn has a catch window (seconds, per rarity, never shown to players). Players catch
   by posting `I reel in the {fish name}!` in the channel.
4. **Scoring - `first_only`:** the first player to post a valid catch inside the window gets the
   points. React ✅ to that message. Every subsequent attempt is ignored entirely - no
   reaction, no reply, no points. Make this a config flag
   `scoring_mode: "first_only" | "all_in_window"` and **ship with `first_only`.**
5. When the window closes, post the fish's name and who caught it **only if it was caught**. A
   fish nobody landed is never named. Config toggle `announce_on_close`, default true.
6. Update the live leaderboard message.
7. At 24 hours: stop spawning, post the final tally, declare the winner.

## THE IMAGE IS THE PUZZLE - do not leak it

The entire challenge is recognizing the fish on sight. The image URLs are Nookipedia's and are
**named after the species** (`Coelacanth_NH_Icon.png`), so how you deliver the image is the
whole ballgame:

1. **Never embed the URL.** `.setImage(url)` lets a player right-click → Copy image address and
   read the answer. Same for putting the URL in message content.
2. **Download the bytes, attach with a neutral filename.** This re-hosts the image on Discord's
   own CDN, so neither the source URL nor the species name ever reaches the client:
   ```js
   const buffer = await downloadBuffer(fish.image);
   await channel.send({
     content: config.spawn_message,
     files: [new AttachmentBuilder(buffer, { name: config.attachment_filename })], // "fish.png"
   });
   ```
   There's a `downloadBuffer(url)` helper at `src/events/messageCreate.js:10-22` (handles
   redirects) - lift it into a shared util rather than rewriting it.
3. **Do not pass the URL string straight to `files: [url]`.** discord.js will fetch it, but the
   attachment inherits the source filename - which is the species name. The `AttachmentBuilder`
   with an explicit `name` is what prevents this.

Also: **never react ⌛ on a late catch** (`react_on_late: false`) and never display remaining
time. Either would tell players the rarity tier.

## Image caching (required, not optional)

Fetch all 20 images **when the frenzy starts**, not per spawn. Cache the buffers in memory
(and/or `data/fishcache/`). Two reasons this is a hard requirement:

- A live fetch at spawn time puts a third-party host on the critical path of an immunity
  challenge. If `dodo.ac` is slow when a Legendary is due, the spawn is late or lost.
- Catch windows are as short as 8 seconds. Fetch latency eats the window.

If any image fails to fetch during warm-up, **refuse to start** and report which ones - do not
start a 24-hour game with a broken fish in the pool.

Optional polish: the icons are 128×128, which renders small in Discord. `jimp` is already in
`package.json`; upscaling to ~384×384 with nearest-neighbour at cache time keeps the pixel art
crisp and makes them much easier to read quickly. Put the target size in config
(`image_upscale_px`, `0` to disable).

## Catch validation

Normalize the incoming message: lowercase, trim, collapse internal whitespace, strip a trailing
`!`/`.` - the same `normalize()` as `bugFrenzy.js:83-85`. A catch is **valid** when the
normalized message equals `i reel in the {fish name}` (name lowercased, or any of that fish's
configured `aliases`), the window is still open, and **no one has claimed this spawn yet**.

- Valid → react ✅, record the point, mark claimed.
- Wrong name / window closed / already claimed → **no reaction, no reply, nothing.**
- Optional `eligible_role_id` in config (default `null`): when set, only members with that role
  can score, so a host in the channel can't take a fish by accident.

**Concurrency requirement - do not get this wrong.** `first_only` means two catches arriving in
the same tick are a genuine race. Record the claim **synchronously before any `await`**: check
`claimed`, set it, add the score, `save()` - and only then call `message.react('✅')`.
`bugFrenzy.js:211-224` already does it in this order; preserve it. If you `await` before
claiming, two players can both be awarded the same fish.

## Scheduling

- Interval: uniform random between `min_interval_minutes` and `max_interval_minutes`.
  **Defaults 8 and 18** (~111 spawns over 24h).
- Never overlap: a new fish spawns only after the previous window closes. Clamp if a rolled
  interval would land sooner.
- Selection: single weighted random pick over the full fish list. No tier logic at runtime.
- `min_window_seconds: 3` is a hard floor - never schedule a window below it.
- `test_mode` compresses intervals to `test_interval_seconds` for dry runs, toggled by command
  and stored in a gitignored runtime override so hosts never hand-edit config mid-game. Copy
  `getConfig()`/`setTestMode()` from `bugFrenzy.js:20-45`.
- **Test mode must also override the window**, to `test_window_seconds` (default 5). Bug Frenzy
  only compressed the interval, which was fine with its 3–10s windows. Fishing's are 8–20s, and
  the clamp is `max(interval, window + 1s)` - so a 5–10s test interval is swallowed entirely and
  a Common still cycles every 21 seconds. Apply `test_window_seconds` in place of `fish.window`
  whenever `test_mode` is on, while still respecting `min_window_seconds` as the floor.

## THE FISH TABLE (fish / windows / points / spawn chance)

Four rarity tiers, 20 fish, 5 per tier. Weights sum to **270**. Windows in seconds; points to
the single first catcher.

| Fish | Rarity | Window (s) | Points | Weight | Chance |
|---|---|---|---|---|---|
| Sea Bass | Common | 20 | 1 | 30 | 11.11% |
| Carp | Common | 20 | 1 | 30 | 11.11% |
| Crucian Carp | Common | 20 | 1 | 30 | 11.11% |
| Bluegill | Common | 20 | 1 | 30 | 11.11% |
| Horse Mackerel | Common | 20 | 1 | 30 | 11.11% |
| Koi | Uncommon | 15 | 4 | 16 | 5.93% |
| Salmon | Uncommon | 15 | 4 | 16 | 5.93% |
| Squid | Uncommon | 15 | 4 | 16 | 5.93% |
| Red Snapper | Uncommon | 15 | 4 | 16 | 5.93% |
| Pike | Uncommon | 15 | 4 | 16 | 5.93% |
| Sturgeon | Rare | 10 | 12 | 6 | 2.22% |
| Blue Marlin | Rare | 10 | 12 | 6 | 2.22% |
| Football Fish | Rare | 10 | 12 | 6 | 2.22% |
| Napoleonfish | Rare | 10 | 12 | 6 | 2.22% |
| Giant Trevally | Rare | 10 | 12 | 6 | 2.22% |
| Coelacanth | Legendary | 8 | 40 | 2 | 0.74% |
| Great White Shark | Legendary | 8 | 40 | 2 | 0.74% |
| Whale Shark | Legendary | 8 | 40 | 2 | 0.74% |
| Barreleye | Legendary | 8 | 40 | 2 | 0.74% |
| Golden Trout | Legendary | 8 | 40 | 2 | 0.74% |

Design intent, so you keep balance if you refactor: expected value is **4.56 points per spawn,
~505 points in play across 24h**, and it's zero-sum - one scorer per fish. Legendaries are 3.7%
of spawns but **32.5% of all points**, deliberately, because that steep curve is the only way a
player who sleeps through a stretch can still win. Windows are tight on purpose: the roster is
published beforehand, so players keep all 20 catch phrases pre-staged and the real test is
visual recognition, not typing. **Do not hardcode any of these numbers** - load them from
`config/fishing.json`.

### Image URLs (verified - use these directly)

Nookipedia's ACNH fish icons: 128×128 PNG, transparent, identical framing for every fish. All
20 confirmed returning HTTP 200 to a plain server-side request, no API key or user-agent needed.

```
Sea Bass           https://dodo.ac/np/images/7/7f/Sea_Bass_NH_Icon.png
Carp               https://dodo.ac/np/images/5/5d/Carp_NH_Icon.png
Crucian Carp       https://dodo.ac/np/images/f/f2/Crucian_Carp_NH_Icon.png
Bluegill           https://dodo.ac/np/images/0/0c/Bluegill_NH_Icon.png
Horse Mackerel     https://dodo.ac/np/images/a/a3/Horse_Mackerel_NH_Icon.png
Koi                https://dodo.ac/np/images/2/2d/Koi_NH_Icon.png
Salmon             https://dodo.ac/np/images/c/ca/Salmon_NH_Icon.png
Squid              https://dodo.ac/np/images/b/bf/Squid_NH_Icon.png
Red Snapper        https://dodo.ac/np/images/c/c1/Red_Snapper_NH_Icon.png
Pike               https://dodo.ac/np/images/9/9f/Pike_NH_Icon.png
Sturgeon           https://dodo.ac/np/images/9/91/Sturgeon_NH_Icon.png
Blue Marlin        https://dodo.ac/np/images/2/2a/Blue_Marlin_NH_Icon.png
Football Fish      https://dodo.ac/np/images/3/34/Football_Fish_NH_Icon.png
Napoleonfish       https://dodo.ac/np/images/3/30/Napoleonfish_NH_Icon.png
Giant Trevally     https://dodo.ac/np/images/1/17/Giant_Trevally_NH_Icon.png
Coelacanth         https://dodo.ac/np/images/4/45/Coelacanth_NH_Icon.png
Great White Shark  https://dodo.ac/np/images/2/20/Great_White_Shark_NH_Icon.png
Whale Shark        https://dodo.ac/np/images/4/4f/Whale_Shark_NH_Icon.png
Barreleye          https://dodo.ac/np/images/e/e0/Barreleye_NH_Icon.png
Golden Trout       https://dodo.ac/np/images/f/fc/Golden_Trout_NH_Icon.png
```

Put these in the `image` field of each fish in `config/fishing.json`. Do **not** substitute the
1280×720 `NH_{Name}.jpg` screenshots - those show a villager holding the fish with UI and
background, framing varies per fish, and some include a dialogue box naming the catch.

Also give each fish an `aliases` array; pre-fill the obvious ones (`Sea Bass` → `seabass`, `Great White Shark` →
`great white`, `Napoleonfish` → `napoleon fish`, `Red Snapper` → `snapper`, `Giant Trevally` →
`trevally`, `Barreleye` → `barrel eye`, `Football Fish` → `footballfish`) and leave the rest
empty. Aliases widen accepted strings; they do **not** turn on fuzzy matching.

## Live leaderboard (new - Bug Frenzy has no equivalent)

One message in the **leaderboard channel** (`leaderboard_channel` in config, separate from where
fish spawn), posted once at start and edited in place forever after.

- Never re-post on update.
- Update on every scoring catch and at each window close.
- Throttle to at most one edit per `leaderboard_min_edit_seconds` (default 5), with a trailing
  update so the final state always lands. Won't engage in normal play; it's for `test_mode`.
- Persist `leaderboardMessageId` and `leaderboardChannelId`.
- Every player with a score, sorted high→low, points and catch count, with
  `allowedMentions: { parse: [] }` so it doesn't ping anyone on each edit.
- Mark it as final on the last update, so it reads correctly after the game ends.

### The host pins it - so never replace it silently

**The bot does not pin.** It posts the message; the host pins it. That means the pin is bound to
one specific message ID, and a replacement message would be **unpinned** - leaving a pinned
message at the top of the channel frozen at a stale score, which is worse than no leaderboard at
all because it looks live.

Therefore:

- `start` must reply to the host with a **jump link to the leaderboard message**
  (`message.url`), so they can pin it immediately.
- If an edit throws because the message was deleted, post a replacement **and announce in the
  results/host channel that it needs re-pinning**, with the new jump link. Never handle this
  silently.
- Add `!fishingfrenzy leaderboard` - re-posts the message on demand and returns the jump link,
  for when the host wants to move or re-pin it.

## Admin commands

Prefix command, module shape `{ name, execute(message, args) }` in `src/commands/org/`, gated
on `PermissionFlagsBits.ManageGuild` - match `src/commands/org/bugfrenzy.js` exactly.

- `!fishingfrenzy start [#channel] [durationHours]` - begin; defaults to the configured channels
  and 24h. Posts the start announcement in the fishing channel, posts the leaderboard message in
  the leaderboard channel, and replies with a **jump link to pin**.
- `!fishingfrenzy leaderboard` - re-post the leaderboard message, return its jump link.
- `!fishingfrenzy stop` - end early, post the final tally.
- `!fishingfrenzy standings` - current leaderboard without ending the game.
- `!fishingfrenzy status` - active? time left, spawn count, next spawn ETA, test-mode state.
- `!fishingfrenzy spawn <fish name>` - force-spawn a specific fish now, for QA.
- `!fishingfrenzy test [on|off]` - toggle compressed intervals **and windows**. The reply should
  state both the interval and window it's now using, so a host can't be unsure whether it took.
- `!fishingfrenzy checkimages` - fetch all 20 images and report each one's status and byte size,
  plus a clear pass/fail summary. Must work **without** an active frenzy, so it can be run days
  ahead. This is the same warm-up fetch the start path does; share the code.

Because `start` overwrites any existing state for the guild, a test run needs no reset command -
starting the real game wipes the test scores. Worth stating in the `start` confirmation whether
test mode is currently on, since starting the real 24h game with it left on would burn through
the whole fish list in minutes.

## Persistence & restart safety

Persist to `data/fishing.json` keyed by guild ID, using the `load()`/`save()` pattern from
`bugFrenzy.js:47-64`:

- Active config: fishing channel ID, leaderboard channel ID, start/end time, `scoring_mode`.
- Per-player scores (points, catch count) and a full catch log (player, fish, points, timestamp)
  for auditing.
- `currentSpawn`: fish, `closeAt`, claiming user, spawn message ID.
- `leaderboardChannelId`, `leaderboardMessageId`, `nextSpawnAt`, `spawnCount`.

After a restart the bot must keep editing the **same** leaderboard message it posted before -
that message is the one the host pinned. Re-posting on resume would break the pin.

On startup resume any active, non-expired frenzy (`resumeAll`, wired in `src/events/ready.js`).
A spawn whose window closed during downtime is treated as expired - no points, no retroactive
awards.

## Final output (tally)

At expiry or `stop`, post to `results_channel` (falling back to the fishing channel):

- **Winner** and total. On a tie, say it's a tie and note that hosts will break it - **the bot
  must not pick a winner**, per `CLAUDE.md`.
- **Full leaderboard**, high→low, points and catches.
- **Summary:** total spawns, fish caught, fish that got away, rarest fish landed per player.

Use the chunked-send helper pattern from `bugFrenzy.js:305-316`.

## Config surface (put it all in one place)

`config/fishing.json` holds: the full fish list (name, rarity, window, points, weight, image,
aliases), `min_interval_minutes`/`max_interval_minutes`, `default_duration_hours`,
`scoring_mode`, `react_on_late`, `min_window_seconds`, `catch_phrase`, `spawn_message`,
`attachment_filename`, `image_upscale_px`, `announce_on_close`, `leaderboard_min_edit_seconds`,
`eligible_role_id`, `channel_id`, `leaderboard_channel`, `results_channel`, and the test-mode
settings.

Ship these channel defaults:

```jsonc
"channel_id":         "1538787163582238792",  // fishing-frenzy - spawns and catches
"leaderboard_channel":"1526348458099871916",  // live leaderboard message
"results_channel":    "1526348458099871916",  // final tally
```

Everything tunable without editing
logic - this repo's first rule (`CLAUDE.md`) is that hosts can change any value without a code
change.

## Acceptance criteria

1. Starting a frenzy schedules randomized, non-overlapping spawns in the one channel.
2. Every spawn message is **identical** apart from the image, and the attachment filename is the
   neutral configured name - no species name anywhere in the message, embed, attachment, or any
   URL a player can reach. Verify by right-clicking a posted image and copying its address: it
   must be a `cdn.discordapp.com` path, never `dodo.ac`.
3. All 20 images are fetched and cached at start; a fetch failure blocks the start with a report
   of which fish failed. No image is fetched from the network during a spawn.
4. The first valid in-window catch gets ✅ and the right points; **every** later attempt scores
   nothing and gets no reaction. Two simultaneous catches award exactly one player.
5. Out-of-window catches score nothing and produce no reaction.
6. The leaderboard posts to the leaderboard channel, `start` returns a jump link to pin, and the
   message edits in place as points are scored - including across a bot restart, still the same
   message ID. If it's deleted, the bot replaces it **and says so loudly** rather than silently.
7. `announce_on_close` names the fish after the window shuts **only when it was caught**; an
   uncaught fish produces no message at all.
8. Standings and final tally show correct per-player totals; a tie is reported, not resolved.
9. State survives a bot restart mid-frenzy.
10. `!fishingfrenzy spawn` force-spawns a named fish. `!fishingfrenzy test on` compresses both
    intervals **and** windows, so a 20-spawn dry run completes in roughly two minutes rather
    than five - verify the window actually shortened, not just the interval.
11. `!fishingfrenzy checkimages` runs with no active frenzy and reports all 20 individually.

Ask me before changing the scoring mode default, the balance numbers, or anything about how the
image is delivered - otherwise use the table and defaults above.

# CJ's Fishing Frenzy (F7) - build spec

Mechanical spec for the Everest bot implementation of **CJ's Fishing Frenzy**, the Final 7
Individual Immunity challenge. Hand `fishing-frenzy-claude-code-prompt.md` to Claude Code
inside the Everest bot repo - it should read the shipped Bug Frenzy implementation
(`src/handlers/bugFrenzy.js`) and mirror those conventions rather than inventing a parallel
structure.

This is Flick's Bug Frenzy (F14) rebuilt for individual play, with the creature's identity
hidden behind an image.

## Key design decisions (locked)

- **Individual, not tribal.** One shared `fishing-frenzy` channel, all 7 players. Scores key
  on user ID alone - the A/B tribe keying from Bug Frenzy collapses to a single `channel_id`.
- **First catch only.** `scoring_mode: "first_only"`. One fish, one scorer. Everyone after the
  first valid catcher is ignored - no reaction, no points. (Bug Frenzy shipped
  `all_in_window`; the flag already exists, this just flips the default.)
- **Visual ID, closed roster.** The bot posts an image of the fish and nothing else that
  identifies it. Players recognize the species by sight. The host posts a reference list of
  all 20 names in the channel before the challenge starts, so the candidate set is public and
  players can pre-stage their catch phrases - the skill being tested is **memorizing what each
  fish looks like**, not spelling and not research.
- **No indicator in the spawn message besides the image.** One fixed line of text, identical
  every single spawn, plus the image. No fish name, no per-fish flavor text, no rarity tell,
  no varying wording of any kind. See *Leak surfaces* below - this constraint extends past the
  message text into filenames and URLs.
- **Exact name matching, no fuzzy.** Same normalization as Bug Frenzy: lowercase, trim,
  collapse whitespace, strip trailing `!`/`.`. A typo loses the fish. This is deliberate and
  low-risk here because the roster is published - players copy from the reference post rather
  than typing from memory - and because under `first_only` a fumble simply hands the fish to
  whoever is second.
- **24 hours, most points wins.** Ties are broken by the hosts, not the bot (per `CLAUDE.md`:
  the bot does not adjudicate gameplay).
- **Two channels.** Spawns and catches happen in `fishing-frenzy` (`1538787163582238792`). The
  live leaderboard lives in a **separate** channel (`1526348458099871916`), so leaderboard edits
  never push a spawn image up the screen.
- **Live leaderboard, host-pinned.** One message, posted once by the bot and **pinned by the
  host**, edited in place for the rest of the game. The bot never pins and never silently
  replaces it - see *Live leaderboard* below for why that distinction matters.

## Player-facing writeup

The existing draft is accurate except for one sentence, which the Visual ID decision makes
wrong. Everything else stands as written.

**Replace this:**

> Each message will be sent with an image attached, where you will then have to find the name
> of the fish in the image and put it in your message to catch the fish.

**With this:**

> Each message will be sent with an image of the fish attached. The bot won't tell you what it
> is - you have to recognize the fish yourself and put its name in your message to catch it.
> I'll post the full list of fish that can appear before we start, so you'll know every name
> that's in play. What you won't know is which one you're looking at.

**Also replace this:**

> A live tracker of the leaderboard will be posted in this channel, as well.

**With this** - the leaderboard now lives in its own channel, so "this channel" would point
players at the wrong place:

> A live tracker of the leaderboard will be pinned in <#1526348458099871916>, updating as
> points are scored.

Two optional additions, both accurate to the build, neither required:

- *"When someone reels a fish in, the bot will say what it was. Miss one and you'll never find
  out."* (Matches `announce_on_close`, default on: caught fish are named, uncaught ones are not.)
- *"If two players finish tied on points, hosts will break the tie."*

## Core mechanic

1. A host starts the frenzy. Spawns go to `fishing-frenzy` (`1538787163582238792`); the
   leaderboard message goes to `1526348458099871916`.
   **Host prerequisites (not the bot's job):** both channels exist, `fishing-frenzy` is
   permissioned so only the 7 players can post, the leaderboard channel is read-only for
   players, the fish reference list is posted, and - right after `start` - the host **pins the
   leaderboard message** the bot links in its confirmation. The bot does not create channels,
   manage permissions, or pin.
2. For 24 hours, at randomized intervals, the bot picks a fish (weighted by rarity) and posts
   the spawn message plus that fish's image.
   - Spawn text, identical every time: `🎣 A fish bites! Reel it in!`
   - Image attached with a neutral filename. Nothing else in the message.
3. Each spawn has a catch window (seconds, per rarity - invisible to players). Players catch by
   posting `I reel in the {fish name}!` in the channel.
4. **First valid catch inside the window scores.** The bot reacts ✅ to that message and awards
   the fish's points. Every later attempt - right or wrong - is ignored silently.
5. When the window closes, the bot names the fish **only if someone caught it**. A fish nobody
   landed is never revealed, so missing one teaches you nothing for free.
6. The live leaderboard message updates.
7. After 24 hours the bot stops spawning, posts a final tally, and names the winner.

## Leak surfaces - the part that is easy to get wrong

"No indicator besides the image" is not only about message text. Three ways the answer leaks
even when the text is clean:

| Leak | How it happens | Fix |
|---|---|---|
| **Attachment filename** | Bot attaches `Coelacanth_NH_Icon.png`; Discord displays the filename under the image. | Attach with a fixed neutral name: `new AttachmentBuilder(buffer, { name: 'fish.png' })`. |
| **Source URL** | Image hot-linked into an embed via `.setImage(url)`. Right-click → Copy image address reveals `.../Coelacanth_NH_Icon.png`. | **Download the bytes and upload as an attachment.** Discord then re-hosts it on its own CDN and the source URL never reaches the client. |

Because the bot re-uploads rather than links, the *source* filenames can be as descriptive as
they like - which is what makes using Nookipedia's URLs directly viable (see *Image source*
below). The one thing that must never happen is putting a source URL where a player can see it.

Also worth noting: **window length itself is a tell** if surfaced. Never display the remaining
time, and never react ⌛ on late catches - that would confirm rarity. `react_on_late` stays
`false`.

## Catch validation

Normalize before matching: lowercase, trim, collapse internal whitespace, strip a trailing
`!` or `.`. A catch is **valid** when the normalized message equals
`i reel in the {fish name}` (name lowercased), the window is still open, and no one has
claimed this spawn yet.

- Valid → react ✅, record the point, mark the spawn claimed.
- Wrong name, window closed, or already claimed → **no reaction, no point, no reply.** Keep the
  channel clean and give away nothing.
- Each fish carries an optional `aliases` array (default empty for most, pre-filled where a
  natural shorter form exists - e.g. `Great White Shark` → `great white`). Aliases widen what's
  accepted; they do not enable fuzzy matching.
- Optional `eligible_role_id` (default `null`): when set, only members holding that role can
  score, so a host or spectator in the channel can't accidentally take a fish.

**Implementation requirement:** the claim must be recorded **synchronously, before any
`await`**. `first_only` is now the default rather than an option, so two near-simultaneous
catches are a real race. `bugFrenzy.js:211-224` gets this right - push to `caught`, add the
score, and `save()` all before calling `message.react()`. Do not reorder it.

## Scheduling

- Spawn interval: uniform random between `min_interval_minutes` and `max_interval_minutes`.
  **Defaults 8 and 18** (mean 13 min → ~111 spawns over 24h), carried over from Bug Frenzy.
- Never overlap spawns: a new fish only appears after the previous window has closed. If a
  rolled interval would land sooner, clamp it past the previous close.
- Fish selection: single weighted random pick over the full list. No tier logic at runtime -
  the weights encode rarity.
- `test_mode` compresses intervals to seconds for end-to-end dry runs, toggled by command so
  hosts never edit the config file mid-game.
- **`test_window_seconds` (default 5) must also override the per-fish window while test mode is
  on.** Bug Frenzy only compressed the *interval*, which worked there because its windows were
  3–10s. Fishing's windows are 8–20s and the anti-overlap clamp is
  `max(interval, window + 1s)` - so a 5–10s test interval gets swallowed whole and a Common
  still takes 21 seconds per cycle. Without this override, "test mode" is barely faster than
  live and a 20-spawn dry run takes five minutes instead of two.

## The fish table

Four rarity tiers, 20 fish, 5 per tier. `weight` is the relative spawn weight; `chance` is the
resulting per-spawn probability. Weights sum to **270**. Windows are seconds; points go to the
single first catcher.

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

Per-tier: Common 55.56%, Uncommon 29.63%, Rare 11.11%, Legendary 3.70%. All 20 are real
*Animal Crossing: New Horizons* fish, so an in-game render exists for every one.

### Balance math

At a 13-minute mean interval over 24 hours (~111 spawns):

| | Share of spawns | Share of all points | Expected spawns |
|---|---|---|---|
| Common | 55.6% | 12.2% | ~62 |
| Uncommon | 29.6% | 26.0% | ~33 |
| Rare | 11.1% | 29.3% | ~12 |
| Legendary | 3.7% | 32.5% | ~4 |

Expected value **4.56 points per spawn → roughly 505 points in play across the whole game.**

### Design intent - what individual play changes

Keep this in mind if you retune anything:

- **Scoring is zero-sum now.** Under Bug Frenzy's `all_in_window`, a wider window meant more
  people scored the same bug and totals inflated. Under `first_only` the pot is fixed at ~505
  points and every point one player takes is a point another cannot have.
- **Window length no longer decides who wins - recognition does.** The fastest present player
  takes the fish regardless of whether the window is 8 seconds or 80. Window length only
  changes the outcome when the fastest player *doesn't recognize the fish*, which is exactly
  the job the image is doing. This is why the windows can stay tight.
- **Tight windows are viable because the roster is published.** Players will keep all 20 catch
  phrases pre-staged, the same way Bug Frenzy players kept one phrase pre-copied. Nobody is
  typing a species name from scratch under time pressure - they're picking the right one of 20
  they already have ready. The 8-second Legendary window is a recognition test, not a typing
  test.
- **The point curve is the only catch-up mechanism.** 1/4/12/40 is deliberately steeper than
  Bug Frenzy's 1/3/8/25. Four Legendaries carry a third of the game's points, so a player who
  sleeps through a stretch of commons can still win by being awake for the right eight seconds.
  Flatten this curve and whoever is online most simply wins.
- **3 seconds is the hard floor** on any window - below that, network latency decides catches
  instead of players.
- **First tuning lever** if hour one comes in with a low catch rate: widen the Common window
  first (it's the least consequential), and only then the rest. Don't touch points mid-game -
  it makes earlier catches retroactively unfair.

## Live leaderboard

New for this build. **One message in its own channel (`1526348458099871916`), posted by the bot
and pinned by the host**, then edited in place for the rest of the game.

- Posted once when the frenzy starts. The `start` confirmation must include a **jump link to
  that message**, so the host can pin it immediately without hunting for it.
- Edited in place forever after - never re-posted on update.
- Updates on every scoring catch and at each window close.
- Throttled to at most one edit per `leaderboard_min_edit_seconds` (default 5), with a trailing
  update so the last change always lands. At roughly one catch every 13 minutes this will never
  actually engage; it's insurance against a burst during `test_mode`.
- `leaderboardMessageId` is persisted in state.
- Shows every player with a score, sorted high→low, with points and catch count. Suppress
  mention pings (`allowedMentions: { parse: [] }`).
- On the final update, mark it as final so it reads correctly after the game ends.

### Because the host pins it, the bot must not replace it silently

The pin belongs to a specific message ID. If the bot posts a replacement, that replacement is
**unpinned**, and the pinned message at the top of the channel silently freezes at whatever the
score was when it died - actively misleading, and nobody notices for hours.

So: if an edit fails because the message is gone, the bot posts a fresh one **and announces in
the host/results channel that the leaderboard was replaced and needs re-pinning**, including the
new jump link. Loud, not silent. Never treat a failed edit as routine.

`!fishingfrenzy leaderboard` re-posts the message on demand and returns the jump link, for when
the host wants to move or re-pin it.

The bot therefore does **not** need Manage Messages. It needs Send Messages and the ability to
edit its own messages in the leaderboard channel - nothing more.

## Commands

Prefix commands matching `src/commands/org/bugfrenzy.js`, gated on **Manage Server**.

| Command | Effect |
|---|---|
| `!fishingfrenzy start [#channel] [durationHours]` | Begin. Defaults to the configured channels and 24h. Posts the start announcement, posts the leaderboard message, and **replies with a jump link to pin**. |
| `!fishingfrenzy leaderboard` | Re-post the leaderboard message and return its jump link, for re-pinning. |
| `!fishingfrenzy stop` | End early, post the final tally. |
| `!fishingfrenzy standings` | Current leaderboard, without ending the game. |
| `!fishingfrenzy status` | Active? Time remaining, spawn count, next spawn ETA, test-mode state. |
| `!fishingfrenzy spawn <fish name>` | Force-spawn a specific fish now (QA). |
| `!fishingfrenzy test [on\|off]` | Toggle compressed spawn intervals **and windows** for a dry run. |
| `!fishingfrenzy checkimages` | Fetch all 20 images and report size + any failures. Run before game day. |

### Dry-run procedure

`start` wipes any previous state, so a test run costs nothing - no reset command needed.

1. `!fishingfrenzy checkimages` - confirms all 20 fetch. Do this days ahead, not on game day.
2. `!fishingfrenzy test on` - compresses intervals *and* windows to seconds.
3. `!fishingfrenzy start #test-channel 0.05` - a 3-minute game in a scratch channel. Confirm the
   reply includes a jump link to the leaderboard message, and pin it.
4. `!fishingfrenzy spawn Coelacanth` - verify a known fish end to end.
   - **Right-click the image → Copy image address.** It must be `cdn.discordapp.com`, never
     `dodo.ac`. This is the single check that matters most; a leaked source URL hands players
     the answer key.
   - Confirm the filename under the image reads `fish.png`.
   - Catch it, confirm ✅ and the leaderboard edit.
   - Have a second account catch the same fish after - confirm **no** reaction and no points.
   - Let one expire uncaught - confirm the close announcement names it.
5. `!fishingfrenzy status` and `standings` mid-run.
6. Restart the bot mid-run - confirm it resumes and keeps editing the **same** leaderboard
   message (the pin must survive the restart).
7. Delete the leaderboard message mid-run - confirm the bot posts a replacement **and warns you
   it needs re-pinning**, rather than silently carrying on.
8. `!fishingfrenzy stop` - confirm the tally.
9. **`!fishingfrenzy test off`** before the real game. Worth a checklist item: starting the real
   24h game with test mode still on would spawn all 20 fish inside a few minutes.

The one thing none of this covers is the simultaneous-catch race - two catches landing in the
same tick. That needs a unit test against the handler rather than live play; see the
concurrency note under *Catch validation*.

## Persistence & restart safety

The frenzy runs 24 hours and the bot may restart. Persist to `data/fishing.json`, keyed by
guild ID, matching the `load()`/`save()` pattern in `bugFrenzy.js:47-64`:

- Active config: channel ID, start/end time, `scoring_mode`.
- Per-player scores (points, catch count) and the full catch log (player, fish, points,
  timestamp) for auditing.
- `currentSpawn` including `closeAt`, the claiming user if any, and the spawn message ID.
- `leaderboardMessageId`, `nextSpawnAt`, `spawnCount`.

On startup, resume any active non-expired frenzy. A spawn whose window closed during downtime
is simply treated as expired - no points, no retroactive award.

## Final tally

At 24 hours or on `stop`, post to the configured results channel (falling back to the fishing
channel):

- **Winner** and their point total. On a tie, say so plainly and state that hosts will break it
  - the bot does not pick.
- **Full leaderboard**, every player sorted high→low with points and catches.
- **Summary:** total spawns, total fish caught, how many got away, and the rarest fish landed by
  each player.

Reuse the chunked-send helper (`bugFrenzy.js:305-316`) - the tally can exceed Discord's limit.

## Everything tunable

All of it lives in `config/fishing.json`. No number in the table above may be hardcoded in
logic. The config surface:

```jsonc
{
  "channel_id": "1538787163582238792",       // fishing-frenzy: spawns and catches
  "leaderboard_channel": "1526348458099871916", // live leaderboard message
  "results_channel": "1526348458099871916",  // final tally; swap for a host channel if preferred
  "eligible_role_id": null,             // restrict scoring to the 7 players
  "min_interval_minutes": 8,
  "max_interval_minutes": 18,
  "default_duration_hours": 24,
  "scoring_mode": "first_only",         // "first_only" | "all_in_window"
  "react_on_late": false,               // keep false - a ⌛ would leak rarity
  "min_window_seconds": 3,              // hard floor, do not lower
  "catch_phrase": "i reel in the {fish}",
  "spawn_message": "🎣 A fish bites! Reel it in!",
  "attachment_filename": "fish.png",    // neutral - never the species name
  "image_upscale_px": 384,              // 0 to disable; icons are 128px natively
  "announce_on_close": true,
  "leaderboard_min_edit_seconds": 5,
  "test_mode": false,
  "test_interval_seconds": { "min": 5, "max": 10 },
  "test_window_seconds": 5,             // overrides per-fish windows in test mode

  "fish": [
    { "name": "Sea Bass", "rarity": "Common", "window": 20, "points": 1,
      "weight": 30, "aliases": ["seabass"],
      "image": "https://dodo.ac/np/images/7/7f/Sea_Bass_NH_Icon.png" }
    // ...19 more
  ]
}
```

Tunable without a code change: the fish list and every field on it (name, rarity, window,
points, weight, image, aliases), spawn interval, duration, scoring mode, catch phrase, spawn
message, attachment filename, the leaderboard throttle, the eligibility role, and both
announce toggles.

## Image source - resolved, no sourcing work needed

Nookipedia hosts a complete, uniform set of ACNH fish icons: **128×128 PNG, transparent
background, identical framing for every fish.** Exactly the right shape for a recognition
puzzle - clean render, no text, no scenery, no framing tell.

Verified against Nookipedia's MediaWiki API: all 20 fish resolve, all return HTTP 200 with real
image bytes to a plain server-side request (no browser user-agent needed, no API key). File
naming is uniform: `File:{Name} NH Icon.png`.

| Fish | Image URL |
|---|---|
| Sea Bass | `https://dodo.ac/np/images/7/7f/Sea_Bass_NH_Icon.png` |
| Carp | `https://dodo.ac/np/images/5/5d/Carp_NH_Icon.png` |
| Crucian Carp | `https://dodo.ac/np/images/f/f2/Crucian_Carp_NH_Icon.png` |
| Bluegill | `https://dodo.ac/np/images/0/0c/Bluegill_NH_Icon.png` |
| Horse Mackerel | `https://dodo.ac/np/images/a/a3/Horse_Mackerel_NH_Icon.png` |
| Koi | `https://dodo.ac/np/images/2/2d/Koi_NH_Icon.png` |
| Salmon | `https://dodo.ac/np/images/c/ca/Salmon_NH_Icon.png` |
| Squid | `https://dodo.ac/np/images/b/bf/Squid_NH_Icon.png` |
| Red Snapper | `https://dodo.ac/np/images/c/c1/Red_Snapper_NH_Icon.png` |
| Pike | `https://dodo.ac/np/images/9/9f/Pike_NH_Icon.png` |
| Sturgeon | `https://dodo.ac/np/images/9/91/Sturgeon_NH_Icon.png` |
| Blue Marlin | `https://dodo.ac/np/images/2/2a/Blue_Marlin_NH_Icon.png` |
| Football Fish | `https://dodo.ac/np/images/3/34/Football_Fish_NH_Icon.png` |
| Napoleonfish | `https://dodo.ac/np/images/3/30/Napoleonfish_NH_Icon.png` |
| Giant Trevally | `https://dodo.ac/np/images/1/17/Giant_Trevally_NH_Icon.png` |
| Coelacanth | `https://dodo.ac/np/images/4/45/Coelacanth_NH_Icon.png` |
| Great White Shark | `https://dodo.ac/np/images/2/20/Great_White_Shark_NH_Icon.png` |
| Whale Shark | `https://dodo.ac/np/images/4/4f/Whale_Shark_NH_Icon.png` |
| Barreleye | `https://dodo.ac/np/images/e/e0/Barreleye_NH_Icon.png` |
| Golden Trout | `https://dodo.ac/np/images/f/fc/Golden_Trout_NH_Icon.png` |

Two operational requirements that come with using someone else's host:

- **Cache at start, not per spawn.** Fetch all 20 into memory (or `data/fishcache/`) when the
  frenzy starts, and serve every spawn from cache. If `dodo.ac` is slow or down at the moment a
  Legendary is due, a live fetch would delay or kill the spawn - during a 24-hour immunity
  challenge that's unacceptable. Cached, an outage mid-game is irrelevant.
- **Fail loudly at start.** If any of the 20 can't be fetched during that warm-up, refuse to
  start and say which ones. Better to fix it before the game than to discover it 14 hours in.

Do **not** switch to the 1280×720 `NH_{Name}.jpg` screenshots. They show a villager holding the
fish with UI and background, framing varies per fish, and some include a dialogue box naming
the catch.

**Optional polish:** 128×128 renders small in Discord. `jimp` is already a dependency in
`package.json` - upscaling to 384×384 or 512×512 at cache time (nearest-neighbour, to keep the
pixel art crisp) makes them far easier to read at a glance without changing the puzzle.

**The reference post.** Ready to paste into the channel before the challenge starts:

> **Fish that can appear:**
> Barreleye · Blue Marlin · Bluegill · Carp · Coelacanth · Crucian Carp · Football Fish ·
> Giant Trevally · Golden Trout · Great White Shark · Horse Mackerel · Koi · Napoleonfish ·
> Pike · Red Snapper · Salmon · Sea Bass · Squid · Sturgeon · Whale Shark
>
> Catch with: `I reel in the <fish name>!`

Listing them alphabetically rather than by rarity keeps the tiers hidden.

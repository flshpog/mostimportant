# Claude Code task: build "Flick's Bug Frenzy" for the Everest bot

## What you're building

Add a timed, 24-hour tribe challenge called **Flick's Bug Frenzy** to our existing Discord bot ("Everest bot"). Two tribes compete in parallel. The bot drops "bugs" into each tribe's own channel at random intervals; players catch them by replying with a set phrase; the bot reacts ✅ to valid catches and awards points. After 24 hours, the tribe with the higher **total** point count wins immunity.

**Do not scaffold a new bot.** First inspect the existing Everest bot codebase - identify the framework (discord.py / discord.js / other), the command style, the config/env conventions, and how existing features are structured - then implement this feature *in that same style and framework*. Match existing patterns for command registration, persistence, logging, and permissions.

## Core mechanic (exact behavior)

1. An admin starts the frenzy, pointing the bot at **two channels**, one per tribe, and giving each a tribe label. **Host prerequisite (not the bot's job):** the host creates both channels ahead of time and sets permissions so each channel is visible/typable **only** to its own tribe. The bot does not create channels or manage permissions - it only posts, reads, and reacts in the channels it's handed. Scoring keys off *which channel* a catch happens in, so tribe-exclusive channel permissions are what keep the tribes separated; if both tribes could post in a channel the scoring would be invalid. The bot only needs Read Messages / Send Messages / Add Reactions / Read Message History in those two channels.
2. For the next 24 hours, at **randomized intervals**, the bot picks a bug (weighted by rarity - see table) and posts an **identical** spawn message to **both** tribe channels at the **same moment**. Fairness requirement: same bug, same time, same catch window in both channels. The only variable between tribes is player activity.
   - Spawn message format: `🪲 A **{bug name}** {flavor}! Type \`I catch the {bug name}!\` to catch it!`
   - Example: `🪲 A **Golden Stag** lands on the tree! Type \`I catch the Golden Stag!\` to catch it!`
3. Each spawn has a **catch window** (seconds, per rarity). Players catch by sending a message in their tribe's channel matching the catch phrase.
4. **Scoring model (DEFAULT - everyone-in-window):** *Every unique player* who posts a valid catch **within the window** earns that bug's point value. The bot reacts ✅ to each valid catch message. A given player can only catch a given spawn once (ignore/no-react their duplicate attempts). This is what makes "who's online more" the deciding factor.
   - Make this a config flag `scoring_mode: "all_in_window" | "first_only"`. `first_only` = only the first valid catcher scores (react ✅ to them, ignore everyone after). Ship with `all_in_window`.
5. Points are tracked **per individual player**, and a tribe's score is the **sum of its members' points**. Higher tribe total after 24h wins.
6. When the 24h timer ends, the bot **stops spawning**, posts a final tally (see Output), and declares the winning tribe.

## Catch validation

Normalize the incoming message before matching: lowercase, trim, collapse internal whitespace, strip a trailing `!`/`.`. A catch is **valid** when the normalized message equals `i catch the {bug name}` (bug name lowercased) **and** the message arrives while that bug's window is still open **and** the sender hasn't already caught this specific spawn.

- Valid catch → react ✅ to the message, record the point.
- Wrong bug name, or after the window closed, or a repeat by the same user → no point. Default: no reaction (keep the channel clean). Optionally, add a config flag to react ⌛ on a correct-but-too-late catch - off by default.
- Matching is per active spawn per channel. If two spawns were ever active at once in a channel (shouldn't happen - see scheduling), match against any currently-open spawn.

## Scheduling

- Spawn interval: random, uniform between `min_interval` and `max_interval`. **Defaults: 8 and 18 minutes** (~90–110 spawns over 24h). Both configurable.
- Never overlap spawns within a channel: a new bug only spawns after the previous window has closed. If a random interval would land before the last window closes, clamp it so the next spawn starts after the previous window ends.
- Bug selection: single **weighted random pick** over the full bug list using each bug's weight (table below). No tier logic needed at runtime - the weights already encode rarity.
- Both channels always receive the **same** scheduled bug at the **same** timestamp.

## THE BUG TABLE (bugs / windows / points / spawn chance)

Four rarity tiers, 20 bugs. `weight` is the relative spawn weight used for the weighted pick; `chance` is the resulting per-spawn probability (weights sum to 332). Windows are seconds; points are per valid catch.

| Bug | Rarity | Window (s) | Points | Weight | Chance |
|---|---|---|---|---|---|
| Common Butterfly | Common | 20 | 1 | 36 | 18.2% |
| Pill Bug | Common | 20 | 1 | 36 | 18.2% |
| Mosquito | Common | 20 | 1 | 36 | 18.2% |
| Ladybug | Uncommon | 13 | 3 | 20 | 10.1% |
| Grasshopper | Uncommon | 13 | 3 | 20 | 10.1% |
| Praying Mantis | Uncommon | 13 | 3 | 20 | 10.1% |
| Emperor Butterfly | Rare | 7 | 8 | 8 | 4.0% |
| Scarab Beetle | Rare | 7 | 8 | 8 | 4.0% |
| Tarantula | Rare | 7 | 8 | 8 | 4.0% |
| Golden Stag | Legendary | 5 | 25 | 3 | 1.5% |
| Horned Hercules | Legendary | 5 | 25 | 3 | 1.5% |

Weights sum to 198.

Design intent (so you keep balance if you refactor): windows are deliberately tight because players keep the catch phrase pre-copied and at least one tribe member is active nearly around the clock - so the real skill is *being on the channel the instant a bug drops*, not typing speed. Commons (20s) should be caught nearly every time; legendaries (5s) should be genuinely hard and only landed by someone actively watching at that moment. **3 seconds is the hard floor** - do not set any window below 3s, since Discord/network latency would start deciding catches instead of the player. The window clock starts at the moment the bot's spawn message is posted. **Do not hardcode these numbers throughout the code** - load them from a single config object/file so we can tune spawn rate, windows, points, and weights without touching logic. Include a per-bug optional `flavor` string for the spawn message (e.g. Golden Stag → "lands on the tree", Tarantula → "skitters out!", Mosquito → "buzzes past") with a sensible generic fallback.

## Admin commands

Use our existing command framework and restrict these to admins/hosts (match how we gate other host-only commands):

- **Start:** `!bugfrenzy start <#channelA> <TribeAName> <#channelB> <TribeBName> [durationHours]` - designates the two tribe channels + labels, begins the frenzy, schedules spawns. `durationHours` optional, default 24. Post a start confirmation in each channel. **Our actual channels:** Tribe A = channel ID `1533508022494822510`, Tribe B = channel ID `1533508060973367356`. Accept channel mentions or raw IDs, and default to these two IDs if none are passed.
- **Stop / cancel:** `!bugfrenzy stop` - ends the frenzy early, stops spawns, posts the final tally.
- **Standings:** `!bugfrenzy standings` - posts current tribe totals + top individual catchers per tribe, without ending the game.
- **Manual spawn (testing):** `!bugfrenzy spawn <bug name>` - force-spawns a specific bug into both channels right now. For QA.
- **Status:** `!bugfrenzy status` - shows whether a frenzy is active, time remaining, spawn count so far, next spawn ETA.

## Persistence & restart safety

The frenzy runs 24h; the bot may restart mid-game. Persist (in whatever store the bot already uses - SQLite/JSON/etc.):

- Active frenzy config: channel IDs, tribe labels, start time, end time, scoring_mode.
- Per-player scores (player id, tribe, points, catch count) and per-tribe totals.
- Enough scheduling state to resume: on startup, if a frenzy is active and not expired, resume spawning until the stored end time. In-flight spawns whose window has closed during downtime are simply treated as expired (no points) - that's acceptable.

Record each catch (player, bug, points, timestamp) so we can audit/verify.

## Final output (tally)

At end (timer expiry or `stop`), post to both channels (and/or a host channel):

- **Winner:** which tribe won immunity, with both tribe totals.
- **Per-tribe individual leaderboard:** each player and their points, sorted high→low.
- **Summary stats:** total spawns, bugs caught per tribe, rarest bug caught by each tribe.

## Config surface (put it all in one place)

Expose, in one config file/object: the full bug list (name, rarity, window, points, weight, flavor), `min_interval`/`max_interval`, `default_duration_hours`, `scoring_mode`, and the react-on-late toggle. Everything tunable without editing logic.

## Acceptance criteria

1. Starting a frenzy schedules randomized, non-overlapping spawns and posts identical bugs to both channels at the same time.
2. Valid in-window catches get ✅ and score correct points per the table; duplicates by the same user and out-of-window catches score nothing.
3. `scoring_mode` toggles between all-catchers-score and first-only.
4. Standings and final tally show correct per-player and per-tribe totals.
5. State survives a bot restart mid-frenzy.
6. `!bugfrenzy spawn` lets us QA a specific bug on demand; consider a hidden test flag to compress intervals to seconds for a fast end-to-end dry run.

Ask me before changing the scoring model default or the balance numbers - otherwise use the table and defaults above.
# Love Day (F10) - build spec + Claude Code prompt

Mechanical spec for the Everest bot implementation of Love Day: "For Better, For Worse." Hand the prompt at the bottom to Claude Code inside the Everest bot repo - it should read the existing bot's command/persistence conventions and match them rather than inventing a parallel structure.

## Key design decisions (locked)

- **Pairing:** `/loveday resident:<user> pal:<user>` - slash command, **staff role only**. Must be run inside the private channel that will serve as that pair's game channel; registers `channel_id ↔ {resident, pal}`. Re-running it in the same channel overwrites the existing registration (lets staff fix a mis-pairing). Registering the same resident in a second channel should be rejected - one active pair per resident.
- **Start trigger:** `!loveday` - prefix command, run by either the resident or the pal, in their registered channel. Starts that pair's clock and kicks off Round 1.
- **Progress trigger:** `!unlock <answer>` - same command name reused every round. Accepts the answer either space-separated after the command, or hyphenated directly into the command token (`!unlock-autumn-punch-tide-morning-harvest-cove`). Correct answer advances the pair to the next round (or finishes them, on Round 4).
- **Winner determination:** manual, off-bot. Staff just compares the `!loveday` timestamp against the finish message's timestamp in each pair's channel - whichever duo has the shortest gap wins. No leaderboard/status command needed.
- **No failure state:** wrong `!unlock` guesses just get a "not quite, try again" reply. No lockout, no cooldown, no penalty of any kind, and nothing needs to be logged beyond that reply.
- **Silent no-ops:** `!loveday` or `!unlock` do nothing (no reply at all) when run by someone who isn't the registered resident/pal for that channel, in a channel with no registered pair, before the pair has started (for `!unlock`), or after the pair has finished. This matches the "if the user is none, do nothing" rule from the original spec, extended consistently to every invalid-state case.

## Commands

| Command | Who | Where | Effect |
|---|---|---|---|
| `/loveday resident:<user> pal:<user>` | Staff only | Pair's private channel | Registers the pair against this channel. |
| `!loveday` | Resident or pal of a registered, not-yet-started pair | Their registered channel | Starts the clock, sets round = 1, DMs both halves their Round 1 images, posts in-channel that the answer type is "a string of words." |
| `!unlock <answer>` / `!unlock-<hyphenated-answer>` | Resident or pal of a started, unfinished pair | Their registered channel | Checks the answer against the current round. Correct → advance (see round table), or finish on Round 4. Incorrect → reply to retry. |

## Data model

One record per pair (JSON file is fine if the repo doesn't already have a DB pattern for this - match whatever the existing bot uses for Bug Frenzy/May Day state if there is one):

```json
{
  "channel_id": "...",
  "resident_id": "...",
  "pal_id": "...",
  "current_round": 1,
  "started_at": null,
  "finished_at": null
}
```

## Round content

Fill in the image CDN URLs - leaving placeholders here.

| Round | Resident image | Pal image | Accepted answer | Announced answer type |
|---|---|---|---|---|
| 1 | `RESIDENT_IMG_1_URL` | `PAL_IMG_1_URL` | `autumn punch tide morning harvest cove` (exact order) | "a string of words" |
| 2 | `RESIDENT_IMG_2_URL` | `PAL_IMG_2_URL` | `4` or `four` | "a number" |
| 3 | `RESIDENT_IMG_3_URL` | `PAL_IMG_3_URL` | `vows` | "a word" |
| 4 | `RESIDENT_IMG_4_URL` | `PAL_IMG_4_URL` | `here's to my herd always` (exact order, punctuation-insensitive) | *(final - no next round)* |

On Round 4 success: set `finished_at`, post in the pair's channel - *"You're finished! Staff will snowflake you shortly."* (exact wording as given; swap it if that was a typo for something else) - and stop responding to further `!unlock` calls for that pair. No time math, no announcement of who's winning - staff reads the `!loveday` and finish-message timestamps directly off the channel to see who was fastest.

## Answer normalization

- Lowercase everything before comparing.
- Strip apostrophes, commas, and periods (`here's` → `heres`, `herd,` → `herd`).
- Collapse repeated whitespace.
- Tokenize on whitespace when the answer follows `!unlock ` with a space; tokenize on hyphens when it's fused as `!unlock-word-word-word`.
- Round 1 and Round 4 compare the full ordered token sequence. Round 2 and Round 3 compare a single token.
- Round 2 needs a small digit↔word lookup (at least one–ten) so `4` and `four` both resolve to the same accepted value - build this as a reusable helper since future rounds/seasons may reuse the number-answer pattern.

## Edge cases

- `/loveday` run for a resident already registered elsewhere → reject with an ephemeral error, don't overwrite the other pair.
- `/loveday` run twice in the same channel → overwrite (production fixing a mis-pairing).
- `!unlock` before `!loveday` → silent no-op.
- `!unlock` after the pair has finished → silent no-op.
- Wrong guesses → no cap, no penalty, nothing else happens besides the retry reply.
- Bot needs DM permission with both the resident and the pal - the pal isn't a normal server member, so confirm invites/permissions let the bot DM them before this goes live.

## Everything tunable

Round images, the accepted answer per round, the announced answer-type string, and the staff role gate should all be easy to change without a code change - same principle as the Bug Frenzy config file.

---

## Prompt for Claude Code

```
I need to add a "Love Day" mini-game to the Everest Discord bot. Read the existing command
and persistence patterns in this repo first (look at how prior challenge commands are
structured, e.g. anything from Bug Frenzy or May Day) and match those conventions rather
than introducing a new pattern.

Build these three commands:

1. `/loveday resident:<user> pal:<user>` - slash command, restricted to a staff role
   (make the role configurable). Must be run inside the channel that will be this
   pair's private game channel. Registers channel_id -> {resident_id, pal_id,
   current_round: 1, started_at: null, finished_at: null}. If the
   resident is already registered in a different channel, reject with an ephemeral error.
   If this exact channel already has a registration, overwrite it.

2. `!loveday` - prefix command. Only takes effect if the invoking user is the resident or
   pal registered to the channel it's run in, AND that pair hasn't started yet
   (started_at is null). Otherwise do nothing - no reply at all. On success: set
   started_at to now, DM the resident their Round 1 resident-image, DM the pal their
   Round 1 pal-image, and post in the channel that the bot has DMed both of them their
   starting images and that the answer to this puzzle is "a string of words."

3. `!unlock <answer text>` and the equivalent `!unlock-word-word-word` form (hyphens
   fused directly into the command token instead of a space before the args) - prefix
   command. Only takes effect if the invoking user is the resident or pal of a pair
   registered to the channel, that pair has started, and it hasn't finished yet.
   Otherwise do nothing.

   Normalize the submitted answer: lowercase, strip apostrophes/commas/periods, collapse
   whitespace, and tokenize on whitespace (space-separated form) or hyphens (fused form).

   Compare against the current round's accepted answer:
     Round 1 (ordered word sequence): autumn punch tide morning harvest cove
     Round 2 (single token, accept digit or spelled word): 4 / four
     Round 3 (single token): vows
     Round 4 (ordered word sequence): here's to my herd always

   [I'll give you the actual image CDN URLs for all 8 images (resident + pal, rounds 1-4)
   separately - leave clearly named placeholder constants for RESIDENT_IMG_1..4_URL and
   PAL_IMG_1..4_URL so I can drop them in.]

   On a correct answer for rounds 1-3: increment current_round, DM the resident their next
   round's resident-image, DM the pal their next round's pal-image, and post in the channel
   what the next round's answer type is ("a number" after round 1, "a word" after round 2,
   and after round 3 just say the puzzle's solved when they get it right - no next answer
   type to announce since round 4 is the last one).

   On a correct answer for round 4: set finished_at to now, post in the channel exactly:
   "You're finished! Staff will snowflake you shortly." and stop responding to any further
   !unlock calls in that channel. Don't compute or announce elapsed time or ranking -
   staff determines the winner manually by comparing the !loveday and finish-message
   timestamps in each pair's channel.

   On an incorrect answer at any round: reply in the channel with a light "not quite, try
   again" message. No other penalty, no cooldown, no attempt cap, nothing needs to be
   logged.

Persistence: use whatever this repo already uses for challenge state (JSON file, SQLite,
etc. - check existing challenge commands for the pattern). One record per pair as
described above.

Keep the accepted answers, image URLs, and the staff-role gate easy to change in one place
without touching the command logic, matching how the rest of this bot keeps
challenge-specific values tunable.
```

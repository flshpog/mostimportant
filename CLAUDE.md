# CLAUDE.md — Everest Hub Bot / Nook's Cranny Economy

## What this is

A Discord bot for **Everest Survivor S2**, an Animal Crossing–themed Survivor ORG.
This build adds the **Nook's Cranny economy**: bell-earning commands, a rotating shop,
player inventories, and host tooling.

Read `SPEC.md` for the full mechanical spec. It is authoritative. If this file and
`SPEC.md` disagree, `SPEC.md` wins.

## The single most important rule

**The hosts must be able to change literally everything without a code change.**

The host said, verbatim: *"I don't want ANY variables that I cannot change."*

Every number — prices, cooldowns, payout ranges, stock counts, slot caps, percentages,
channel IDs, the timezone — lives in `config/economy.json` (or the equivalent for this
repo's existing stack). Nothing is a magic number in a handler. If you find yourself
typing a number inside game logic, stop and move it to config.

## The second most important rule

**This is an ORG. Information is the game.**

- Balances are **private**. Item ownership is **private**.
- `/inventory` and `/cooldown` are **ephemeral, always**.
- Purchases are **silent** to players. No public "X bought something" message.
- Deliveries are **silent**. No announcement of who sent what to whom.
- The only public artifact is the shop post itself (stock counts visible, buyers not).
- Anything that leaks who owns what is a **bug**, not a feature request.

The one exception is the host log channel, which is host-only and should be verbose.

Every host command is gated on the **host category** `1414321682415357964` — any
channel inside it is safe, anything outside it is not. This is a backstop behind role
permissions, not a replacement for them. `/taxreturns` in particular is non-ephemeral
and dumps every ownership relationship in the game; if that gate fails open, it fails
open into a player channel.

## The third rule

**The bot does not adjudicate gameplay. Hosts do.**

- The bot does **not** roll Star Wand immunity, Golden Rod vote counts, or any
  flimsy-tool percentage. Hosts roll those by hand.
- The bot does **not** consume items on use. Hosts remove them via `/editinventory`.
- The bot does **not** track rounds, phases, challenges, or tribals.
- The bot does **not** deduct house payments automatically. Hosts deduct manually.

The **only** RNG the bot performs is income variance on `/rock`, `/tree`, `/bottle`.

Do not add automation the spec doesn't ask for. Every piece of automation is a thing
the hosts can no longer override mid-game, and they have chosen manual control
deliberately.

## Existing codebase

This bot already exists and already has `/initializeplayerroles`. Match the existing
stack, storage layer, command registration pattern, and error handling. **Do not**
introduce a new database, ORM, or framework. If the repo uses JSON files, use JSON
files. If it uses SQLite, use SQLite.

`/inventory` gates on the player role list established by `/initializeplayerroles`.

## Conventions

- **Timezone:** `America/New_York` for all scheduling. Never UTC in user-facing text.
- **Bells emoji:** `<:Bells:1530232089021124711>` — this exact ID. There is a
  near-identical emoji from another server with ID `738250012932440176`. It will render
  as raw text. Do not use it.
- **Money formatting:** comma-separated, no decimals. `7,500`
- **Item IDs:** integers 1–24, defined in `SPEC.md`. Stable forever — never renumber.
  Host-facing fields accept IDs; player-facing text always shows item names.
- **Errors:** ephemeral, plain language, never a stack trace. A player seeing
  "TypeError" during tribal week is a bad night for everyone.

## Build order

1. Config + data model + item registry (IDs, prices, stock, flags)
2. Income commands + additive cooldown reduction + `/cooldown`
3. `/inventory`, `/buy`, slot cap enforcement
4. Shop state machine + `/setupshop` + embed rendering
5. `/queueshop` + the midnight scheduler
6. Host tools: `/viewinventory`, `/editinventory`, `/eliminate`, `/deliver`,
   `/counterfeit`, `/grant`, `/deduct`, `/resetcooldown`, `/taxreturns`
7. Logging to the host channel

Ship 1–3 working before touching 4. The income commands going live is the launch
requirement; the shop can follow an hour later.

## Things that have already been decided — do not re-litigate

- Watering Can cooldown reductions stack **additively**, not multiplicatively.
  Yes, this means the theoretical max is −85%. Nobody will own all three. It's fine.
- Wasp penalty is an **extended cooldown**, not a bell loss. Reduction applies to the
  base cooldown *first*, then the result is doubled.
- Eliminated players are frozen entirely. This is the biggest exploit surface in the
  game (a 6-person jury farming bells for an ally) and `/eliminate` is the only thing
  standing in front of it.
- Redd's Counterfeit items must be **indistinguishable** from real ones in
  `/inventory`. Same name, same description, no marker of any kind.
# SPEC.md - Nook's Cranny Economy

Authoritative mechanical spec. Every number here belongs in config, not in code.

---

## 1. Income commands

Three commands. **One global cooldown**: running any one of them locks *all three*
for that command's duration.

| Command | Payout | Base cooldown |
|---|---|---|
| `/rock` | 180–220 | 8h |
| `/tree` | 60%: 700–800 · 40%: **0 bells + wasps** | 12h (24h if wasps) |
| `/bottle` | 80%: 90–110 · 20%: 2,400–2,600 | 24h |

All ranges and probabilities are config values. The tilde amounts above are the
intended feel; the ranges are the implementation.

**This is the only RNG in the bot.** Everything else is host-rolled.

### Wasps

On a wasp result the player gets **0 bells** and the cooldown is **doubled**.

Order of operations matters:

```
effective_cooldown = base_cooldown * (1 - total_reduction)
if wasps: effective_cooldown *= 2
```

Reduction applies to the base **first**, then the doubling. A player with −50% who
gets stung sits at 12h, not 24h - the penalty stays proportional to their build.

### Cooldown reduction - additive

| Source | Reduction | Duration | Item ID |
|---|---|---|---|
| Golden Watering Can | −50% | Permanent, once per player | 12 |
| Watering Can | −25% | Permanent | 20 |
| Flimsy Watering Can | −10% | Next **10 income commands** | 24 |

**Additive.** `total_reduction = 0.50 + 0.25 + 0.10` where owned. Max possible −85%.
This is intentional and has been confirmed. Do not implement multiplicative stacking.

- Permanent reductions apply from purchase, forever, and survive elimination flags.
- The Flimsy counter decrements **once per income command run**, regardless of which
  command. At 0 uses the effect expires and is removed.
- Whether multiple Flimsy Watering Cans stack with each other is a **config flag**
  (`flimsy_wc_stacks`, default `true`, each instance tracked with its own counter).
- None of the three occupy an inventory slot.

### `/cooldown`

Ephemeral. Shows time remaining on the global lock, which command set it, the
player's current total reduction, and Flimsy uses remaining if any.

When an income command is run during cooldown, the failure message shows the time
remaining - never a bare "on cooldown."

---

## 2. Item registry

IDs are permanent. Never renumber. Host-facing inputs accept IDs; player-facing text
always shows names.

### Store Specials (2 in rotation per round)

| ID | Item | Price | Stock |
|---|---|---|---|
| 1 | Nook Family Tax Returns | 7,500 | - |
| 2 | Resetti's Do-Over | 7,000 | - |
| 3 | Redd's Counterfeit | 6,500 | - |
| 4 | Isabelle's Briefing | 5,000 | - |
| 5 | Kapp'n's Island Tour | 5,000 | - |
| 6 | May Day Ticket | 3,500 | 1 |
| 7 | Pete's Special Delivery | 250 + deposit | - |

### Golden Tools (3 in rotation per round)

| ID | Item | Price | Stock |
|---|---|---|---|
| 8 | Golden Shovel | 7,500 | 1 (refreshes) |
| 9 | Golden Axe | 7,000 | 1 (refreshes) |
| 10 | Golden Slingshot | 6,500 | 2 |
| 11 | Golden Rod | 6,000 | 3 |
| 12 | Golden Watering Can | 4,000 | once per player |

### Standard Tools (4 in rotation per round)

| ID | Item | Price | Stock |
|---|---|---|---|
| 13 | Shovel | 4,000 | 3 |
| 14 | Axe | 4,000 | 3 |
| 15 | Slingshot | 3,500 | 3 |
| 16 | Vaulting Pole | 3,500 | - |
| 17 | Stone Axe | 3,000 | 3 |
| 18 | Ladder | 2,500 | 5 |
| 19 | Star Wand | 2,000 | unlimited, **stackable** |
| 20 | Watering Can | 2,000 | - |

### The Cabinet (always available, never rotates)

| ID | Item | Price |
|---|---|---|
| 21 | Flimsy Shovel | 1,000 |
| 22 | Flimsy Axe | 750 |
| 23 | Flimsy Slingshot | 750 |
| 24 | Flimsy Watering Can | 400 |

### Item flags

Each registry entry carries:

```
id, name, description, price, category,
stock (int | null for unlimited),
refreshes (bool),
stackable (bool)        - true for Star Wand (19) only
occupies_slot (bool)    - false for 12, 20, 24
once_per_player (bool)  - true for 12
```

---

## 3. Inventory

**Cap: 3 slots.** Config value.

- Each distinct item = 1 slot.
- **Star Wand is the only stackable item.** Any quantity of Star Wands occupies
  exactly 1 slot. A player may hold 9 Wands plus 2 other items.
- Watering Cans (IDs 12, 20, 24) **never occupy a slot** - they're upgrades, not
  playable items.
- `/buy` **hard-blocks** at 3 slots. No override, no buy-and-play-same-round.
- Items are removed by hosts via `/editinventory`. The bot never consumes an item.

### Counterfeits

Item instances carry `is_fake: bool`, default false.

A fake item is **completely indistinguishable** from a real one in `/inventory` -
same name, same description, no icon, no ordering difference, nothing. The flag is
visible only to hosts, in `/viewinventory` and `/editinventory`.

---

## 4. House payments

Prices exist in config for reference and display only. **The bot does not charge
them.** Players ping the hosts to pay; hosts deduct with `/deduct`.

| Phase | Amount |
|---|---|
| Pre-Swap | 725 |
| Swap | 1,000 |
| Early Merge | 850 |
| Late Merge (F7+) | 275 |

---

## 5. Shop state machine

Every item is in exactly one state:

```
available ──/buy──> owned ──host removes──> used ──> available   (if refreshes)
                                                 └──> retired    (if not)
```

- `available` - eligible to be slotted into a shop rotation
- `owned` - purchased, sitting in someone's inventory, **not** offerable
- `used` - host has removed it from an inventory
- `retired` - permanently gone

Rules:

- `/setupshop` and `/queueshop` autocomplete **only** offers `available` items.
- `/buy` autocomplete offers **only** what is currently in the posted shop, plus the
  full Cabinet. Players must never see an item name they haven't been shown.
- **Stock > 1** means that many units before the item leaves `available`.
- **Refreshes** means a unit returns to `available` when a host marks it `used` -
  not on a timer, not at rotation.
- **Player eliminated holding an unused item:** the item is gone. It does not return
  to the pool. Confirmed.

---

## 6. Commands

### Player

| Command | Behaviour |
|---|---|
| `/rock` `/tree` `/bottle` | Income. Ephemeral result. Blocked if eliminated. |
| `/cooldown` | Ephemeral. Time remaining, reduction total, Flimsy uses left. |
| `/inventory` | **Ephemeral.** Bells, items (with Star Wand quantity), active perks. Requires a role from `/initializeplayerroles`. |
| `/buy <item>` | Autocomplete = current shop + Cabinet. Checks: not eliminated, in stock, affordable, slot available, `once_per_player`. Ephemeral confirmation. **Logs to host channel.** No public message. |

### Host

| Command | Behaviour |
|---|---|
| `/setupshop` | 9 inputs: 2 Specials, 3 Golden, 4 Standard. Autocomplete from `available`. Posts immediately to the shop channel. Cabinet + House Payments append automatically. |
| `/queueshop` | Same inputs. Stores the queue; posts at **12:00am America/New_York**. On post, deletes the **stored message ID** of the previous shop post - never "the last bot message." |
| `/viewinventory <user>` | Full host view: bells, items, `is_fake` flags, permanents, Flimsy counter, elimination status. |
| `/editinventory <user>` | Modal. Fields: balance · items (CSV of IDs, e.g. `13, 19, 19, 24`) · Flimsy WC uses remaining · toggles for Golden WC and Watering Can. Every edit logged with before/after. |
| `/eliminate <user>` | Freezes income commands and `/buy`. Flags inventory as eliminated. Held items do not return to the pool. |
| `/uneliminate <user>` | Reverses it. Mistakes happen at 2am. |
| `/deliver <from> <to> [bells] [item]` | Pete's. Moves bells and/or an item. Deducts 250 shipping from sender. **Bounces if the recipient is at 3 slots.** Silent - no public message, no DM. Logged. |
| `/counterfeit <user> <item>` | Places a fake item instance in a player's inventory. Logged. |
| `/grant <user> <amount> [reason]` | Add bells. |
| `/deduct <user> <amount> [reason]` | Remove bells. **This is the house payment tool** - it runs ~13 times per tribal, so it must be fast. |
| `/resetcooldown <user>` | Clears the global cooldown. |
| `/taxreturns` | Every item owned by every player, **with names**, for host reference. Non-ephemeral, but **hard-restricted to the host category** - see warning below. |

### Host category gate

There is no single host channel. Instead, **every channel inside category
`1414321682415357964` is host-safe.** Gate on the channel's parent:

```
if channel.parent_id != config.channels.host_category:
    reject with an ephemeral error
```

Apply this to **every host command** - `/setupshop`, `/queueshop`, `/editinventory`,
`/viewinventory`, `/eliminate`, `/uneliminate`, `/deliver`, `/counterfeit`, `/grant`,
`/deduct`, `/resetcooldown`, `/taxreturns`. Role permissions are the primary guard;
the category check is the backstop that stops a misfired command from firing into a
player channel.

One exception: `/setupshop` and `/queueshop` are *invoked* inside the host category
but **post** to the shop channel. Don't confuse invocation location with output
destination.

⚠️ **`/taxreturns` is a live grenade.** It is non-ephemeral by request, and it reveals
every ownership relationship in the game. If the category check ever fails open, it
fails open into a player channel and the season is over. Hosts hand the anonymized
version to buyers themselves.

---

## 7. Logging

Host log channel: `1531494704712122603`

Log: purchases · deliveries · counterfeits · all `/editinventory` diffs · `/grant` ·
`/deduct` · eliminations · shop rotations posted.

Do **not** log income command runs by default - 17 players × several per day is
unreadable. Put it behind a config flag, default off.

Shop channel: `1531460665481625681`

Host category: `1414321682415357964` - every channel inside it is host-safe, and all
host commands are gated on it.

---

## 8. Shop embed rendering

Five embeds, one message. Match the existing format:

- `color: 16775075`
- `image.url` = the Everest banner (1500×11 spacer, forces full embed width)
- Bells emoji `<:Bells:1530232089021124711>` on every price line
- Prices comma-separated
- Descriptions pulled from the item registry - hosts pick names, the bot writes the
  rest

**Header format - this matters.** Decorative flourishes must sit on their own
normal-size line, *not* inside the `##`. Inside an H2 they render enormous, wrap, and
cut off on desktop:

```
## ✨ __STORE SPECIALS__ ✨
⫘⫘⫘⫘⫘⫘⫘⫘⫘⫘⫘⫘⫘⫘
```

Embed order: Store Specials · Golden Tools · Standard Tools · The Cabinet ·
Loan Repayment.

Cabinet and Loan Repayment embeds are static - rendered from config every time, no
host input.

---

## 9. Config schema

`config/economy.json`, or the repo's existing equivalent. Everything below must be
editable without touching code:

```
income:        payout ranges, probabilities, base cooldowns, wasp multiplier
reductions:    each tier's %, flimsy use count, flimsy_wc_stacks flag
items:         the full registry - id, name, description, price, stock,
               refreshes, stackable, occupies_slot, once_per_player
inventory:     slot cap
house:         the four payment amounts (display only)
rotation:      slots per category (2/3/4), post time, timezone
channels:      shop, host_log, host_category
flags:         log_income_commands
```

Adding a new item should mean adding a registry entry, nothing more.
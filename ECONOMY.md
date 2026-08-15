# Nook's Cranny Economy — Command & Item Reference

Everything the bot adds for Everest Survivor S2. All game values live in
`config/economy.json` and can be edited live (no restart needed for value changes;
**restart the bot only to register new/renamed commands**).

**Conventions**
- 🟢 **Player** command · 🔵 **Shop** command · 🔴 **Host** command · 🧪 **Testing**
- "Ephemeral" = only the person who ran it can see the reply.
- Host commands (🔴) require the **Manage Server** permission **and** must be run
  **inside the host category**. They also log to the host log channel.

---

## 🟢 Player commands

### `/rock` · `/tree` · `/bottle`
Earn bells. **One shared cooldown** across all three — running any one locks all
three. Ephemeral. Blocked if you're eliminated.
- `/rock` — 180–220 bells · 8h cooldown
- `/tree` — 60%: 700–800 bells · 40%: **wasps** (0 bells, cooldown doubled) · 12h base
- `/bottle` — 80%: 90–110 · 20%: 2,400–2,600 · 24h cooldown

Cooldown reductions (from Watering Cans) apply to the base first; the wasp penalty
doubles *after* that.

**Usage:** just run the command.

### `/cooldown`
Ephemeral. Shows time left on your global cooldown, which command set it, your total
cooldown reduction %, and Flimsy Watering Can uses remaining.

**Usage:** `/cooldown`

### `/inventory`
Ephemeral. Shows your balance, items (Star Wands stack), and active perks. **Requires
a player role** (set via `/initializeplayerroles`). Counterfeit items look identical to
real ones here — no marker.

**Usage:** `/inventory`

### `/buy`
Ephemeral. Buy an item. Autocomplete shows the **currently posted shop + the Cabinet**.
Checks: not eliminated, in stock, affordable, slot available (3-slot cap), and
one-time / already-owned rules. On success it deducts bells, confirms privately
("Production will be with you shortly."), and **pings the hosts** so they deliver the
advantage. No public message.

**Usage:** `/buy item:<pick from autocomplete>`

---

## 🔵 Shop commands (host)

Both take **9 items**: 2 Store Specials, 3 Golden Tools, 4 Standard Tools. Autocomplete
only offers items that are still **available**. The Cabinet + Loan Repayment sections
are appended automatically from config.

### `/setupshop`
Posts a new shop rotation to the shop channel **immediately**, deleting the previous
shop post.

**Usage:** `/setupshop special1:… special2:… golden1:… golden2:… golden3:… standard1:… standard2:… standard3:… standard4:…`

### `/queueshop`
Same inputs, but **stores** the rotation and posts it automatically at the scheduled
time (**00:00 America/New_York** by default), replacing the previous post.

**Usage:** same options as `/setupshop`.

### `/refreshshop`
Re-posts the **current** rotation with the latest config — use it after editing an
item's text/price or adding a Cabinet item so the change shows on the live shop.

### `/rerollshop`
Posts a new shop built from a **random** rotation of currently-available items (2
Specials / 3 Golden / 4 Standard). Handy for a manual reroll or to test the auto-reroll.

### `/restockshop`
Resets **all** shop stock to the config defaults, so any sold-out finite item (Golden
Shovel, May Day Ticket, etc.) becomes offerable and buyable again. Use for a season reset
or to clear stock depleted during testing. (Per-item: remove an owned copy via
`/editinventory`, which returns that unit to the pool on its own.)

### `/stockcheck`
Ephemeral host report of **every** item in the registry: units left vs. total, how many
players currently hold one, and per-category flags. Answers "why is this sold out?"

- **`⚠️ burned`** — no stock left and **nobody holds one**. The unit went out and never
  came back. Since `/editinventory` now returns items automatically, this should only
  show up for stock lost before that change (fix it with `/restockshop`) or if the
  return flags are switched off in config.
- **`♻️ shown as "Refreshes"`** — cosmetic only: the item's shop-post label. It no longer
  affects whether stock comes back.
- **`🎭 N fake in play`** — counterfeits from `/counterfeit`. They never consumed stock,
  so they're excluded from the burned-unit math.
- **`🚫 disabled`** — `enabled: false` in config; never offered regardless of stock.

The header of each category compares offerable items against its rotation slot count and
warns when a random rotation would **under-fill** (post 2 Golden Tools instead of 3).

### Auto-reroll (no command)
If **no shop is queued** by the scheduled post time, the bot **auto-rerolls** a random
rotation and posts it — so the shop never fails to refresh if hosts forget to queue one.
Controlled by `rotation.auto_reroll` in config (default **on**). A queued shop always
takes priority over the auto-reroll.

---

## 🔴 Host tools

All require Manage Server + the host category.

| Command | What it does | Usage |
|---|---|---|
| `/balances` | Private list of **every** player's balance, sorted high to low, with the total. | `/balances` |
| `/grant` | Add bells to a player. | `/grant user:@p amount:5000 [reason:…]` |
| `/deduct` | Remove bells — **the house-payment tool**. | `/deduct user:@p amount:1000 [reason:…]` |
| `/resetcooldown` | Clears a player's income cooldown. | `/resetcooldown user:@p` |
| `/eliminate` | Freezes a player from all economy actions (income + buy). | `/eliminate user:@p` |
| `/uneliminate` | Reverses an elimination. | `/uneliminate user:@p` |
| `/viewinventory` | Full host view — balance, items **with `is_fake` flags**, upgrades, Flimsy counter, status. | `/viewinventory user:@p` |
| `/editinventory` | Opens a modal: balance · items (CSV of IDs) · Flimsy uses · Golden WC (yes/no) · Watering Can (yes/no). Logs before/after. | `/editinventory user:@p` |
| `/counterfeit` | Places a **fake** item in a player's inventory (indistinguishable in `/inventory`). | `/counterfeit user:@p item:<pick>` |
| `/deliver` | Pete's: move bells and/or one item between players. Charges 250 shipping to sender. Bounces if recipient is full. Silent. | `/deliver from:@a to:@b [bells:500] [item:<pick>]` |
| `/taxreturns` | **NON-EPHEMERAL.** Lists every item every player owns, with names. Host reference only — locked to the host category. | `/taxreturns` |

**`/editinventory` notes:** the items field is a comma-separated list of item IDs, e.g.
`13, 19, 19, 24`. It best-effort preserves existing counterfeits by ID. Flimsy uses are
one combined number.

**Automatic stock reconciliation.** Whatever you change in the items field is mirrored in
the shop pool, for **every** finite-stock item:

| You do this | Shop pool |
|---|---|
| Remove an item ID | That unit goes **back** into stock |
| Add an item ID | That unit is **taken out** of stock |
| Remove a counterfeit | **Nothing** — fakes never used a unit |
| Change an unlimited item | Nothing to track |

The confirmation reports exactly what moved (`**Golden Rod** +2 back in the pool (now
2/3)`), the same line goes to the host log, and the posted shop re-renders so a returned
item stops saying SOLD OUT. Returns are capped at the item's configured `stock` — you can
never end up with more than the config allows.

Three switches in `flags` (`config/economy.json`) control it, all **on** by default:

| Flag | Off means |
|---|---|
| `return_stock_on_removal` | Removing an item never restocks it (the old behaviour) |
| `return_stock_from_eliminated` | Items pulled from **eliminated** players don't restock |
| `consume_stock_on_grant` | Hand-adding an item doesn't deplete stock |

---

## 🧪 Testing

### `/twisttester`
Toggles **god mode** for a user: no cooldowns, every item buyable, free purchases, no
slot cap, and balance topped to 1,000,000. Staff-only (Manage Server), ephemeral.

**Usage:** `/twisttester action:add user:@you` … then `action:remove` when done.
To wipe **all** economy data, delete `data/economy.json`.

---

## Complete Item ID List

IDs are permanent — never renumber. Host inputs accept IDs; players always see names.
Stock `∞` = unlimited.

### Store Specials (IDs 1–7)
| ID | Item | Price | Stock | Notes |
|---:|---|---:|:--:|---|
| 1 | Nook Family Tax Returns | 7,500 | ∞ | |
| 2 | Resetti's Do-Over | 7,000 | ∞ | |
| 3 | Redd's Counterfeit | 6,500 | ∞ | |
| 4 | Isabelle's Briefing | 5,000 | ∞ | |
| 5 | Kapp'n's Island Tour | 5,000 | ∞ | |
| 6 | May Day Ticket | 3,500 | 1 | |
| 7 | Pete's Special Delivery | 250 + deposit | ∞ | |

### Golden Tools (IDs 8–12)
| ID | Item | Price | Stock | Notes |
|---:|---|---:|:--:|---|
| 8 | Golden Shovel | 7,500 | 1 | refreshes |
| 9 | Golden Axe | 7,000 | 1 | refreshes |
| 10 | Golden Slingshot | 6,500 | 2 | |
| 11 | Golden Rod | 6,000 | 3 | |
| 12 | Golden Watering Can | 4,000 | ∞ | **once per player** · no slot · −50% cooldown |

### Standard Tools (IDs 13–20)
| ID | Item | Price | Stock | Notes |
|---:|---|---:|:--:|---|
| 13 | Shovel | 4,000 | 3 | |
| 14 | Axe | 4,000 | 3 | |
| 15 | Slingshot | 3,500 | 3 | |
| 16 | Vaulting Pole | 3,500 | ∞ | |
| 17 | Stone Axe | 3,000 | 3 | |
| 18 | Ladder | 2,500 | 5 | |
| 19 | Star Wand | 2,000 | ∞ | **stackable** (any qty = 1 slot) |
| 20 | Watering Can | 2,000 | ∞ | no slot · −25% cooldown |

### The Cabinet — always available, never rotates (IDs 21–24)
| ID | Item | Price | Notes |
|---:|---|---:|---|
| 21 | Flimsy Shovel | 1,000 | |
| 22 | Flimsy Axe | 750 | |
| 23 | Flimsy Slingshot | 750 | |
| 24 | Flimsy Watering Can | 400 | no slot · −10% for next 10 commands |
| 25 | +1 Islander | 2,500 | no slot · adds a buddy to your confessional · buy multiple |

### Special flags at a glance
- **Stackable:** 19 (Star Wand) only.
- **Don't occupy a slot:** 12, 20, 24 (the Watering Cans) and 25 (+1 Islander).
- **Once per player:** 12 (Golden Watering Can).
- **Refreshes** (returns to the pool when a host removes it): 8, 9.

---

## Cooldown reductions (Watering Cans)

You can hold only **one** watering can at a time — they do **not** stack. To switch,
trade in your current one with a host (no refund) before buying another.
- Golden Watering Can (ID 12): **−50%**, permanent, once per player.
- Watering Can (ID 20): **−25%**, permanent.
- Flimsy Watering Can (ID 24): **−10%** for your next 10 income commands.

None of them take an inventory slot. A reduction only applies to cooldowns set
*after* you own the can — it never shrinks a cooldown that's already running.

---

*The bot never adjudicates gameplay — it only handles bells, cooldowns, inventory
bookkeeping, and the shop. Hosts roll every tool effect and remove items manually.*

# Economy Cheat Sheet (Discord copy-paste)

Copy each **Post** block's contents into its own Discord message - every block is under
the 2,000-character limit and uses Discord markdown that renders when pasted.

---

## Post 1 - Player commands
```
# 🍃 Nook's Cranny - Player Commands
All replies are PRIVATE (only the player sees them).

**Earn Bells** - one shared cooldown across all three:
- `/rock` - small, safe payout (~200)
- `/tree` - big payout, but can hit wasps (0 Bells + longer wait)
- `/bottle` - usually small, rare jackpot

**Check things**
- `/cooldown` - time left on your timer, your reduction %, Flimsy uses left
- `/inventory` - your Bells, items (Star Wands stack), and upgrades

**Spend**
- `/buy` - buy from the currently posted shop + the Cabinet. Pick from the menu that
  appears. You get a private "purchased - production will be with you shortly" note,
  and the hosts are pinged to deliver your advantage.

⏳ A cooldown's end-time is locked when you run the command. Buying a Watering Can only
shortens FUTURE cooldowns, never one already ticking.
```

---

## Post 2 - Shop + Host commands
```
# 🛍️ Shop & Host Commands
Host commands need "Manage Server" AND must be run inside the host category.

**Shop**
- `/setupshop` - post a new shop NOW (2 Specials, 3 Golden, 4 Standard; Cabinet + Loan auto-added)
- `/queueshop` - queue a shop to auto-post at midnight (ET) and replace the old one
- `/refreshshop` - re-post the current shop with the latest config (after editing an item)
- `/rerollshop` - post a random rotation right now
- `/restockshop` - reset ALL shop stock to full (sold-out items become available again)
- `/stockcheck` - stock left on every item, who's holding it, what's out of sync, and a warning if a category can't fill its rotation slots
- `/syncstock` - match shop stock to what players actually hold (`preview:true` to look first). The fix for drift
- `/setstock item:<pick> units:N` - set one item's stock by hand
- Auto-reroll: if NObody queues a shop by midnight, the bot posts a random rotation automatically (so it never fails to refresh)

Note: a stock-1 item (like Golden Shovel) disappears from `/setupshop` once bought - that's intended. It returns when a host removes it from the owner via `/editinventory`, or use `/restockshop` to reset everything.

**Stock follows inventories automatically.** Remove an item from a player in `/editinventory` and it goes straight back in the shop pool; add one by hand and it comes out of the pool. Works for every finite-stock item, whether or not it says "Refreshes". The confirmation tells you exactly what moved, and the live shop post updates itself. Fakes from `/counterfeit` are ignored - they never used a unit.

Note: a **random** rotation (`/rerollshop` or the midnight auto-reroll) only fills the slots it can - if just 2 Golden Tools are in stock, the shop posts 2, not 3. Run `/stockcheck` to see that coming.

**Host tools**
- `/grant` - give a player Bells
- `/deduct` - remove Bells (the house-payment / voting-fee tool)
- `/balances` - everyone's balance, high to low, with the game total
- `/viewinventory` - full view of a player (shows FAKES)
- `/editinventory` - edit balance / items / upgrades; also how you REMOVE a used item
- `/counterfeit` - plant a fake item (looks 100% real to the player)
- `/deliver` - Pete's: move Bells and/or an item between players (charges shipping)
- `/eliminate` / `/uneliminate` - freeze / unfreeze a player
- `/resetcooldown` - clear a player's timer
- `/taxreturns` - ⚠️ NON-PRIVATE full "who owns what" dump - host channels ONLY
- `/twisttester` - god-mode toggle for testing (no cooldowns, free buys)
```

---

## Post 3 - Item IDs (Specials & Golden)
```
# 📋 Item IDs - Store Specials & Golden Tools
Host inputs use these IDs; players always see names. "-" stock = unlimited.

**Store Specials**
1 - Nook Family Tax Returns - 7,500
2 - Resetti's Do-Over - 7,000
3 - Redd's Counterfeit - 6,500
4 - Isabelle's Briefing - 5,000
5 - Kapp'n's Island Tour - 5,000
6 - May Day Ticket - 3,500 (stock 1)
7 - Pete's Special Delivery - 250 + deposit

**Golden Tools**
8 - Golden Shovel - 7,500 (stock 1, refreshes)
9 - Golden Axe - 7,000 (stock 1, refreshes)
10 - Golden Slingshot - 6,500 (stock 2)
11 - Golden Rod - 6,000 (stock 3)
12 - Golden Watering Can - 4,000 (once per player, no slot, −50% cooldown)
```

---

## Post 4 - Item IDs (Standard & Cabinet)
```
# 📋 Item IDs - Standard Tools & The Cabinet

**Standard Tools**
13 - Shovel - 4,000 (stock 3)
14 - Axe - 4,000 (stock 3)
15 - Slingshot - 3,500 (stock 3)
16 - Vaulting Pole - 3,500
17 - Stone Axe - 3,000 (stock 3)
18 - Ladder - 2,500 (stock 5)
19 - Star Wand - 2,000 (stackable - any qty = 1 slot)
20 - Watering Can - 2,000 (no slot, −25% cooldown)

**The Cabinet** (always available, never rotates)
21 - Flimsy Shovel - 1,000
22 - Flimsy Axe - 750
23 - Flimsy Slingshot - 750
24 - Flimsy Watering Can - 400 (no slot, −10% for next 10 commands)
25 - +1 Islander - 2,500 (no slot, adds a confessional buddy, buy multiple)
```

---

## Post 5 - Quick rules
```
# 📌 Quick Rules
- **3-item inventory cap.** Watering Cans (12/20/24) and +1 Islander (25) DON'T use a slot.
- **Star Wand** is the only stackable item - any quantity = 1 slot.
- **Refreshes:** Golden Shovel (8) & Golden Axe (9) return to the shop when a host removes them.
- **Once per player:** Golden Watering Can (12).
- **Watering Cans do NOT stack** - a player can hold only ONE at a time (Golden, regular, or Flimsy). To switch, they trade in their current one with a host (NO refund).
- **The bot never adjudicates** - it handles Bells, cooldowns, inventory & the shop. Hosts roll every tool effect and remove items manually with `/editinventory`.
- **Deliver the advantage yourself** when the bot pings you about a purchase.
```

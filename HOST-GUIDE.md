# Nook's Cranny — Cohost Guide (Plain English)

This is the no-jargon version. It explains how the money system works and what each
command does, in normal words.

---

## The big picture

Players earn a currency called **bells** by running a few commands. They spend those
bells in a **shop** the hosts post. When a player buys something, **the bot does NOT
explain or hand them the advantage** — it just takes their bells and quietly pings us
hosts. Then **we** deliver the actual advantage to them by hand.

The bot's whole job is bookkeeping: it tracks bells, cooldowns, and who owns what, and
it posts the shop. It never decides who wins a challenge, whose vote gets blocked, etc.
**We roll all of that ourselves.** The bot never takes an item away on its own either —
if someone uses an item, a host removes it manually.

**One term you'll see a lot:** when I say a reply is **private**, it means only the
person who typed the command can see it — nobody else in the channel does. Player money
and inventories are secret, so most things are private on purpose.

---

## What players do (so you understand the flow)

- **Earn bells:** they type `/rock`, `/tree`, or `/bottle`. Each pays out bells, then
  puts them on a **timer** (a cooldown) before they can earn again. There's **one shared
  timer** — using any one of the three locks all three for a while.
  - `/tree` is a gamble: sometimes they hit **wasps** and get 0 bells plus a longer wait.
- **Check their timer:** `/cooldown` privately tells them how long until they can earn
  again.
- **See their stuff:** `/inventory` privately shows their bells, items, and any perks.
- **Buy from the shop:** `/buy`. They pick an item from the little menu that appears.
  If they can afford it and have room, they get it. They see a short private "you bought
  it, production will be with you shortly" message — and **we get pinged** to go deliver
  the real thing.

**Important rule:** a player can only hold **3 items at once.** (Watering Cans don't
count toward that limit — they're upgrades, not items.) The bot blocks a 4th purchase
until they free up space.

---

## The shop (this is a host job)

The shop is one big post with sections: Store Specials, Golden Tools, Standard Tools,
The Cabinet, and Loan Repayment. Each round we choose which items are on offer.

- **`/setupshop`** — posts a fresh shop **right now**. You'll fill in 9 items: 2 Store
  Specials, 3 Golden Tools, 4 Standard Tools. As you type each one, a menu shows the
  items you're allowed to pick. The Cabinet and Loan sections fill in automatically. It
  also deletes the old shop post so there's only ever one.
- **`/queueshop`** — same thing, but instead of posting now, it **saves** the shop and
  posts it automatically at **midnight (New York time).** Use this to line up tomorrow's
  shop tonight.
- **`/refreshshop`** — re-posts the shop that's already up with the latest wording/prices.
- **`/rerollshop`** — posts a brand-new **random** shop right now.
- **`/stockcheck`** — private list of every item, how many are left, and who's holding
  one. Run this if a shop posts with fewer items than you expected, or if something says
  SOLD OUT and you don't think anyone has it. Anything marked 🔧 **out of sync** means
  the shop's count disagrees with what players actually have.
- **`/syncstock`** — fixes all of that in one go. It counts what everyone is holding and
  sets each item's stock to match. Add `preview:true` to see the changes before making
  them. Safe to run any time; if nothing's wrong it says so.
- **`/setstock item:<pick> units:2`** — set one item's stock by hand, for when you want a
  number that doesn't follow from who's holding what.

**Why a shop can post with only 2 Golden Tools.** A random shop can only use items that
still have stock. If just two Golden Tools are left in the season's pool, the random shop
posts two — it doesn't error, it just fills what it can. `/stockcheck` tells you this
before midnight; `/restockshop` refills everything.

**You don't have to remember to post a shop.** If nobody has queued one by midnight, the
bot **automatically rolls a random shop** and posts it — so the shop always refreshes on
time. (If you *did* queue one, that's what posts instead.)

You don't set the Cabinet or the loan payments — those are always the same and appear on
their own.

---

## Your host commands (what you'll actually use)

**Two rules for ALL of these:**
1. You need the **Manage Server** permission (producers have it).
2. You must run them **in a host channel** (any channel inside the host category). This
   is a safety net so a mistyped command never fires in front of players.

When in doubt, run host stuff in a host channel and you're fine.

| Command | What it does, in plain words |
|---|---|
| `/balances` | See a **private list of everyone's bell count**, richest to poorest, plus the total in the game. Great for a quick money check. |
| `/grant` | **Give** a player bells. `user`, `amount`, and an optional note. |
| `/deduct` | **Take** bells from a player. This is your **house-payment / voting-fee** tool — you'll use it a lot at tribal. |
| `/resetcooldown` | **Clear a player's timer** so they can earn again right away. |
| `/eliminate` | **Freeze** a player — they can't earn or buy anything anymore. Use this the moment someone's out. It's the main thing stopping a voted-out person from farming bells for a friend. |
| `/uneliminate` | Undo an elimination if you did it by mistake. |
| `/viewinventory` | See **everything** about a player: bells, every item (including whether an item is a **fake**), their upgrades, and their status. This is the host's X-ray view. |
| `/editinventory` | **Manually change** a player's stuff — their bell balance, their items, their upgrades. This is also how you **remove** an item after someone uses it (the bot never removes items itself). A form pops up with the current values; edit and submit. **Removing an item automatically puts it back in the shop; adding one takes it out.** |
| `/counterfeit` | Secretly drop a **fake** item into someone's inventory. To that player it looks 100% real — they won't know until they try to use it. (This powers Redd's Counterfeit.) |
| `/deliver` | Move bells and/or an item **from one player to another** (this is Pete's delivery). It charges the sender 250 for shipping and bounces if the receiver's inventory is full. Nobody is told — it's silent. |
| `/taxreturns` | Prints a **full list of everything everyone owns**, by name. ⚠️ This one is NOT private and shows the whole board — only ever run it in a host channel, never where players can see. |

Everything you do here gets written to the **host log channel**, so there's always a
record of who changed what.

---

## Testing (when you're setting things up)

- **`/twisttester`** — flips a player into **god mode** for testing: no timers, can buy
  anything, buys are free, no item limit, and a huge pile of bells. Do
  `/twisttester action:add user:@yourself` to turn it on, and `action:remove` to turn it
  off. Great for trying the shop without waiting on cooldowns.

---

## The upgrades players can buy (Watering Cans)

These make a player's earning **timers shorter**, forever (except the flimsy one). They
**don't** take up an item slot:

- **Golden Watering Can** — cuts timers by **half (50%)**, forever. Can only be bought
  once per person.
- **Watering Can** — cuts timers by **25%**, forever.
- **Flimsy Watering Can** — cuts timers by **10%**, but only for their **next 10** earns.

Players can only hold **one** watering can at a time — they don't stack. To switch to a
different one, they trade in their current can with a host (no refund). A watering can
only shortens **future** timers, never one that's already counting down.

---

## Quick reminders

- **Money and inventories are secret.** The bot keeps buys private and never announces
  them. If something ever leaks who owns what, that's a bug — tell the dev.
- **The bot doesn't play the game.** It won't roll immunity, count Golden Rod votes, or
  decide any percentage. We do all of that by hand.
- **The bot won't use up items.** After a player uses something, a host removes it with
  `/editinventory`. That removal **puts the item back in the shop** for someone else to
  buy, and tells you it did. If you'd rather used items stay gone for good, set
  `return_stock_on_removal` to `false` in `config/economy.json`.
- **Deliver the advantage yourself.** When the bot pings you about a purchase, that's
  your cue to send the buyer their actual advantage write-up.

For the exact numbers, prices, and item ID list, see **`ECONOMY.md`**.

---

## Running the bot in another server

The commands are registered globally, so they show up anywhere the bot is invited. What
varies is server-specific IDs.

**Channel commands (`/alliance`, `/alliancevc`, `/tribe1on1s`) work anywhere.** They used
to hardcode the main server's spectator role, which made Discord reject the channel
creation outright in any other server. That role is now per-server config. To give a
second server a spectator role, add a block to `config/org.json`:

```json
"guilds": {
  "1414321682025545822": { "spectator_role": "1414321682360832182" },
  "YOUR_OTHER_GUILD_ID":  { "spectator_role": "THAT_SERVERS_ROLE_ID" }
}
```

Leave a server out entirely and it simply gets no spectator overwrite — alliances and
1-on-1s are still private to their members. A role ID that's been deleted is ignored
rather than breaking the command.

**The economy commands are still single-server.** `config/economy.json` holds one
`host_category`, one `shop` channel, and one `host_log`, all pointing at the main server.
In a second server the host gate won't recognise any channel as a host channel, so
`/stockcheck`, `/editinventory`, `/setupshop` and the rest will refuse to run, and player
balances are stored per guild but the shop would post to the main server's channel. Making
the economy multi-server means keying those channel IDs by guild the same way — ask the
dev if you need it.

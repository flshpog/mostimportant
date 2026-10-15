import type { EngineEvent, EventChoiceKind } from "./types";

export const EVENT_NAMES: Record<EventChoiceKind, string> = { coinSteal: "Coin Steal", starSteal: "Star Steal", swap: "Swap Places" };

// One line of plain English per event, for the website feed and the Discord bot.
// `name` resolves a player id to a display name; `item` resolves an item id.
// Returns null for bookkeeping events nobody needs to read.
export function describeEvent(
  event: EngineEvent | { type: "Undone"; count: number },
  name: (playerId: string) => string,
  item: (itemId: string) => string = (id) => id,
): string | null {
  const coins = (n: number) => `${Math.abs(n)} coin${Math.abs(n) === 1 ? "" : "s"}`;
  switch (event.type) {
    case "BoardStarted":
      return "The board is open! Let's play.";
    case "BoardPaused":
      return "The hosts paused the board.";
    case "BoardResumed":
      return "The board is back on.";
    case "TurnStarted":
      return `It's ${name(event.playerId)}'s turn.`;
    case "TurnSkipped":
      return event.byHost ? `The hosts skipped ${name(event.playerId)}'s turn.` : `${name(event.playerId)} ran out of time and missed their turn.`;
    case "TurnEnded":
      return null;
    case "DiceRolled": {
      if (event.choose) return `${name(event.playerId)} rolled a ${event.dice[0]} and a ${event.dice[1]}, and gets to pick one.`;
      const raw = event.halvedFrom ?? event.total;
      const roll = event.dice.length > 1 ? `rolled ${event.dice.join(" + ")} = ${raw}` : `rolled a ${raw}`;
      return event.halvedFrom !== undefined
        ? `${name(event.playerId)} ${roll}, but they're poisoned: halved to ${event.total}.`
        : `${name(event.playerId)} ${roll}.`;
    }
    case "DiePicked": {
      const how = event.auto ? "didn't pick in time and goes with" : "picked";
      return event.halvedFrom !== undefined
        ? `${name(event.playerId)} ${how} ${event.value}, but they're poisoned: halved to ${event.total}.`
        : `${name(event.playerId)} ${how} ${event.value}.`;
    }
    case "PlayerMoved":
    case "PassedSpace":
      return null;
    case "ForkChoiceRequired":
      return `${name(event.playerId)} reached a fork.`;
    case "ForkChosen":
      return event.auto ? `${name(event.playerId)} didn't pick a path in time, so they went the default way.` : null;
    case "LandedOnSpace":
      return `${name(event.playerId)} landed on ${event.spaceType === "start" ? "the start" : `a ${event.spaceType} space`}.`;
    case "CoinsChanged":
      if (event.reason === "star" || event.reason === "shop" || event.reason === "event" || event.reason === "item") return null;
      if (event.delta === 0) return event.reason === "red" ? `${name(event.playerId)} had no coins to lose.` : null;
      return `${name(event.playerId)} ${event.delta > 0 ? "got" : "lost"} ${coins(event.delta)}${event.reason === "host" ? " (host)" : ""}. Now ${event.coins}.`;
    case "StarsChanged":
      if (event.reason === "star" || event.reason === "event") return null;
      return `${name(event.playerId)} ${event.delta >= 0 ? "got" : "lost"} ${Math.abs(event.delta)} star${Math.abs(event.delta) === 1 ? "" : "s"}${event.reason === "host" ? " (host)" : ""}.`;
    case "StarOffered":
      return `${name(event.playerId)} reached the star! It costs ${coins(event.price)}.`;
    case "StarUnaffordable":
      return `${name(event.playerId)} passed the star but needs ${coins(event.price)}.`;
    case "StarPurchased":
      return event.discount ? `⭐ ${name(event.playerId)} bought a star for ${coins(event.price)}!` : `⭐ ${name(event.playerId)} bought a star!`;
    case "StarSkipped":
      return event.auto ? `${name(event.playerId)} let the star go (timed out).` : `${name(event.playerId)} passed on the star.`;
    case "StarMoved":
      return event.by === "host" ? "The hosts moved the star." : "The star flew to a new spot.";
    case "ShopOpened":
      return `${name(event.playerId)} stopped at the shop.`;
    case "ShopUnaffordable":
      return event.bagFull
        ? `${name(event.playerId)} passed the shop, but their bag is full.`
        : `${name(event.playerId)} passed the shop but can't afford anything.`;
    case "AdvantagePurchased":
      return `${name(event.playerId)} bought the Tribe Advantage for ${coins(event.price)}!`;
    case "ItemUsed":
      return event.targetId ? `${name(event.playerId)} used ${item(event.itemId)} on ${name(event.targetId)}!` : `${name(event.playerId)} used ${item(event.itemId)}!`;
    case "ItemSpent":
      return `${name(event.playerId)}'s ${item(event.itemId)} kicked in.`;
    case "StealBlocked":
      return `${name(event.targetId)}'s Guard Charm blocked ${name(event.playerId)}'s steal!`;
    case "BooBellRang":
      return `${name(event.playerId)} took ${coins(event.amount)} from ${name(event.targetId)}!`;
    case "ShopPurchase":
      // itemId "" is a purchase this viewer isn't allowed to see (bags are private)
      return event.itemId ? `${name(event.playerId)} bought ${item(event.itemId)} for ${coins(event.price)}.` : `${name(event.playerId)} bought something from the shop.`;
    case "ShopClosed":
      return null;
    case "EventDrawn":
      return `❗ ${name(event.playerId)} hit an event: ${EVENT_NAMES[event.event]}!`;
    case "EventFizzled":
      if (event.reason === "no_events") return `${name(event.playerId)} landed on an event space, but nothing happened.`;
      if (event.reason === "no_stars") return "Nobody has a star to steal, so nothing happens.";
      if (event.reason === "too_poor") return `${name(event.playerId)} needs ${coins(event.price ?? 0)} to steal a star, so nothing happens.`;
      return "There's nobody to pick, so nothing happens.";
    case "EventDeclined":
      return event.auto ? `${name(event.playerId)} didn't pick in time, so nothing happens.` : `${name(event.playerId)} passed on the ${EVENT_NAMES[event.event].toLowerCase()}.`;
    case "CoinsStolen":
      return `💰 ${name(event.playerId)} stole ${event.percent}% of ${name(event.targetId)}'s coins: ${coins(event.amount)}!${event.auto ? " (picked automatically)" : ""}`;
    case "StarStolen":
      return `🌟 ${name(event.playerId)} paid ${coins(event.price)} and stole a star from ${name(event.targetId)}!`;
    case "PlayersSwapped":
      return `🔄 ${name(event.playerId)} swapped places with ${name(event.targetId)}!`;
    case "PlayerAdded":
      return `${name(event.playerId)} joined the board.`;
    case "PlayerRemoved":
      return `${event.player.name} left the board.`;
    case "PlayerTeleported":
      return `The hosts moved ${name(event.playerId)}.`;
    case "ItemGranted":
      return `${name(event.playerId)} received ${event.itemId ? item(event.itemId) : "an item"}.`;
    case "ItemRemoved":
      return `${name(event.playerId)} lost ${event.itemId ? item(event.itemId) : "an item"}.`;
    case "TurnOrderSet":
      return "The hosts changed the turn order.";
    case "Undone":
      return "The hosts rewound the board.";
  }
}

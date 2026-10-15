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
  // "a Mushroom", "an Ice Flower": item names are in the config, so pick the article
  const an = (itemId: string) => {
    const n = item(itemId);
    return `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}`;
  };
  switch (event.type) {
    case "BoardStarted":
      return "The board is open.";
    case "BoardPaused":
      return "The hosts paused the board.";
    case "BoardResumed":
      return "The board is unpaused.";
    case "TurnStarted":
      return `It's ${name(event.playerId)}'s turn.`;
    case "TurnSkipped":
      return event.byHost ? `The hosts skipped ${name(event.playerId)}'s turn.` : `${name(event.playerId)} missed their turn.`;
    case "TurnEnded":
      return null;
    case "DiceRolled": {
      if (event.choose) return `${name(event.playerId)} is using ${event.item ? an(event.item) : "a Custom Dice Block"}.`;
      const raw = event.halvedFrom ?? event.total;
      const roll = event.dice.length > 1 ? `rolled ${event.dice.join(" + ")} = ${raw}` : `rolled a ${raw}`;
      return event.halvedFrom !== undefined
        ? `${name(event.playerId)} ${roll}, halved to ${event.total} by poison.`
        : `${name(event.playerId)} ${roll}.`;
    }
    case "DiePicked": {
      const how = event.auto ? "ran out of time and goes" : "chose";
      return event.halvedFrom !== undefined
        ? `${name(event.playerId)} ${how} ${event.value}, halved to ${event.total} by poison.`
        : `${name(event.playerId)} ${how} ${event.value}.`;
    }
    case "PlayerMoved":
    case "PassedSpace":
      return null;
    case "ForkChoiceRequired":
      return `${name(event.playerId)} reached a fork.`;
    case "ForkChosen":
      return event.auto ? `${name(event.playerId)} ran out of time and took the default path.` : null;
    case "LandedOnSpace":
      // an event space gets its own line once the event is drawn
      if (event.spaceType === "event") return null;
      return `${name(event.playerId)} landed on ${event.spaceType === "start" ? "the start" : `a ${event.spaceType} space`}.`;
    case "CoinsChanged":
      if (event.reason === "star" || event.reason === "shop" || event.reason === "event" || event.reason === "item") return null;
      if (event.delta === 0) return event.reason === "red" ? `${name(event.playerId)} had no coins to lose.` : null;
      if (event.reason === "host") return event.delta > 0 ? `The hosts gave ${name(event.playerId)} ${coins(event.delta)}.` : `The hosts took ${coins(event.delta)} from ${name(event.playerId)}.`;
      return `${name(event.playerId)} ${event.delta > 0 ? "got" : "lost"} ${coins(event.delta)} and has ${event.coins}.`;
    case "StarsChanged":
      if (event.reason === "star" || event.reason === "event") return null;
      {
        const stars = `${Math.abs(event.delta)} star${Math.abs(event.delta) === 1 ? "" : "s"}`;
        if (event.reason === "host") return event.delta >= 0 ? `The hosts gave ${name(event.playerId)} ${stars}.` : `The hosts took ${stars} from ${name(event.playerId)}.`;
        return `${name(event.playerId)} ${event.delta >= 0 ? "got" : "lost"} ${stars}.`;
      }
    case "StarOffered":
      return `${name(event.playerId)} reached the star. It costs ${coins(event.price)}.`;
    case "StarUnaffordable":
      return `${name(event.playerId)} reached the star but can't afford it.`;
    case "StarPurchased":
      return event.discount ? `${name(event.playerId)} bought a star for ${coins(event.price)}.` : `${name(event.playerId)} bought a star.`;
    case "StarSkipped":
      return event.auto ? `${name(event.playerId)} ran out of time and passed on the star.` : `${name(event.playerId)} passed on the star.`;
    case "StarMoved":
      return event.by === "host" ? "The hosts moved the star." : "The star moved.";
    case "ShopOpened":
      return `${name(event.playerId)} stopped at the shop.`;
    case "ShopUnaffordable":
      return `${name(event.playerId)} passed the shop.`;
    case "AdvantagePurchased":
      return `${name(event.playerId)} bought the tribe advantage for ${coins(event.price)}.`;
    case "ItemUsed":
      return event.targetId ? `${name(event.playerId)} used ${an(event.itemId)} on ${name(event.targetId)}.` : `${name(event.playerId)} used ${an(event.itemId)}.`;
    case "ItemSpent":
      return `${name(event.playerId)} used their ${item(event.itemId)}.`;
    case "StealBlocked":
      return `${name(event.targetId)}'s ${item("guard-charm")} blocked ${name(event.playerId)}'s steal.`;
    case "BooBellRang":
      return `${name(event.playerId)} took ${coins(event.amount)} from ${name(event.targetId)}.`;
    case "ShopPurchase":
      // itemId "" is a purchase this viewer isn't allowed to see (bags are private)
      return event.itemId ? `${name(event.playerId)} bought ${an(event.itemId)} for ${coins(event.price)}.` : `${name(event.playerId)} bought something at the shop.`;
    case "ShopClosed":
      return null;
    case "EventDrawn":
      return `${name(event.playerId)} landed on an event space. It's ${EVENT_NAMES[event.event]}.`;
    case "EventFizzled":
      if (event.reason === "no_events") return `${name(event.playerId)} landed on an event space. Nothing happened.`;
      if (event.reason === "no_stars") return "Nobody has a star to steal. Nothing happens.";
      if (event.reason === "too_poor") return `${name(event.playerId)} can't afford to steal a star. Nothing happens.`;
      return "There's nobody to pick. Nothing happens.";
    case "EventDeclined":
      return event.auto ? `${name(event.playerId)} ran out of time. Nothing happens.` : `${name(event.playerId)} passed on the ${EVENT_NAMES[event.event]}.`;
    case "CoinsStolen":
      return `${name(event.playerId)} stole ${coins(event.amount)} from ${name(event.targetId)} (${event.percent}% of their coins).`;
    case "StarStolen":
      return `${name(event.playerId)} paid ${coins(event.price)} and stole a star from ${name(event.targetId)}.`;
    case "PlayersSwapped":
      return `${name(event.playerId)} swapped places with ${name(event.targetId)}.`;
    case "PlayerAdded":
      return `${name(event.playerId)} joined the board.`;
    case "PlayerRemoved":
      return `${event.player.name} left the board.`;
    case "PlayerTeleported":
      return `The hosts moved ${name(event.playerId)}.`;
    case "ItemGranted":
      return `The hosts gave ${name(event.playerId)} ${event.itemId ? an(event.itemId) : "an item"}.`;
    case "ItemRemoved":
      return `The hosts took ${event.itemId ? an(event.itemId) : "an item"} from ${name(event.playerId)}.`;
    case "TurnOrderSet":
      return "The hosts changed the turn order.";
    case "Undone":
      return "The hosts rewound the board.";
  }
}

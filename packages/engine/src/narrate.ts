import type { EngineEvent } from "./types";

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
      return `${name(event.playerId)} ran out of time and missed their turn.`;
    case "TurnEnded":
      return null;
    case "DiceRolled":
      return event.dice.length > 1
        ? `${name(event.playerId)} rolled ${event.dice.join(" + ")} = ${event.total}.`
        : `${name(event.playerId)} rolled a ${event.total}.`;
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
      if (event.reason === "star" || event.reason === "shop") return null;
      if (event.delta === 0) return event.reason === "red" ? `${name(event.playerId)} had no coins to lose.` : null;
      return `${name(event.playerId)} ${event.delta > 0 ? "got" : "lost"} ${coins(event.delta)}${event.reason === "host" ? " (host)" : ""}. Now ${event.coins}.`;
    case "StarsChanged":
      if (event.reason === "star") return null;
      return `${name(event.playerId)} ${event.delta >= 0 ? "got" : "lost"} ${Math.abs(event.delta)} star${Math.abs(event.delta) === 1 ? "" : "s"}${event.reason === "host" ? " (host)" : ""}.`;
    case "StarOffered":
      return `${name(event.playerId)} reached the star! It costs ${coins(event.price)}.`;
    case "StarUnaffordable":
      return `${name(event.playerId)} passed the star but needs ${coins(event.price)}.`;
    case "StarPurchased":
      return `⭐ ${name(event.playerId)} bought a star!`;
    case "StarSkipped":
      return event.auto ? `${name(event.playerId)} let the star go (timed out).` : `${name(event.playerId)} passed on the star.`;
    case "StarMoved":
      return event.by === "host" ? "The hosts moved the star." : "The star flew to a new spot.";
    case "ShopOpened":
      return `${name(event.playerId)} stopped at the shop.`;
    case "ShopUnaffordable":
      return `${name(event.playerId)} passed the shop but can't afford anything.`;
    case "ShopPurchase":
      return `${name(event.playerId)} bought ${item(event.itemId)} for ${coins(event.price)}.`;
    case "ShopClosed":
      return null;
    case "BowserSpinRequired":
      return `${name(event.playerId)} landed on Bowser...`;
    case "BowserSpin":
      return `Bowser's wheel: ${event.label}`;
    case "BowserNoWheel":
      return `${name(event.playerId)} landed on Bowser, but he's not home.`;
    case "PlayerAdded":
      return `${name(event.playerId)} joined the board.`;
    case "PlayerRemoved":
      return `${event.player.name} left the board.`;
    case "PlayerTeleported":
      return `The hosts moved ${name(event.playerId)}.`;
    case "ItemGranted":
      return `${name(event.playerId)} received ${item(event.itemId)}.`;
    case "ItemRemoved":
      return `${name(event.playerId)} lost ${item(event.itemId)}.`;
    case "TurnOrderSet":
      return "The hosts changed the turn order.";
    case "Undone":
      return "The hosts rewound the board.";
  }
}

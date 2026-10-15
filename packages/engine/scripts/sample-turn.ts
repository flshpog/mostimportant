// Prints the event list for one sample turn on the real main board.
//   npm run sample -w @everest/engine
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { apply, createBoardState, type Action, type BoardState, type EngineContext } from "../src";

const config = loadSeasonConfig();
const ctx: EngineContext = {
  layout: loadLayouts().main,
  rules: config,
};
const t0 = Date.parse("2026-11-01T12:00:00-05:00");

let state: BoardState = createBoardState(ctx, {
  boardId: "mario-stadium",
  starSpace: "s04",
  players: [
    { id: "111", name: "Peach", coins: 24 },
    { id: "222", name: "Toad" },
  ],
});

function run(label: string, action: Action) {
  const r = apply(ctx, state, action);
  state = r.state;
  console.log(`\n> ${label}`);
  for (const e of r.events) console.log("  " + JSON.stringify(e));
}

run("host starts the board", { type: "startBoard", now: t0 });
run("Peach rolls a 9", { type: "roll", playerId: "111", dice: [9], now: t0 + 60_000 });
run("Peach heads up the right column at the start fork", { type: "chooseFork", playerId: "111", next: "s02", now: t0 + 120_000 });
run("Peach takes the top row at the right fork", { type: "chooseFork", playerId: "111", next: "s04", now: t0 + 180_000 });
run("Peach buys the star (server picked s62)", { type: "buyStar", playerId: "111", newStarSpace: "s62", now: t0 + 240_000 });
console.log(`\nPeach: ${JSON.stringify(state.players["111"])}`);

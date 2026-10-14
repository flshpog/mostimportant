// Renders sample board images to a folder, to check the look without Discord.
//   npm run preview -w @everest/discord -- <output folder>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { apply, createBoardState, type BoardState, type EngineContext } from "@everest/engine";
import { renderBoard } from "../src/render";

const out = process.argv[2] ?? "board-preview";
mkdirSync(out, { recursive: true });
const ctx: EngineContext = { layout: loadLayouts().main, rules: loadSeasonConfig() };
const t0 = Date.parse("2026-11-02T12:00:00-05:00");

let state: BoardState = createBoardState(ctx, {
  boardId: "mario-stadium",
  starSpace: "s62",
  players: [
    { id: "1001", name: "Peach" },
    { id: "1002", name: "Toad" },
    { id: "1003", name: "Yoshi" },
    { id: "1004", name: "Daisy the Extremely Long Named" },
    { id: "1005", name: "Wario" },
  ],
});
writeFileSync(join(out, "1-not-started.png"), renderBoard({ layout: ctx.layout, state, boardName: "Mario Stadium", now: t0 }));

state = apply(ctx, state, { type: "startBoard", now: t0 }).state;
// Spread everyone out a bit, like mid-season.
const spots: Record<string, [string, number, number]> = { "1001": ["s45", 23, 1], "1002": ["s45", 7, 0], "1003": ["s88", 31, 2], "1004": ["s12", 4, 0], "1005": ["s67", 15, 1] };
for (const [id, [space, coins, stars]] of Object.entries(spots)) {
  state = apply(ctx, state, { type: "movePlayer", playerId: id, spaceId: space, now: t0 }).state;
  state = apply(ctx, state, { type: "setCoins", playerId: id, coins, now: t0 }).state;
  state = apply(ctx, state, { type: "setStars", playerId: id, stars, now: t0 }).state;
}
state = apply(ctx, state, { type: "roll", playerId: "1001", dice: [3], now: t0 + 1000 }).state;
writeFileSync(join(out, "2-mid-game.png"), renderBoard({ layout: ctx.layout, state, boardName: "Mario Stadium", now: t0 + 2000 }));
console.log(`wrote previews to ${out}`);

// Runs the board server on its own, with no Discord bot, for local testing.
//   npm run board:dev            (add -- --seed to put fake players on mario-stadium)
// The website's login screen then offers one-click logins as a fake host and fake
// players, so nothing needs Discord. Data goes to data/board-dev, separate from real data.
import { join } from "node:path";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { loadServerConfig, startBoardServer } from "../src";

const ROOT = join(__dirname, "..", "..", "..");
const SECRET = "dev-only-secret-not-for-production";
// Run a second copy alongside another one with DEV_WEB_ORIGIN / BOARD_PORT.
const ORIGIN = process.env.DEV_WEB_ORIGIN ?? "http://localhost:5173";
const SITE = `${ORIGIN}/board/`;
const HOST = { id: "900000000000000001", name: "Dev Host" };
const PLAYERS = [
  { id: "100000000000000001", name: "Peach" },
  { id: "100000000000000002", name: "Toad" },
  { id: "100000000000000003", name: "Yoshi" },
  { id: "100000000000000004", name: "Daisy" },
];

async function main() {
  const base = loadServerConfig(join(ROOT, "config", "board.json"), {});
  const config = {
    ...base,
    port: Number(process.env.BOARD_PORT ?? 8787),
    public_url: `http://localhost:${process.env.BOARD_PORT ?? 8787}`,
    site_url: SITE,
    allowed_origins: [ORIGIN],
    host_user_ids: [HOST.id],
  };
  const srv = await startBoardServer({
    config,
    dataDir: join(ROOT, "data", process.env.DEV_DATA ?? "board-dev"),
    layouts: loadLayouts(),
    loadConfig: loadSeasonConfig,
    sessionSecret: SECRET,
    oauth: null,
    devLogins: [HOST, ...PLAYERS],
    isHost: async () => false, // only host_user_ids above
  });

  if (process.argv.includes("--seed")) {
    for (const p of PLAYERS) {
      if (!srv.service.boardIdOf(p.id)) await srv.service.transfer(p.id, "mario-stadium", HOST.id, { name: p.name });
    }
    console.log("seeded mario-stadium with", PLAYERS.map((p) => p.name).join(", "));
  }

  console.log(`\nOpen ${SITE}#/console (website dev server: npm run board:web)`);
  console.log(`and pick who to log in as. ${HOST.name} is the host.`);
  console.log("\nCtrl+C to stop.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

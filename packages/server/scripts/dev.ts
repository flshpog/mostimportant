// Runs the board server on its own, with no Discord bot, for local testing.
//   npm run board:dev            (add -- --seed to put fake players on mario-stadium)
// Prints login links for a fake host and fake players, so the website test console
// works without Discord OAuth. Data goes to data/board-dev, separate from real data.
import { join } from "node:path";
import { loadLayouts, loadSeasonConfig } from "@everest/board-data";
import { loadServerConfig, signToken, startBoardServer } from "../src";

const ROOT = join(__dirname, "..", "..", "..");
const SECRET = "dev-only-secret-not-for-production";
const SITE = "http://localhost:5173/board/";
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
    public_url: "http://localhost:8787",
    site_url: SITE,
    allowed_origins: ["http://localhost:5173"],
    host_user_ids: [HOST.id],
  };
  const srv = await startBoardServer({
    config,
    dataDir: join(ROOT, "data", "board-dev"),
    layouts: loadLayouts(),
    loadConfig: loadSeasonConfig,
    sessionSecret: SECRET,
    oauth: null,
    isHost: async () => false, // only host_user_ids above
  });

  if (process.argv.includes("--seed")) {
    for (const p of PLAYERS) {
      if (!srv.service.boardIdOf(p.id)) await srv.service.transfer(p.id, "mario-stadium", HOST.id, { name: p.name });
    }
    console.log("seeded mario-stadium with", PLAYERS.map((p) => p.name).join(", "));
  }

  const link = (u: { id: string; name: string }) =>
    `${SITE}#/auth?token=${encodeURIComponent(signToken(SECRET, { sub: u.id, name: u.name, avatar: null, exp: Date.now() + 30 * 86_400_000 }))}`;
  console.log("\nOpen these (website dev server must be running: npm run board:web):");
  console.log(`  ${HOST.name} (host):\n    ${link(HOST)}`);
  for (const p of PLAYERS) console.log(`  ${p.name}:\n    ${link(p)}`);
  console.log("\nCtrl+C to stop.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

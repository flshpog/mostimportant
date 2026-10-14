// Validates every board layout and the season config. Exits 1 on any error.
//   npm run board:validate
import { BoardSchema, rawLayouts, rawSeasonConfig, validateBoard, validateSeasonConfig, type Board } from "../src";

let failed = false;
const parsedLayouts: Record<string, Board> = {};

for (const [id, raw] of Object.entries(rawLayouts)) {
  const r = validateBoard(raw);
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  console.log(`\nlayout "${id}": ${total} spaces`);
  console.log("  " + Object.entries(r.counts).map(([t, n]) => `${t} ${n}`).join(", "));
  console.log(`  forks: ${r.forks.join(", ") || "none"}`);
  for (const w of r.warnings) console.log(`  warning: ${w}`);
  for (const e of r.errors) console.log(`  ERROR: ${e}`);
  if (r.review.length) {
    console.log(`  needs review (${r.review.length}):`);
    for (const { id: sid, note } of r.review) console.log(`    ${sid}: ${note}`);
  }
  if (r.errors.length) failed = true;
  const parsed = BoardSchema.safeParse(raw);
  if (parsed.success) parsedLayouts[id] = parsed.data;
}

const configErrors = validateSeasonConfig(rawSeasonConfig, parsedLayouts);
console.log(`\nseason-config.json: ${configErrors.length ? "" : "ok"}`);
for (const e of configErrors) console.log(`  ERROR: ${e}`);
if (configErrors.length) failed = true;

console.log(failed ? "\nFAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);

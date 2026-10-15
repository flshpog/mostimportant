import mainBoard from "../boards/main.json";
import mergeBoard from "../boards/merge.json";
import underworldBoard from "../boards/underworld.json";
import seasonConfigJson from "../season-config.json";
import { BoardSchema, SeasonConfigSchema, type Board, type SeasonConfig } from "./schema";

export * from "./schema";
export * from "./validate";

// Raw JSON, unparsed, for tools (validator, debug overlay) that must show bad data
// instead of throwing on it.
export const rawLayouts: Record<string, unknown> = { main: mainBoard, merge: mergeBoard, underworld: underworldBoard };
export const rawSeasonConfig: unknown = seasonConfigJson;

export function loadLayouts(): Record<string, Board> {
  return Object.fromEntries(Object.entries(rawLayouts).map(([id, raw]) => [id, BoardSchema.parse(raw)]));
}

export function loadSeasonConfig(): SeasonConfig {
  return SeasonConfigSchema.parse(rawSeasonConfig);
}

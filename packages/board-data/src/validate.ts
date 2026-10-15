import { BoardSchema, SeasonConfigSchema, type Board, type SeasonConfig, type SpaceType } from "./schema";

export interface BoardReport {
  errors: string[];
  warnings: string[];
  counts: Record<SpaceType, number>;
  forks: string[];
  review: { id: string; note: string }[];
}

// Spaces closer than this (in normalized units) are probably a double transcription.
const OVERLAP_DISTANCE = 0.012;

function reachable(from: string, edges: Map<string, string[]>): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    for (const n of edges.get(stack.pop()!) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

// Structural checks on a board graph. Schema errors short-circuit everything else.
export function validateBoard(input: unknown): BoardReport {
  const counts = { blue: 0, red: 0, green: 0, shop: 0, event: 0, start: 0 } as Record<SpaceType, number>;
  const report: BoardReport = { errors: [], warnings: [], counts, forks: [], review: [] };

  const parsed = BoardSchema.safeParse(input);
  if (!parsed.success) {
    report.errors.push(...parsed.error.issues.map((i) => `schema: ${i.path.join(".")}: ${i.message}`));
    return report;
  }
  const board: Board = parsed.data;
  const ids = new Set<string>();
  for (const s of board.spaces) {
    if (ids.has(s.id)) report.errors.push(`duplicate space id ${s.id}`);
    ids.add(s.id);
  }

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const s of board.spaces) {
    counts[s.type]++;
    forward.set(s.id, s.next);
    if (new Set(s.next).size !== s.next.length) report.errors.push(`${s.id} lists the same exit twice`);
    for (const n of s.next) {
      if (n === s.id) report.errors.push(`${s.id} points to itself`);
      if (!ids.has(n)) report.errors.push(`${s.id} points to missing space ${n}`);
      backward.set(n, [...(backward.get(n) ?? []), s.id]);
    }
    if (s.next.length > 1) report.forks.push(s.id);
    if (s.needsReview) report.review.push({ id: s.id, note: s.reviewNote ?? "(no note)" });
  }

  if (!ids.has(board.startSpace)) report.errors.push(`startSpace ${board.startSpace} does not exist`);
  if (counts.start !== 1) report.errors.push(`expected exactly 1 start space, found ${counts.start}`);
  const startSpace = board.spaces.find((s) => s.id === board.startSpace);
  if (startSpace && startSpace.type !== "start") report.errors.push(`startSpace ${startSpace.id} is not type "start"`);

  for (const b of board.bridges) {
    if (!forward.get(b.from)?.includes(b.to)) report.errors.push(`bridge ${b.label}: ${b.from} has no edge to ${b.to}`);
    if (forward.get(b.to)?.includes(b.from)) report.errors.push(`bridge ${b.label} is not one-way`);
  }

  if (ids.has(board.startSpace)) {
    const fromStart = reachable(board.startSpace, forward);
    const toStart = reachable(board.startSpace, backward);
    for (const id of ids) {
      if (!fromStart.has(id)) report.errors.push(`${id} is unreachable from start`);
      // A space that can never get back to start traps the token in a sub-loop.
      else if (!toStart.has(id)) report.errors.push(`${id} can never get back to start (trap)`);
    }
  }

  for (const s of board.spaces) {
    if (s.shop && s.type !== "shop") report.errors.push(`${s.id} has a shop variant but isn't a shop`);
  }

  const list = board.spaces;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = Math.hypot(list[i].pos.x - list[j].pos.x, list[i].pos.y - list[j].pos.y);
      if (d < OVERLAP_DISTANCE) report.warnings.push(`${list[i].id} and ${list[j].id} overlap on the layout`);
    }
  }
  return report;
}

// Checks the season config against itself and the board layouts it references.
export function validateSeasonConfig(input: unknown, layouts: Record<string, Board>): string[] {
  const parsed = SeasonConfigSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => `schema: ${i.path.join(".")}: ${i.message}`);
  const config: SeasonConfig = parsed.data;
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const b of config.boards) {
    if (seen.has(b.id)) errors.push(`duplicate board id ${b.id}`);
    seen.add(b.id);
    const layout = layouts[b.layout];
    if (!layout) {
      errors.push(`board ${b.id} uses unknown layout ${b.layout}`);
      continue;
    }
    if (b.starStart) {
      const space = layout.spaces.find((s) => s.id === b.starStart);
      if (!space) errors.push(`board ${b.id} starStart ${b.starStart} is not on layout ${b.layout}`);
      else if (!config.star.spawnOn.includes(space.type))
        errors.push(`board ${b.id} starStart ${b.starStart} is ${space.type}; the star only sits on ${config.star.spawnOn.join("/")}`);
    }
  }
  return errors;
}

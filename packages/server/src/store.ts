import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Action, BoardState, EngineEvent } from "@everest/engine";

// Events the server adds on top of the engine's.
export type ServerEvent = { type: "Undone"; count: number };
export type WireEvent = EngineEvent | ServerEvent;

export interface StoredEvent {
  seq: number; // per board, starts at 1, never reused
  at: number;
  entry: number; // log entry that produced it
  event: WireEvent;
}

export type LogEntry =
  | { n: number; kind: "init"; at: number; by: string | null; state: BoardState }
  | { n: number; kind: "action"; at: number; by: string | null; action: Action; before: BoardState }
  | { n: number; kind: "undo"; at: number; by: string | null; count: number; state: BoardState };

interface Snapshot {
  state: BoardState;
  entry: number;
  seq: number;
}

export interface LoadedBoard {
  entries: LogEntry[];
  events: StoredEvent[];
  snapshot: Snapshot | null;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A torn final line from a crash mid-write. Everything before it is intact.
      break;
    }
  }
  return out;
}

// One board's files on disk:
//   log.jsonl     every accepted action/undo, with the state before it (append-only)
//   events.jsonl  every event, with its sequence number (append-only)
//   state.json    snapshot of the latest state, rewritten atomically
// Write order per action is events -> log -> snapshot, so on load anything past the
// last log entry is a half-finished write and gets dropped or replayed.
export class BoardStore {
  readonly dir: string;

  constructor(dataDir: string, boardId: string) {
    this.dir = join(dataDir, boardId);
    mkdirSync(this.dir, { recursive: true });
  }

  private get logPath() {
    return join(this.dir, "log.jsonl");
  }
  private get eventsPath() {
    return join(this.dir, "events.jsonl");
  }
  private get snapshotPath() {
    return join(this.dir, "state.json");
  }

  load(): LoadedBoard {
    const entries = readJsonl<LogEntry>(this.logPath);
    const lastEntry = entries.length ? entries[entries.length - 1].n : 0;
    let events = readJsonl<StoredEvent>(this.eventsPath);
    const kept = events.filter((e) => e.entry <= lastEntry);
    if (kept.length !== events.length || this.hasTornLine(this.eventsPath)) {
      events = kept;
      this.rewrite(this.eventsPath, events);
    }
    if (this.hasTornLine(this.logPath)) this.rewrite(this.logPath, entries);
    const snapshot = existsSync(this.snapshotPath)
      ? (JSON.parse(readFileSync(this.snapshotPath, "utf8")) as Snapshot)
      : null;
    return { entries, events, snapshot };
  }

  private hasTornLine(path: string): boolean {
    if (!existsSync(path)) return false;
    const text = readFileSync(path, "utf8");
    return text.length > 0 && !text.endsWith("\n");
  }

  private rewrite(path: string, rows: unknown[]) {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, rows.map((r) => JSON.stringify(r) + "\n").join(""));
    renameSync(tmp, path);
  }

  appendEvents(events: StoredEvent[]) {
    if (events.length) appendFileSync(this.eventsPath, events.map((e) => JSON.stringify(e) + "\n").join(""));
  }

  appendEntry(entry: LogEntry) {
    appendFileSync(this.logPath, JSON.stringify(entry) + "\n");
  }

  writeSnapshot(snapshot: Snapshot) {
    const tmp = `${this.snapshotPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, this.snapshotPath);
  }
}

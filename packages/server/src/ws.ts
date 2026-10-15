import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { eventFor, stateFor, type BoardState } from "@everest/engine";
import type { SessionUser } from "./auth";
import { originAllowed, sessionFrom, type HttpDeps } from "./http";
import type { StoredEvent } from "./store";

// Protocol (JSON text frames):
//   client -> {op:"hello", token}                     authenticate first
//   server -> {op:"hello", user, boardId, isHost}
//   client -> {op:"subscribe", board, since?}         since = last seq the client has
//   server -> {op:"events", board, events, seq, state} catch-up, then every live change;
//                                                     state is the board after these events
//          or {op:"snapshot", board, seq, state}      when catch-up isn't possible
//   server -> {op:"reset", board, seq, state}         after a host undo; replace local state
//   client -> {op:"unsubscribe", board}
//   server -> {op:"error", code, message}
// Events always arrive in seq order with no gaps; a client can detect a gap and resubscribe.

interface Client {
  ws: WebSocket;
  user: SessionUser | null;
  isHost: boolean;
  boards: Set<string>;
  alive: boolean;
}

const HEARTBEAT_MS = 30_000;
const MAX_CATCH_UP = 2_000;

export function attachWebSocket(server: Server, deps: HttpDeps) {
  const { service } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Set<Client>();

  const send = (c: Client, msg: unknown) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const canView = (c: Client, boardId: string) => !!c.user && (c.isHost || service.boardIdOf(c.user.sub) === boardId);

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !originAllowed(deps.config, req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws: WebSocket) => {
    const c: Client = { ws, user: null, isHost: false, boards: new Set(), alive: true };
    clients.add(c);
    ws.on("pong", () => (c.alive = true));
    ws.on("close", () => clients.delete(c));
    ws.on("message", async (data) => {
      let msg: { op?: string; token?: string; board?: string; since?: number };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return send(c, { op: "error", code: "bad_json", message: "Messages must be JSON." });
      }
      try {
        if (msg.op === "hello") {
          c.user = sessionFrom(deps, `Bearer ${msg.token ?? ""}`);
          if (!c.user) return send(c, { op: "error", code: "unauthenticated", message: "Log in with Discord first." });
          c.isHost = await deps.isHost(c.user.sub);
          return send(c, {
            op: "hello",
            user: { id: c.user.sub, name: c.user.name, avatar: c.user.avatar },
            boardId: service.boardIdOf(c.user.sub),
            isHost: c.isHost,
          });
        }
        if (msg.op === "subscribe" && typeof msg.board === "string") {
          const board = msg.board;
          if (!c.user) return send(c, { op: "error", code: "unauthenticated", message: "Say hello with a login token first." });
          if (!service.boardIds().includes(board)) return send(c, { op: "error", code: "unknown_board", message: "No such board." });
          if (!canView(c, board)) return send(c, { op: "error", code: "not_your_board", message: "You can only view your own board." });
          // Catch-up and registration happen in the same tick, so no live event can
          // slip between them.
          const { state: full, seq } = service.state(board);
          const state = stateFor(full, c.user.sub, c.isHost);
          const since = typeof msg.since === "number" ? msg.since : null;
          if (since !== null && since >= 0 && since <= seq && seq - since <= MAX_CATCH_UP) {
            send(c, { op: "events", board, events: redact(c, service.eventsSince(board, since, MAX_CATCH_UP)), seq, state });
          } else {
            send(c, { op: "snapshot", board, seq, state });
          }
          c.boards.add(board);
          return;
        }
        if (msg.op === "unsubscribe" && typeof msg.board === "string") {
          c.boards.delete(msg.board);
          return;
        }
        send(c, { op: "error", code: "bad_request", message: "Unknown message." });
      } catch (err) {
        deps.log("[board] websocket message failed", err);
        send(c, { op: "error", code: "server_error", message: "Something went wrong on the board server." });
      }
    });
  });

  // Other players' bags are private: hide what they bought or were given.
  const redact = (c: Client, events: StoredEvent[]) => events.map((e) => ({ ...e, event: eventFor(e.event, c.user?.sub ?? null, c.isHost) }));

  const dropIfNotAllowed = (c: Client, board: string) => {
    if (canView(c, board)) return false;
    // A player moved off this board (eliminated, swapped) loses the feed immediately.
    c.boards.delete(board);
    send(c, { op: "error", code: "not_your_board", message: "You're no longer on this board." });
    return true;
  };

  const onEvents = (board: string, events: StoredEvent[], state: BoardState) => {
    const seq = events[events.length - 1].seq;
    for (const c of clients) {
      if (!c.boards.has(board) || dropIfNotAllowed(c, board)) continue;
      send(c, { op: "events", board, events: redact(c, events), seq, state: stateFor(state, c.user?.sub ?? null, c.isHost) });
    }
  };
  const onReset = (board: string, state: BoardState, seq: number) => {
    for (const c of clients) {
      if (!c.boards.has(board) || dropIfNotAllowed(c, board)) continue;
      send(c, { op: "reset", board, seq, state: stateFor(state, c.user?.sub ?? null, c.isHost) });
    }
  };
  service.on("events", onEvents);
  service.on("reset", onReset);

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    close() {
      clearInterval(heartbeat);
      service.off("events", onEvents);
      service.off("reset", onReset);
      for (const c of clients) c.ws.terminate();
      wss.close();
    },
  };
}

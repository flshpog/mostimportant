import type { IncomingMessage, ServerResponse } from "node:http";
import { EngineError } from "@everest/engine";
import { authorizeUrl, avatarUrl, checkState, exchangeCode, signToken, verifyToken, type OAuthSettings, type SessionUser } from "./auth";
import type { ServerConfig } from "./config";
import { ServiceError, type BoardService, type HostActionInput } from "./service";

export interface HttpDeps {
  service: BoardService;
  config: ServerConfig;
  sessionSecret: string;
  oauth: OAuthSettings | null; // null when DISCORD_CLIENT_SECRET isn't set: login is off
  // Local testing only (npm run board:dev): log in as a fake user with one click.
  // Never set by the bot, so production has no such route.
  devLogins?: { id: string; name: string }[];
  isHost: (userId: string) => Promise<boolean>;
  // Avatar URLs for Discord users, supplied by the bot. Missing = no avatars.
  profiles?: (userIds: string[]) => Promise<Record<string, { avatar: string | null }>>;
  fetch: typeof fetch;
  clock: () => number;
  log: (message: string, error?: unknown) => void;
}

const HOST_ACTIONS = new Set<HostActionInput["type"]>([
  "startBoard",
  "setCoins",
  "setStars",
  "grantItem",
  "removeItem",
  "movePlayer",
  "moveStar",
  "addPlayer",
  "removePlayer",
  "setTurnOrder",
  "openTurnNow",
  "skipTurn",
  "pause",
  "resume",
]);
const MAX_BODY = 64 * 1024;
const DAY = 86_400_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Origin checks shared with the websocket upgrade.
export function originAllowed(config: ServerConfig, origin: string | undefined): boolean {
  return !origin || config.allowed_origins.includes(origin);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "too_large", "That request is too big.");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "bad_json", "The request body must be a JSON object.");
}

export function sessionFrom(deps: HttpDeps, header: string | undefined): SessionUser | null {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  return token ? verifyToken<SessionUser>(deps.sessionSecret, token, deps.clock()) : null;
}

export function createHttpHandler(deps: HttpDeps) {
  const { service, config } = deps;

  const requireUser = (req: IncomingMessage): SessionUser => {
    const user = sessionFrom(deps, req.headers.authorization);
    if (!user) throw new HttpError(401, "unauthenticated", "Log in with Discord first.");
    return user;
  };
  const requireHost = async (req: IncomingMessage): Promise<SessionUser> => {
    const user = requireUser(req);
    if (!(await deps.isHost(user.sub))) throw new HttpError(403, "not_host", "Only hosts can do that.");
    return user;
  };
  // Players see only their own board; hosts see every board.
  const requireView = async (req: IncomingMessage, boardId: string): Promise<SessionUser> => {
    const user = requireUser(req);
    service.summary(boardId); // 404 for unknown boards before the permission check
    if (service.boardIdOf(user.sub) !== boardId && !(await deps.isHost(user.sub))) {
      throw new HttpError(403, "not_your_board", "You can only view your own board.");
    }
    return user;
  };

  type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<void>;
  const routes: [string, RegExp, Handler][] = [
    [
      "GET",
      /^\/api\/health$/,
      async (_q, res) =>
        send(res, 200, {
          ok: true,
          discordLogin: !!deps.oauth,
          devLogins: deps.devLogins?.map((u) => ({ id: u.id, name: u.name })) ?? [],
        }),
    ],
    [
      "GET",
      /^\/dev\/login\/(\d+)$/,
      async (_q, res, [id]) => {
        const user = deps.devLogins?.find((u) => u.id === id);
        if (!user) throw new HttpError(404, "not_found", "No such endpoint.");
        const session: SessionUser = { sub: user.id, name: user.name, avatar: null, exp: deps.clock() + config.session_days * DAY };
        redirect(res, `${config.site_url}#/auth?token=${encodeURIComponent(signToken(deps.sessionSecret, session))}`);
      },
    ],

    [
      "GET",
      /^\/auth\/login$/,
      async (_q, res) => {
        if (!deps.oauth) throw new HttpError(503, "login_disabled", "Website login isn't set up on this server yet.");
        redirect(res, authorizeUrl(deps.oauth, deps.sessionSecret, deps.clock()));
      },
    ],
    [
      "GET",
      /^\/auth\/callback$/,
      async (_q, res, _p, url) => {
        if (!deps.oauth) throw new HttpError(503, "login_disabled", "Website login isn't set up on this server yet.");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        if (!code || !checkState(deps.sessionSecret, state, deps.clock())) {
          return redirect(res, `${config.site_url}#/auth?error=login_failed`);
        }
        const user = await exchangeCode(deps.oauth, code, deps.fetch);
        const session: SessionUser = {
          sub: user.id,
          name: user.global_name || user.username,
          avatar: avatarUrl(user),
          exp: deps.clock() + config.session_days * DAY,
        };
        // The token rides in the URL fragment, which browsers never send to servers.
        redirect(res, `${config.site_url}#/auth?token=${encodeURIComponent(signToken(deps.sessionSecret, session))}`);
      },
    ],

    [
      "GET",
      /^\/api\/me$/,
      async (req, res) => {
        const user = requireUser(req);
        send(res, 200, {
          user: { id: user.sub, name: user.name, avatar: user.avatar },
          boardId: service.boardIdOf(user.sub),
          isHost: await deps.isHost(user.sub),
        });
      },
    ],
    [
      "GET",
      /^\/api\/boards$/,
      async (req, res) => {
        const user = requireUser(req);
        const ids = (await deps.isHost(user.sub)) ? service.boardIds() : [service.boardIdOf(user.sub)].filter((x): x is string => !!x);
        send(res, 200, { boards: ids.map((id) => service.summary(id)) });
      },
    ],
    [
      "GET",
      /^\/api\/boards\/([\w-]+)$/,
      async (req, res, [id]) => {
        await requireView(req, id);
        send(res, 200, { board: service.summary(id), ...service.state(id) });
      },
    ],
    [
      "GET",
      /^\/api\/boards\/([\w-]+)\/layout$/,
      async (req, res, [id]) => {
        await requireView(req, id);
        send(res, 200, { layout: service.layout(id) });
      },
    ],
    [
      "GET",
      /^\/api\/boards\/([\w-]+)\/events$/,
      async (req, res, [id], url) => {
        await requireView(req, id);
        const since = Math.max(0, Number(url.searchParams.get("since") ?? 0) || 0);
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? 500) || 500));
        send(res, 200, { events: service.eventsSince(id, since, limit), seq: service.summary(id).seq });
      },
    ],
    [
      "GET",
      /^\/api\/boards\/([\w-]+)\/profiles$/,
      async (req, res, [id]) => {
        await requireView(req, id);
        const ids = service.state(id).state.turn.order;
        const profiles = deps.profiles ? await deps.profiles(ids).catch(() => ({})) : {};
        send(res, 200, { profiles });
      },
    ],
    [
      "GET",
      /^\/api\/boards\/([\w-]+)\/leaderboard$/,
      async (req, res, [id]) => {
        await requireView(req, id);
        send(res, 200, { leaderboard: service.leaderboard(id) });
      },
    ],

    // Player actions. The board is always the caller's own.
    ["POST", /^\/api\/play\/roll$/, async (req, res) => send(res, 200, { events: await service.roll(requireUser(req).sub) })],
    [
      "POST",
      /^\/api\/play\/fork$/,
      async (req, res) => {
        const user = requireUser(req);
        const { next } = await readJson(req);
        if (typeof next !== "string") throw new HttpError(400, "bad_request", "Say which path to take.");
        send(res, 200, { events: await service.chooseFork(user.sub, next) });
      },
    ],
    [
      "POST",
      /^\/api\/play\/star$/,
      async (req, res) => {
        const user = requireUser(req);
        const { buy } = await readJson(req);
        send(res, 200, { events: await (buy === true ? service.buyStar(user.sub) : service.skipStar(user.sub)) });
      },
    ],
    [
      "POST",
      /^\/api\/play\/shop$/,
      async (req, res) => {
        const user = requireUser(req);
        const { itemId } = await readJson(req);
        send(res, 200, { events: await (typeof itemId === "string" ? service.shopBuy(user.sub, itemId) : service.shopSkip(user.sub)) });
      },
    ],

    // Host dashboard.
    [
      "GET",
      /^\/api\/host\/boards$/,
      async (req, res) => {
        await requireHost(req);
        send(res, 200, { boards: service.boardIds().map((id) => ({ ...service.summary(id), ...service.state(id) })) });
      },
    ],
    [
      "POST",
      /^\/api\/host\/boards\/([\w-]+)\/actions$/,
      async (req, res, [id]) => {
        const host = await requireHost(req);
        const { action } = await readJson(req);
        const type = (action as { type?: unknown } | undefined)?.type;
        if (!action || typeof action !== "object" || !HOST_ACTIONS.has(type as HostActionInput["type"])) {
          throw new HttpError(400, "bad_request", "That isn't a host action.");
        }
        send(res, 200, { events: await service.hostAction(id, action as HostActionInput, host.sub) });
      },
    ],
    [
      "POST",
      /^\/api\/host\/boards\/([\w-]+)\/undo$/,
      async (req, res, [id]) => {
        const host = await requireHost(req);
        const { count, turn } = await readJson(req);
        const events = await service.undo(id, { count: typeof count === "number" ? count : undefined, turn: turn === true }, host.sub);
        send(res, 200, { events, ...service.state(id) });
      },
    ],
    [
      "POST",
      /^\/api\/host\/transfer$/,
      async (req, res) => {
        const host = await requireHost(req);
        const { playerId, to, name, reset } = await readJson(req);
        if (typeof playerId !== "string" || typeof to !== "string") {
          throw new HttpError(400, "bad_request", "Give a playerId and a destination board.");
        }
        const result = await service.transfer(playerId, to, host.sub, {
          name: typeof name === "string" ? name : undefined,
          reset: typeof reset === "boolean" ? reset : undefined,
        });
        send(res, 200, result);
      },
    ],
  ];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && originAllowed(config, origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      res.setHeader("access-control-max-age", "600");
    }
    try {
      if (origin && !originAllowed(config, origin)) throw new HttpError(403, "bad_origin", "This site isn't allowed to use the board API.");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      for (const [method, pattern, handler] of routes) {
        const m = url.pathname.match(pattern);
        if (!m) continue;
        if (req.method !== method) throw new HttpError(405, "method_not_allowed", "Wrong method for this endpoint.");
        return await handler(req, res, m.slice(1), url);
      }
      throw new HttpError(404, "not_found", "No such endpoint.");
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      if (err instanceof ServiceError) return send(res, 404, { error: { code: err.code, message: err.message } });
      if (err instanceof EngineError) return send(res, 400, { error: { code: err.code, message: err.message } });
      deps.log(`[board] ${req.method} ${req.url} failed`, err);
      send(res, 500, { error: { code: "server_error", message: "Something went wrong on the board server." } });
    }
  };
}

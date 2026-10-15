import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Board, SeasonConfig } from "@everest/board-data";
import type { OAuthSettings } from "./auth";
import type { ServerConfig } from "./config";
import { createHttpHandler, type HttpDeps } from "./http";
import type { RandomSource } from "./random";
import { BoardService } from "./service";
import { attachWebSocket } from "./ws";

export { loadServerConfig, type ServerConfig } from "./config";
export { BoardService, REDEMPTION_ISLAND_ID, ServiceError, type HostActionInput, type LeaderboardRow, type BoardSummary, type ActionMeta, type ActionSource } from "./service";
export type { StoredEvent, WireEvent, ServerEvent } from "./store";
export { signToken, verifyToken, type SessionUser } from "./auth";

export interface StartOptions {
  config: ServerConfig;
  dataDir: string; // absolute
  layouts: Record<string, Board>;
  loadConfig: () => SeasonConfig;
  sessionSecret: string;
  oauth: OAuthSettings | null;
  devLogins?: { id: string; name: string }[]; // local testing only, see scripts/dev.ts
  // Host check, normally "has the host role in the guild" via the bot.
  isHost: (userId: string) => Promise<boolean>;
  profiles?: (userIds: string[]) => Promise<Record<string, { avatar: string | null }>>;
  random?: RandomSource;
  clock?: () => number;
  fetch?: typeof fetch;
  log?: (message: string, error?: unknown) => void;
}

export interface RunningBoardServer {
  service: BoardService;
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startBoardServer(opts: StartOptions): Promise<RunningBoardServer> {
  const log = opts.log ?? ((m: string, e?: unknown) => (e ? console.error(m, e) : console.log(m)));
  const clock = opts.clock ?? Date.now;
  const service = new BoardService({
    dataDir: opts.dataDir,
    layouts: opts.layouts,
    loadConfig: opts.loadConfig,
    random: opts.random,
    clock,
    log,
  });
  service.init();

  const deps: HttpDeps = {
    service,
    config: opts.config,
    sessionSecret: opts.sessionSecret,
    oauth: opts.oauth,
    devLogins: opts.devLogins,
    isHost: async (id) => opts.config.host_user_ids.includes(id) || (await opts.isHost(id)),
    profiles: opts.profiles,
    fetch: opts.fetch ?? fetch,
    clock,
    log,
  };
  const handler = createHttpHandler(deps);
  const server = createServer((req, res) => void handler(req, res));
  const ws = attachWebSocket(server, deps);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.config.port, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  log(`[board] server listening on port ${port} (public url ${opts.config.public_url})`);

  return {
    service,
    server,
    url: `http://localhost:${port}`,
    async close() {
      ws.close();
      service.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

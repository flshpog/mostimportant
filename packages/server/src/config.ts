import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const SnowflakeSchema = z.string().regex(/^\d{17,20}$/);

export const ServerConfigSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(0).max(65535),
  public_url: z.string().url(),
  site_url: z.string().url(),
  allowed_origins: z.array(z.string()),
  guild_id: SnowflakeSchema,
  host_role_id: SnowflakeSchema,
  host_user_ids: z.array(SnowflakeSchema),
  data_dir: z.string().min(1),
  session_days: z.number().positive(),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// Reads config/board.json, then config/board.local.json if it exists (gitignored, for
// pointing a local copy at a test server), then env overrides.
export function loadServerConfig(path: string, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const localPath = path.replace(/\.json$/, ".local.json");
  const raw = {
    ...(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>),
    ...(existsSync(localPath) ? (JSON.parse(readFileSync(localPath, "utf8")) as Record<string, unknown>) : {}),
  };
  delete raw._comment;
  if (env.BOARD_PORT) raw.port = Number(env.BOARD_PORT);
  if (env.BOARD_PUBLIC_URL) raw.public_url = env.BOARD_PUBLIC_URL;
  if (env.BOARD_SITE_URL) raw.site_url = env.BOARD_SITE_URL;
  if (env.BOARD_DATA_DIR) raw.data_dir = env.BOARD_DATA_DIR;
  return ServerConfigSchema.parse(raw);
}

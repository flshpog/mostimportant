import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src";

describe("loadServerConfig", () => {
  it("reads the real config", () => {
    const c = loadServerConfig(join(__dirname, "../../../config/board.json"), {});
    expect(c.public_url).toBe("https://board.fiovivor.org");
    expect(c.allowed_origins).toContain("https://fiovivor.org");
  });

  it("layers board.local.json and then env on top", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-config-"));
    try {
      const base = JSON.parse(JSON.stringify(loadServerConfig(join(__dirname, "../../../config/board.json"), {})));
      writeFileSync(join(dir, "board.json"), JSON.stringify({ _comment: ["x"], ...base }));
      writeFileSync(join(dir, "board.local.json"), JSON.stringify({ guild_id: "123456789012345678", public_url: "http://localhost:8787" }));
      const c = loadServerConfig(join(dir, "board.json"), { BOARD_PORT: "9000" });
      expect(c).toMatchObject({ guild_id: "123456789012345678", public_url: "http://localhost:8787", port: 9000, host_role_id: base.host_role_id });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

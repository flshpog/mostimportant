import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src";

describe("loadServerConfig", () => {
  it("reads the committed config (ignoring anyone's local overrides)", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-config-"));
    try {
      copyFileSync(join(__dirname, "../../../config/board.json"), join(dir, "board.json"));
      const c = loadServerConfig(join(dir, "board.json"), {});
      expect(c.public_url).toBe("https://board.fiovivor.org");
      expect(c.allowed_origins).toContain("https://fiovivor.org");
      expect(c.test_channel_id ?? null).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("layers board.local.json and then env on top", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-config-"));
    try {
      const base = JSON.parse(readFileSync(join(__dirname, "../../../config/board.json"), "utf8"));
      delete base._comment;
      writeFileSync(join(dir, "board.json"), JSON.stringify({ _comment: ["x"], ...base }));
      writeFileSync(join(dir, "board.local.json"), JSON.stringify({ guild_id: "123456789012345678", public_url: "http://localhost:8787" }));
      const c = loadServerConfig(join(dir, "board.json"), { BOARD_PORT: "9000" });
      expect(c).toMatchObject({ guild_id: "123456789012345678", public_url: "http://localhost:8787", port: 9000, host_role_id: base.host_role_id });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

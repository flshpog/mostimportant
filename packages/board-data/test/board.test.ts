import { describe, expect, it } from "vitest";
import { rawLayouts, rawSeasonConfig, loadLayouts, validateBoard, validateSeasonConfig } from "../src";

const tiny = {
  id: "tiny",
  name: "tiny",
  startSpace: "s01",
  spaces: [
    { id: "s01", type: "start", pos: { x: 0.1, y: 0.1 }, next: ["s02", "s03"] },
    { id: "s02", type: "blue", pos: { x: 0.2, y: 0.1 }, next: ["s01"] },
    { id: "s03", type: "red", pos: { x: 0.3, y: 0.1 }, next: ["s01"] },
  ],
};

describe("validateBoard", () => {
  it("passes the main board", () => {
    expect(validateBoard(rawLayouts.main).errors).toEqual([]);
  });

  it("passes a minimal valid board and reports forks", () => {
    const r = validateBoard(tiny);
    expect(r.errors).toEqual([]);
    expect(r.forks).toEqual(["s01"]);
  });

  it("catches edges to missing spaces", () => {
    const bad = structuredClone(tiny);
    bad.spaces[1].next = ["s99"];
    expect(validateBoard(bad).errors).toContain("s02 points to missing space s99");
  });

  it("catches unreachable spaces", () => {
    const bad = structuredClone(tiny);
    bad.spaces[0].next = ["s02"];
    expect(validateBoard(bad).errors).toContain("s03 is unreachable from start");
  });

  it("catches trap loops that never return to start", () => {
    const bad = structuredClone(tiny);
    bad.spaces.push({ id: "s04", type: "green", pos: { x: 0.4, y: 0.1 }, next: ["s03"] });
    bad.spaces[2].next = ["s04"];
    expect(validateBoard(bad).errors).toContain("s03 can never get back to start (trap)");
  });

  it("catches dead ends via the schema", () => {
    const bad = structuredClone(tiny);
    bad.spaces[1].next = [];
    expect(validateBoard(bad).errors.some((e) => e.includes("at least one exit"))).toBe(true);
  });

  it("rejects unknown fields so typos don't slip through", () => {
    const bad = structuredClone(tiny);
    Object.assign(bad.spaces[2], { pasEffect: true });
    expect(validateBoard(bad).errors.some((e) => e.includes("pasEffect"))).toBe(true);
  });
});

describe("validateSeasonConfig", () => {
  it("passes the real config", () => {
    expect(validateSeasonConfig(rawSeasonConfig, loadLayouts())).toEqual([]);
  });

  it("rejects a star start on a non-blue space", () => {
    const config = structuredClone(rawSeasonConfig) as { boards: { starStart: string }[] };
    config.boards[0].starStart = "s05"; // red
    expect(validateSeasonConfig(config, loadLayouts())[0]).toMatch(/starStart s05 is red/);
  });
});

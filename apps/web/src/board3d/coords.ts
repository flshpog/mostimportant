import { Vector3 } from "three";
import type { Board } from "@everest/board-data";

// Blender is Z-up with the layout image's y pointing away from the viewer; the
// glTF export turns that into three.js Y-up, so blender (x, y, z) -> three (x, z, -y).
export function spaceToWorld(layout: Board, spaceId: string, lift = 0): Vector3 {
  const w = layout.world;
  const s = layout.spaces.find((sp) => sp.id === spaceId);
  if (!w || !s) return new Vector3();
  const W = layout.reference?.width ?? 1;
  const H = layout.reference?.height ?? 1;
  const bx = (s.pos.x * W - w.cx) * w.scale;
  const by = -(s.pos.y * H - w.cy) * w.scale;
  return new Vector3(bx, w.tileY + lift, -by);
}

export function allSpacePositions(layout: Board): Map<string, Vector3> {
  return new Map(layout.spaces.map((s) => [s.id, spaceToWorld(layout, s.id)]));
}

// "Up", "Left"... as seen from the default camera (looking north), for fork buttons.
export function directionLabel(layout: Board, from: string, to: string): string {
  const a = spaceToWorld(layout, from);
  const b = spaceToWorld(layout, to);
  const deg = (Math.atan2(-(b.z - a.z), b.x - a.x) * 180) / Math.PI;
  const dirs: [number, string][] = [
    [0, "➡️ Right"],
    [45, "↗️ Up-right"],
    [90, "⬆️ Up"],
    [135, "↖️ Up-left"],
    [180, "⬅️ Left"],
    [-180, "⬅️ Left"],
    [-135, "↙️ Down-left"],
    [-90, "⬇️ Down"],
    [-45, "↘️ Down-right"],
  ];
  return dirs.reduce((best, d) => (Math.abs(d[0] - deg) < Math.abs(best[0] - deg) ? d : best))[1];
}

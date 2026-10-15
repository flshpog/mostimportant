import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferGeometry, CatmullRomCurve3, DoubleSide, Float32BufferAttribute, Vector3, type Group, type Mesh, type MeshStandardMaterial } from "three";
import type { Board } from "@everest/board-data";
import type { BoardState } from "@everest/engine";
import { FORK_COLOURS, spaceToWorld } from "./coords";
import type { TokenAnimator } from "./Tokens";

const LIFT = 0.42; // above the path, clear of the tile tops
const START = 0.7; // starts this far from the fork, clear of the token standing on it
const REACH = 3.4; // how far along the path it runs
const HEAD = 0.62; // arrowhead length
const UP = new Vector3(0, 1, 0);

// A flat ribbon along the curve from `s0` to `s1` (distances), ending in an arrowhead.
// Triangles run start to end, so a draw range can "grow" it along the path.
function ribbon(curve: CatmullRomCurve3, s0: number, s1: number, half: number, headHalf: number): BufferGeometry {
  const L = curve.getLength();
  const pos: number[] = [];
  const idx: number[] = [];
  const N = 40;
  const bodyEnd = s1 - HEAD;
  for (let i = 0; i <= N; i++) {
    const u = (s0 + ((bodyEnd - s0) * i) / N) / L;
    const p = curve.getPointAt(u);
    const side = curve.getTangentAt(u).cross(UP).normalize().multiplyScalar(half);
    pos.push(p.x + side.x, p.y, p.z + side.z, p.x - side.x, p.y, p.z - side.z);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const uEnd = bodyEnd / L;
  const base = curve.getPointAt(uEnd);
  const side = curve.getTangentAt(uEnd).cross(UP).normalize().multiplyScalar(headHalf);
  const tip = curve.getPointAt(Math.min(1, s1 / L));
  const h = pos.length / 3;
  pos.push(base.x + side.x, base.y, base.z + side.z, base.x - side.x, base.y, base.z - side.z, tip.x, tip.y, tip.z);
  idx.push(h, h + 1, h + 2);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The spaces a path runs through after the fork: the chosen exit, then straight on.
function pathPoints(layout: Board, fork: string, first: string): Vector3[] {
  const pts = [spaceToWorld(layout, fork), spaceToWorld(layout, first)];
  let cur = layout.spaces.find((s) => s.id === first);
  for (let i = 0; i < 2 && cur; i++) {
    const next = cur.next[0];
    if (!next) break;
    pts.push(spaceToWorld(layout, next));
    cur = layout.spaces.find((s) => s.id === next);
  }
  return pts.map((p) => p.add(new Vector3(0, LIFT, 0)));
}

function PathArrow(props: { points: Vector3[]; colour: string; ready: () => boolean; onPick: (() => void) | null }) {
  const { points, colour, ready, onPick } = props;
  const group = useRef<Group>(null);
  const top = useRef<Mesh>(null);
  const outline = useRef<Mesh>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const hover = useRef(false);
  const grow = useRef(0);
  const { body, edge } = useMemo(() => {
    const curve = new CatmullRomCurve3(points, false, "centripetal");
    const L = curve.getLength();
    const s1 = Math.min(L - 0.05, START + REACH);
    return { body: ribbon(curve, START, s1, 0.16, 0.42), edge: ribbon(curve, START - 0.07, Math.min(L, s1 + 0.12), 0.24, 0.55) };
  }, [points]);

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const show = ready();
    grow.current = show ? Math.min(1, grow.current + dt / 0.45) : 0;
    const e = 1 - (1 - grow.current) ** 3;
    for (const m of [top.current, outline.current]) {
      if (!m) continue;
      const count = m.geometry.index!.count;
      // grow along the path; the head (last triangle) pops on at the end
      m.geometry.setDrawRange(0, e >= 1 ? count : Math.floor(((count - 3) * e) / 3) * 3);
      m.visible = grow.current > 0;
    }
    if (group.current) group.current.position.y = Math.sin(t * 3) * 0.05 + (hover.current ? 0.12 : 0);
    if (mat.current) mat.current.emissiveIntensity = 0.5 + (Math.sin(t * 4) * 0.5 + 0.5) * 0.45 + (hover.current ? 0.5 : 0);
  });

  const handlers = onPick
    ? {
        onClick: (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onPick();
        },
        onPointerOver: () => {
          hover.current = true;
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          hover.current = false;
          document.body.style.cursor = "";
        },
      }
    : {};
  return (
    <group ref={group}>
      <mesh ref={outline} geometry={edge} position={[0, -0.015, 0]} {...handlers}>
        <meshBasicMaterial color="#ffffff" side={DoubleSide} />
      </mesh>
      <mesh ref={top} geometry={body} {...handlers}>
        <meshStandardMaterial ref={mat} color={colour} emissive={colour} emissiveIntensity={0.6} roughness={0.4} side={DoubleSide} />
      </mesh>
    </group>
  );
}

// At a fork, a glowing arrow runs along each path (curving with the track) in the same
// colours as the buttons. They draw themselves in once the token has arrived; the
// player at the fork can click one to go that way.
export function ForkArrows(props: { layout: Board; state: BoardState; animator: TokenAnimator; meId: string | null; ready: boolean; onPick: (next: string) => void }) {
  const { layout, state, animator, meId, ready, onPick } = props;
  const m = state.move;
  const c = m?.choice;
  const options = c?.kind === "fork" ? c.options : null;
  const forkSpace = c?.kind === "fork" ? c.spaceId : null;
  const key = options?.join(",") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paths = useMemo(() => (options && forkSpace ? options.map((o) => pathPoints(layout, forkSpace, o)) : []), [layout, forkSpace, key]);
  if (!m || !options || !forkSpace) return null;
  const mine = m.playerId === meId;
  return (
    <group>
      {options.map((o, i) => (
        <PathArrow
          key={`${forkSpace}-${o}-${m.rolledAt}`}
          points={paths[i]}
          colour={FORK_COLOURS[i % FORK_COLOURS.length]}
          ready={() => ready && !animator.busy(m.playerId)}
          onPick={mine ? () => onPick(o) : null}
        />
      ))}
    </group>
  );
}

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ExtrudeGeometry, Shape, type Group, type MeshStandardMaterial } from "three";
import type { Board } from "@everest/board-data";
import type { BoardState } from "@everest/engine";
import { FORK_COLOURS, spaceToWorld } from "./coords";
import type { TokenAnimator } from "./Tokens";

// A chunky arrow lying flat, pointing along +X.
function arrowGeometry() {
  const s = new Shape();
  s.moveTo(-0.35, -0.15);
  s.lineTo(0.15, -0.15);
  s.lineTo(0.15, -0.36);
  s.lineTo(0.62, 0);
  s.lineTo(0.15, 0.36);
  s.lineTo(0.15, 0.15);
  s.lineTo(-0.35, 0.15);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2); // lie flat: shape +Y becomes world -Z
  return g;
}

function PathArrow(props: {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  colour: string;
  ready: () => boolean;
  onPick: (() => void) | null;
}) {
  const { from, to, colour, ready, onPick } = props;
  const ref = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const geometry = useMemo(arrowGeometry, []);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const yaw = Math.atan2(-dz, dx);
  const hover = useRef(false);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    // halfway down the path (clear of the token on the fork), nudging forward like
    // it's saying "this way"
    const push = Math.max(1.1, len * 0.55) + (Math.sin(t * 4) * 0.5 + 0.5) * 0.25;
    g.position.set(from.x + ux * push, from.y + 0.5 + Math.sin(t * 4) * 0.05, from.z + uz * push);
    const target = ready() ? (hover.current ? 1.6 : 1.35) : 0;
    const s = g.scale.x + (target - g.scale.x) * (1 - Math.exp(-10 * dt));
    g.scale.setScalar(s);
    if (mat.current) mat.current.emissiveIntensity = 0.45 + (Math.sin(t * 4) * 0.5 + 0.5) * 0.5 + (hover.current ? 0.4 : 0);
  });
  return (
    <group ref={ref} rotation={[0, yaw, 0]} scale={0}>
      <mesh
        geometry={geometry}
        castShadow
        onClick={
          onPick
            ? (e) => {
                e.stopPropagation();
                onPick();
              }
            : undefined
        }
        onPointerOver={() => {
          hover.current = true;
          if (onPick) document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          hover.current = false;
          document.body.style.cursor = "";
        }}
      >
        <meshStandardMaterial ref={mat} color={colour} emissive={colour} emissiveIntensity={0.6} roughness={0.35} />
      </mesh>
    </group>
  );
}

// At a fork, a glowing arrow down each path in the same colours as the buttons. They
// appear once the token has finished hopping there; the player at the fork can click one.
export function ForkArrows(props: { layout: Board; state: BoardState; animator: TokenAnimator; meId: string | null; onPick: (next: string) => void }) {
  const { layout, state, animator, meId, onPick } = props;
  const m = state.move;
  const c = m?.choice;
  if (!m || !c || c.kind !== "fork") return null;
  const from = spaceToWorld(layout, c.spaceId);
  const mine = m.playerId === meId;
  return (
    <group>
      {c.options.map((o, i) => (
        <PathArrow
          key={`${c.spaceId}-${o}-${m.rolledAt}`}
          from={from}
          to={spaceToWorld(layout, o)}
          colour={FORK_COLOURS[i % FORK_COLOURS.length]}
          ready={() => !animator.busy(m.playerId)}
          onPick={mine ? () => onPick(o) : null}
        />
      ))}
    </group>
  );
}

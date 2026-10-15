import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Vector3, type Group } from "three";
import type { BoardState } from "@everest/engine";

export const TOKEN_COLOURS = ["#ef476f", "#118ab2", "#06d6a0", "#ffb703", "#8338ec", "#fb5607", "#3a86ff", "#ff006e"];
export function tokenColour(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TOKEN_COLOURS[h % TOKEN_COLOURS.length];
}

const HOP_SECONDS = 0.34;
const HOP_HEIGHT = 0.6;

// Shared, mutable animation state (outside React so 60fps updates don't re-render).
export class TokenAnimator {
  shown = new Map<string, Vector3>(); // where each token is drawn right now
  queue = new Map<string, Vector3[]>(); // hops still to play
  hop = new Map<string, { from: Vector3; to: Vector3; t: number }>();
  enqueue(id: string, to: Vector3) {
    this.queue.set(id, [...(this.queue.get(id) ?? []), to.clone()]);
  }
  busy(id: string) {
    return this.hop.has(id) || (this.queue.get(id)?.length ?? 0) > 0;
  }
}

export interface Popup {
  id: number;
  playerId: string;
  text: string;
  tone: "good" | "bad" | "star";
}

function Token(props: {
  id: string;
  name: string;
  avatar: string | null;
  home: Vector3; // resting spot (space + offset when sharing)
  current: boolean;
  me: boolean;
  animator: TokenAnimator;
  popups: Popup[];
}) {
  const { id, name, avatar, home, current, me, animator, popups } = props;
  const ref = useRef<Group>(null);
  const marker = useRef<Group>(null);
  const colour = useMemo(() => tokenColour(id), [id]);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    let shown = animator.shown.get(id);
    if (!shown) {
      shown = home.clone();
      animator.shown.set(id, shown);
    }
    let hop = animator.hop.get(id);
    if (!hop) {
      const next = animator.queue.get(id)?.shift();
      if (next) {
        hop = { from: shown.clone(), to: next, t: 0 };
        animator.hop.set(id, hop);
      }
    }
    if (hop) {
      hop.t = Math.min(1, hop.t + dt / HOP_SECONDS);
      const e = hop.t < 0.5 ? 2 * hop.t * hop.t : 1 - (-2 * hop.t + 2) ** 2 / 2;
      shown.lerpVectors(hop.from, hop.to, e);
      shown.y += Math.sin(Math.PI * hop.t) * HOP_HEIGHT;
      if (hop.t >= 1) {
        shown.copy(hop.to);
        animator.hop.delete(id);
      }
    } else {
      // Settle onto the resting spot (also covers reconnects, undos and late joiners).
      shown.lerp(home, 1 - Math.exp(-8 * dt));
    }
    g.position.copy(shown);
    if (marker.current) {
      marker.current.position.y = 1.75 + Math.sin(clock.getElapsedTime() * 3) * 0.08;
      marker.current.rotation.y += dt * 2;
    }
  });
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <group ref={ref} position={home}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.27, 0.32, 0.12, 16]} />
        <meshStandardMaterial color={colour} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.62, 0]} castShadow>
        <coneGeometry args={[0.22, 0.6, 16]} />
        <meshStandardMaterial color={colour} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.0, 0]} castShadow>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshStandardMaterial color={colour} roughness={0.4} />
      </mesh>
      {current && (
        <group ref={marker} position={[0, 1.75, 0]}>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.16, 0.3, 4]} />
            <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.6} />
          </mesh>
        </group>
      )}
      <Html position={[0, 1.42, 0]} center distanceFactor={14} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className={`token-tag ${me ? "me" : ""}`} style={{ borderColor: colour }}>
          {avatar ? <img src={avatar} alt="" /> : <span style={{ background: colour }}>{initial}</span>}
          <b>{name}</b>
        </div>
      </Html>
      {popups.map((p) => (
        <Html key={p.id} position={[0, 2.0, 0]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
          <div className={`popup ${p.tone}`}>{p.text}</div>
        </Html>
      ))}
    </group>
  );
}

// Lays out everyone on the board; players sharing a space stand in a little ring.
export function Tokens(props: {
  state: BoardState;
  spacePos: Map<string, Vector3>;
  animator: TokenAnimator;
  meId: string | null;
  avatars: Record<string, string | null>;
  popups: Popup[];
}) {
  const { state, spacePos, animator, meId, avatars, popups } = props;
  const homes = useMemo(() => {
    const bySpace = new Map<string, string[]>();
    for (const id of state.turn.order) {
      const p = state.players[id];
      if (p) bySpace.set(p.space, [...(bySpace.get(p.space) ?? []), id]);
    }
    const out = new Map<string, Vector3>();
    for (const [space, ids] of bySpace) {
      const c = spacePos.get(space) ?? new Vector3();
      ids.forEach((id, i) => {
        const n = ids.length;
        const off = n === 1 ? new Vector3() : new Vector3(Math.cos((i / n) * Math.PI * 2) * 0.42, 0, Math.sin((i / n) * Math.PI * 2) * 0.42);
        out.set(id, c.clone().add(off));
      });
    }
    return out;
  }, [state, spacePos]);
  const current = state.turn.order[state.turn.index];
  return (
    <group>
      {state.turn.order.map((id) => {
        const p = state.players[id];
        if (!p) return null;
        return (
          <Token
            key={id}
            id={id}
            name={p.name}
            avatar={avatars[id] ?? null}
            home={homes.get(id) ?? new Vector3()}
            current={state.started && id === current}
            me={id === meId}
            animator={animator}
            popups={popups.filter((x) => x.playerId === id)}
          />
        );
      })}
    </group>
  );
}

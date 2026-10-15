import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ExtrudeGeometry, Shape, Vector3, type Group } from "three";

export function starGeometry() {
  const shape = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.26 : 0.6;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1 });
  g.center();
  return g;
}

// Heights above the space.
const BASE_Y = 1.35; // floating over its space
const RAISED_Y = 3.0; // lifted over the head (and name tag) of a player who reached it
const SKY_Y = 24; // out of sight
const NORMAL_SPIN = 1.2; // rad/s
const FAST_SPIN = 16;

// The claim cutscene, in ms from the purchase.
export const STAR_TIMELINE = {
  spin: 900, // spins up over the buyer's head
  lift: 900, // shoots up into the sky
  pan: 1000, // camera glides to the new space while it's out of sight
  descend: 2200, // drifts down onto the new space, spinning fast
  settle: 1600, // spin eases back to normal
};
const T = STAR_TIMELINE;
export const STAR_CAMERA_AT = T.spin + T.lift - 150; // when the camera starts gliding to the new spot
export const STAR_LANDED_AT = T.spin + T.lift + T.pan + T.descend;
export const STAR_CUTSCENE_MS = STAR_LANDED_AT + T.settle;

// Shared, mutable star animation state, driven by events (like TokenAnimator).
export class StarDirector {
  // When a star prompt is up, the star rises once the player has arrived (performance.now()).
  raiseAt = 0;
  claim: { start: number; from: Vector3; to: Vector3 } | null = null;
  // smoothed values the frame loop carries between frames
  angle = 0;
  spin = NORMAL_SPIN;
  height = BASE_Y;
}

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// The star floats and turns above its space, glowing. While someone is deciding
// whether to buy it, it rises over their head; when it's bought it spins, flies off
// and drifts down onto its new space.
export function Star({ position, director, offered }: { position: Vector3; director: StarDirector; offered: boolean }) {
  const ref = useRef<Group>(null);
  const geometry = useMemo(starGeometry, []);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    const d = director;
    const now = performance.now();
    const bob = Math.sin(clock.getElapsedTime() * 2) * 0.12;
    let at = position;
    let y: number;
    let spinTarget = NORMAL_SPIN;
    let spinRate = 3; // how fast the spin speed follows its target
    let scale = 1;
    g.visible = true;

    const c = d.claim;
    const local = c ? now - c.start : Infinity;
    if (c && local < STAR_CUTSCENE_MS && local >= 0) {
      if (local < T.spin) {
        const u = local / T.spin;
        at = c.from;
        y = RAISED_Y + bob * (1 - u);
        spinTarget = FAST_SPIN;
        spinRate = 4;
        scale = 1 + 0.3 * Math.sin(Math.PI * u);
      } else if (local < T.spin + T.lift) {
        const u = (local - T.spin) / T.lift;
        at = c.from;
        y = RAISED_Y + (SKY_Y - RAISED_Y) * easeIn(u);
        spinTarget = FAST_SPIN;
      } else if (local < T.spin + T.lift + T.pan) {
        at = c.to;
        y = SKY_Y;
        g.visible = false;
        spinTarget = FAST_SPIN;
      } else if (local < STAR_LANDED_AT) {
        const u = (local - T.spin - T.lift - T.pan) / T.descend;
        at = c.to;
        y = SKY_Y + (BASE_Y - SKY_Y) * easeOut(u) + bob * u;
        spinTarget = FAST_SPIN;
      } else {
        at = c.to;
        y = BASE_Y + bob;
        spinRate = 1.6; // winds down gently
      }
      d.height = y;
    } else {
      if (c) d.claim = null;
      const raised = offered && now >= d.raiseAt;
      const target = raised ? RAISED_Y : BASE_Y;
      d.height += (target - d.height) * (1 - Math.exp(-4 * dt));
      y = d.height + bob;
      if (raised) spinTarget = 2.6;
    }
    d.spin += (spinTarget - d.spin) * (1 - Math.exp(-spinRate * dt));
    d.angle += d.spin * dt;
    g.rotation.y = d.angle;
    g.position.set(at.x, at.y + y, at.z);
    g.scale.setScalar(scale);
  });
  return (
    <group ref={ref} position={[position.x, position.y + BASE_Y, position.z]}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.55} roughness={0.25} metalness={0.1} />
      </mesh>
      <pointLight color="#ffd86b" intensity={6} distance={5} decay={2} />
    </group>
  );
}

// Where the star will appear next, shown only to whoever used a Crystal Ball: a
// see-through star, turning slowly.
export function GhostStar({ position }: { position: Vector3 }) {
  const ref = useRef<Group>(null);
  const geometry = useMemo(starGeometry, []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y = t * 0.8;
    ref.current.position.set(position.x, position.y + BASE_Y + 0.3 + Math.sin(t * 2) * 0.15, position.z);
  });
  return (
    <group ref={ref}>
      <mesh geometry={geometry} scale={1.15}>
        <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.7} transparent opacity={0.45} depthWrite={false} />
      </mesh>
    </group>
  );
}

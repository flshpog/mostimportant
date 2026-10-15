import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3, type Group, type Mesh } from "three";
import { ItemDropDirector } from "./ItemDrops";
import { starGeometry } from "./Star";
import type { TokenAnimator } from "./Tokens";

// Things that fly from one token to another: coins for a coin steal, a star for a
// star steal. Positions come from the tokens as drawn, so they follow the pawns.
export interface Flight {
  kind: "coins" | "star";
  from: string; // player ids
  to: string;
  start: number; // performance.now()
  count: number; // coins only
}

export const COIN_FLIGHT_MS = 1500;
export const STAR_FLIGHT_MS = 2400;

export class FlightDirector {
  flights: Flight[] = [];
  // items coming down to (or popping out of) a pawn
  items = new ItemDropDirector();
  add(f: Omit<Flight, "start">) {
    this.flights.push({ ...f, start: performance.now() });
  }
}

const MAX_COINS = 12;
const HEAD = 1.3;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function Flights({ director, animator }: { director: FlightDirector; animator: TokenAnimator }) {
  const coins = useRef<(Mesh | null)[]>([]);
  const star = useRef<Group>(null);
  const starGeo = useMemo(starGeometry, []);
  const a = useMemo(() => new Vector3(), []);
  const b = useMemo(() => new Vector3(), []);

  useFrame(({ clock }) => {
    const now = performance.now();
    director.flights = director.flights.filter((f) => now - f.start < (f.kind === "coins" ? COIN_FLIGHT_MS + MAX_COINS * 70 : STAR_FLIGHT_MS) + 100);
    let used = 0;
    let starShown = false;
    for (const f of director.flights) {
      const from = animator.shown.get(f.from);
      const to = animator.shown.get(f.to);
      if (!from || !to) continue;
      a.copy(from).setY(from.y + HEAD);
      b.copy(to).setY(to.y + HEAD);
      const dist = a.distanceTo(b);
      if (f.kind === "coins") {
        // a stream of coins, each on its own arc, a beat apart
        const n = Math.min(MAX_COINS - used, f.count);
        for (let j = 0; j < n; j++) {
          const m = coins.current[used++];
          if (!m) continue;
          const u = (now - f.start - j * 70) / (COIN_FLIGHT_MS - 300);
          m.visible = u > 0 && u < 1;
          if (!m.visible) continue;
          const e = ease(u);
          const h = 2.2 + dist * 0.18 + (j % 3) * 0.3;
          m.position.lerpVectors(a, b, e);
          m.position.y += Math.sin(Math.PI * u) * h;
          m.position.x += Math.sin(j * 2.1) * 0.25 * Math.sin(Math.PI * u);
          m.rotation.set(Math.PI / 2, clock.getElapsedTime() * 9 + j, 0);
        }
      } else if (star.current) {
        // rises off the victim, arcs over, settles onto the thief
        starShown = true;
        const t = (now - f.start) / STAR_FLIGHT_MS;
        const g = star.current;
        if (t < 0.25) {
          const u = ease(t / 0.25);
          g.position.copy(a).setY(a.y + u * 1.8);
          g.scale.setScalar(0.6 + u * 0.4);
        } else if (t < 0.8) {
          const u = ease((t - 0.25) / 0.55);
          g.position.lerpVectors(a, b, u);
          g.position.y += 1.8 + Math.sin(Math.PI * u) * (2.5 + dist * 0.15);
          g.scale.setScalar(1);
        } else {
          const u = ease(Math.min(1, (t - 0.8) / 0.2));
          g.position.copy(b).setY(b.y + 1.8 * (1 - u));
          g.scale.setScalar(1 - u * 0.7);
        }
        g.rotation.y = clock.getElapsedTime() * 8;
        g.visible = t < 1;
      }
    }
    for (let i = used; i < MAX_COINS; i++) if (coins.current[i]) coins.current[i]!.visible = false;
    if (star.current && !starShown) star.current.visible = false;
  });

  return (
    <group>
      {Array.from({ length: MAX_COINS }, (_, i) => (
        <mesh key={i} ref={(m) => (coins.current[i] = m)} visible={false} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.07, 18]} />
          <meshStandardMaterial color="#f5b100" emissive="#c98a00" emissiveIntensity={0.35} roughness={0.3} metalness={0.4} />
        </mesh>
      ))}
      <group ref={star} visible={false}>
        <mesh geometry={starGeo} castShadow>
          <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.6} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
}

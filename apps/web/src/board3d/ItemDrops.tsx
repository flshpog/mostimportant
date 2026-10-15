import { useMemo, useReducer, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, DoubleSide, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { ItemModel } from "./ItemModels";
import type { TokenAnimator } from "./Tokens";

// An item arriving or being used, over a pawn.
//  "buy": a beam of light comes down from the sky and the item drifts down it,
//         spinning, hangs over the buyer's head, then tucks itself away into them.
//  "use": the item pops up out of the pawn, spins, and bursts.
export interface ItemDrop {
  kind: "buy" | "use";
  playerId: string;
  model: string; // see ItemModel
  start: number; // performance.now()
}

// The buy cutscene, in ms from its start.
export const DROP = {
  beamIn: 500,
  descendFrom: 300,
  landed: 2500, // hanging over the buyer's head; the banner goes up
  tuckAt: 3500,
  end: 4100,
};
export const USE_MS = 1500;

export class ItemDropDirector {
  drops: ItemDrop[] = [];
  add(d: Omit<ItemDrop, "start">) {
    this.drops.push({ ...d, start: performance.now() });
  }
}

const SKY = 13;
const HOVER = 3.3; // well over the pawn's name tag
const SIZE = 1.6; // the models are about a metre; a bit bigger reads better from the camera
const SPARKS = 14;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// overshoots a little, for the pop
const easeBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

function beamTexture() {
  // bright in the middle, fading out to the sides and towards the top
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const across = ctx.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = "destination-in";
  const up = ctx.createLinearGradient(0, 0, 0, 256);
  up.addColorStop(0, "rgba(0,0,0,0)");
  up.addColorStop(0.35, "rgba(0,0,0,0.8)");
  up.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = up;
  ctx.fillRect(0, 0, 64, 256);
  return new CanvasTexture(c);
}

function One({ drop, animator, onDone }: { drop: ItemDrop; animator: TokenAnimator; onDone: () => void }) {
  const item = useRef<Group>(null);
  const beam = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const sparks = useRef<Group>(null);
  const beamTex = useMemo(beamTexture, []);
  const gold = drop.model.startsWith("advantage:");
  const done = useRef(false);

  useFrame(() => {
    const g = item.current;
    if (!g) return;
    const at = animator.shown.get(drop.playerId);
    const t = performance.now() - drop.start;
    const total = drop.kind === "buy" ? DROP.end : USE_MS;
    if (t > total || !at) {
      if (!done.current) {
        done.current = true;
        onDone();
      }
      g.visible = false;
      return;
    }
    if (t < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    let y: number;
    let scale = 1;
    let spin: number;
    let beamAlpha = 0;
    let ringU = -1; // landing ring, 0..1 while it spreads
    let sparkle = 0; // how far out the sparks are, 0 = hidden

    if (drop.kind === "buy") {
      // dims once the item has arrived, so the beam doesn't wash it out
      beamAlpha = Math.min(clamp01(t / DROP.beamIn), clamp01((DROP.end - t) / 600)) * (0.5 - 0.25 * clamp01((t - DROP.landed + 600) / 600));
      if (t < DROP.landed) {
        const u = clamp01((t - DROP.descendFrom) / (DROP.landed - DROP.descendFrom));
        y = SKY + (HOVER - SKY) * easeOut(u);
        spin = t * 0.006 * (1 - 0.6 * u);
        scale = 0.8 + 0.2 * u;
        sparkle = 0.7;
      } else if (t < DROP.tuckAt) {
        const u = (t - DROP.landed) / (DROP.tuckAt - DROP.landed);
        y = HOVER + Math.sin(u * Math.PI * 2) * 0.08;
        spin = DROP.landed * 0.0024 + (t - DROP.landed) * 0.0028;
        scale = 1 + 0.25 * Math.sin(clamp01(u * 3) * Math.PI);
        ringU = clamp01(u * 1.6);
        sparkle = 1 + u;
      } else {
        // tucked away into the pawn
        const u = easeInOut(clamp01((t - DROP.tuckAt) / (DROP.end - DROP.tuckAt - 150)));
        y = HOVER + (1.0 - HOVER) * u;
        spin = DROP.landed * 0.0024 + (t - DROP.landed) * 0.0028 + u * 6;
        scale = 1 - u;
      }
    } else {
      const pop = clamp01(t / 450);
      y = 1.1 + 1.9 * easeOut(pop);
      spin = t * 0.009;
      scale = t < 1000 ? 0.9 * easeBack(pop) : 0.9 * (1 - easeInOut(clamp01((t - 1000) / 450)));
      if (t > 900) {
        ringU = clamp01((t - 900) / 500);
        sparkle = 1 + 2 * ringU;
      }
    }

    g.position.set(at.x + (drop.kind === "buy" ? Math.sin(t * 0.003) * 0.15 * clamp01((DROP.landed - t) / 800) : 0), at.y + y, at.z);
    g.rotation.y = spin;
    g.scale.setScalar(Math.max(0.0001, scale * SIZE));

    if (beam.current) {
      beam.current.visible = beamAlpha > 0.001;
      beam.current.position.set(at.x, at.y, at.z);
      for (const m of beam.current.children as Mesh[]) (m.material as MeshBasicMaterial).opacity = beamAlpha;
    }
    if (ring.current) {
      ring.current.visible = ringU >= 0 && ringU < 1;
      ring.current.position.set(at.x, at.y + y - 0.2, at.z);
      ring.current.scale.setScalar((0.3 + ringU * 2.2) * SIZE);
      (ring.current.material as MeshBasicMaterial).opacity = 0.8 * (1 - ringU);
    }
    if (sparks.current) {
      sparks.current.visible = sparkle > 0 && scale > 0.05;
      sparks.current.position.copy(g.position);
      sparks.current.children.forEach((s, i) => {
        const a = (i / SPARKS) * Math.PI * 2 + t * 0.002 * (i % 2 ? 1 : -1);
        const r = (0.55 + 0.35 * sparkle + 0.1 * Math.sin(t * 0.01 + i)) * SIZE;
        s.position.set(Math.cos(a) * r, Math.sin(t * 0.004 + i * 1.7) * 0.45, Math.sin(a) * r);
        s.rotation.set(t * 0.004, t * 0.003 + i, 0);
        s.scale.setScalar(0.06 * (0.6 + 0.4 * Math.sin(t * 0.012 + i * 2)) * (drop.kind === "use" ? 1.6 - ringU : 1));
      });
    }
  });

  const tint = gold ? "#ffd86b" : drop.kind === "use" ? "#c9b8ff" : "#fff2b3";
  return (
    <>
      {drop.kind === "buy" && (
        <group ref={beam} visible={false}>
          {/* two crossed sheets and a soft column: reads as a beam from any angle */}
          <mesh position={[0, SKY / 2 + 0.2, 0]}>
            <cylinderGeometry args={[0.85, 1.15, SKY, 32, 1, true]} />
            <meshBasicMaterial map={beamTex} color={tint} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
          </mesh>
          <mesh position={[0, SKY / 2 + 0.2, 0]}>
            <cylinderGeometry args={[0.35, 0.5, SKY, 24, 1, true]} />
            <meshBasicMaterial map={beamTex} color="#ffffff" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.2, 32]} />
            <meshBasicMaterial color={tint} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
          </mesh>
        </group>
      )}
      <group ref={item} visible={false}>
        <ItemModel model={drop.model} />
        <pointLight color={tint} intensity={5} distance={4.5} decay={2} />
      </group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.5, 0.62, 40]} />
        <meshBasicMaterial color={tint} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
      </mesh>
      <group ref={sparks} visible={false}>
        {Array.from({ length: SPARKS }, (_, i) => (
          <mesh key={i}>
            <octahedronGeometry args={[1, 0]} />
            <meshBasicMaterial color={i % 3 ? tint : "#ffffff"} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </>
  );
}

export function ItemDrops({ director, animator }: { director: ItemDropDirector; animator: TokenAnimator }) {
  // re-render only when a drop starts or finishes; the frame loop does the rest
  const [, force] = useReducer((n: number) => n + 1, 0);
  const seen = useRef(0);
  useFrame(() => {
    if (director.drops.length !== seen.current) {
      seen.current = director.drops.length;
      force();
    }
  });
  return (
    <>
      {director.drops.map((d) => (
        <One
          key={`${d.start}-${d.playerId}-${d.kind}`}
          drop={d}
          animator={animator}
          onDone={() => {
            director.drops = director.drops.filter((x) => x !== d);
          }}
        />
      ))}
    </>
  );
}

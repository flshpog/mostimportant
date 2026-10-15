import { Suspense, useMemo } from "react";
import { RoundedBox, useGLTF } from "@react-three/drei";
import { Box3, CanvasTexture, DoubleSide, LatheGeometry, Quaternion, SRGBColorSpace, TextureLoader, Vector2, Vector3 } from "three";
import { starGeometry } from "./Star";

// Little 3D versions of the shop items, about a metre across, centred on the origin.
// Flat colours with a touch of glow so they read against any board.

const INK = "#2b2140";
const CREAM = "#fff1d6";

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const MUSHROOMS: Record<string, { cap: string; spots: string; glow?: string; metal?: number }> = {
  mushroom: { cap: "#e5484d", spots: "#ffffff" },
  "golden-mushroom": { cap: "#f5b100", spots: "#fff6c9", glow: "#a86f00", metal: 0.55 },
  "slow-mushroom": { cap: "#4fa3e0", spots: "#ffffff" },
  "poison-mushroom": { cap: "#8e4ec6", spots: "#3b1360" },
};

function Mushroom({ id }: { id: string }) {
  const m = MUSHROOMS[id];
  // spots sit on the cap's surface, turned to face out
  const spots = useMemo(
    () =>
      [
        [0, 1],
        [0.95, 0.55],
        [-0.95, 0.55],
        [2.3, 0.6],
        [-2.3, 0.6],
        [Math.PI, 0.6],
      ].map(([theta, phi]) => {
        const dir = new Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
        const pos = new Vector3(dir.x * 0.55, dir.y * 0.47, dir.z * 0.55);
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
        return { pos, q, r: theta === 0 && phi === 1 ? 0.15 : 0.12 };
      }),
    [],
  );
  return (
    <group position={[0, 0.05, 0]}>
      <mesh position={[0, -0.24, 0]}>
        <cylinderGeometry args={[0.27, 0.31, 0.46, 24]} />
        <meshStandardMaterial color={CREAM} roughness={0.7} />
      </mesh>
      {[-0.1, 0.1].map((x) => (
        <mesh key={x} position={[x, -0.2, 0.275]} scale={[0.6, 1, 0.5]}>
          <capsuleGeometry args={[0.04, 0.09, 4, 8]} />
          <meshBasicMaterial color={id === "poison-mushroom" ? "#3b1360" : INK} />
        </mesh>
      ))}
      <mesh scale={[1, 0.85, 1]}>
        <sphereGeometry args={[0.55, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={m.cap} roughness={0.45} metalness={m.metal ?? 0} emissive={m.glow ?? m.cap} emissiveIntensity={m.glow ? 0.35 : 0.12} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 36]} />
        <meshStandardMaterial color="#e8d3ad" />
      </mesh>
      {spots.map((s, i) => (
        <mesh key={i} position={s.pos} quaternion={s.q} scale={[1, 0.35, 1]}>
          <sphereGeometry args={[s.r, 16, 8]} />
          <meshStandardMaterial color={m.spots} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// Custom Dice Block: a blue block with a question mark
function RerollBlock() {
  const face = useMemo(
    () =>
      canvasTexture((ctx, s) => {
        ctx.fillStyle = "#5bc0eb";
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = "#1f6f99";
        ctx.lineWidth = s * 0.05;
        ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
        ctx.fillStyle = "#1f6f99";
        for (const [x, y] of [
          [0.17, 0.17],
          [0.83, 0.17],
          [0.17, 0.83],
          [0.83, 0.83],
        ]) {
          ctx.beginPath();
          ctx.arc(x * s, y * s, s * 0.04, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = `900 ${s * 0.62}px "Nunito", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = s * 0.06;
        ctx.strokeStyle = INK;
        ctx.strokeText("?", s / 2, s * 0.54);
        ctx.fillStyle = "#ffffff";
        ctx.fillText("?", s / 2, s * 0.54);
      }),
    [],
  );
  return (
    <RoundedBox args={[0.82, 0.82, 0.82]} radius={0.09} smoothness={3}>
      <meshStandardMaterial map={face} roughness={0.5} emissive="#5bc0eb" emissiveIntensity={0.12} />
    </RoundedBox>
  );
}

// Bullet Bill: a black bullet with angry eyes and little white fists
function BulletBill() {
  const black = { color: "#2b2b33", roughness: 0.35, metalness: 0.3, emissive: "#14141a", emissiveIntensity: 0.4 } as const;
  return (
    <group rotation={[0, 0, 0]}>
      <mesh rotation={[0, 0, -Math.PI / 2]} position={[0.05, 0, 0]}>
        <capsuleGeometry args={[0.34, 0.5, 8, 24]} />
        <meshStandardMaterial {...black} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[-0.42, 0, 0]}>
        <cylinderGeometry args={[0.38, 0.38, 0.12, 28]} />
        <meshStandardMaterial color="#4a4a55" roughness={0.4} metalness={0.4} />
      </mesh>
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh position={[0.32, 0.1, side * 0.22]} scale={[0.6, 1, 0.4]}>
            <sphereGeometry args={[0.12, 14, 10]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.37, 0.09, side * 0.25]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshBasicMaterial color={INK} />
          </mesh>
          <mesh position={[0, -0.25, side * 0.36]}>
            <sphereGeometry args={[0.1, 12, 10]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Crystal Ball: a glowing glass ball on a gold stand, a star inside
function CrystalBall() {
  const star = useMemo(starGeometry, []);
  return (
    <group position={[0, 0.08, 0]}>
      <mesh>
        <sphereGeometry args={[0.42, 36, 24]} />
        <meshPhysicalMaterial color="#c9b8ff" emissive="#7c5cff" emissiveIntensity={0.35} roughness={0.05} transmission={0.6} thickness={0.5} transparent opacity={0.75} />
      </mesh>
      <mesh geometry={star} scale={0.3}>
        <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, -0.45, 0]}>
        <cylinderGeometry args={[0.22, 0.32, 0.18, 28]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh position={[0, -0.37, 0]}>
        <torusGeometry args={[0.2, 0.04, 8, 28]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
    </group>
  );
}

// Blue Shell: the spiny shell, blue on top with white spikes and rim, and wings
function BlueShell() {
  const spikes = useMemo(
    () =>
      [
        [0, 1],
        [0, 0.55],
        [Math.PI / 2, 0.55],
        [Math.PI, 0.55],
        [-Math.PI / 2, 0.55],
      ].map(([theta, phi]) => {
        const dir = new Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
        if (phi === 1) dir.set(0, 1, 0);
        return { pos: dir.clone().multiplyScalar(0.45).setY(dir.y * 0.4 + 0.02), q: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir) };
      }),
    [],
  );
  return (
    <group position={[0, -0.05, 0]}>
      <mesh scale={[1, 0.8, 1]}>
        <sphereGeometry args={[0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#2f6fe0" emissive="#1d4ed8" emissiveIntensity={0.3} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.09, 12, 36]} />
        <meshStandardMaterial color="#f4f1e8" roughness={0.5} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshStandardMaterial color="#f2d9a0" />
      </mesh>
      {spikes.map((s, i) => (
        <mesh key={i} position={s.pos} quaternion={s.q}>
          <coneGeometry args={[0.09, 0.26, 12]} />
          <meshStandardMaterial color="#f4f1e8" roughness={0.4} />
        </mesh>
      ))}
      {[1, -1].map((side) => (
        <mesh key={side} position={[side * 0.55, 0.25, 0]} rotation={[0, 0, side * -0.5]} scale={[1, 0.55, 0.2]}>
          <sphereGeometry args={[0.22, 14, 10]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.2} />
        </mesh>
      ))}
    </group>
  );
}

const GOLD = { color: "#f2b632", metalness: 0.6, roughness: 0.3, emissive: "#8a5a00", emissiveIntensity: 0.35 } as const;

function MagicLamp() {
  return (
    <group position={[0, 0.02, 0]}>
      <mesh scale={[1.3, 0.62, 1]}>
        <sphereGeometry args={[0.36, 28, 16]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      {/* the spout */}
      <mesh position={[0.58, 0.12, 0]} rotation={[0, 0, -1.15]}>
        <cylinderGeometry args={[0.045, 0.12, 0.55, 16]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      {/* the handle */}
      <mesh position={[-0.52, 0.04, 0]}>
        <torusGeometry args={[0.15, 0.04, 10, 24]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh position={[0, -0.26, 0]}>
        <cylinderGeometry args={[0.17, 0.24, 0.12, 24]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh position={[0, 0.22, 0]} scale={[1, 0.6, 1]}>
        <sphereGeometry args={[0.17, 20, 12]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshStandardMaterial color="#e5484d" emissive="#e5484d" emissiveIntensity={0.4} />
      </mesh>
      {/* a wisp of smoke from the spout */}
      <mesh position={[0.86, 0.36, 0]}>
        <sphereGeometry args={[0.08, 12, 8]} />
        <meshStandardMaterial color="#c9b8ff" emissive="#8e4ec6" emissiveIntensity={0.6} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function BooBell() {
  const bell = useMemo(
    () =>
      new LatheGeometry(
        [
          [0, 0.4],
          [0.1, 0.4],
          [0.19, 0.34],
          [0.25, 0.18],
          [0.28, -0.02],
          [0.34, -0.2],
          [0.44, -0.3],
          [0.45, -0.35],
          [0.4, -0.36],
        ].map(([x, y]) => new Vector2(x, y)),
        40,
      ),
    [],
  );
  return (
    <group position={[0, 0.02, 0]}>
      <mesh geometry={bell}>
        <meshStandardMaterial color="#f1ecff" emissive="#b9a6ff" emissiveIntensity={0.35} roughness={0.4} side={DoubleSide} />
      </mesh>
      {/* the Boo's face on the front */}
      {[-0.08, 0.08].map((x) => (
        <mesh key={x} position={[x, 0.08, 0.255]} scale={[0.7, 1.2, 0.4]}>
          <sphereGeometry args={[0.04, 10, 8]} />
          <meshBasicMaterial color={INK} />
        </mesh>
      ))}
      <mesh position={[0, -0.04, 0.275]} scale={[1.3, 0.8, 0.4]}>
        <sphereGeometry args={[0.05, 12, 8]} />
        <meshBasicMaterial color="#c2255c" />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <torusGeometry args={[0.09, 0.032, 8, 20]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh position={[0, -0.4, 0]}>
        <sphereGeometry args={[0.08, 14, 10]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
    </group>
  );
}

// What other players see: a wrapped present (bags are private).
function Present() {
  return (
    <group>
      <RoundedBox args={[0.72, 0.62, 0.72]} radius={0.05} smoothness={2}>
        <meshStandardMaterial color="#e0569b" emissive="#e0569b" emissiveIntensity={0.15} roughness={0.5} />
      </RoundedBox>
      <mesh>
        <boxGeometry args={[0.75, 0.64, 0.15]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.15, 0.64, 0.75]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      {[0.6, -0.6].map((r) => (
        <mesh key={r} position={[r * 0.18, 0.4, 0]} rotation={[0, 0, r * 1.6]} scale={[1, 0.6, 1]}>
          <torusGeometry args={[0.13, 0.045, 8, 20]} />
          <meshStandardMaterial {...GOLD} />
        </mesh>
      ))}
    </group>
  );
}

// The tribe advantage: its picture on a gold card.
function AdvantageCard({ image }: { image: string }) {
  const tex = useMemo(() => {
    const t = new TextureLoader().load(`${import.meta.env.BASE_URL}advantages/${image}`);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [image]);
  return (
    <group>
      <RoundedBox args={[1.05, 1.25, 0.08]} radius={0.06} smoothness={2}>
        <meshStandardMaterial {...GOLD} />
      </RoundedBox>
      {[0, Math.PI].map((r) => (
        <group key={r} rotation={[0, r, 0]}>
          <mesh position={[0, 0, 0.045]}>
            <planeGeometry args={[0.9, 1.1]} />
            <meshBasicMaterial color="#fff4cf" />
          </mesh>
          <mesh position={[0, 0.02, 0.05]}>
            <planeGeometry args={[0.8, 0.8]} />
            <meshBasicMaterial map={tex} alphaTest={0.4} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Proper models made in Blender (art/items.blend, see docs/CREDITS.md), one per item
// id. The hand-built ones below stand in while these load, and for any item without one.
const GLB_ITEMS = new Set([
  "mushroom",
  "golden-mushroom",
  "slow-mushroom",
  "fast-mushroom",
  "poison-mushroom",
  "reroll-block",
  "magic-lamp",
  "star-compass",
  "guard-charm",
  "boo-bell",
]);
// long, flat ones look small at "a metre across"
const GLB_SCALE: Record<string, number> = { "magic-lamp": 1.4, "fast-mushroom": 1.1 };
const glbUrl = (id: string) => `${import.meta.env.BASE_URL}models/items/${id}.glb`;
const DRACO = `${import.meta.env.BASE_URL}draco/`;

// Fetch them all ahead of time, so the first purchase isn't the placeholder.
export function preloadItemModels() {
  for (const id of GLB_ITEMS) useGLTF.preload(glbUrl(id), DRACO);
}

function GlbItem({ id }: { id: string }) {
  const gltf = useGLTF(glbUrl(id), DRACO);
  // a copy per drop (two can be on screen at once), centred and about a metre across
  const object = useMemo(() => {
    const o = gltf.scene.clone(true);
    const box = new Box3().setFromObject(o);
    const size = box.getSize(new Vector3());
    const k = (GLB_SCALE[id] ?? 1) / Math.max(size.x, size.y, size.z);
    o.scale.setScalar(k);
    o.position.copy(box.getCenter(new Vector3()).multiplyScalar(-k));
    return o;
  }, [gltf, id]);
  return <primitive object={object} />;
}

function HandBuilt({ model }: { model: string }) {
  if (model.startsWith("advantage:")) return <AdvantageCard image={model.slice("advantage:".length)} />;
  if (MUSHROOMS[model]) return <Mushroom id={model} />;
  switch (model) {
    case "fast-mushroom":
      return <BulletBill />;
    case "reroll-block":
      return <RerollBlock />;
    case "magic-lamp":
      return <MagicLamp />;
    case "star-compass":
      return <CrystalBall />;
    case "guard-charm":
      return <BlueShell />;
    case "boo-bell":
      return <BooBell />;
    default:
      return <Present />;
  }
}

// `model`: an item id, "advantage:<image>" for the tribe advantage, or "" for a
// purchase this viewer can't see.
export function ItemModel({ model }: { model: string }) {
  if (!GLB_ITEMS.has(model)) return <HandBuilt model={model} />;
  return (
    <Suspense fallback={<HandBuilt model={model} />}>
      <GlbItem id={model} />
    </Suspense>
  );
}

import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import { CanvasTexture, DoubleSide, ExtrudeGeometry, LatheGeometry, Quaternion, Shape, SRGBColorSpace, TextureLoader, Vector2, Vector3 } from "three";
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
  "fast-mushroom": { cap: "#f97316", spots: "#fff3c4" },
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

function RerollBlock() {
  const face = useMemo(
    () =>
      canvasTexture((ctx, s) => {
        ctx.fillStyle = "#f2c230";
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = "#b07a00";
        ctx.lineWidth = s * 0.05;
        ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
        ctx.fillStyle = "#b07a00";
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
      <meshStandardMaterial map={face} roughness={0.5} emissive="#f2c230" emissiveIntensity={0.12} />
    </RoundedBox>
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

function StarCompass() {
  const face = useMemo(
    () =>
      canvasTexture((ctx, s) => {
        const c = s / 2;
        ctx.fillStyle = "#fffaf0";
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = "#c9b48a";
        ctx.lineWidth = s * 0.02;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(c + Math.cos(a) * s * 0.3, c + Math.sin(a) * s * 0.3);
          ctx.lineTo(c + Math.cos(a) * s * 0.4, c + Math.sin(a) * s * 0.4);
          ctx.stroke();
        }
        // the needle: red to the north, blue to the south
        const needle = (dir: number, colour: string) => {
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.moveTo(c, c + dir * s * 0.36);
          ctx.lineTo(c - s * 0.07, c);
          ctx.lineTo(c + s * 0.07, c);
          ctx.closePath();
          ctx.fill();
        };
        needle(-1, "#e5484d");
        needle(1, "#3b82f6");
        ctx.fillStyle = "#f5b100";
        ctx.beginPath();
        ctx.arc(c, c, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }),
    [],
  );
  const star = useMemo(starGeometry, []);
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.46, 0.46, 0.13, 40]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      {[0, Math.PI].map((r) => (
        <mesh key={r} rotation={[0, r, 0]} position={[0, 0, r ? -0.068 : 0.068]}>
          <circleGeometry args={[0.38, 40]} />
          <meshStandardMaterial map={face} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.55, 0]}>
        <torusGeometry args={[0.09, 0.03, 8, 20]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh geometry={star} position={[0, 0.82, 0]} scale={0.32}>
        <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function shieldShape(w: number, h: number) {
  const s = new Shape();
  s.moveTo(-w, h);
  s.lineTo(w, h);
  s.lineTo(w, 0);
  s.quadraticCurveTo(w, -h * 0.75, 0, -h * 1.2);
  s.quadraticCurveTo(-w, -h * 0.75, -w, 0);
  s.closePath();
  return s;
}

function GuardCharm() {
  const rim = useMemo(() => new ExtrudeGeometry(shieldShape(0.44, 0.44), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }).center(), []);
  const body = useMemo(() => new ExtrudeGeometry(shieldShape(0.35, 0.36), { depth: 0.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }).center(), []);
  const star = useMemo(starGeometry, []);
  return (
    <group>
      <mesh geometry={rim}>
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh geometry={body} position={[0, 0.02, 0]}>
        <meshStandardMaterial color="#3b82f6" emissive="#1d4ed8" emissiveIntensity={0.3} roughness={0.35} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} geometry={star} position={[0, 0.05, side * 0.14]} scale={[0.42, 0.42, 0.3]}>
          <meshStandardMaterial color="#ffd21f" emissive="#ffb300" emissiveIntensity={0.5} />
        </mesh>
      ))}
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

// `model`: an item id, "advantage:<image>" for the tribe advantage, or "" for a
// purchase this viewer can't see.
export function ItemModel({ model }: { model: string }) {
  if (model.startsWith("advantage:")) return <AdvantageCard image={model.slice("advantage:".length)} />;
  if (MUSHROOMS[model]) return <Mushroom id={model} />;
  switch (model) {
    case "reroll-block":
      return <RerollBlock />;
    case "magic-lamp":
      return <MagicLamp />;
    case "star-compass":
      return <StarCompass />;
    case "guard-charm":
      return <GuardCharm />;
    case "boo-bell":
      return <BooBell />;
    default:
      return <Present />;
  }
}

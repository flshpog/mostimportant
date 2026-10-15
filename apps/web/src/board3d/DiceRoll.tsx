import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { CanvasTexture, Euler, Quaternion, SRGBColorSpace, Vector3, type Group, type Mesh, type MeshBasicMaterial } from "three";
import { tokenColour } from "./Tokens";

export interface DiceShow {
  key: number;
  playerId: string;
  name: string;
  total: number;
  mine: boolean;
  // every die rolled (a Mushroom rolls two or three), in the item's colour if any
  dice?: number[];
  colour?: string;
  // two numbers to pick from, no total yet
  choose?: boolean;
  // a Custom Dice Block: the number was chosen, not rolled
  chosen?: boolean;
  // a poisoned roll, halved from this
  halvedFrom?: number;
}

// The roll, in ms: the die drops in and tumbles to a stop facing you, the number
// fades in, it stays a moment, then it goes. Tokens start hopping after DICE_TOTAL_MS.
const FALL_MS = 520;
const SETTLE_MS = 1250; // spinning has eased to a stop by now
const REVEAL_MS = SETTLE_MS + 60;
const LEAVE_MS = 2350;
export const DICE_TOTAL_MS = 2650;

const SIZE = 1.6;
const DROP = 4.6; // world units above the resting spot it falls from
// Resting pose: tipped a little so it still reads as a cube (shows the top and right).
const REST = new Quaternion().setFromEuler(new Euler(0.26, -0.32, 0));

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
function easeOutBack(t: number) {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

// Height over time: falls like it's dropped, then two small bounces.
function heightAt(ms: number): number {
  if (ms < FALL_MS) {
    const u = ms / FALL_MS;
    return DROP * (1 - u * u);
  }
  let t = ms - FALL_MS;
  for (const [len, h] of [
    [300, 0.55],
    [190, 0.16],
  ]) {
    if (t < len) return h * Math.sin((Math.PI * t) / len);
    t -= len;
  }
  return 0;
}

// Face decals: a faint star on every face, the number on the front.
function faceTexture(draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  draw(c.getContext("2d")!, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function starMark(ctx: CanvasRenderingContext2D, s: number) {
  ctx.translate(s / 2, s / 2);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.12 : s * 0.27;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.stroke();
}
function numberMark(n: number) {
  return (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.font = `900 ${s * 0.62}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillText(String(n), s / 2, s / 2 + s * 0.05);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(n), s / 2, s / 2 + s * 0.02);
  };
}

// [position, rotation] of each face's decal, just off the surface.
const OFF = SIZE / 2 + 0.002;
const FACES: [[number, number, number], [number, number, number]][] = [
  [[0, 0, OFF], [0, 0, 0]],
  [[0, 0, -OFF], [0, Math.PI, 0]],
  [[OFF, 0, 0], [0, Math.PI / 2, 0]],
  [[-OFF, 0, 0], [0, -Math.PI / 2, 0]],
  [[0, OFF, 0], [-Math.PI / 2, 0, 0]],
  [[0, -OFF, 0], [Math.PI / 2, 0, 0]],
];

// One die. `x` places it in a row; `delay` staggers the drop a little.
function Die({ total, colour, revealed, x = 0, delay = 0 }: { total: number; colour: string; revealed: boolean; x?: number; delay?: number }) {
  const group = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const number = useRef<Mesh>(null);
  const frontStar = useRef<MeshBasicMaterial>(null);
  const start = useRef(performance.now() + delay);
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    document.fonts.load("900 120px Nunito").finally(() => setFontReady(true));
  }, []);
  const star = useMemo(() => faceTexture(starMark), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const num = useMemo(() => faceTexture(numberMark(total)), [total, fontReady]);
  const shadowTex = useMemo(
    () =>
      faceTexture((ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, "rgba(10,20,40,0.55)");
        g.addColorStop(1, "rgba(10,20,40,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }),
    [],
  );
  // a random tumble that eases out to exactly the resting pose
  const tumble = useMemo(() => {
    const axis = new Vector3(0.6 + Math.random() * 0.4, (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5), (Math.random() - 0.5) * 0.4).normalize();
    const turns = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 0.6) * Math.PI * 2;
    return { axis, turns };
  }, []);
  const q = useMemo(() => new Quaternion(), []);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const ms = Math.max(0, performance.now() - start.current);
    g.position.x = x;
    if (shadow.current) shadow.current.position.x = x;
    const spin = tumble.turns * (1 - easeOutCubic(Math.min(1, ms / SETTLE_MS)));
    q.setFromAxisAngle(tumble.axis, spin).multiply(REST);
    g.quaternion.copy(q);
    const y = heightAt(ms);
    g.position.y = y;
    // a quick squash where it hits the ground
    const impact = ms > FALL_MS && ms < FALL_MS + 120 ? Math.sin((Math.PI * (ms - FALL_MS)) / 120) : 0;
    g.scale.set(1 + impact * 0.07, 1 - impact * 0.09, 1 + impact * 0.07);
    if (shadow.current) {
      const k = Math.max(0.2, 1 - y / DROP);
      shadow.current.scale.setScalar(k);
      (shadow.current.material as MeshBasicMaterial).opacity = k;
    }
    // the number fades and pops in once it has settled
    const n = number.current;
    if (n) {
      const m = n.material as MeshBasicMaterial;
      const target = revealed ? 1 : 0;
      m.opacity += (target - m.opacity) * (1 - Math.exp(-10 * dt));
      n.scale.setScalar(0.5 + 0.5 * easeOutBack(m.opacity));
      if (frontStar.current) frontStar.current.opacity = 1 - m.opacity;
    }
  });

  return (
    <>
      <mesh ref={shadow} position={[0, -SIZE / 2 - 0.25, 0]} rotation={[-Math.PI / 2 + 0.35, 0, 0]}>
        <planeGeometry args={[2.6, 2.6]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
      </mesh>
      <group ref={group}>
        <RoundedBox args={[SIZE, SIZE, SIZE]} radius={0.3} smoothness={5}>
          <meshStandardMaterial color={colour} roughness={0.32} metalness={0.05} />
        </RoundedBox>
        {FACES.map(([p, r], i) => (
          <mesh key={i} position={p} rotation={r}>
            <planeGeometry args={[SIZE * 0.78, SIZE * 0.78]} />
            <meshBasicMaterial ref={i === 0 ? frontStar : undefined} map={star} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
        <mesh ref={number} position={[0, 0, OFF + 0.002]}>
          <planeGeometry args={[SIZE * 0.86, SIZE * 0.86]} />
          <meshBasicMaterial map={num} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

// A big die in the roller's colour drops from the top of the screen, tumbles, and
// settles facing you before the number fades in. A real rounded cube in its own
// little transparent three.js canvas, mounted only while it's on screen.
export function DiceOverlay({ roll, onDone }: { roll: DiceShow | null; onDone: () => void }) {
  const [stage, setStage] = useState<"rolling" | "revealed" | "leaving">("rolling");
  useEffect(() => {
    if (!roll) return;
    setStage("rolling");
    const reveal = setTimeout(() => setStage("revealed"), REVEAL_MS);
    const leave = setTimeout(() => setStage("leaving"), LEAVE_MS);
    const done = setTimeout(onDone, DICE_TOTAL_MS);
    return () => {
      clearTimeout(reveal);
      clearTimeout(leave);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll?.key]);

  if (!roll) return null;
  const colour = roll.colour ?? tokenColour(roll.playerId);
  const dice = roll.dice?.length ? roll.dice : [roll.total];
  // a row of dice, spaced to fit
  const gap = dice.length > 2 ? 2.15 : 2.4;
  const raw = roll.halvedFrom ?? roll.total;
  const result = roll.choose ? (
    <>
      <b>{dice[0]}</b> or <b>{dice[1]}</b>. Pick one!
    </>
  ) : dice.length > 1 ? (
    <>
      {dice.join(" + ")} = <b>{raw}</b>!
    </>
  ) : (
    <>
      <b>{raw}</b>!
    </>
  );
  return (
    <div className={`dice-overlay ${stage}`} key={roll.key} aria-live="polite">
      <div className="dice-canvas">
        <Canvas flat dpr={[1, 2]} gl={{ alpha: true, antialias: true }} camera={{ fov: 30, position: [0, 0, 14], near: 0.1, far: 50 }}>
          <ambientLight intensity={0.9} />
          <hemisphereLight args={["#ffffff", "#7a6a90", 0.6]} />
          <directionalLight position={[3, 6, 5]} intensity={2.2} />
          {dice.map((d, i) => (
            <Die key={`${roll.key}-${i}`} total={d} colour={colour} revealed={stage !== "rolling"} x={(i - (dice.length - 1) / 2) * gap} delay={i * 90} />
          ))}
        </Canvas>
      </div>
      {stage !== "rolling" && <div className="dice-burst" style={{ ["--die" as string]: colour }} />}
      <div className="dice-caption">
        {stage === "rolling" ? (
          <>{roll.mine ? "Rolling…" : `${roll.name} is rolling…`}</>
        ) : (
          <>
            {roll.mine ? (roll.chosen ? "You chose" : "You rolled") : `${roll.name} ${roll.chosen ? "chose" : "rolled"}`} {result}
            {roll.halvedFrom !== undefined && (
              <span className="poisoned">
                {" "}
                Poisoned! Halved to <b>{roll.total}</b>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

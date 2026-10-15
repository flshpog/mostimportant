import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { Box3, Ray, Spherical, Vector3 } from "three";
import type { Board } from "@everest/board-data";
import type { BoardState } from "@everest/engine";
import { allSpacePositions } from "./coords";
import { occluders, Scenery, SceneryBoundary } from "./Scenery";
import { Star } from "./Star";
import { Tiles } from "./Tiles";
import { Tokens, type Popup, type TokenAnimator } from "./Tokens";

export type CamMode = { kind: "overview" } | { kind: "follow"; playerId: string } | { kind: "star" } | { kind: "free" };

const OVERVIEW = { pos: new Vector3(0, 31, 30), target: new Vector3(0, -1, 1.5) };
const FOLLOW_OFFSET = new Vector3(0, 8.5, 9.5);
const LOOK_LIFT = 0.6;
// Where on the token we need a clear line of sight to (its head; the name tag is just above).
const HEAD = new Vector3(0, 1.1, 0);

// True if a scenery box sits between the camera and the point.
function blocked(from: Vector3, to: Vector3): boolean {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  const ray = new Ray(from, dir.normalize());
  const hit = new Vector3();
  for (const box of occluders.boxes) {
    if (box.containsPoint(to)) continue; // the token is standing right against it
    if (ray.intersectBox(box, hit) && hit.distanceTo(from) < dist - 0.3) return true;
  }
  return false;
}

// Camera angles to try when the view is blocked, cheapest change first: a little
// orbit around the token, tilting towards top-down, or both.
const CANDIDATES = (() => {
  const out: { dTheta: number; dPhi: number; cost: number }[] = [];
  for (const dTheta of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
    for (const dPhi of [0, -0.25, -0.5, -0.8]) {
      if (dTheta || dPhi) out.push({ dTheta, dPhi, cost: Math.abs(dTheta) + 1.3 * Math.abs(dPhi) });
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
})();

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function CameraRig(props: { mode: CamMode; setMode: (m: CamMode) => void; animator: TokenAnimator; starPos: Vector3 | null }) {
  const { mode, setMode, animator, starPos } = props;
  const ref = useRef<CameraControls>(null);
  const followTarget = useRef(new Vector3());

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.setBoundary(new Box3(new Vector3(-24, -2, -17), new Vector3(24, 8, 17)));
    c.boundaryFriction = 0.2;
    const onUser = () => setMode({ kind: "free" });
    c.addEventListener("controlstart", onUser);
    return () => c.removeEventListener("controlstart", onUser);
  }, [setMode]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (mode.kind === "overview") void c.setLookAt(OVERVIEW.pos.x, OVERVIEW.pos.y, OVERVIEW.pos.z, OVERVIEW.target.x, OVERVIEW.target.y, OVERVIEW.target.z, true);
    if (mode.kind === "star" && starPos) void c.setLookAt(starPos.x + 5, starPos.y + 8, starPos.z + 8, starPos.x, starPos.y + 0.8, starPos.z, true);
    if (mode.kind === "follow") {
      const p = animator.shown.get(mode.playerId);
      if (p) {
        followTarget.current.copy(p);
        const cam = p.clone().add(FOLLOW_OFFSET);
        void c.setLookAt(cam.x, cam.y, cam.z, p.x, p.y + 0.6, p.z, true);
      }
    }
  }, [mode, starPos, animator]);

  // While following, glide along with the token as it hops, and if a tree or a shop
  // gets between the camera and the token, swing round to the nearest clear angle.
  const avoid = useRef<{ from: Spherical; to: Spherical; t: number } | null>(null);
  const nextCheck = useRef(0);
  useEffect(() => {
    avoid.current = null;
    nextCheck.current = performance.now() + 1000; // let the fly-in finish first
  }, [mode]);

  useFrame((_, dt) => {
    const c = ref.current;
    if (!c || mode.kind !== "follow") return;
    const p = animator.shown.get(mode.playerId);
    if (!p) return;
    const before = followTarget.current.clone();
    followTarget.current.lerp(p, 1 - Math.exp(-5 * dt));
    const look = followTarget.current.clone().add(new Vector3(0, LOOK_LIFT, 0));

    const a = avoid.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / 0.9);
      const e = ease(a.t);
      const sph = new Spherical(
        a.from.radius + (a.to.radius - a.from.radius) * e,
        a.from.phi + (a.to.phi - a.from.phi) * e,
        a.from.theta + (a.to.theta - a.from.theta) * e,
      );
      const cam = new Vector3().setFromSpherical(sph).add(look);
      void c.setLookAt(cam.x, cam.y, cam.z, look.x, look.y, look.z, false);
      if (a.t >= 1) {
        avoid.current = null;
        nextCheck.current = performance.now() + 1200;
      }
      return;
    }

    if (before.distanceTo(followTarget.current) >= 1e-4) {
      const cam = new Vector3();
      c.getPosition(cam);
      const shift = followTarget.current.clone().sub(before);
      void c.setLookAt(cam.x + shift.x, cam.y + shift.y, cam.z + shift.z, look.x, look.y, look.z, false);
    }

    const now = performance.now();
    if (now < nextCheck.current || !occluders.boxes.length) return;
    nextCheck.current = now + 200;
    const cam = new Vector3();
    c.getPosition(cam);
    const head = p.clone().add(HEAD);
    if (!blocked(cam, head)) return;
    const cur = new Spherical().setFromVector3(cam.clone().sub(look));
    let to: Spherical | null = null;
    for (const k of CANDIDATES) {
      const s2 = new Spherical(cur.radius, Math.min(1.25, Math.max(0.08, cur.phi + k.dPhi)), cur.theta + k.dTheta);
      if (!blocked(new Vector3().setFromSpherical(s2).add(look), head)) {
        to = s2;
        break;
      }
    }
    avoid.current = { from: cur, to: to ?? new Spherical(cur.radius, 0.08, cur.theta), t: 0 };
  });

  return <CameraControls ref={ref} makeDefault minDistance={4} maxDistance={70} maxPolarAngle={1.32} smoothTime={0.6} draggingSmoothTime={0.12} />;
}

export function Board3D(props: {
  layout: Board;
  state: BoardState;
  meId: string | null;
  avatars: Record<string, string | null>;
  animator: TokenAnimator;
  popups: Popup[];
  mode: CamMode;
  setMode: (m: CamMode) => void;
  // "lite" drops shadows and caps resolution for slow devices.
  quality?: "full" | "lite";
}) {
  const { layout, state, meId, avatars, animator, popups, mode, setMode } = props;
  const lite = props.quality === "lite";
  const spacePos = useMemo(() => allSpacePositions(layout), [layout]);
  const starPos = state.star ? spacePos.get(state.star) ?? null : null;
  const model = `${import.meta.env.BASE_URL}${layout.world?.model ?? ""}`;
  return (
    <Canvas
      shadows={!lite}
      flat
      dpr={lite ? 1 : [1, 1.75]}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", () => console.error("[board3d] WebGL context lost"));
      }}
      gl={{ antialias: true, alpha: true }}
      camera={{ fov: 40, near: 0.5, far: 300, position: OVERVIEW.pos.toArray() }}
    >
      <hemisphereLight args={["#d6eeff", "#4f9a3e", 1.05]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[18, 30, 14]}
        intensity={2.4}
        color="#fff1d8"
        castShadow={!lite}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
      <SceneryBoundary>
        <Suspense fallback={null}>
          <Scenery url={model} />
        </Suspense>
      </SceneryBoundary>
      <Tiles layout={layout} />
      {starPos && <Star position={starPos.toArray() as [number, number, number]} />}
      <Tokens state={state} spacePos={spacePos} animator={animator} meId={meId} avatars={avatars} popups={popups} />
      <CameraRig mode={mode} setMode={setMode} animator={animator} starPos={starPos} />
    </Canvas>
  );
}

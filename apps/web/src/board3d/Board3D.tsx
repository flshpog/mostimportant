import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { Box3, Vector3 } from "three";
import type { Board } from "@everest/board-data";
import type { BoardState } from "@everest/engine";
import { allSpacePositions } from "./coords";
import { Scenery, SceneryBoundary } from "./Scenery";
import { Star } from "./Star";
import { Tiles } from "./Tiles";
import { Tokens, type Popup, type TokenAnimator } from "./Tokens";

export type CamMode = { kind: "overview" } | { kind: "follow"; playerId: string } | { kind: "star" } | { kind: "free" };

const OVERVIEW = { pos: new Vector3(0, 31, 30), target: new Vector3(0, -1, 1.5) };
const FOLLOW_OFFSET = new Vector3(0, 8.5, 9.5);

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

  // While following, glide along with the token as it hops.
  useFrame((_, dt) => {
    const c = ref.current;
    if (!c || mode.kind !== "follow") return;
    const p = animator.shown.get(mode.playerId);
    if (!p) return;
    const before = followTarget.current.clone();
    followTarget.current.lerp(p, 1 - Math.exp(-5 * dt));
    if (before.distanceTo(followTarget.current) < 1e-4) return;
    const t = followTarget.current;
    const cam = new Vector3();
    c.getPosition(cam);
    const shift = t.clone().sub(before);
    void c.setLookAt(cam.x + shift.x, cam.y + shift.y, cam.z + shift.z, t.x, t.y + 0.6, t.z, false);
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
  const modelPath = layout.world?.model ?? "";
  const model = `${import.meta.env.BASE_URL}${window.location.hash.includes("raw") ? modelPath.replace(".glb", "-raw.glb") : modelPath}`;
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
      {!window.location.hash.includes("noscenery") && (
        <SceneryBoundary>
          <Suspense fallback={null}>
            <Scenery url={model} />
          </Suspense>
        </SceneryBoundary>
      )}
      <Tiles layout={layout} />
      {starPos && <Star position={starPos.toArray() as [number, number, number]} />}
      <Tokens state={state} spacePos={spacePos} animator={animator} meId={meId} avatars={avatars} popups={popups} />
      <CameraRig mode={mode} setMode={setMode} animator={animator} starPos={starPos} />
    </Canvas>
  );
}

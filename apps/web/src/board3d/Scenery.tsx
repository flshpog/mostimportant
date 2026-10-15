import { Component, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { Group, InstancedMesh, Matrix4, Mesh, type BufferGeometry, type Material, type Object3D } from "three";

// The Blender scene has ~700 objects but only ~45 distinct meshes (every tree is a copy
// of one of four trees, and so on). Drawing each object separately is ~700 draw calls,
// which phones hate, so copies are merged into one InstancedMesh per mesh.
function batch(root: Object3D): Group {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { geometry: BufferGeometry; material: Material; matrices: Matrix4[] }>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const material = Array.isArray(m.material) ? m.material[0] : m.material;
    const key = `${m.geometry.uuid}|${material.uuid}`;
    const g = groups.get(key) ?? { geometry: m.geometry, material, matrices: [] };
    g.matrices.push(m.matrixWorld.clone());
    groups.set(key, g);
  });
  const out = new Group();
  for (const { geometry, material, matrices } of groups.values()) {
    const name = (material.name || "").toLowerCase();
    const isWater = name.includes("water") || name.includes("foam");
    if (matrices.length === 1) {
      const mesh = new Mesh(geometry, material);
      mesh.applyMatrix4(matrices[0]);
      mesh.castShadow = !isWater;
      mesh.receiveShadow = true;
      out.add(mesh);
      continue;
    }
    const inst = new InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((mat, i) => inst.setMatrixAt(i, mat));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    out.add(inst);
  }
  return out;
}

export function Scenery({ url }: { url: string }) {
  const gltf = useGLTF(url, `${import.meta.env.BASE_URL}draco/`);
  const batched = useMemo(() => {
    const probe = (window as unknown as { __probeWrite?: (m: string) => void }).__probeWrite;
    probe?.("scenery loaded: " + gltf.scene.children.length + " nodes");
    const g = batch(gltf.scene);
    probe?.("batched into " + g.children.length + " draws");
    (window as unknown as { __sceneryDebug: unknown }).__sceneryDebug = { children: g.children.length };
    return g;
  }, [gltf.scene]);
  return <primitive object={batched} />;
}

// If the scenery fails to load, keep the board playable and say why.
export class SceneryBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error("[board3d] scenery failed to load:", e);
    (window as unknown as { __sceneryDebug: unknown }).__sceneryDebug = { error: String(e instanceof Error ? e.message : e) };
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

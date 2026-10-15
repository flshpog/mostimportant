import { Component, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Group, InstancedMesh, Matrix4, Mesh, Vector3, type BufferGeometry, type Material, type Object3D } from "three";

// Boxes around everything tall enough to hide a token (trees, mushrooms, shops...), for
// the camera to steer around. Filled in once the model loads.
export const occluders: { boxes: Box3[] } = { boxes: [] };
// three.js turns spaces in node names into underscores
const OCCLUDER = /^(tree_|Mushroom[ _]|Shop[ _]|Signpost[ _]|Start[ _]|rock|bush)/;

function findOccluders(root: Object3D): Box3[] {
  root.updateMatrixWorld(true);
  const out: Box3[] = [];
  const size = new Vector3();
  const centre = new Vector3();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    // the named object may be the mesh itself or a parent of its parts
    let n: Object3D | null = m;
    while (n && !OCCLUDER.test(n.name)) n = n.parent;
    if (!n) return;
    const box = new Box3().setFromObject(m);
    box.getSize(size);
    if (size.y < 0.7 || size.x * size.y * size.z < 0.08) return; // flowers, spots, pebbles
    // boxes are fatter than the real shapes; trim the sides so near misses don't count
    box.getCenter(centre);
    box.setFromCenterAndSize(centre, size.set(size.x * 0.8, size.y, size.z * 0.8));
    out.push(box);
  });
  return out;
}

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
    occluders.boxes = findOccluders(gltf.scene);
    if (import.meta.env.DEV) console.debug(`[board3d] ${occluders.boxes.length} camera occluders`);
    return batch(gltf.scene);
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
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

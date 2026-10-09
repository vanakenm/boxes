import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Edges, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { lidLayout, type BoxParams, type Panel, type PanelId } from '../lib/geometry';
import type { PlacedArt } from '../lib/svg';

const COLORS: Record<PanelId, string> = {
  bottom: '#c99a63',
  front: '#e2bb86',
  back: '#e2bb86',
  left: '#d6aa72',
  right: '#d6aa72',
  lid: '#edc996',
};

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const NEG_X = new THREE.Vector3(-1, 0, 0);
const NEG_Y = new THREE.Vector3(0, -1, 0);

/**
 * Maps panel local (u, v, w = extrusion) into box coordinates (x, y, z-up).
 * For left/right the local +w face (the one engraved) faces the inside.
 */
function placement(id: PanelId, p: BoxParams, explode: number): THREE.Matrix4 {
  const { width: W, depth: D, thickness: t } = p;
  const m = new THREE.Matrix4();
  switch (id) {
    case 'bottom':
      return m.makeBasis(X, Y, Z).setPosition(0, 0, -explode);
    case 'front':
      return m.makeBasis(X, Z, NEG_Y).setPosition(0, t - explode, 0);
    case 'back':
      return m.makeBasis(X, Z, NEG_Y).setPosition(0, D + explode, 0);
    case 'left':
      return m.makeBasis(Y, Z, X).setPosition(-explode, 0, 0);
    case 'right':
      return m.makeBasis(NEG_Y, Z, NEG_X).setPosition(W + explode, D, 0);
    case 'lid': {
      const lid = lidLayout(p)!;
      // Explode the lid by sliding it out of the front, plus a little lift.
      return m.makeBasis(X, Y, Z).setPosition(lid.x, -explode * 2, lid.z + explode * 0.5);
    }
  }
}

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];

function panelGeometry(panel: Panel, t: number, grooveDepth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(panel.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geom = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  if (!panel.grooves?.length) return geom;

  // Subtract each groove as a box pocket on the +w face.
  let result = new Brush(geom);
  result.updateMatrixWorld();
  const e = 0.05; // overshoot to avoid coplanar faces
  for (const [u0, v0, u1, v1] of panel.grooves) {
    const box = new THREE.BoxGeometry(u1 - u0 + 2 * e, v1 - v0, grooveDepth + e);
    const cutter = new Brush(box);
    cutter.position.set((u0 + u1) / 2, (v0 + v1) / 2, t - grooveDepth / 2 + e / 2);
    cutter.updateMatrixWorld();
    const next = evaluator.evaluate(result, cutter, SUBTRACTION);
    result.geometry.dispose();
    box.dispose();
    result = next;
  }
  return result.geometry;
}

/** Rasterizes artwork (already in panel screen space) onto a decal over the panel's +w face. */
function ArtDecal({ panel, art, t }: { panel: Panel; art: PlacedArt; t: number }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const { width: w, height: h } = panel;

  useEffect(() => {
    const px = 2048 / Math.max(w, h);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}">` +
      `<g transform="${art.transform}">${art.markup}</g></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    let tex: THREE.Texture | null = null;
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * px);
      canvas.height = Math.round(h * px);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Tint the (black) artwork to look like a burn mark.
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#4a2a14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      setTexture(tex);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    return () => {
      cancelled = true;
      tex?.dispose();
    };
  }, [art, w, h]);

  if (!texture) return null;
  return (
    <mesh position={[w / 2, h / 2, t + 0.02]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
}

function PanelMesh({
  panel,
  params,
  explode,
  children,
}: {
  panel: Panel;
  params: BoxParams;
  explode: number;
  children?: ReactNode;
}) {
  const grooveDepth = params.lid?.grooveDepth ?? 0;
  const geometry = useMemo(
    () => panelGeometry(panel, params.thickness, grooveDepth),
    [panel, params.thickness, grooveDepth],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const matrix = useMemo(() => placement(panel.id, params, explode), [panel.id, params, explode]);

  return (
    <mesh geometry={geometry} matrix={matrix} matrixAutoUpdate={false}>
      <meshStandardMaterial color={COLORS[panel.id]} roughness={0.8} />
      <Edges color="#5a3d1e" />
      {children}
    </mesh>
  );
}

export function Box3D({
  panels,
  params,
  explode,
  art,
}: {
  panels: Panel[];
  params: BoxParams;
  explode: number;
  art?: PlacedArt | null;
}) {
  const size = Math.max(params.width, params.depth, params.height);
  const d = size * 1.6;
  return (
    // Camera sits at the front-right so the lid's entry side is visible.
    <Canvas camera={{ position: [d * 0.9, d * 0.8, d * 1.1], fov: 40, near: 1, far: size * 50 }}>
      <color attach="background" args={['#f4f1ec']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[1, 2, 1.5]} intensity={1.6} />
      <directionalLight position={[-1.5, 0.5, -1]} intensity={0.5} />
      {/* box coords are z-up; three.js is y-up (box -y, the front, maps to three +z) */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <group position={[-params.width / 2, -params.depth / 2, -params.height / 2]}>
          {panels.map((p) => (
            <PanelMesh key={p.id} panel={p} params={params} explode={explode}>
              {art?.panelId === p.id && <ArtDecal panel={p} art={art} t={params.thickness} />}
            </PanelMesh>
          ))}
        </group>
      </group>
      <OrbitControls makeDefault />
    </Canvas>
  );
}

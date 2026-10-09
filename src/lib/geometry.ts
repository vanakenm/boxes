// Finger-joint geometry for an open (lidless) box. All units are mm.
//
// Box coordinates: x = width, y = depth, z = height. Outer dimensions are W x D x H.
// Ownership rules (each bit of the shell belongs to exactly one panel):
//  - Front/back own the vertical corner columns' bottom cube and the even
//    segments of the vertical joints; left/right own the odd ones.
//  - Along the bottom edges, walls own the even segments and the bottom panel
//    owns the odd ones (so the bottom has tabs going into slots in every wall).
// Finger counts are always odd, so every joint is symmetric and front/back
// (and left/right) panels are identical.
//
// Optional sliding lid: it slides in from the front (y = 0) along the depth,
// riding in grooves engraved on the inner faces of the left/right panels. The
// front panel is lowered to the bottom of the groove so the lid can pass over
// it, and the side panels take over the front corner columns above it.

export type Pt = [number, number];

export interface Interval {
  start: number;
  end: number;
  /** true = material reaches the outer edge, false = recessed by thickness */
  out: boolean;
}

export interface LidParams {
  /** Engraving depth of the grooves into the side panels */
  grooveDepth: number;
  /** Solid wall left above the groove */
  lip: number;
  /** Play added to the groove width and removed from the lid width */
  clearance: number;
}

export interface BoxParams {
  width: number;
  depth: number;
  height: number;
  thickness: number;
  fingerWidth: number;
  lid?: LidParams | null;
}

export type PanelId = 'bottom' | 'front' | 'back' | 'left' | 'right' | 'lid';

/** Axis-aligned rectangle in panel-local coords: [u0, v0, u1, v1] */
export type Rect = [number, number, number, number];

export interface Panel {
  id: PanelId;
  label: string;
  /** Local extent along u (outline x) */
  width: number;
  /** Local extent along v (outline y, pointing "up" for walls) */
  height: number;
  /** Counter-clockwise polygon in local coords, nominal size (no kerf). */
  outline: Pt[];
  /**
   * Areas to engrave (pocket) on the face that is up when cutting, which is
   * the panel's local +w face (the inside face for left/right).
   */
  grooves?: Rect[];
}

/** Derived lid geometry, in box coordinates. */
export interface LidLayout {
  /** z of the bottom / top of the groove */
  grooveBottom: number;
  grooveTop: number;
  /** Lid size: x extent and y extent */
  width: number;
  length: number;
  /** Lid position: x of its left edge, z of its underside */
  x: number;
  z: number;
}

export function lidLayout(p: BoxParams): LidLayout | null {
  if (!p.lid) return null;
  const { width: W, depth: D, height: H, thickness: t } = p;
  const { grooveDepth: g, lip, clearance: c } = p.lid;
  const grooveTop = H - lip;
  const grooveBottom = grooveTop - (t + c);
  return {
    grooveBottom,
    grooveTop,
    width: W - 2 * t + 2 * g - c,
    length: D - t,
    x: t - g + c / 2,
    z: grooveBottom + c / 2,
  };
}

/** Height of the front panel (lowered when there is a lid). */
export function frontHeight(p: BoxParams): number {
  return lidLayout(p)?.grooveBottom ?? p.height;
}

const EPS = 1e-9;

export function fingerCount(length: number, fingerWidth: number, thickness: number): number {
  if (length <= 0) return 1;
  let n = Math.floor(length / Math.max(fingerWidth, 0.1));
  if (n % 2 === 0) n -= 1;
  if (n < 3 && length / 3 >= thickness) n = 3;
  return Math.max(n, 1);
}

function merge(ivs: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const iv of ivs) {
    if (iv.end - iv.start < EPS) continue;
    const prev = out[out.length - 1];
    if (prev && prev.out === iv.out) prev.end = iv.end;
    else out.push({ ...iv });
  }
  return out;
}

/**
 * Edge profile over [0, total]. The finger joint spans [from, to] with n
 * segments; segment 0 is "out" when firstOut. Outside the joint the edge
 * state is given by `before` / `after`.
 */
function jointProfile(
  total: number,
  from: number,
  to: number,
  n: number,
  firstOut: boolean,
  before: boolean,
  after: boolean,
): Interval[] {
  const ivs: Interval[] = [{ start: 0, end: from, out: before }];
  const s = (to - from) / n;
  for (let i = 0; i < n; i++) {
    ivs.push({
      start: from + i * s,
      end: i === n - 1 ? to : from + (i + 1) * s,
      out: i % 2 === 0 ? firstOut : !firstOut,
    });
  }
  ivs.push({ start: to, end: total, out: after });
  return merge(ivs);
}

const straight = (length: number): Interval[] => [{ start: 0, end: length, out: true }];

interface Sides {
  bottom: Interval[];
  right: Interval[];
  top: Interval[];
  left: Interval[];
}

/** Traces a rectilinear outline (CCW, v up) for an A x B panel from its four edge profiles. */
function outline(A: number, B: number, t: number, s: Sides): Pt[] {
  const o = (iv: Interval) => (iv.out ? 0 : t);
  const first = (p: Interval[]) => p[0];
  const last = (p: Interval[]) => p[p.length - 1];
  const pts: Pt[] = [];

  pts.push([o(first(s.left)), o(first(s.bottom))]);
  for (let i = 0; i < s.bottom.length - 1; i++) {
    const x = s.bottom[i].end;
    pts.push([x, o(s.bottom[i])], [x, o(s.bottom[i + 1])]);
  }
  pts.push([A - o(first(s.right)), o(last(s.bottom))]);
  for (let i = 0; i < s.right.length - 1; i++) {
    const y = s.right[i].end;
    pts.push([A - o(s.right[i]), y], [A - o(s.right[i + 1]), y]);
  }
  pts.push([A - o(last(s.right)), B - o(last(s.top))]);
  for (let i = s.top.length - 1; i > 0; i--) {
    const x = s.top[i].start;
    pts.push([x, B - o(s.top[i])], [x, B - o(s.top[i - 1])]);
  }
  pts.push([o(last(s.left)), B - o(first(s.top))]);
  for (let i = s.left.length - 1; i > 0; i--) {
    const y = s.left[i].start;
    pts.push([o(s.left[i]), y], [o(s.left[i - 1]), y]);
  }
  return simplify(pts);
}

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/** Removes duplicate and collinear vertices of a rectilinear polygon. */
function simplify(input: Pt[]): Pt[] {
  let pts = input;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const next: Pt[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = next.length ? next[next.length - 1] : pts[(i - 1 + n) % n];
      const cur = pts[i];
      const after = pts[(i + 1) % n];
      const collinear =
        (Math.abs(prev[0] - cur[0]) < EPS && Math.abs(cur[0] - after[0]) < EPS) ||
        (Math.abs(prev[1] - cur[1]) < EPS && Math.abs(cur[1] - after[1]) < EPS);
      if (same(prev, cur) || collinear) {
        changed = true;
        continue;
      }
      next.push(cur);
    }
    pts = next;
  }
  return pts;
}

/** Mirrors a panel left-to-right (u -> A - u), keeping the outline CCW. */
function mirror(panel: Panel, id: PanelId, label: string): Panel {
  const A = panel.width;
  return {
    ...panel,
    id,
    label,
    outline: panel.outline.map(([u, v]): Pt => [A - u, v]).reverse(),
    grooves: panel.grooves?.map(([u0, v0, u1, v1]): Rect => [A - u1, v0, A - u0, v1]),
  };
}

export function buildPanels(p: BoxParams): Panel[] {
  const { width: W, depth: D, height: H, thickness: t, fingerWidth: f } = p;
  const lid = lidLayout(p);
  const Hf = frontHeight(p);
  const nx = fingerCount(W - 2 * t, f, t);
  const ny = fingerCount(D - 2 * t, f, t);
  const nz = fingerCount(H - t, f, t);
  const nzFront = fingerCount(Hf - t, f, t);

  const wallBottomX = jointProfile(W, t, W - t, nx, true, true, true);
  const sideBottomY = jointProfile(D, t, D - t, ny, true, false, false);
  const baseX = jointProfile(W, t, W - t, nx, false, false, false);
  const baseY = jointProfile(D, t, D - t, ny, false, false, false);

  // Vertical joints. Above a lowered front panel the sides own the corner.
  const frontVertical = jointProfile(Hf, t, Hf, nzFront, true, true, true);
  const backVertical = jointProfile(H, t, H, nz, true, true, true);
  const sideFrontVertical = jointProfile(H, t, Hf, nzFront, false, false, true);
  const sideBackVertical = jointProfile(H, t, H, nz, false, false, false);

  const front = outline(W, Hf, t, {
    bottom: wallBottomX,
    right: frontVertical,
    top: straight(W),
    left: frontVertical,
  });
  const back = outline(W, H, t, {
    bottom: wallBottomX,
    right: backVertical,
    top: straight(W),
    left: backVertical,
  });
  // Local u runs from the front (u = 0) to the back (u = D).
  const side = outline(D, H, t, {
    bottom: sideBottomY,
    right: sideBackVertical,
    top: straight(D),
    left: sideFrontVertical,
  });
  const bottom = outline(W, D, t, { bottom: baseX, right: baseY, top: baseX, left: baseY });

  const left: Panel = {
    id: 'left',
    label: 'Left',
    width: D,
    height: H,
    outline: side,
    // Groove runs from the open front edge to the inner face of the back.
    grooves: lid ? [[0, lid.grooveBottom, D - t, lid.grooveTop]] : undefined,
  };

  const panels: Panel[] = [
    { id: 'bottom', label: 'Bottom', width: W, height: D, outline: bottom },
    { id: 'front', label: 'Front', width: W, height: Hf, outline: front },
    { id: 'back', label: 'Back', width: W, height: H, outline: back },
    left,
    // The right panel is the left one flipped, so its groove ends up inside
    // while still being engraved on the face that is up on the laser bed.
    mirror(left, 'right', 'Right'),
  ];
  if (lid) {
    const { width: lw, length: ll } = lid;
    panels.push({
      id: 'lid',
      label: 'Lid',
      width: lw,
      height: ll,
      outline: [[0, 0], [lw, 0], [lw, ll], [0, ll]],
    });
  }
  return panels;
}

/**
 * Grows a CCW rectilinear polygon outward by k (kerf / 2), so that after the
 * laser burns away the kerf the part ends up at its nominal size.
 */
export function offsetRectilinear(pts: Pt[], k: number): Pt[] {
  if (!k) return pts;
  const n = pts.length;
  const normal = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dy / len, -dx / len];
  };
  return pts.map((p, i) => {
    const n1 = normal(pts[(i - 1 + n) % n], p);
    const n2 = normal(p, pts[(i + 1) % n]);
    return [p[0] + k * (n1[0] + n2[0]), p[1] + k * (n1[1] + n2[1])];
  });
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function validate(p: BoxParams, kerf: number): string[] {
  const errors: string[] = [];
  const vals = [p.width, p.depth, p.height, p.thickness, p.fingerWidth, kerf];
  if (vals.some((v) => !Number.isFinite(v))) return ['All values must be numbers.'];
  if (p.thickness <= 0) errors.push('Thickness must be greater than 0.');
  if (p.width < 4 * p.thickness) errors.push('Width must be at least 4× the thickness.');
  if (p.depth < 4 * p.thickness) errors.push('Depth must be at least 4× the thickness.');
  if (p.height < 3 * p.thickness) errors.push('Height must be at least 3× the thickness.');
  if (p.fingerWidth < p.thickness) errors.push('Finger width should be at least the thickness.');
  if (kerf < 0 || kerf >= p.thickness) errors.push('Kerf must be between 0 and the thickness.');
  if (p.lid) {
    const { grooveDepth, lip, clearance } = p.lid;
    if (![grooveDepth, lip, clearance].every(Number.isFinite)) return ['All values must be numbers.'];
    if (grooveDepth <= 0 || grooveDepth >= p.thickness)
      errors.push('Groove depth must be between 0 and the thickness.');
    if (lip <= 0) errors.push('Lip above the groove must be greater than 0.');
    if (clearance < 0 || clearance >= p.thickness) errors.push('Lid clearance must be between 0 and the thickness.');
    if (frontHeight(p) < 3 * p.thickness)
      errors.push('Box is too low for a sliding lid: the lowered front would be under 3× the thickness.');
  }
  return errors;
}

import { describe, expect, it } from 'vitest';
import { artExtent, artOutOfBounds, artTransform, fitWidth, type Artwork } from './artwork';
import { buildPanels } from './geometry';
import { layoutParts } from './layout';

const art: Artwork = { name: 't.svg', markup: '', bbox: { x: 10, y: 20, width: 200, height: 100 }, mmPerUnit: 1 };

/** Applies an SVG transform list made of translate/rotate/scale/matrix to a point. */
function apply(transform: string, [x, y]: [number, number]): [number, number] {
  const ops = [...transform.matchAll(/(\w+)\(([^)]*)\)/g)].map((m) => ({
    op: m[1],
    a: m[2].split(/[\s,]+/).filter(Boolean).map(Number),
  }));
  // Rightmost transform applies first.
  for (const { op, a } of ops.reverse()) {
    if (op === 'translate') [x, y] = [x + a[0], y + (a[1] ?? 0)];
    else if (op === 'scale') [x, y] = [x * a[0], y * (a[1] ?? a[0])];
    else if (op === 'rotate') {
      const r = (a[0] * Math.PI) / 180;
      [x, y] = [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
    } else if (op === 'matrix') [x, y] = [a[0] * x + a[2] * y + a[4], a[1] * x + a[3] * y + a[5]];
  }
  return [x, y];
}

describe('artwork placement', () => {
  it('centres the artwork on the panel and scales it to the requested width', () => {
    const p = { width: 50, offsetX: 0, offsetY: 0, rotation: 0 };
    const t = artTransform(art, p, 120, 80);
    expect(apply(t, [110, 70])).toEqual([60, 40]);
    const [x0] = apply(t, [10, 20]);
    const [x1] = apply(t, [210, 20]);
    expect(x1 - x0).toBeCloseTo(50);
  });

  it('positive offset Y moves the artwork towards the back (up on screen)', () => {
    const t = artTransform(art, { width: 50, offsetX: 5, offsetY: 10, rotation: 0 }, 120, 80);
    const [x, y] = apply(t, [110, 70]);
    expect(x).toBeCloseTo(65);
    expect(y).toBeCloseTo(30);
  });

  it('fits within the area for any rotation', () => {
    for (const rotation of [0, 30, 90, 135]) {
      const width = fitWidth(art, rotation, 100, 60);
      const { w, h } = artExtent(art, { width, offsetX: 0, offsetY: 0, rotation });
      expect(w).toBeLessThanOrEqual(100 + 1e-9);
      expect(h).toBeLessThanOrEqual(60 + 1e-9);
      expect(Math.max(w - 100, h - 60)).toBeCloseTo(0);
    }
  });

  it('detects artwork leaving the visible area', () => {
    expect(artOutOfBounds(art, { width: 50, offsetX: 0, offsetY: 0, rotation: 0 }, 100, 60)).toBe(false);
    expect(artOutOfBounds(art, { width: 50, offsetX: 30, offsetY: 0, rotation: 0 }, 100, 60)).toBe(true);
    expect(artOutOfBounds(art, { width: 50, offsetX: 0, offsetY: 0, rotation: 90 }, 100, 40)).toBe(true);
  });
});

describe('screenToSheet', () => {
  const params = {
    width: 150,
    depth: 100,
    height: 80,
    thickness: 3,
    fingerWidth: 10,
    lid: { grooveDepth: 1.3, lip: 3, clearance: 0.2 },
  };

  it.each([
    [420, 297],
    [140, 420], // narrow sheet forces the lid to be rotated
  ])('maps the lid screen rectangle onto its cut outline (sheet %d x %d)', (w, h) => {
    const kerf = 0.2;
    const layout = layoutParts(buildPanels(params), { width: w, height: h, margin: 5, gap: 3 }, kerf);
    const lid = layout.sheets.flatMap((s) => s.parts).find((p) => p.panel.id === 'lid')!;
    const { width: lw, height: ll } = lid.panel;
    const corners = [[0, 0], [lw, 0], [lw, ll], [0, ll]].map((c) => apply(lid.screenToSheet, c as [number, number]));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const k = kerf / 2;
    expect(Math.min(...xs)).toBeCloseTo(lid.x + k);
    expect(Math.max(...xs)).toBeCloseTo(lid.x + lid.w - k);
    expect(Math.min(...ys)).toBeCloseTo(lid.y + k);
    expect(Math.max(...ys)).toBeCloseTo(lid.y + lid.h - k);
    if (w === 140) expect(lid.rotated).toBe(true);
  });
});

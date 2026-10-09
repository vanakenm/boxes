import { describe, expect, it } from 'vitest';
import { buildPanels, frontHeight, lidLayout, offsetRectilinear, polygonArea, validate } from './geometry';
import { layoutParts } from './layout';

const cases = [
  { width: 150, depth: 100, height: 80, thickness: 3, fingerWidth: 10 },
  { width: 60, depth: 40, height: 20, thickness: 3, fingerWidth: 8 },
  { width: 300, depth: 200, height: 120, thickness: 6, fingerWidth: 15 },
  { width: 50, depth: 50, height: 50, thickness: 4, fingerWidth: 100 },
];

describe('buildPanels', () => {
  it.each(cases)('panels exactly fill the shell volume (%o)', (p) => {
    const t = p.thickness;
    const panels = buildPanels(p);
    const material = panels.reduce((s, pn) => s + polygonArea(pn.outline), 0) * t;
    const shell = p.width * p.depth * p.height - (p.width - 2 * t) * (p.depth - 2 * t) * (p.height - t);
    expect(material).toBeCloseTo(shell, 6);
  });

  it('outlines are counter-clockwise and within bounds', () => {
    for (const pn of buildPanels(cases[0])) {
      expect(polygonArea(pn.outline)).toBeGreaterThan(0);
      for (const [x, y] of pn.outline) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(pn.width);
        expect(y).toBeLessThanOrEqual(pn.height);
      }
    }
  });

  it.each(cases)('with a sliding lid, walls fill the shell minus the lowered front strip (%o)', (base) => {
    const p = { ...base, height: Math.max(base.height, 40), lid: { grooveDepth: 1.3, lip: 3, clearance: 0.2 } };
    const t = p.thickness;
    const lid = lidLayout(p)!;
    const Hf = frontHeight(p);
    expect(Hf).toBeCloseTo(p.height - 3 - t - 0.2);

    const panels = buildPanels(p);
    const walls = panels.filter((pn) => pn.id !== 'lid');
    const material = walls.reduce((s, pn) => s + polygonArea(pn.outline), 0) * t;
    const shell =
      p.width * p.depth * p.height -
      (p.width - 2 * t) * (p.depth - 2 * t) * (p.height - t) -
      (p.width - 2 * t) * t * (p.height - Hf); // open strip above the front, between the sides
    expect(material).toBeCloseTo(shell, 6);

    // Lid reaches into both grooves, leaving the clearance as total side play.
    const lidPanel = panels.find((pn) => pn.id === 'lid')!;
    expect(lidPanel.width).toBeCloseTo(p.width - 2 * t + 2 * 1.3 - 0.2);
    expect(lid.grooveTop - lid.grooveBottom).toBeCloseTo(t + 0.2);

    // Right is the mirror of left, grooves included.
    const left = panels.find((pn) => pn.id === 'left')!;
    const right = panels.find((pn) => pn.id === 'right')!;
    expect(left.grooves).toEqual([[0, lid.grooveBottom, p.depth - t, lid.grooveTop]]);
    expect(right.grooves![0][0]).toBeCloseTo(t);
    expect(right.grooves![0][2]).toBeCloseTo(p.depth);
    expect(polygonArea(right.outline)).toBeCloseTo(polygonArea(left.outline));
  });

  it('rejects a box too low for the lid', () => {
    const p = { ...cases[0], height: 15, lid: { grooveDepth: 1.3, lip: 3, clearance: 0.2 } };
    expect(validate(p, 0).some((e) => e.includes('too low'))).toBe(true);
  });

  it('kerf offset grows each edge by k', () => {
    const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(polygonArea(offsetRectilinear(square, 0.5))).toBeCloseTo(121);
  });
});

describe('layoutParts', () => {
  it('fits a default box on one A3 sheet', () => {
    const r = layoutParts(buildPanels(cases[0]), { width: 420, height: 297, margin: 5, gap: 3 }, 0.1);
    expect(r.errors).toEqual([]);
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].parts).toHaveLength(5);
  });

  it('spills onto extra sheets and reports oversize parts', () => {
    const r = layoutParts(buildPanels(cases[2]), { width: 420, height: 297, margin: 5, gap: 3 }, 0);
    expect(r.sheets.length).toBeGreaterThan(1);
    const big = layoutParts(buildPanels({ ...cases[0], width: 500 }), { width: 420, height: 297, margin: 5, gap: 3 }, 0);
    expect(big.errors.length).toBeGreaterThan(0);
  });
});

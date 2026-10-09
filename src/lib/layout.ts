import { offsetRectilinear, type Panel, type Pt } from './geometry';

export interface SheetSpec {
  width: number;
  height: number;
  margin: number;
  gap: number;
}

export interface PlacedPart {
  panel: Panel;
  /** Outline in sheet coordinates (SVG: y down), kerf applied */
  points: Pt[];
  /** Engrave areas in sheet coordinates (no kerf offset) */
  grooves: { x: number; y: number; w: number; h: number }[];
  /**
   * SVG transform from the panel's screen space (nominal panel, origin
   * top-left, y down, mm) to sheet coordinates. Used to place artwork.
   */
  screenToSheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface Sheet {
  parts: PlacedPart[];
}

export interface LayoutResult {
  sheets: Sheet[];
  errors: string[];
}

/** Maps panel-local coords (v up) into sheet space at (x, y), optionally rotated 90°. */
function mapper(panel: Panel, k: number, rotated: boolean, x: number, y: number) {
  const A = panel.width + 2 * k;
  const B = panel.height + 2 * k;
  return ([u, v]: Pt): Pt => {
    const px = u + k;
    const py = B - (v + k); // flip so walls are drawn top-up
    return rotated ? [x + py, y + A - px] : [x + px, y + py];
  };
}

function place(panel: Panel, k: number, rotated: boolean, x: number, y: number) {
  const map = mapper(panel, k, rotated, x, y);
  const A = panel.width + 2 * k;
  return {
    screenToSheet: rotated
      ? `matrix(0 -1 1 0 ${x + k} ${y + A - k})`
      : `matrix(1 0 0 1 ${x + k} ${y + k})`,
    points: offsetRectilinear(panel.outline, k).map(map),
    grooves: (panel.grooves ?? []).map(([u0, v0, u1, v1]) => {
      const [ax, ay] = map([u0, v0]);
      const [bx, by] = map([u1, v1]);
      return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    }),
  };
}

/** Simple shelf packing across as many sheets as needed. */
export function layoutParts(panels: Panel[], sheet: SheetSpec, kerf: number): LayoutResult {
  const k = kerf / 2;
  const maxW = sheet.width - 2 * sheet.margin;
  const maxH = sheet.height - 2 * sheet.margin;
  const errors: string[] = [];

  const items = panels
    .map((panel) => {
      const w = panel.width + 2 * k;
      const h = panel.height + 2 * k;
      return { panel, w, h };
    })
    .sort((a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h));

  const sheets: Sheet[] = [];
  let cur: Sheet | null = null;
  let x = 0;
  let y = 0;
  let shelfH = 0;

  const newSheet = () => {
    cur = { parts: [] };
    sheets.push(cur);
    x = 0;
    y = 0;
    shelfH = 0;
  };

  for (const item of items) {
    // Prefer lying flat (long side horizontal), fall back to the other orientation.
    const landscape = item.w >= item.h;
    const orientations = [
      { w: item.w, h: item.h, rotated: false },
      { w: item.h, h: item.w, rotated: true },
    ].sort((a, b) => (landscape ? 0 : a.rotated === b.rotated ? 0 : a.rotated ? -1 : 1));
    const fitting = orientations.filter((o) => o.w <= maxW + 1e-9 && o.h <= maxH + 1e-9);
    if (!fitting.length) {
      errors.push(
        `${item.panel.label} (${fmt(item.panel.width)} × ${fmt(item.panel.height)} mm) does not fit on the sheet.`,
      );
      continue;
    }
    if (!cur) newSheet();

    let placed = false;
    for (let attempt = 0; attempt < 3 && !placed; attempt++) {
      for (const o of fitting) {
        if (x + o.w <= maxW + 1e-9 && y + o.h <= maxH + 1e-9) {
          const px = sheet.margin + x;
          const py = sheet.margin + y;
          cur!.parts.push({
            panel: item.panel,
            ...place(item.panel, k, o.rotated, px, py),
            x: px,
            y: py,
            w: o.w,
            h: o.h,
            rotated: o.rotated,
          });
          x += o.w + sheet.gap;
          shelfH = Math.max(shelfH, o.h);
          placed = true;
          break;
        }
      }
      if (placed) break;
      if (attempt === 0 && x > 0) {
        // start a new shelf
        y += shelfH + sheet.gap;
        x = 0;
        shelfH = 0;
      } else {
        newSheet();
      }
    }
  }

  return { sheets, errors };
}

export function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

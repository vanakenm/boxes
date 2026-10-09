import type { Pt } from './geometry';
import { fmt, type Sheet, type SheetSpec } from './layout';

export const CUT_COLOR = '#ff0000';
export const CUT_STROKE = 0.1;
export const ENGRAVE_COLOR = '#0000ff';

/** Artwork already resolved for a panel: markup in its own units + transform into panel screen space. */
export interface PlacedArt {
  panelId: string;
  markup: string;
  transform: string;
}

export function pathData(points: Pt[]): string {
  return 'M' + points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' L') + ' Z';
}

/**
 * Standalone SVG for one sheet. width/height are in mm so laser software imports at true scale.
 * Cut paths are red strokes; groove pockets (if any) are blue fills to engrave to `engraveDepth`;
 * artwork (if any) is black, to be scored/engraved lightly.
 */
export function sheetToSvg(sheet: Sheet, spec: SheetSpec, engraveDepth?: number, art?: PlacedArt | null): string {
  const artPart = art && sheet.parts.find((p) => p.panel.id === art.panelId);
  const drawing = artPart
    ? `  <!-- Drawing (black): score or engrave at low power, do not cut -->
  <g id="drawing" transform="${artPart.screenToSheet}">
    <g transform="${art!.transform}">${art!.markup}</g>
  </g>
`
    : '';
  const paths = sheet.parts
    .map((p) => `    <path id="${p.panel.id}" d="${pathData(p.points)}"/>`)
    .join('\n');
  const grooves = sheet.parts.flatMap((p) =>
    p.grooves.map(
      (g, i) =>
        `    <rect id="${p.panel.id}-groove-${i + 1}" x="${fmt(g.x)}" y="${fmt(g.y)}" width="${fmt(g.w)}" height="${fmt(g.h)}"/>`,
    ),
  );
  const engrave = grooves.length
    ? `  <!-- Engrave (fill) ${engraveDepth != null ? fmt(engraveDepth) + ' mm deep' : ''} - run before cutting -->
  <g id="engrave" fill="${ENGRAVE_COLOR}" stroke="none">
${grooves.join('\n')}
  </g>
`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(spec.width)}mm" height="${fmt(spec.height)}mm" viewBox="0 0 ${fmt(spec.width)} ${fmt(spec.height)}">
${drawing}${engrave}  <g id="cut" fill="none" stroke="${CUT_COLOR}" stroke-width="${CUT_STROKE}">
${paths}
  </g>
</svg>
`;
}

export function downloadSvg(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

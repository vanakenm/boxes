// User-supplied SVG artwork, engraved/scored on a panel (the lid).
//
// "Panel screen space" is a panel's nominal rectangle seen from above on the
// laser bed: origin top-left, x right, y down, in mm. Artwork is placed in that
// space, and layout.ts supplies the transform from it to sheet coordinates.

export const ART_COLOR = '#000000';

export interface Artwork {
  name: string;
  /** Sanitized, recolored SVG children, in the artwork's own user units */
  markup: string;
  /** Content bounding box in the artwork's user units */
  bbox: { x: number; y: number; width: number; height: number };
  /** Physical size of one user unit in mm, from the file's width/viewBox (96 dpi for px) */
  mmPerUnit: number;
}

export interface ArtPlacement {
  /** Width of the artwork in mm (height follows the aspect ratio) */
  width: number;
  /** Offset of the artwork centre from the panel centre, in mm (y positive = up / towards the back) */
  offsetX: number;
  offsetY: number;
  /** Clockwise rotation in degrees */
  rotation: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath']);
const FORBIDDEN = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set']);
const DROP_ATTRS = ['style', 'class', 'opacity', 'fill-opacity', 'stroke-opacity', 'filter', 'color'];

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

function lengthToMm(value: string | null): number | null {
  const m = value?.trim().match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px|)$/);
  return m ? parseFloat(m[1]) * UNIT_MM[m[2]] : null;
}

function sanitize(el: Element) {
  for (const child of Array.from(el.children)) {
    if (FORBIDDEN.has(child.localName)) child.remove();
    else sanitize(child);
  }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value.trim().toLowerCase();
    if (name.startsWith('on')) el.removeAttribute(attr.name);
    else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#') && !value.startsWith('data:image/'))
      el.removeAttribute(attr.name);
  }
}

/**
 * Parses an SVG file, strips anything active, and flattens all styling to a
 * single laser layer colour (fills stay fills, strokes stay strokes).
 * Needs a live DOM: computed styles and getBBox only work on rendered nodes.
 */
export async function loadArtwork(file: File): Promise<Artwork> {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const parsed = doc.documentElement;
  if (doc.querySelector('parsererror') || parsed.localName !== 'svg') throw new Error('Not a valid SVG file.');
  sanitize(parsed);

  const root = document.importNode(parsed, true) as unknown as SVGSVGElement;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;height:1000px;opacity:0;pointer-events:none';
  host.appendChild(root);
  document.body.appendChild(host);

  try {
    // Physical scale, from width + viewBox when available.
    const vb = root.viewBox.baseVal;
    const widthMm = lengthToMm(root.getAttribute('width'));
    const mmPerUnit = widthMm && vb && vb.width ? widthMm / vb.width : 25.4 / 96;

    for (const el of Array.from(root.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') {
        el.remove();
        continue;
      }
      if (SHAPES.has(el.localName)) {
        const strokeWidth = parseFloat(cs.strokeWidth) || 0;
        const hasFill = cs.fill !== 'none' && parseFloat(cs.fillOpacity) !== 0;
        const hasStroke = cs.stroke !== 'none' && strokeWidth > 0 && parseFloat(cs.strokeOpacity) !== 0;
        el.setAttribute('fill', hasFill ? ART_COLOR : 'none');
        el.setAttribute('stroke', hasStroke ? ART_COLOR : 'none');
        if (hasStroke) el.setAttribute('stroke-width', String(strokeWidth));
        if (el.localName === 'text' || el.localName === 'tspan') {
          el.setAttribute('font-family', cs.fontFamily);
          el.setAttribute('font-size', cs.fontSize);
          el.setAttribute('font-weight', cs.fontWeight);
          el.setAttribute('font-style', cs.fontStyle);
        }
      }
    }
    root.querySelectorAll('style, title, desc, metadata').forEach((el) => el.remove());

    const g = document.createElementNS(SVG_NS, 'g');
    while (root.firstChild) g.appendChild(root.firstChild);
    root.appendChild(g);
    const box = g.getBBox();
    if (!box.width || !box.height) throw new Error('The SVG has no visible content.');

    for (const el of Array.from(g.querySelectorAll('*'))) DROP_ATTRS.forEach((a) => el.removeAttribute(a));
    const serializer = new XMLSerializer();
    const markup = Array.from(g.childNodes)
      .map((n) => serializer.serializeToString(n))
      .join('');

    return {
      name: file.name,
      markup,
      bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      mmPerUnit,
    };
  } finally {
    host.remove();
  }
}

export function artHeight(art: Artwork, width: number): number {
  return (width * art.bbox.height) / art.bbox.width;
}

/** Size of the axis-aligned box around the placed (rotated) artwork, in mm. */
export function artExtent(art: Artwork, p: ArtPlacement): { w: number; h: number } {
  const r = (p.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const h = artHeight(art, p.width);
  return { w: p.width * c + h * s, h: p.width * s + h * c };
}

/** Largest width so the rotated artwork fits in an areaW x areaH box. */
export function fitWidth(art: Artwork, rotation: number, areaW: number, areaH: number): number {
  const r = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const ar = art.bbox.height / art.bbox.width;
  return Math.max(0, Math.min(areaW / (c + ar * s), areaH / (s + ar * c)));
}

/** SVG transform from artwork user units into a panel's screen space (panelW x panelH mm). */
export function artTransform(art: Artwork, p: ArtPlacement, panelW: number, panelH: number): string {
  const sc = p.width / art.bbox.width;
  const cx = panelW / 2 + p.offsetX;
  const cy = panelH / 2 - p.offsetY;
  const bx = art.bbox.x + art.bbox.width / 2;
  const by = art.bbox.y + art.bbox.height / 2;
  return `translate(${cx} ${cy}) rotate(${p.rotation}) scale(${sc}) translate(${-bx} ${-by})`;
}

/** True when the placed artwork leaves the centred visibleW x visibleH area. */
export function artOutOfBounds(art: Artwork, p: ArtPlacement, visibleW: number, visibleH: number): boolean {
  const { w, h } = artExtent(art, p);
  const eps = 1e-6;
  return Math.abs(p.offsetX) + w / 2 > visibleW / 2 + eps || Math.abs(p.offsetY) + h / 2 > visibleH / 2 + eps;
}

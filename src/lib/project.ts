// Project files: every setting needed to recreate a design, as JSON.

import type { ArtPlacement } from './artwork';
import type { BoxParams, LidParams } from './geometry';

export const PROJECT_APP = 'laser-boxes';
export const PROJECT_VERSION = 1;

export const SHEET_PRESETS: Record<string, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  '600 × 400': [600, 400],
  '300 × 300': [300, 300],
};

export interface ProjectState {
  box: Omit<BoxParams, 'lid'>;
  kerf: number;
  lid: LidParams & { enabled: boolean };
  sheet: { preset: string; portrait: boolean; custom: [number, number]; margin: number; gap: number };
  /** Lid drawing: sanitized markup as produced by loadArtwork, plus its placement */
  artwork: { name: string; markup: string; mmPerUnit: number; placement: ArtPlacement } | null;
}

export const DEFAULT_PROJECT: ProjectState = {
  box: { width: 150, depth: 100, height: 80, thickness: 3, fingerWidth: 10 },
  kerf: 0,
  lid: { enabled: false, grooveDepth: 1.3, lip: 3, clearance: 0.2 },
  sheet: { preset: 'A3', portrait: false, custom: [420, 297], margin: 5, gap: 3 },
  artwork: null,
};

export function serializeProject(state: ProjectState): string {
  return JSON.stringify({ app: PROJECT_APP, version: PROJECT_VERSION, ...state }, null, 2);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

/** Reads every key of `defaults` from `src`, keeping the default when missing or of the wrong type. */
function numbers<T extends Record<string, number>>(src: unknown, defaults: T): T {
  const o = isObj(src) ? src : {};
  return Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, num(o[k], d)])) as T;
}

/**
 * Parses a project file. Throws on anything that is not a project; missing
 * or malformed individual settings fall back to their defaults.
 */
export function parseProject(text: string): ProjectState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a valid JSON file.');
  }
  if (!isObj(data) || data.app !== PROJECT_APP) throw new Error('Not a box project file.');
  if (typeof data.version !== 'number' || data.version > PROJECT_VERSION)
    throw new Error('This project was saved by a newer version of the app.');

  const d = DEFAULT_PROJECT;
  const lid = isObj(data.lid) ? data.lid : {};
  const sheet = isObj(data.sheet) ? data.sheet : {};
  const custom = Array.isArray(sheet.custom) ? sheet.custom : [];
  const preset = str(sheet.preset, d.sheet.preset);

  let artwork: ProjectState['artwork'] = null;
  if (isObj(data.artwork) && typeof data.artwork.markup === 'string' && data.artwork.markup.trim()) {
    const a = data.artwork;
    artwork = {
      name: str(a.name, 'drawing.svg'),
      markup: a.markup as string,
      mmPerUnit: num(a.mmPerUnit, 25.4 / 96),
      placement: numbers(a.placement, { width: 50, offsetX: 0, offsetY: 0, rotation: 0 }),
    };
  }

  return {
    box: numbers(data.box, d.box),
    kerf: num(data.kerf, d.kerf),
    lid: {
      ...numbers(lid, { grooveDepth: d.lid.grooveDepth, lip: d.lid.lip, clearance: d.lid.clearance }),
      enabled: bool(lid.enabled, d.lid.enabled),
    },
    sheet: {
      preset: preset in SHEET_PRESETS || preset === 'Custom' ? preset : d.sheet.preset,
      portrait: bool(sheet.portrait, d.sheet.portrait),
      custom: [num(custom[0], d.sheet.custom[0]), num(custom[1], d.sheet.custom[1])],
      margin: num(sheet.margin, d.sheet.margin),
      gap: num(sheet.gap, d.sheet.gap),
    },
    artwork,
  };
}

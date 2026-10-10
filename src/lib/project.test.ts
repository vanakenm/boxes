import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT, parseProject, serializeProject, type ProjectState } from './project';

const full: ProjectState = {
  box: { width: 200, depth: 120, height: 60, thickness: 4, fingerWidth: 12 },
  kerf: 0.15,
  lid: { enabled: true, grooveDepth: 1.5, lip: 4, clearance: 0.3 },
  sheet: { preset: 'Custom', portrait: true, custom: [500, 300], margin: 6, gap: 2 },
  artwork: {
    name: 'logo.svg',
    markup: '<circle xmlns="http://www.w3.org/2000/svg" cx="5" cy="5" r="5" fill="#000000" stroke="none"/>',
    mmPerUnit: 1,
    placement: { width: 40, offsetX: 3, offsetY: -2, rotation: 90 },
  },
};

describe('project files', () => {
  it('round-trips every setting, including the lid drawing', () => {
    const text = serializeProject(full);
    expect(JSON.parse(text)).toMatchObject({ app: 'laser-boxes', version: 1 });
    expect(parseProject(text)).toEqual(full);
  });

  it('round-trips the defaults (no artwork)', () => {
    expect(parseProject(serializeProject(DEFAULT_PROJECT))).toEqual(DEFAULT_PROJECT);
  });

  it('fills missing or malformed settings with defaults', () => {
    const p = parseProject(
      JSON.stringify({
        app: 'laser-boxes',
        version: 1,
        box: { width: 90, height: 'tall' },
        lid: { enabled: 'yes', lip: 5 },
        sheet: { preset: 'Letter', custom: [100] },
        artwork: { name: 'x.svg', markup: '' },
      }),
    );
    expect(p.box).toEqual({ ...DEFAULT_PROJECT.box, width: 90 });
    expect(p.lid).toEqual({ ...DEFAULT_PROJECT.lid, lip: 5 });
    expect(p.sheet.preset).toBe('A3');
    expect(p.sheet.custom).toEqual([100, DEFAULT_PROJECT.sheet.custom[1]]);
    expect(p.artwork).toBeNull();
  });

  it('rejects files that are not projects', () => {
    expect(() => parseProject('not json')).toThrow(/JSON/);
    expect(() => parseProject('{"hello":1}')).toThrow(/project/);
    expect(() => parseProject('[1,2]')).toThrow(/project/);
    expect(() => parseProject('{"app":"laser-boxes","version":99}')).toThrow(/newer/);
  });
});

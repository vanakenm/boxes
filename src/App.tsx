import { useEffect, useMemo, useState } from 'react';
import { Box3D } from './components/Box3D';
import { SheetPreview } from './components/SheetPreview';
import { buildPanels, fingerCount, frontHeight, lidLayout, validate, type BoxParams, type LidParams } from './lib/geometry';
import { fmt, layoutParts, type SheetSpec } from './lib/layout';
import { downloadSvg, sheetToSvg, type PlacedArt } from './lib/svg';
import {
  artHeight,
  artOutOfBounds,
  artTransform,
  fitWidth,
  loadArtwork,
  type ArtPlacement,
  type Artwork,
} from './lib/artwork';

/** Margin kept around the artwork when fitting it to the lid. */
const ART_FIT_MARGIN = 3;

const SHEET_PRESETS: Record<string, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  '600 × 400': [600, 400],
  '300 × 300': [300, 300],
};

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  hint,
  unit = 'mm',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  hint?: string;
  unit?: string;
}) {
  // Keep the raw text so the field can be temporarily empty while typing.
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <input
          type="number"
          value={text}
          step={step}
          min={min}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
        />
        <em>{unit}</em>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function App() {
  const [box, setBox] = useState<Omit<BoxParams, 'lid'>>({
    width: 150,
    depth: 100,
    height: 80,
    thickness: 3,
    fingerWidth: 10,
  });
  const [lidEnabled, setLidEnabled] = useState(false);
  const [lidParams, setLidParams] = useState<LidParams>({ grooveDepth: 1.3, lip: 3, clearance: 0.2 });
  const [kerf, setKerf] = useState(0);
  const [preset, setPreset] = useState('A3');
  const [portrait, setPortrait] = useState(false);
  const [custom, setCustom] = useState<[number, number]>([420, 297]);
  const [margin, setMargin] = useState(5);
  const [gap, setGap] = useState(3);
  const [explode, setExplode] = useState(0);
  const [art, setArt] = useState<Artwork | null>(null);
  const [artError, setArtError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<ArtPlacement>({ width: 50, offsetX: 0, offsetY: 0, rotation: 0 });

  const params: BoxParams = useMemo(
    () => ({ ...box, lid: lidEnabled ? lidParams : null }),
    [box, lidEnabled, lidParams],
  );
  const set = (key: keyof typeof box) => (v: number) => setBox((p) => ({ ...p, [key]: v }));
  const setLid = (key: keyof LidParams) => (v: number) => setLidParams((p) => ({ ...p, [key]: v }));

  const spec: SheetSpec = useMemo(() => {
    let [w, h] = preset === 'Custom' ? custom : SHEET_PRESETS[preset];
    if (portrait !== h > w) [w, h] = [h, w];
    return { width: w, height: h, margin, gap };
  }, [preset, custom, portrait, margin, gap]);

  const errors = validate(params, kerf);
  const valid = errors.length === 0;
  const panels = useMemo(() => (valid ? buildPanels(params) : []), [valid, params]);
  const layout = useMemo(() => layoutParts(panels, spec, kerf), [panels, spec, kerf]);

  const t = params.thickness;
  const fingers = valid
    ? {
        x: fingerCount(params.width - 2 * t, params.fingerWidth, t),
        y: fingerCount(params.depth - 2 * t, params.fingerWidth, t),
        z: fingerCount(params.height - t, params.fingerWidth, t),
      }
    : null;
  const lid = valid ? lidLayout(params) : null;
  // Visible part of the lid: the strip between the grooves, full length.
  const lidVisible = lid ? { w: params.width - 2 * t, h: lid.length } : null;
  const placedArt: PlacedArt | null = useMemo(
    () =>
      art && lid ? { panelId: 'lid', markup: art.markup, transform: artTransform(art, placement, lid.width, lid.length) } : null,
    [art, lid?.width, lid?.length, placement], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const artOut = !!(art && lidVisible && artOutOfBounds(art, placement, lidVisible.w, lidVisible.h));
  const setPlace = (key: keyof ArtPlacement) => (v: number) => setPlacement((p) => ({ ...p, [key]: v }));
  const fitArt = (a: Artwork, rotation: number) =>
    lidVisible
      ? fitWidth(a, rotation, lidVisible.w - 2 * ART_FIT_MARGIN, lidVisible.h - 2 * ART_FIT_MARGIN)
      : placement.width;

  const onArtFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const a = await loadArtwork(file);
      // Keep the file's own physical size when it fits, otherwise fit it to the lid.
      const natural = a.bbox.width * a.mmPerUnit;
      const fit = fitArt(a, 0);
      setArt(a);
      setArtError(null);
      setPlacement({ width: Number(Math.min(natural, fit).toFixed(1)), offsetX: 0, offsetY: 0, rotation: 0 });
    } catch (e) {
      setArtError(e instanceof Error ? e.message : 'Could not read the SVG.');
    }
  };

  const svgFor = (i: number) => sheetToSvg(layout.sheets[i], spec, params.lid?.grooveDepth, placedArt);

  const filename = (i: number) =>
    `box-${fmt(params.width)}x${fmt(params.depth)}x${fmt(params.height)}-t${fmt(t)}` +
    (params.lid ? '-lid' : '') +
    (layout.sheets.length > 1 ? `-sheet${i + 1}` : '') +
    '.svg';

  const downloadAll = () =>
    layout.sheets.forEach((_, i) => setTimeout(() => downloadSvg(svgFor(i), filename(i)), i * 300));

  return (
    <div className="app">
      <aside className="panel">
        <h1>Finger-joint box</h1>
        <p className="lede">Outside dimensions, in millimetres.</p>

        <fieldset>
          <legend>Box</legend>
          <NumField label="Width (X)" value={params.width} onChange={set('width')} />
          <NumField label="Depth (Y)" value={params.depth} onChange={set('depth')} />
          <NumField label="Height (Z)" value={params.height} onChange={set('height')} />
          <NumField label="Plywood thickness" value={params.thickness} onChange={set('thickness')} step={0.1} />
          <NumField
            label="Target finger width"
            value={params.fingerWidth}
            onChange={set('fingerWidth')}
            hint="Adjusted per edge to get an odd number of equal fingers."
          />
          <NumField
            label="Kerf"
            value={kerf}
            onChange={setKerf}
            step={0.05}
            hint="Laser cut width. Parts are grown by kerf/2 for a snug fit (typ. 0.1–0.2)."
          />
        </fieldset>

        <fieldset>
          <legend>Lid</legend>
          <label className="check">
            <input type="checkbox" checked={lidEnabled} onChange={(e) => setLidEnabled(e.target.checked)} />
            Sliding lid
          </label>
          {lidEnabled && (
            <>
              <p className="note">
                Slides in from the front along the depth, in grooves engraved inside the left and right panels.
                The front panel is lowered so the lid can pass.
              </p>
              <NumField
                label="Groove depth"
                value={lidParams.grooveDepth}
                onChange={setLid('grooveDepth')}
                step={0.1}
                hint="Engraved, not cut: tune power/passes to reach this depth."
              />
              <NumField
                label="Lip above groove"
                value={lidParams.lip}
                onChange={setLid('lip')}
                step={0.5}
                hint="Solid wall left between the top edge and the groove."
              />
              <NumField
                label="Clearance"
                value={lidParams.clearance}
                onChange={setLid('clearance')}
                step={0.05}
                hint="Extra groove width, and side play removed from the lid."
              />
            </>
          )}
        </fieldset>

        {lidEnabled && (
          <fieldset>
            <legend>Lid drawing</legend>
            <label className="field">
              <span>SVG artwork</span>
              <input
                type="file"
                accept=".svg,image/svg+xml"
                onChange={(e) => {
                  onArtFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <small>Scored/engraved in black, never cut. Convert text to paths for best results.</small>
            </label>
            {artError && <p className="error">{artError}</p>}
            {art && (
              <>
                <div className="art-file">
                  <span title={art.name}>{art.name}</span>
                  <button onClick={() => setArt(null)}>Remove</button>
                </div>
                <div className="row">
                  <NumField label="Width" value={placement.width} onChange={setPlace('width')} step={1} />
                  <label className="field">
                    <span>Height</span>
                    <output>{fmt(Number(artHeight(art, placement.width).toFixed(2)))} mm</output>
                  </label>
                </div>
                <div className="row">
                  <NumField
                    label="Offset X"
                    value={placement.offsetX}
                    onChange={setPlace('offsetX')}
                    min={-1000}
                    hint="+ right"
                  />
                  <NumField
                    label="Offset Y"
                    value={placement.offsetY}
                    onChange={setPlace('offsetY')}
                    min={-1000}
                    hint="+ towards the back"
                  />
                </div>
                <NumField
                  label="Rotation"
                  value={placement.rotation}
                  onChange={setPlace('rotation')}
                  step={90}
                  min={-360}
                  unit="°"
                />
                <div className="buttons">
                  <button
                    onClick={() =>
                      setPlacement((p) => ({ ...p, width: Number(fitArt(art, p.rotation).toFixed(1)), offsetX: 0, offsetY: 0 }))
                    }
                  >
                    Fit to lid
                  </button>
                  <button onClick={() => setPlacement((p) => ({ ...p, offsetX: 0, offsetY: 0 }))}>Center</button>
                  <button onClick={() => setPlacement((p) => ({ ...p, rotation: (p.rotation + 90) % 360 }))}>
                    Rotate 90°
                  </button>
                </div>
                {artOut && <p className="warning">The drawing goes past the visible part of the lid.</p>}
              </>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend>Sheet</legend>
          <label className="field">
            <span>Size</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.entries(SHEET_PRESETS).map(([k, [w, h]]) => (
                <option key={k} value={k}>
                  {k} ({w} × {h})
                </option>
              ))}
              <option value="Custom">Custom…</option>
            </select>
          </label>
          {preset === 'Custom' && (
            <div className="row">
              <NumField label="Sheet W" value={custom[0]} onChange={(v) => setCustom([v, custom[1]])} />
              <NumField label="Sheet H" value={custom[1]} onChange={(v) => setCustom([custom[0], v])} />
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={portrait} onChange={(e) => setPortrait(e.target.checked)} />
            Portrait
          </label>
          <div className="row">
            <NumField label="Margin" value={margin} onChange={setMargin} />
            <NumField label="Part spacing" value={gap} onChange={setGap} />
          </div>
        </fieldset>

        {valid && fingers && (
          <dl className="summary">
            <dt>Inside</dt>
            <dd>
              {fmt(params.width - 2 * t)} × {fmt(params.depth - 2 * t)} × {fmt(params.height - t)} mm
            </dd>
            <dt>Fingers</dt>
            <dd>
              X {fingers.x} · Y {fingers.y} · Z {fingers.z}
            </dd>
            {lid && (
              <>
                <dt>Lid</dt>
                <dd>
                  {fmt(lid.width)} × {fmt(lid.length)} mm
                </dd>
                <dt>Front</dt>
                <dd>{fmt(frontHeight(params))} mm high</dd>
                <dt>Under lid</dt>
                <dd>{fmt(lid.z - t)} mm clear</dd>
              </>
            )}
            <dt>Sheets</dt>
            <dd>
              {layout.sheets.length} × {fmt(spec.width)} × {fmt(spec.height)} mm
            </dd>
          </dl>
        )}

        {[...errors, ...layout.errors].map((e) => (
          <p key={e} className="error">
            {e}
          </p>
        ))}

        <button className="primary" disabled={!valid || layout.sheets.length === 0} onClick={downloadAll}>
          Download SVG{layout.sheets.length > 1 ? `s (${layout.sheets.length})` : ''}
        </button>
        <p className="note">
          Cut lines: red (#ff0000), 0.1 mm stroke.
          {params.lid && ' Grooves: blue (#0000ff) fill, engrave before cutting.'}
          {placedArt && ' Drawing: black (#000000), score/engrave lightly.'} Document size is set in mm.
        </p>
      </aside>

      <main className="views">
        <section className="view-3d">
          <header>
            <h2>Assembled</h2>
            <label className="slider">
              Explode
              <input
                type="range"
                min={0}
                max={Math.max(params.width, params.depth, params.height) / 3 || 0}
                step={0.5}
                value={explode}
                onChange={(e) => setExplode(parseFloat(e.target.value))}
              />
            </label>
          </header>
          <div className="canvas-wrap">{valid && <Box3D panels={panels} params={params} explode={explode} art={placedArt} />}</div>
        </section>

        <section className="view-sheets">
          <h2>Cut layout</h2>
          {layout.sheets.map((s, i) => (
            <figure key={i}>
              <SheetPreview sheet={s} spec={spec} art={placedArt} />
              <figcaption>
                Sheet {i + 1}
                <button onClick={() => downloadSvg(svgFor(i), filename(i))}>Download</button>
              </figcaption>
            </figure>
          ))}
        </section>
      </main>
    </div>
  );
}

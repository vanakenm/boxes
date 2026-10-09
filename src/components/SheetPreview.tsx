import type { Sheet, SheetSpec } from '../lib/layout';
import { CUT_COLOR, ENGRAVE_COLOR, pathData, type PlacedArt } from '../lib/svg';

export function SheetPreview({ sheet, spec, art }: { sheet: Sheet; spec: SheetSpec; art?: PlacedArt | null }) {
  const fontSize = Math.max(spec.width, spec.height) / 60;
  return (
    <svg className="sheet" viewBox={`0 0 ${spec.width} ${spec.height}`} preserveAspectRatio="xMidYMid meet">
      <rect width={spec.width} height={spec.height} className="sheet-bg" />
      <rect
        x={spec.margin}
        y={spec.margin}
        width={Math.max(spec.width - 2 * spec.margin, 0)}
        height={Math.max(spec.height - 2 * spec.margin, 0)}
        className="sheet-margin"
      />
      {sheet.parts.map((p) => (
        <g key={p.panel.id}>
          <path d={pathData(p.points)} fill="rgba(201,154,99,0.25)" stroke={CUT_COLOR} strokeWidth={0.4} />
          {p.grooves.map((g, i) => (
            <rect key={i} x={g.x} y={g.y} width={g.w} height={g.h} fill={ENGRAVE_COLOR} opacity={0.45} />
          ))}
          {art?.panelId === p.panel.id && (
            <g transform={p.screenToSheet}>
              <g transform={art.transform} dangerouslySetInnerHTML={{ __html: art.markup }} />
            </g>
          )}
          <text
            x={p.x + p.w / 2}
            y={art?.panelId === p.panel.id ? p.y + p.h - fontSize : p.y + p.h / 2}
            fontSize={fontSize}
            className="part-label"
          >
            {p.panel.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

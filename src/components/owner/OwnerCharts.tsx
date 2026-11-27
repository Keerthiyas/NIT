import { useState } from 'react';

export function formatInr(amount: number, decimals = 2): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatCompactInr(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}k`;
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export interface ComparisonBarItem {
  label: string;
  primaryValue: number;
  secondaryValue?: number;
  primaryLabel?: string;
  secondaryLabel?: string;
}

interface ComparisonBarChartProps {
  items: ComparisonBarItem[];
  primaryName: string;
  secondaryName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  valueFormatter?: (v: number) => string;
  emptyText?: string;
}

export function ComparisonBarChart({
  items,
  primaryName,
  secondaryName,
  primaryColor = '#1e3a8a',
  secondaryColor = '#059669',
  valueFormatter = (v) => v.toLocaleString('en-IN'),
  emptyText = 'No chart data for the selected range.',
}: ComparisonBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-500">
        {emptyText}
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...items.flatMap((i) => [i.primaryValue, i.secondaryValue ?? 0])
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: primaryColor }}
            />
            {primaryName}
          </span>
          {secondaryName && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: secondaryColor }}
              />
              {secondaryName}
            </span>
          )}
        </div>
        {hoveredIdx !== null && items[hoveredIdx] && (
          <span className="font-medium text-slate-800">
            {items[hoveredIdx].label}: {primaryName}{' '}
            {valueFormatter(items[hoveredIdx].primaryValue)}
            {secondaryName && items[hoveredIdx].secondaryValue !== undefined
              ? ` · ${secondaryName} ${valueFormatter(items[hoveredIdx].secondaryValue ?? 0)}`
              : ''}
          </span>
        )}
      </div>

      <div className="w-full overflow-x-auto">
        <div
          className="flex items-end gap-3 min-w-[260px] h-44 pt-4 pb-2 border-b border-slate-200"
          role="img"
          aria-label={`${primaryName}${secondaryName ? ` vs ${secondaryName}` : ''} chart`}
        >
          {items.map((item, idx) => {
            const pHeight = Math.max(4, Math.round((item.primaryValue / maxVal) * 124));
            const sHeight =
              item.secondaryValue !== undefined
                ? Math.max(
                    item.secondaryValue > 0 ? 4 : 0,
                    Math.round((item.secondaryValue / maxVal) * 124)
                  )
                : 0;

            return (
              <div
                key={`${item.label}-${idx}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="flex-1 min-w-[44px] flex flex-col items-center justify-end gap-1.5 group cursor-default"
              >
                <div className="flex items-end justify-center gap-1 h-[128px] w-full">
                  <div
                    className="w-4 sm:w-5 rounded-t transition-opacity group-hover:opacity-85"
                    style={{ height: `${pHeight}px`, backgroundColor: primaryColor }}
                    title={`${item.label} — ${primaryName}: ${valueFormatter(item.primaryValue)}`}
                  />
                  {secondaryName && (
                    <div
                      className="w-4 sm:w-5 rounded-t transition-opacity group-hover:opacity-85"
                      style={{ height: `${sHeight}px`, backgroundColor: secondaryColor }}
                      title={`${item.label} — ${secondaryName}: ${valueFormatter(
                        item.secondaryValue ?? 0
                      )}`}
                    />
                  )}
                </div>
                <span className="text-[11px] text-slate-600 truncate max-w-[78px]" title={item.label}>
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface TrendLinePoint {
  label: string;
  value: number;
  meta?: string;
}

export function SimpleTrendChart({
  points,
  seriesName,
  strokeColor = '#1d4ed8',
  valueFormatter = (v) => formatCompactInr(v),
  emptyText = 'No trend data available.',
}: {
  points: TrendLinePoint[];
  seriesName: string;
  strokeColor?: string;
  valueFormatter?: (v: number) => string;
  emptyText?: string;
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-500">
        {emptyText}
      </div>
    );
  }

  const width = 440;
  const height = 140;
  const padX = 28;
  const padY = 18;
  const maxVal = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;

  const coords = points.map((p, idx) => {
    const x = points.length === 1 ? width / 2 : padX + idx * stepX;
    const y = height - padY - (p.value / maxVal) * (height - padY * 2);
    return { x, y, ...p };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-36 overflow-visible"
        role="img"
        aria-label={seriesName}
      >
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <line
          x1={padX}
          y1={padY}
          x2={width - padX}
          y2={padY}
          stroke="#f1f5f9"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        {coords.length > 1 && (
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={polylinePoints}
          />
        )}
        {coords.map((c, idx) => (
          <g key={`${c.label}-${idx}`}>
            <circle cx={c.x} cy={c.y} r="4.5" fill={strokeColor}>
              <title>{`${c.label}: ${valueFormatter(c.value)}${c.meta ? ` (${c.meta})` : ''}`}</title>
            </circle>
            <text
              x={c.x}
              y={Math.max(11, c.y - 8)}
              textAnchor="middle"
              fontSize="10"
              fill="#334155"
              fontWeight="600"
            >
              {valueFormatter(c.value)}
            </text>
            <text
              x={c.x}
              y={height - 2}
              textAnchor="middle"
              fontSize="10"
              fill="#64748b"
            >
              {c.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

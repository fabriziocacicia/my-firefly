import React, { useEffect, useMemo, useState } from 'react';
import { DealAnalysis, PriceRecord } from '../../types';

interface ProductPriceChartProps {
  records: PriceRecord[];
  analysis: DealAnalysis | null;
  defaultUnit: string;
}

const STORE_COLORS = [
  '#2563EB', // blue-600
  '#059669', // emerald-600
  '#D97706', // amber-600
  '#7C3AED', // violet-600
  '#E11D48', // rose-600
  '#0891B2', // cyan-600
];

function formatUnitAxisLabel(defaultUnit: string): string {
  const clean = (defaultUnit || '').toLowerCase().trim();
  if (clean === 'g' || clean === 'kg') return '€/kg';
  if (clean === 'ml' || clean === 'l') return '€/L';
  return '€/pc';
}

function getStoreLabel(record: PriceRecord): string {
  if (record.store) {
    const company = record.store.company?.name;
    return company ? `${company} (${record.store.name})` : record.store.name;
  }
  return `Store #${record.store_id}`;
}

export const ProductPriceChart: React.FC<ProductPriceChartProps> = ({
  records,
  analysis,
  defaultUnit,
}) => {
  const unitAxisLabel = formatUnitAxisLabel(defaultUnit);

  const normalizedRecords = useMemo(
    () =>
      records.filter(
        (r): r is PriceRecord & { normalized_unit_price: number } =>
          r.normalized_unit_price !== null && r.normalized_unit_price !== undefined
      ),
    [records]
  );

  const storesMeta = useMemo(() => {
    const map = new Map<number, { id: number; label: string; color: string }>();
    let idx = 0;
    for (const rec of normalizedRecords) {
      if (!map.has(rec.store_id)) {
        map.set(rec.store_id, {
          id: rec.store_id,
          label: getStoreLabel(rec),
          color: STORE_COLORS[idx % STORE_COLORS.length],
        });
        idx += 1;
      }
    }
    return Array.from(map.values());
  }, [normalizedRecords]);

  const [visibleStoreIds, setVisibleStoreIds] = useState<number[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<number | null>(null);

  useEffect(() => {
    setVisibleStoreIds(storesMeta.map(s => s.id));
    setActiveRecordId(null);
  }, [storesMeta]);

  const toggleStore = (storeId: number) => {
    setVisibleStoreIds(prev =>
      prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId]
    );
  };

  if (normalizedRecords.length === 0) {
    return (
      <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
        No normalized unit price data points available for charting yet.
      </div>
    );
  }

  const visibleRecords = normalizedRecords.filter(r =>
    visibleStoreIds.includes(r.store_id)
  );
  const pointsToScale = visibleRecords.length > 0 ? visibleRecords : normalizedRecords;

  const timestamps = pointsToScale.map(r =>
    new Date(`${r.recorded_date}T12:00:00Z`).getTime()
  );
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);

  const normValues = pointsToScale.map(r => r.normalized_unit_price);
  const baselineVal =
    analysis?.normalized_baseline_regular_price != null &&
    analysis.normalized_baseline_regular_price > 0
      ? analysis.normalized_baseline_regular_price
      : null;

  if (baselineVal !== null) {
    normValues.push(baselineVal);
  }

  const rawMinY = Math.min(...normValues);
  const rawMaxY = Math.max(...normValues);
  const isFlatPrice = Math.abs(rawMaxY - rawMinY) < 0.0001;
  const yMin = isFlatPrice
    ? Math.max(0, rawMinY * 0.85 - 0.1)
    : Math.max(0, rawMinY - (rawMaxY - rawMinY) * 0.15);
  const yMax = isFlatPrice
    ? rawMaxY * 1.15 + 0.1
    : rawMaxY + (rawMaxY - rawMinY) * 0.15;

  const svgWidth = 640;
  const svgHeight = 250;
  const padLeft = 58;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 38;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const getX = (dateStr: string): number => {
    if (maxTs === minTs) {
      return padLeft + plotWidth / 2;
    }
    const ts = new Date(`${dateStr}T12:00:00Z`).getTime();
    return padLeft + ((ts - minTs) / (maxTs - minTs)) * plotWidth;
  };

  const getY = (val: number): number => {
    const ratio = (val - yMin) / (yMax - yMin || 1);
    return padTop + plotHeight - ratio * plotHeight;
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(frac => {
    const val = yMin + (yMax - yMin) * frac;
    return { val, y: getY(val) };
  });

  const uniqueDates = Array.from(new Set(pointsToScale.map(r => r.recorded_date)));
  const xTickDates =
    uniqueDates.length <= 4
      ? uniqueDates
      : [
          uniqueDates[0],
          uniqueDates[Math.floor(uniqueDates.length / 2)],
          uniqueDates[uniqueDates.length - 1],
        ];

  const activePoint =
    normalizedRecords.find(r => r.id === activeRecordId) || null;

  return (
    <div className="mt-4 p-4 rounded-xl bg-white border border-slate-200 space-y-3">
      {/* Header Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Normalized Price Trend ({unitAxisLabel})
          </h3>
          <p className="text-[11px] text-slate-400">
            Per-store unit price history with normalized median regular baseline
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          {analysis?.normalized_baseline_regular_price != null && (
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">
              Baseline: €{analysis.normalized_baseline_regular_price.toFixed(2)}{' '}
              {unitAxisLabel.replace('€', '')}
            </span>
          )}
          {analysis?.normalized_all_time_low != null && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
              Norm Low: €{analysis.normalized_all_time_low.toFixed(2)}{' '}
              {unitAxisLabel.replace('€', '')}
            </span>
          )}
        </div>
      </div>

      {/* Store Legend & Filter Checkboxes */}
      <div className="flex flex-wrap items-center gap-2">
        {storesMeta.map(store => {
          const checked = visibleStoreIds.includes(store.id);
          return (
            <label
              key={store.id}
              className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition ${
                checked
                  ? 'bg-slate-50 border-slate-300 text-slate-800'
                  : 'bg-white border-slate-200 text-slate-400 opacity-70'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleStore(store.id)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: store.color }}
              />
              <span>{store.label}</span>
            </label>
          );
        })}

        {baselineVal !== null && (
          <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 text-xs text-slate-500">
            <span className="w-4 border-t-2 border-dashed border-slate-500 inline-block" />
            <span>Normalized Regular Baseline</span>
          </div>
        )}
      </div>

      {/* Responsive SVG Plot */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto overflow-visible select-none"
          role="img"
          aria-label={`Normalized price chart in ${unitAxisLabel}`}
        >
          {/* Horizontal Grid Lines & Y-Axis Labels */}
          {yTicks.map((tick, idx) => (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={tick.y}
                x2={svgWidth - padRight}
                y2={tick.y}
                stroke="#E2E8F0"
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={tick.y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono"
              >
                €{tick.val.toFixed(2)}
              </text>
            </g>
          ))}

          {/* Y-Axis Unit Title */}
          <text
            x={12}
            y={padTop + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${padTop + plotHeight / 2})`}
            className="fill-slate-500 text-[10px] font-semibold"
          >
            {unitAxisLabel}
          </text>

          {/* Axes */}
          <line
            x1={padLeft}
            y1={padTop}
            x2={padLeft}
            y2={padTop + plotHeight}
            stroke="#94A3B8"
            strokeWidth="1.2"
          />
          <line
            x1={padLeft}
            y1={padTop + plotHeight}
            x2={svgWidth - padRight}
            y2={padTop + plotHeight}
            stroke="#94A3B8"
            strokeWidth="1.2"
          />

          {/* X-Axis Date Labels */}
          {xTickDates.map(d => (
            <text
              key={d}
              x={getX(d)}
              y={padTop + plotHeight + 18}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {d}
            </text>
          ))}

          {/* Normalized Regular Baseline Horizontal Dashed Line */}
          {baselineVal !== null && (
            <g>
              <line
                x1={padLeft}
                y1={getY(baselineVal)}
                x2={svgWidth - padRight}
                y2={getY(baselineVal)}
                stroke="#64748B"
                strokeWidth="1.75"
                strokeDasharray="6 4"
              />
              <text
                x={svgWidth - padRight}
                y={getY(baselineVal) - 5}
                textAnchor="end"
                className="fill-slate-600 text-[10px] font-semibold"
              >
                Median €{baselineVal.toFixed(2)}
              </text>
            </g>
          )}

          {/* Per-Store Connected Trend Lines (Strictly Within Same Store) */}
          {storesMeta
            .filter(store => visibleStoreIds.includes(store.id))
            .map(store => {
              const storePoints = visibleRecords
                .filter(r => r.store_id === store.id)
                .map(r => `${getX(r.recorded_date)},${getY(r.normalized_unit_price)}`);
              if (storePoints.length < 2) return null;
              return (
                <polyline
                  key={`line-${store.id}`}
                  fill="none"
                  stroke={store.color}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.8"
                  points={storePoints.join(' ')}
                />
              );
            })}

          {/* Scatter Points & Touch/Hover Targets */}
          {visibleRecords.map(rec => {
            const meta = storesMeta.find(s => s.id === rec.store_id);
            const color = meta?.color || '#2563EB';
            const cx = getX(rec.recorded_date);
            const cy = getY(rec.normalized_unit_price);
            const isSelected = activeRecordId === rec.id;

            return (
              <g
                key={rec.id}
                className="cursor-pointer"
                onMouseEnter={() => setActiveRecordId(rec.id)}
                onClick={() =>
                  setActiveRecordId(prev => (prev === rec.id ? null : rec.id))
                }
              >
                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 6.5 : 4.5}
                  fill={rec.is_discount ? '#FFFFFF' : color}
                  stroke={color}
                  strokeWidth={rec.is_discount ? 2.5 : 2}
                />
              </g>
            );
          })}
        </svg>

        {/* Active Tooltip Details Bar */}
        {activePoint && (
          <div className="mt-2 p-2.5 rounded-lg bg-slate-900 text-white text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <span className="font-semibold">{activePoint.recorded_date}</span>
              <span className="text-slate-300">•</span>
              <span className="font-medium text-blue-300">
                {getStoreLabel(activePoint)}
              </span>
              {activePoint.is_discount && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-bold text-[10px]">
                  SALE
                </span>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <span>
                Normalized:{' '}
                <strong>
                  €{activePoint.normalized_unit_price.toFixed(2)} {unitAxisLabel.replace('€', '')}
                </strong>
              </span>
              <span className="text-slate-300">
                (Paid €{activePoint.paid_price.toFixed(2)})
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

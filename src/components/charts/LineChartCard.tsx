'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_CATEGORICAL, chartAxisProps, chartGridProps, chartTooltipStyle } from '@/lib/chartTheme';

export interface LineChartDatum {
  label: string;
  value: number;
  // Optional extra fields (e.g. per-currency breakdown) surfaced in the tooltip
  // via `tooltipExtra` rather than baked into the axis.
  [key: string]: unknown;
}

/**
 * A single-series "card" area chart for change-over-time data (the one form
 * BarChartCard doesn't cover — see the dataviz skill's choosing-a-form guide:
 * magnitude-across-categories is a bar, change-over-time is a line/area).
 * One brand hue, filled area for an immediate sense of trend, dot only on hover.
 */
export default function LineChartCard({
  title,
  subtitle,
  data,
  emptyMessage = 'No data yet.',
  height = 240,
  valueFormatter,
  tooltipExtra,
}: {
  title: string;
  subtitle?: string;
  data: LineChartDatum[];
  emptyMessage?: string;
  height?: number;
  valueFormatter?: (value: number) => string;
  /** Render extra lines inside the tooltip for a given datum (e.g. per-currency breakdown). */
  tooltipExtra?: (datum: LineChartDatum) => string[];
}) {
  const hasData = data.some((d) => d.value > 0);
  const color = CHART_CATEGORICAL[0];
  // Y-axis tick width sized to the longest label instead of a fixed guess —
  // a count axis ("0..12") and a currency axis ("0..14,202") need very
  // different widths, and a too-narrow fixed width clips the leading digits.
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const yAxisWidth = Math.max(32, String(Math.round(maxValue)).length * 8 + 16);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      <div className="p-5 flex-1 min-h-0">
        {!hasData ? (
          <p className="text-sm text-gray-400 text-center py-10">{emptyMessage}</p>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="lineChartCardFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="label" {...chartAxisProps} />
              <YAxis {...chartAxisProps} allowDecimals={false} width={yAxisWidth} />
              <Tooltip
                {...chartTooltipStyle}
                formatter={(value) => [valueFormatter ? valueFormatter(Number(value)) : value, undefined]}
                labelFormatter={(label, payload) => {
                  const extra = tooltipExtra && payload?.[0]?.payload ? tooltipExtra(payload[0].payload as LineChartDatum) : [];
                  return extra.length ? `${label}\n${extra.join(' · ')}` : label;
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill="url(#lineChartCardFill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

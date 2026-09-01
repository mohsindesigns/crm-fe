'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_CATEGORICAL, chartAxisProps, chartGridProps, chartTooltipStyle } from '@/lib/chartTheme';

export interface BarChartDatum {
  label: string;
  value: number;
}

/**
 * A single "card" bar chart matching the app's existing SectionCard/table-card
 * visual language (white panel, bordered header). Two color modes:
 *
 * - Default (magnitude across categories, e.g. "tasks per stage"): every bar
 *   is one brand hue — a single measure doesn't need a legend, and coloring
 *   each bar a different hue would imply an identity distinction that isn't
 *   there.
 * - `categorical`: each bar gets its own hue from the validated categorical
 *   order (e.g. "projects by status") and a legend renders below the chart,
 *   since here each bar *is* a distinct, nameable entity.
 */
export default function BarChartCard({
  title,
  data,
  emptyMessage = 'No data yet.',
  height = 260,
  valueFormatter,
  categorical = false,
  href,
}: {
  title: string;
  data: BarChartDatum[];
  emptyMessage?: string;
  height?: number;
  valueFormatter?: (value: number) => string;
  categorical?: boolean;
  href?: string;
}) {
  const rotate = data.length > 6;
  // Y-axis tick width sized to the longest label instead of a fixed guess —
  // a count axis ("0..12") and a currency axis ("0..14,202") need very
  // different widths, and a too-narrow fixed width clips the leading digits.
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const yAxisWidth = Math.max(32, String(Math.round(maxValue)).length * 8 + 16);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {href && (
          <a href={href} className="text-xs font-medium text-brand-700 hover:text-brand-800">View all →</a>
        )}
      </div>
      <div className="p-5">
        {data.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">{emptyMessage}</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: rotate ? 16 : 4 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis
                  dataKey="label"
                  {...chartAxisProps}
                  interval={0}
                  angle={rotate ? -25 : 0}
                  textAnchor={rotate ? 'end' : 'middle'}
                  height={rotate ? 52 : 30}
                />
                <YAxis {...chartAxisProps} allowDecimals={false} width={yAxisWidth} />
                <Tooltip
                  {...chartTooltipStyle}
                  formatter={(value) => [valueFormatter ? valueFormatter(Number(value)) : value, 'Count']}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {data.map((d, i) => (
                    <Cell key={d.label} fill={categorical ? CHART_CATEGORICAL[i % CHART_CATEGORICAL.length] : CHART_CATEGORICAL[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {categorical && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-1 pt-3 border-t border-gray-50">
                {data.map((d, i) => (
                  <span key={d.label} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHART_CATEGORICAL[i % CHART_CATEGORICAL.length] }} />
                    {d.label}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

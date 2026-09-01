'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_CATEGORICAL, chartTooltipStyle } from '@/lib/chartTheme';

export interface DonutDatum {
  label: string;
  value: number;
}

/**
 * A donut breakdown card — same white/bordered card shell as BarChartCard,
 * center total + a below-chart legend (never color alone, per the dataviz
 * skill) since a donut's slices are always distinct named categories.
 */
export default function DonutChartCard({
  title,
  data,
  emptyMessage = 'No data yet.',
  height = 200,
  href,
}: {
  title: string;
  data: DonutDatum[];
  emptyMessage?: string;
  height?: number;
  href?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 h-full flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {href && (
          <a href={href} className="text-xs font-medium text-brand-700 hover:text-brand-800">View all →</a>
        )}
      </div>
      <div className="p-5 flex-1 flex flex-col">
        {total === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">{emptyMessage}</p>
        ) : (
          <>
            <div className="relative">
              <ResponsiveContainer width="100%" height={height}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="90%"
                    paddingAngle={2}
                    strokeWidth={2}
                    stroke="#ffffff"
                  >
                    {data.map((d, i) => (
                      <Cell key={d.label} fill={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipStyle} formatter={(value) => [value, 'Count']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-gray-900 tabular-nums">{total}</span>
                <span className="text-[11px] text-gray-400">Total</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-2 pt-3 border-t border-gray-50">
              {data.map((d, i) => (
                <span key={d.label} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHART_CATEGORICAL[i % CHART_CATEGORICAL.length] }} />
                  {d.label} <span className="text-gray-400">({d.value})</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

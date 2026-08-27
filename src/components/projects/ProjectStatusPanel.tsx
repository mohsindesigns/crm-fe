'use client';

import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Users, MessageSquare, FileBarChart, Paperclip } from 'lucide-react';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import { cn, titleCase, formatDate } from '@/lib/utils';

type Tab = 'overview' | 'keywords' | 'backlinks' | 'content' | 'blogs' | 'reporting' | 'comments';

// Semantic, not per-status — "good/finished", "in progress", "neutral/inactive",
// "needs attention" — reused consistently across every donut in this panel so a
// reader learns the meaning once instead of decoding a new legend per card.
const C = {
  good: '#0B1D5E',    // brand-700
  progress: '#F4C430', // brand accent gold
  neutral: '#CBD5E1',  // slate-300
  bad: '#F87171',      // red-400
};

function tally<T>(rows: T[], keyFn: (r: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

function Donut({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  const data = segments.filter((s) => s.value > 0);
  return (
    <div className="relative w-14 h-14 shrink-0">
      {total > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={16} outerRadius={27} strokeWidth={1.5} stroke="#fff" isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="w-full h-full rounded-full border-[3px] border-gray-100" />
      )}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[11px] font-bold text-gray-800">{total}</span>
      </div>
    </div>
  );
}

function DonutStat({
  title,
  segments,
  total,
  onClick,
}: {
  title: string;
  segments: { label: string; value: number; color: string }[];
  total: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'w-full text-left bg-white rounded-xl border border-gray-200 p-3',
        onClick && 'hover:border-brand-300 hover:shadow-sm transition-all cursor-pointer',
      )}
    >
      <div className="flex items-center gap-3">
        <Donut segments={segments} total={total} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-700 mb-1">{title}</p>
          <div className="space-y-0.5">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 text-gray-500 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="font-medium text-gray-700 shrink-0">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}

function SimpleStat({
  icon: Icon,
  title,
  value,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: number | string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'w-full text-left bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3',
        onClick && 'hover:border-brand-300 hover:shadow-sm transition-all cursor-pointer',
      )}
    >
      <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-brand-700" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-700">{title}</p>
        <p className="text-sm text-gray-900">
          <span className="font-bold">{value}</span>
          {hint && <span className="text-gray-400 font-normal"> · {hint}</span>}
        </p>
      </div>
    </button>
  );
}

export default function ProjectStatusPanel({
  project,
  stages,
  currentStageIdx,
  setTab,
}: {
  project: any;
  stages: any[];
  currentStageIdx: number;
  setTab: (t: Tab) => void;
}) {
  const id = project.id;
  const isSeo = project.serviceTypeKey === 'seo';

  const completionPct = stages.length > 1
    ? Math.round(((project.status === 'completed' ? stages.length - 1 : Math.max(currentStageIdx, 0)) / (stages.length - 1)) * 100)
    : (project.status === 'completed' ? 100 : 0);

  // ── SEO-only breakdowns ───────────────────────────────────────────────────
  const { data: keywords = [] } = useQuery({
    queryKey: ['panel-seo-keywords', id],
    queryFn: () => api.get(`/seo/projects/${id}/keywords`, { params: { includeInactive: 1 } }).then((r) => r.data),
    enabled: isSeo,
  });
  const { data: backlinks = [] } = useQuery({
    queryKey: ['panel-seo-backlinks', id],
    queryFn: () => api.get(`/seo/projects/${id}/backlinks`, { params: { includeInactive: 1 } }).then((r) => r.data),
    enabled: isSeo,
  });
  const { data: content = [] } = useQuery({
    queryKey: ['panel-seo-content', id],
    queryFn: () => api.get(`/seo/projects/${id}/content`).then((r) => r.data),
    enabled: isSeo,
  });
  const { data: blogs = [] } = useQuery({
    queryKey: ['panel-seo-blogs', id],
    queryFn: () => api.get(`/seo/projects/${id}/blogs`).then((r) => r.data),
    enabled: isSeo,
  });
  const { data: rankings } = useQuery({
    queryKey: ['panel-seo-rankings', id],
    queryFn: () => api.get(`/seo/projects/${id}/rankings`).then((r) => r.data),
    enabled: isSeo,
  });

  // ── Generic breakdown for every other service type ────────────────────────
  const { data: allTasks = [] } = useQuery({
    queryKey: ['panel-tasks', id],
    queryFn: () => api.get(`/projects/${id}/tasks`).then((r) => r.data),
    enabled: !isSeo,
  });

  // ── Shared by every project type ──────────────────────────────────────────
  const { data: artifacts = [] } = useQuery({
    queryKey: ['panel-artifacts', id],
    queryFn: () => api.get('/media/artifacts', { params: { projectId: id } }).then((r) => r.data),
  });
  const { data: comments = [] } = useQuery({
    queryKey: ['panel-comments', id],
    queryFn: () => api.get(`/projects/${id}/comments`).then((r) => r.data),
  });

  const keywordCounts = tally(keywords as any[], (k) => k.status || 'active');
  const backlinkCounts = tally(backlinks as any[], (b) => (b.isIndexed ? 'indexed' : 'not_indexed'));
  const contentCounts = tally(content as any[], (c) => c.status || 'pending');
  const blogCounts = tally(blogs as any[], (b) => b.status || 'draft');
  const taskCounts = tally(allTasks as any[], (t) => t.status || 'todo');

  return (
    <aside className="w-full lg:w-[300px] lg:shrink-0 space-y-4">
      {/* Completion + team */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <Donut
            segments={[
              { label: 'Complete', value: completionPct, color: C.good },
              { label: 'Remaining', value: 100 - completionPct, color: C.neutral },
            ]}
            total={completionPct}
          />
          <div>
            <p className="text-xs font-semibold text-gray-700">Completion</p>
            <p className="text-xl font-bold text-gray-900">{completionPct}%</p>
            <p className="text-[11px] text-gray-400">
              Stage {Math.max(currentStageIdx, 0) + 1} of {stages.length || 1}
            </p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-gray-400" /> Team
          </p>
          {(project.assignments || []).length === 0 ? (
            <p className="text-xs text-gray-400">No one assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {(project.assignments || []).map((a: any) => (
                <div key={a.id} className="flex items-center gap-2">
                  <Avatar src={a.user?.avatarUrl} name={a.user?.name} size="xs" className="w-6 h-6" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{a.user?.name || 'Unassigned'}</p>
                    <p className="text-[10px] text-gray-400 truncate">{titleCase(a.roleSlot)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-service-type breakdowns */}
      {isSeo ? (
        <div className="space-y-3">
          <DonutStat
            title="Keywords"
            total={(keywords as any[]).length}
            onClick={() => setTab('keywords')}
            segments={[
              { label: 'Active', value: keywordCounts.get('active') || 0, color: C.good },
              { label: 'Inactive', value: keywordCounts.get('inactive') || 0, color: C.neutral },
            ]}
          />
          <DonutStat
            title="Backlinks"
            total={(backlinks as any[]).length}
            onClick={() => setTab('backlinks')}
            segments={[
              { label: 'Indexed', value: backlinkCounts.get('indexed') || 0, color: C.good },
              { label: 'Not indexed', value: backlinkCounts.get('not_indexed') || 0, color: C.neutral },
            ]}
          />
          <DonutStat
            title="Content"
            total={(content as any[]).length}
            onClick={() => setTab('content')}
            segments={[
              { label: 'Approved', value: contentCounts.get('approved') || 0, color: C.good },
              { label: 'Pending', value: contentCounts.get('pending') || 0, color: C.progress },
              { label: 'Rejected', value: contentCounts.get('rejected') || 0, color: C.bad },
              { label: 'Superseded', value: contentCounts.get('superseded') || 0, color: C.neutral },
            ]}
          />
          <DonutStat
            title="Blogs"
            total={(blogs as any[]).length}
            onClick={() => setTab('blogs')}
            segments={[
              { label: 'Approved', value: blogCounts.get('approved') || 0, color: C.good },
              { label: 'Pending', value: blogCounts.get('pending') || 0, color: C.progress },
              { label: 'Draft', value: blogCounts.get('draft') || 0, color: C.neutral },
              { label: 'Rejected', value: blogCounts.get('rejected') || 0, color: C.bad },
            ]}
          />
          <SimpleStat
            icon={FileBarChart}
            title="Monthly Report"
            value={rankings?.dates?.length || 0}
            hint={rankings?.latestDate ? `last ${formatDate(rankings.latestDate)}` : 'no reports yet'}
            onClick={() => setTab('reporting')}
          />
          <SimpleStat
            icon={MessageSquare}
            title="Comments"
            value={(comments as any[]).length}
            onClick={() => setTab('comments')}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <DonutStat
            title="Tasks"
            total={(allTasks as any[]).length}
            segments={[
              { label: 'Done / approved', value: (taskCounts.get('done') || 0) + (taskCounts.get('approved') || 0), color: C.good },
              { label: 'In progress', value: (taskCounts.get('in_progress') || 0) + (taskCounts.get('submitted') || 0) + (taskCounts.get('in_review') || 0), color: C.progress },
              { label: 'To do', value: (taskCounts.get('todo') || 0) + (taskCounts.get('accepted') || 0), color: C.neutral },
              { label: 'Rejected', value: taskCounts.get('rejected') || 0, color: C.bad },
            ]}
          />
          <SimpleStat
            icon={Paperclip}
            title="Artifacts"
            value={(artifacts as any[]).length}
          />
          <SimpleStat
            icon={MessageSquare}
            title="Comments"
            value={(comments as any[]).length}
            onClick={() => setTab('comments')}
          />
        </div>
      )}
    </aside>
  );
}

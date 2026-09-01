'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, FolderKanban, Search, Loader2, Filter, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import { cn, formatDate, titleCase } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const STATUS_OPTS = [
  { label: 'All statuses', value: '' },
  { label: 'Active',    value: 'active'    },
  { label: 'On Hold',   value: 'on_hold'   },
  { label: 'Blocked',   value: 'blocked'   },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-brand-100 text-brand-800',
  completed: 'bg-blue-100   text-blue-700',
  on_hold:   'bg-amber-100  text-amber-700',
  blocked:   'bg-orange-100 text-orange-700',
  cancelled: 'bg-red-100    text-red-700',
};

const LIMIT = 25;

// Every project — regardless of service type — gets a Project Strategist slot.
// Fall back to a service-specific lead (Social Manager, Ads Manager, Account
// Manager) or Project Manager only if no Project Strategist has been assigned yet.
const STRATEGIST_ROLE_PRIORITY = ['project_strategist', 'social_manager', 'ads_manager', 'account_manager', 'project_manager'];

function SkeletonRows() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <TableRow key={i} className="animate-pulse border-b border-gray-50">
          <TableCell className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 shrink-0" />
              <div className="h-4 bg-gray-100 rounded w-40" />
            </div>
          </TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-24" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-24" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-5 bg-gray-100 rounded-full w-16" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function ProjectsPage() {
  const [rawSearch, setRawSearch] = useState('');
  const [search,    setSearch]    = useState('');
  const [status,    setStatus]    = useState('');
  const [service,   setService]   = useState('');
  const [stage,     setStage]     = useState('');
  const [clientId,  setClientId]  = useState('');
  const [type,      setType]      = useState(''); // '', 'recurring', 'one_time'
  const [strategistId, setStrategistId] = useState('');
  const [teamMemberId, setTeamMemberId] = useState('');
  const [overdue,   setOverdue]   = useState(false);
  const [hideCancelled, setHideCancelled] = useState(true);
  const [payViaCrm, setPayViaCrm] = useState(false);
  const [page,      setPage]      = useState(1);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const statusParam = searchParams.get('status');
    if (!statusParam) return;
    const allowed = STATUS_OPTS.map((s) => s.value).filter(Boolean);
    if (!allowed.includes(statusParam)) return;
    setStatus(statusParam);
    setPage(1);
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['projects', { page, search, status, service, stage, clientId, type, overdue, strategistId, teamMemberId, hideCancelled, payViaCrm }],
    queryFn: () =>
      api.get('/projects', {
        params: {
          page, limit: LIMIT, search: search || undefined, status: status || undefined,
          serviceTypeKey: service || undefined, currentStageKey: stage || undefined,
          clientId: clientId || undefined,
          isRecurring: type ? type === 'recurring' : undefined,
          overdue: overdue || undefined,
          assignedUserId: strategistId || undefined,
          roleSlot: strategistId ? STRATEGIST_ROLE_PRIORITY.join(',') : undefined,
          teamMemberId: teamMemberId || undefined,
          excludeCancelled: hideCancelled || undefined,
          payViaCrm: payViaCrm || undefined,
        },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => api.get('/clients', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['admin-templates'],
    queryFn: () => api.get('/admin/templates').then((r) => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get('/users', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const allProjects: any[] = data?.data || [];

  // First match on the project's own assignments wins, so this works across every
  // service type instead of only ever showing an SEO Strategist column.
  const projectStrategistOf = (project: any) => {
    for (const slot of STRATEGIST_ROLE_PRIORITY) {
      const a = project.assignments?.find((x: any) => x.roleSlot === slot);
      if (a?.user) return a.user;
    }
    return undefined;
  };

  // Any team member can be assigned to a strategist-type slot — filtering only by
  // role.key left the dropdown empty when people with Employee/Admin/etc. roles
  // were filling it, so this also matches on role name and on who's actually
  // holding one of these slots on a real project.
  const strategists = (() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const p of allProjects) {
      const u = projectStrategistOf(p);
      if (u?.id) map.set(u.id, { id: u.id, name: u.name || 'Unknown' });
    }
    for (const u of users as any[]) {
      const key = u.role?.key || '';
      const roleName = String(u.role?.name || '');
      if (STRATEGIST_ROLE_PRIORITY.includes(key) || /seo|social|ads|account|project manager|strategist/i.test(roleName)) {
        map.set(u.id, { id: u.id, name: u.name || 'Unknown' });
      }
    }
    if (map.size === 0) {
      for (const u of users as any[]) {
        if (u.id) map.set(u.id, { id: u.id, name: u.name || 'Unknown' });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  // Stages are defined per-template; flatten and dedupe by key across all templates
  // so the filter covers every stage regardless of which workflow a project uses.
  // Label with titleCase(key) — same transform the Stage column in the table below
  // uses — instead of the template's stage.name. Different templates give the same
  // key wildly different names ("review" is "Client Review" on Logo Design but
  // "Final Review" on App Development), so a name-based label wouldn't visually
  // match what the table shows for that project, making the filter look broken.
  const stageOptions = (() => {
    const seen = new Set<string>();
    const relevantTemplates = service ? (templates as any[]).filter((t) => t.serviceTypeKey === service) : (templates as any[]);
    for (const t of relevantTemplates) {
      for (const s of t.stages || []) seen.add(s.key);
    }
    return Array.from(seen, (value) => ({ value, label: titleCase(value) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  const projects = allProjects;
  const total: number      = data?.total      || 0;
  const totalPages: number = data?.totalPages || 1;

  function navigate(id: string) {
    setNavigatingId(id);
    router.push(`/projects/${id}`);
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Projects" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Service type tabs ── */}
        <div className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-1 overflow-x-auto scrollbar-hide">
          {[{ key: '', name: 'All Services' }, ...(serviceTypes as any[])].map((s: any) => (
            <button
              key={s.key || 'all'}
              onClick={() => { setService(s.key); setStage(''); setPage(1); }}
              className={cn(
                'shrink-0 whitespace-nowrap px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                service === s.key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {s.name}
            </button>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative w-full sm:flex-1 sm:max-w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={rawSearch}
                onChange={(e) => setRawSearch(e.target.value)}
                placeholder="Search by project or client…"
                className="w-full pl-9 pr-4 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div className="flex items-center gap-2 sm:ml-auto min-w-0 flex-wrap">
              <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <select
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setPage(1); }}
                className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                <option value="">All clients</option>
                {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:justify-end">
            <select
              value={stage}
              onChange={(e) => { setStage(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All stages</option>
              {stageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All types</option>
              <option value="recurring">Recurring</option>
              <option value="one_time">One-time</option>
            </select>
            <select
              value={strategistId}
              onChange={(e) => { setStrategistId(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All strategists</option>
              {strategists.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select
              value={teamMemberId}
              onChange={(e) => { setTeamMemberId(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All team members</option>
              {(users as any[]).slice().sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')).map((u: any) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <label className={cn(
              'flex items-center gap-1.5 shrink-0 whitespace-nowrap text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors',
              overdue ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            )}>
              <input
                type="checkbox"
                checked={overdue}
                onChange={(e) => { setOverdue(e.target.checked); setPage(1); }}
                className="w-3.5 h-3.5 rounded accent-red-600"
              />
              Overdue only
            </label>
            <label className={cn(
              'flex items-center gap-1.5 shrink-0 whitespace-nowrap text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors',
              hideCancelled ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            )}>
              <input
                type="checkbox"
                checked={hideCancelled}
                onChange={(e) => { setHideCancelled(e.target.checked); setPage(1); }}
                className="w-3.5 h-3.5 rounded accent-brand-600"
              />
              Hide cancelled
            </label>
            <label className={cn(
              'flex items-center gap-1.5 shrink-0 whitespace-nowrap text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors',
              payViaCrm ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            )}>
              <input
                type="checkbox"
                checked={payViaCrm}
                onChange={(e) => { setPayViaCrm(e.target.checked); setPage(1); }}
                className="w-3.5 h-3.5 rounded accent-brand-600"
              />
              Pay via CRM
            </label>

            <Link
              href="/projects/new"
              className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Project
            </Link>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <Table className="w-full min-w-[900px]">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Client</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Service</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Package</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Type</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Stage</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Strategist</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Start</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Due</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows />
              ) : projects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="px-5 py-12 text-center text-sm text-gray-400">No projects found.</TableCell>
                </TableRow>
              ) : (
                projects.map((project: any) => {
                  const isNavigating = navigatingId === project.id;
                  const isOverdue = !!project.deliveryDate
                    && new Date(project.deliveryDate) < new Date(new Date().toDateString())
                    && !['completed', 'cancelled'].includes(project.status);
                  return (
                    <TableRow
                      key={project.id}
                      onClick={() => navigate(project.id)}
                      className={cn(
                        'hover:bg-gray-50 transition-colors cursor-pointer',
                        isNavigating && 'bg-brand-50',
                        !isNavigating && isOverdue && 'bg-red-50/40'
                      )}
                    >
                      <TableCell className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors', isNavigating ? 'bg-brand-100' : 'bg-brand-50')}>
                            {isNavigating
                              ? <Loader2 className="w-4 h-4 text-brand-700 animate-spin" />
                              : <FolderKanban className="w-4 h-4 text-brand-700" />}
                          </div>
                          <span className={cn('text-sm font-medium transition-colors', isNavigating ? 'text-brand-700' : 'text-gray-900')}>
                            {project.client?.name || '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600 capitalize">{project.serviceTypeKey}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{project.package?.name || '—'}</TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', project.isRecurring ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500')}>
                          {project.isRecurring ? 'Recurring' : 'One-time'}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600 capitalize">
                        {titleCase(project.currentStageKey) || '—'}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{projectStrategistOf(project)?.name || '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">{project.startDate ? formatDate(project.startDate) : '—'}</TableCell>
                      <TableCell className={cn('px-5 py-3.5 text-sm whitespace-nowrap', isOverdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
                        <div className="flex items-center gap-1.5">
                          {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          {project.deliveryDate ? formatDate(project.deliveryDate) : '—'}
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[project.status] || 'bg-gray-100 text-gray-600')}>
                          {project.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={setPage} />
        </div>

      </div>
    </div>
  );
}

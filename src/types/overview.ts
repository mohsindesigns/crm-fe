/**
 * Shape of `GET /api/analytics/overview` and `GET /api/analytics/overview/system`.
 *
 * Mirrors crm-be/src/services/OverviewService.js. Most API payloads in this app
 * are read as `any` at the call site, but the Overview page reads ~90 distinct
 * fields off one response across six tabs — untyped, a renamed key on the server
 * would surface as a silent blank cell rather than a build-time error. Keep this
 * in sync with the service when adding a section.
 */

/** `{ currency: amount }`. Never summed — the app holds no FX rates. */
export type MoneyMap = Record<string, number>;

/** `{ status: count }` from a grouped COUNT; a status with no rows is absent. */
export type CountMap = Record<string, number>;

export interface Headline {
  revenueThisMonth: MoneyMap;
  revenueAllTime: MoneyMap;
  outstanding: MoneyMap;
  overdueAmount: MoneyMap;
  activeClients: number;
  activeProjects: number;
  openTasks: number;
  overdueTasks: number;
  headcount: number;
  presentToday: number;
  pendingApprovals: number;
  newLeads: number;
  tasksDoneThisWeek: number;
  collected: MoneyMap;
  criticalCount: number;
}

export type Severity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  severity: Severity;
  label: string;
  detail: string;
  href: string;
  count: number;
}

export interface ApprovalCounts {
  totals: { pending: number; approved: number; rejected: number };
  byType: Record<string, { pending: number; approved: number; rejected: number }>;
}

export interface WaitingItem {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  actorName: string | null;
  action: 'create' | 'update' | 'delete' | 'other';
  resource: string | null;
  description: string;
  statusCode: number | null;
  createdAt: string;
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export interface StageBucket {
  key: string;
  name: string;
  count: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  client: string;
  status: string;
  stage: string;
  deliveryDate: string;
  daysLate: number;
}

/** One row of SlaService.getSlaStatus — an active project against its stage policy. */
export interface SlaItem {
  projectId?: string;
  id?: string;
  projectName?: string;
  name?: string;
  clientName?: string;
  client?: { id: string; name: string } | null;
  stageKey?: string;
  currentStageKey?: string;
  slaStatus: 'ok' | 'at_risk' | 'breached';
  hoursRemaining?: number;
}

export interface WorkloadRow {
  id: string;
  name: string;
  role: string;
  openTasks: number;
  overdueTasks: number;
  activeProjects: number;
}

export interface OnTimeDelivery {
  pct: number;
  onTime: number;
  late: number;
  noDeadline?: number;
}

/** Open-task age buckets — how long work has been sitting, regardless of due date. */
export interface TaskAging {
  d0_1: number;
  d1_3: number;
  d3_7: number;
  d7_14: number;
  d14_plus: number;
}

export interface BusiestProject {
  id: string;
  name: string;
  client: string;
  openTasks: number;
}

export interface ReviewerLoad {
  id: string;
  name: string;
  awaiting: number;
}

export interface Delivery {
  projects: { byStatus: CountMap; total: number };
  tasks: {
    byStatus: CountMap;
    total: number;
    open: number;
    overdue: number;
    unassigned: number;
    dueThisWeek: number;
    completedThisWeek: number;
    byType: CountMap;
    aging: TaskAging;
    auditPending: number;
  };
  byStage: StageBucket[];
  overdueProjects: ProjectRow[];
  overdueProjectCount: number;
  dueSoonProjects: ProjectRow[];
  dueSoonProjectCount: number;
  blocked: number;
  onHold: number;
  onTimeDelivery: OnTimeDelivery | null;
  sla: { breached: number; atRisk: number; items: SlaItem[] };
  workload: WorkloadRow[];
  busiestProjects: BusiestProject[];
  reviewerLoad: ReviewerLoad[];
  recurringRules: number;
  artifacts: number;
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export interface RevenueMonth {
  label: string;
  count: number;
  byCurrency: MoneyMap;
  totalApprox: number;
}

export interface TopClient {
  id: string;
  name: string;
  byCurrency: MoneyMap;
  totalApprox: number;
}

export interface OverdueInvoice {
  id: string;
  number: string;
  client: string;
  currency: string;
  due: number;
  daysLate: number;
  dueAt: string | null;
}

export interface RetainerDue {
  id: string;
  client: string;
  amount: number;
  currency: string;
  cycle: string;
  nextInvoiceDate: string;
}

/** Receivables split by how far past due, each still per-currency. */
export interface Aging {
  current: MoneyMap;
  d1_30: MoneyMap;
  d31_60: MoneyMap;
  d61_90: MoneyMap;
  d90_plus: MoneyMap;
}

export interface Debtor {
  id: string;
  name: string;
  byCurrency: MoneyMap;
  count: number;
  totalApprox: number;
}

export interface ProviderSplit {
  count: number;
  byCurrency: MoneyMap;
}

export interface Finance {
  invoices: { total: number; byStatus: CountMap };
  revenue: { allTime: MoneyMap; thisMonth: MoneyMap };
  collectedThisMonth: MoneyMap;
  outstanding: MoneyMap;
  overdueAmount: MoneyMap;
  aging: Aging;
  revenueTrend: RevenueMonth[];
  topClients: TopClient[];
  overdueInvoices: OverdueInvoice[];
  overdueInvoiceCount: number;
  retainers: { byStatus: CountMap; dueSoon: RetainerDue[] };
  documents: { byStatus: CountMap; total: number };
  debtors: Debtor[];
  payments: { byProvider: Record<string, ProviderSplit>; feesByCurrency: MoneyMap; total: number };
  personalInvoices: { byStatus: CountMap; total: number };
  /** `recurringMonthly` normalises quarterly/annual packages to a monthly figure. */
  packages: { active: number; recurringMonthly: MoneyMap };
}

// ─── People ───────────────────────────────────────────────────────────────────

export interface AttendanceToday {
  present: number;
  absent: number;
  leave: number;
  half_day: number;
  holiday: number;
  weekend: number;
  late: number;
  /** Active staff with no attendance row yet today — not the same as absent. */
  unmarked: number;
  headcount: number;
}

export interface UpcomingLeave {
  id: string;
  name: string;
  type: string;
  fromDate: string;
  toDate: string;
  days: number;
}

export interface PayrollRunSummary {
  id: string;
  period: string;
  periodLabel: string;
  status: string;
  paidAt: string | null;
}

export interface AttendanceDay {
  date: string;
  present: number;
  absent: number;
  leave: number;
  other: number;
  late: number;
}

export interface LateLeader {
  id: string;
  name: string;
  count: number;
  minutes: number;
}

export interface HolidayRow {
  id: string;
  name: string;
  date: string;
  endDate: string | null;
}

export interface AppraisalRow {
  id: string;
  name: string;
  reviewDate: string;
  rating: number | null;
  salaryBefore: number | null;
  salaryAfter: number | null;
}

/** An upcoming work anniversary (year-agnostic match on joining date). */
export interface Milestone {
  id: string;
  name: string;
  date: string;
  years: number;
}

export interface People {
  headcount: {
    total: number;
    active: number;
    byStatus: CountMap;
    byType: CountMap;
    byDepartment: { label: string; value: number }[];
  };
  attendanceToday: AttendanceToday;
  leave: { byStatus: CountMap; pending: number; upcoming: UpcomingLeave[] };
  payroll: PayrollRunSummary[];
  contractorInvoices: CountMap;
  hrDocuments: CountMap;
  probationEndingSoon: number;
  attendanceTrend: AttendanceDay[];
  lateLeaders: LateLeader[];
  leaveByType: CountMap;
  salaryByDepartment: { label: string; byCurrency: MoneyMap }[];
  upcomingHolidays: HolidayRow[];
  appraisals: AppraisalRow[];
  milestones: Milestone[];
}

// ─── Growth ───────────────────────────────────────────────────────────────────

export interface LeadMonth {
  label: string;
  value: number;
  converted: number;
}

export interface Growth {
  clients: { byStatus: CountMap; total: number; newThisMonth: number };
  leads: {
    byStatus: CountMap;
    bySource: { label: string; value: number }[];
    total: number;
    converted: number;
    conversionRate: number;
    trend: LeadMonth[];
    byAssignee: { id: string; name: string; value: number }[];
    unassigned: number;
  };
  clientRequests: CountMap;
  recentRequests: { id: string; status: string; createdAt: string; projectId: string | null }[];
  /** Client contacts with portal login enabled, as a share of all contacts. */
  portal: { contacts: number; enabled: number; pct: number };
}

// ─── SEO ──────────────────────────────────────────────────────────────────────

/** Latest known position per tracked keyword, bucketed. */
export interface RankBuckets {
  top3: number;
  top10: number;
  top30: number;
  beyond30: number;
  unranked: number;
}

export interface Seo {
  keywords: { byStatus: CountMap; total: number; rankBuckets: RankBuckets; ranked: number };
  keywordBatches: CountMap;
  backlinks: {
    total: number;
    byType: CountMap;
    indexed: number;
    indexedPct: number;
    avgDa: number | null;
  };
  contentSubmissions: CountMap;
  contentImplementation: CountMap;
  blogTasks: CountMap;
  gmb: CountMap;
}

// ─── Done (finished work) ────────────────────────────────────────────────────

export interface CompletedProject {
  id: string;
  name: string;
  client: string;
  service: string | null;
  finishedAt: string;
  /** null when the project never had a start date — not zero. */
  durationDays: number | null;
}

export interface PaidInvoice {
  id: string;
  number: string;
  client: string;
  total: number;
  currency: string;
  paidAt: string;
}

/** One workflow-engine stage transition. */
export interface StageEvent {
  id: string;
  projectId: string;
  project: string;
  from: string | null;
  to: string;
  action: string;
  actor: string;
  at: string;
}

export interface Done {
  /** Tasks finished per week, oldest first, eight buckets. */
  throughput: { label: string; value: number }[];
  tasks: {
    window: number;
    thisWeek: number;
    thisMonth: number;
    byType: CountMap;
    avgTurnaroundDays: number | null;
  };
  topFinishers: { id: string; name: string; value: number }[];
  completedProjects: CompletedProject[];
  paidInvoices: PaidInvoice[];
  revenueCollected: MoneyMap;
  stageEvents: StageEvent[];
  totals: {
    leavesApproved30d: number;
    documentsSigned: number;
    contentApproved: number;
    blogsApproved: number;
  };
}

// ─── The whole payload ────────────────────────────────────────────────────────

export interface Overview {
  generatedAt: string;
  headline: Headline;
  attention: AttentionItem[];
  approvals: ApprovalCounts;
  waitingOnMe: WaitingItem[];
  delivery: Delivery;
  finance: Finance;
  people: People;
  growth: Growth;
  seo: Seo;
  done: Done;
  activity: ActivityEntry[];
}

// ─── System health ────────────────────────────────────────────────────────────

export interface SchedulerStatus {
  key: string;
  label: string;
  everyMs: number;
  startedAt: string;
  ok: boolean;
  error: string | null;
}

export interface Integration {
  key: string;
  label: string;
  configured: boolean;
  detail: string | null;
}

export interface TableSize {
  name: string;
  /** The storage engine's estimate, not an exact count — see `records` for exact. */
  rowEstimate: number;
  bytes: number;
  size: string | null;
}

export interface SystemHealth {
  checkedAt: string;
  api: {
    ok: boolean;
    env: string;
    nodeVersion: string;
    pid: number;
    uptimeSeconds: number;
    host: string;
    platform: string;
    cpus: number;
    loadAverage: number[];
    memory: {
      rss: string | null;
      heapUsed: string | null;
      heapTotal: string | null;
      systemFree: string | null;
      systemTotal: string | null;
    };
  };
  database: {
    ok: boolean;
    latencyMs: number;
    error: string | null;
    dialect: string;
    version: string | null;
    name: string | null;
    host: string | null;
    pool: { size: number; available: number; using: number; waiting: number } | null;
  };
  media: {
    ok: boolean;
    status: number | null;
    latencyMs: number | null;
    error: string | null;
    url: string;
  };
  schedulers: SchedulerStatus[];
  integrations: Integration[];
  storage: { tables: TableSize[]; totalSize: string | null };
  records: Record<string, number | null>;
}

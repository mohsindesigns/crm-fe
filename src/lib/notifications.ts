export function notificationHref(n: any): string | null {
  // Messages mentions → open that room in the full-screen Messages app.
  if (n.type === 'chat_mention' || n.refTable === 'chat_rooms') {
    return n.refId ? `/messages/${n.refId}` : '/messages';
  }
  // Task notifications: "projectId:taskId" → the task's own page.
  if (n.refTable === 'project_tasks' && n.refId && String(n.refId).includes(':')) {
    const [projectId, taskId] = String(n.refId).split(':');
    if (projectId && taskId) {
      return `/tasks/${projectId}/${taskId}`;
    }
  }
  if (
    (n.type === 'task_assigned' || n.type === 'task_submitted' || n.type === 'task_update')
    && n.refTable === 'projects'
    && n.refId
  ) {
    return `/projects/${n.refId}?tab=overview`;
  }
  // Project-scoped notifications that belong on a specific tab, not the
  // project's default Overview — must be checked before the generic
  // refTable === 'projects' fallback further down swallows them.
  if (n.refTable === 'projects' && n.refId) {
    if (n.type === 'blog_submitted' || n.type === 'blog_approved' || n.type === 'blog_rejected') {
      return `/projects/${n.refId}?tab=blogs`;
    }
    if (n.type === 'content_rejected') return `/projects/${n.refId}?tab=content`;
    // The client-requirements approval queue — the approve/reject buttons and
    // the composed email both live on this tab.
    if (n.type?.startsWith('client_request_')) return `/projects/${n.refId}?tab=client-requests`;
  }
  if (n.type === 'appraisal_recorded' || n.refTable === 'appraisals') return '/self-service?tab=appraisals';
  if (n.type === 'leave_approved' || n.type === 'leave_rejected') return '/self-service?tab=leaves';
  if (n.type === 'document_issued' || n.type === 'document_rejected') return '/self-service?tab=documents';
  if (n.type === 'profile_rejected') return '/self-service?tab=profile';
  if (n.type === 'payroll_review') return '/self-service?tab=payroll';
  if (n.type === 'document_requested' && n.refTable === 'workers' && n.refId) {
    return `/hr/workers/${n.refId}?tab=documents`;
  }
  if (n.type === 'document_requested') return '/hr';
  if (!n.refTable || !n.refId) return null;
  if (n.refTable === 'projects')        return `/projects/${n.refId}`;
  if (n.refTable === 'invoices')        return `/invoices/${n.refId}`;
  if (n.refTable === 'payroll_runs')    return `/hr/payroll/${n.refId}`;
  if (n.refTable === 'leave_requests')  return '/hr?tab=leaves';
  if (n.refTable === 'self_service')    return '/self-service?tab=documents';
  if (n.refTable === 'workers')         return `/hr/workers/${n.refId}`;
  if (n.refTable === 'customer_documents') return `/documents/${n.refId}`;
  return null;
}

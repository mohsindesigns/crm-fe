import type { QueryClient } from '@tanstack/react-query';

/**
 * After a successful API mutation, mark related React Query caches stale and
 * refetch any that are currently on screen — so the UI updates without a
 * full page refresh.
 */
export async function invalidateMany(
  qc: QueryClient,
  keys: Array<readonly unknown[]>,
) {
  await Promise.all(
    keys.map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
}

/** Project stage advance / cancel / assignment changes. */
export function afterProjectChange(projectId?: string | null) {
  const keys: Array<readonly unknown[]> = [
    ['projects'],
    ['projects-by-stage'],
    ['waiting-on-me'],
    ['analytics-dashboard'],
    ['dashboard-my-projects'],
    ['dashboard-my-tasks-open'],
    ['dashboard-my-tasks-done'],
    ['my-tasks'],
    ['all-tasks'],
  ];
  if (projectId) {
    keys.push(
      ['project', projectId],
      ['project-timeline', projectId],
      ['project-tasks', projectId],
      ['stage-artifacts', projectId],
      ['all-artifacts', projectId],
    );
  }
  return keys;
}

/** Task create / complete / status transition. */
export function afterTaskChange(projectId?: string | null) {
  const keys: Array<readonly unknown[]> = [
    ['my-tasks'],
    ['all-tasks'],
    ['project-tasks'],
    ['dashboard-my-tasks-open'],
    ['dashboard-my-tasks-done'],
    ['waiting-on-me'],
  ];
  if (projectId) {
    // The Blogs tab mirrors blog_post tasks — the backend keeps the sheet row in
    // step on every transition and deliverable upload (services/BlogSheetSync.js),
    // so a task change acted on from anywhere must refetch it too, or the tab
    // still shows the pre-submit state until a hard reload.
    keys.push(['project', projectId], ['project-tasks', projectId], ['blog-sheet', projectId]);
  }
  return keys;
}

/** Invoice create / status / payment / package billing. */
export function afterInvoiceChange(invoiceId?: string | null, clientId?: string | null) {
  const keys: Array<readonly unknown[]> = [
    ['invoices'],
    ['invoices-summary'],
    ['analytics-dashboard'],
    ['business-overview'],
    ['clients'],
  ];
  if (invoiceId) keys.push(['invoice', invoiceId]);
  if (clientId) keys.push(['client', clientId], ['client-packages', clientId]);
  return keys;
}

/**
 * Personal invoice create / update / payment.
 *
 * Deliberately its own list, not a reuse of afterInvoiceChange — Personal
 * invoices live in a separate table with no effect on official revenue, so
 * there is nothing to invalidate there (analytics-dashboard, business-overview,
 * clients). Invalidating those anyway would just be a wasted refetch that
 * changes nothing, and blurs the point that these two systems are unrelated.
 */
export function afterPersonalInvoiceChange(invoiceId?: string | null, contactId?: string | null) {
  const keys: Array<readonly unknown[]> = [
    ['personal-invoices'],
    ['personal-invoices-by-contact'],
    ['personal-contacts'],
  ];
  if (invoiceId) keys.push(['personal-invoice', invoiceId]);
  if (contactId) keys.push(['personal-contact', contactId]);
  return keys;
}

/** Client create / update / sell package. */
export function afterClientChange(clientId?: string | null) {
  const keys: Array<readonly unknown[]> = [
    ['clients'],
    ['clients-all'],
    ['projects'],
    ['invoices'],
    ['invoices-summary'],
    ['retainers'],
    ['retainers-summary'],
    ['analytics-dashboard'],
    ['waiting-on-me'],
    ['dashboard-my-projects'],
  ];
  if (clientId) {
    keys.push(
      ['client', clientId],
      ['client-packages', clientId],
      ['sellable-packages', clientId],
      ['projects', { clientId }],
    );
  }
  return keys;
}

/** Quotation / agreement / proposal create / update / convert. */
export function afterDocumentChange(documentId?: string | null) {
  const keys: Array<readonly unknown[]> = [
    ['documents'],
    ['clients'],
    ['clients-all'],
    ['projects'],
    ['invoices'],
    ['invoices-summary'],
    ['retainers'],
    ['retainers-summary'],
    ['waiting-on-me'],
    ['analytics-dashboard'],
    ['dashboard-my-projects'],
  ];
  if (documentId) keys.push(['document', documentId]);
  return keys;
}

/** Lead status / assignment / conversion. */
export function afterLeadChange(leadId?: string | null) {
  const keys: Array<readonly unknown[]> = [
    ['leads'],
    ['clients'],
    ['clients-all'],
  ];
  if (leadId) keys.push(['lead', leadId]);
  return keys;
}

/** Lead form create / update / activate / deactivate. */
export function afterLeadFormChange(formId?: string | null) {
  const keys: Array<readonly unknown[]> = [['lead-forms']];
  if (formId) keys.push(['lead-form', formId]);
  return keys;
}

/** Retainer create / update. */
export function afterRetainerChange() {
  return [
    ['retainers'],
    ['retainers-summary'],
    ['invoices'],
    ['invoices-summary'],
    ['analytics-dashboard'],
  ] as Array<readonly unknown[]>;
}

/**
 * Maps project role slots → HR department names.
 * Used only for non-strict slots (e.g. project_manager stays open).
 * Specialist slots match the CRM role key exactly — no admin/dept fallbacks.
 */
const ROLE_SLOT_DEPARTMENTS: Record<string, string[]> = {
  project_manager: [], // empty = all departments (cross-functional)
  project_strategist: [], // empty = all departments — every project type gets one, not just SEO
  content_writer: ['SEO'],
  link_builder: ['SEO'],
  blog_writer: ['SEO'],
  web_developer: ['Website'],
  ui_designer: ['Website'],
  app_developer: ['Applications'],
  qa_engineer: ['Applications'],
  social_manager: ['Marketing'],
  ads_manager: ['Marketing'],
  account_manager: ['Marketing'],
};

/** These slots only list users whose CRM role.key equals the slot name. */
const STRICT_ROLE_SLOTS = new Set([
  'content_writer',
  'link_builder',
  'blog_writer',
  'web_developer',
  'ui_designer',
  'app_developer',
  'qa_engineer',
  'social_manager',
  'ads_manager',
  'account_manager',
]);

// Writing work on a project overlaps enough that either role should be
// assignable to either slot — a Content Writer can be handed the Blog Writer
// slot (and vice versa) instead of being limited to their exact role name.
const STRICT_SLOT_ROLE_ALIASES: Record<string, string[]> = {
  content_writer: ['content_writer', 'blog_writer'],
  blog_writer: ['content_writer', 'blog_writer'],
};

function norm(s?: string | null) {
  return String(s || '').trim().toLowerCase();
}

export function departmentsForRoleSlot(roleSlot: string): string[] | null {
  const key = String(roleSlot || '').trim();
  if (!(key in ROLE_SLOT_DEPARTMENTS)) return null; // unknown slot → no dept filter
  return ROLE_SLOT_DEPARTMENTS[key];
}

/** Users eligible for a project team slot dropdown. */
export function usersForRoleSlot(
  users: any[],
  roleSlot: string,
  currentUserId?: string | null,
): any[] {
  const slot = norm(roleSlot);
  const strict = STRICT_ROLE_SLOTS.has(slot);

  if (strict) {
    // Exact CRM role only — e.g. Content Writer slot lists Content Writers,
    // not Super Admins or everyone in the SEO department. A few slots (see
    // STRICT_SLOT_ROLE_ALIASES) accept more than one role in that exact match.
    const acceptedRoles = STRICT_SLOT_ROLE_ALIASES[slot] || [slot];
    return (users || []).filter((u) => {
      if (!u?.id) return false;
      if (currentUserId && u.id === currentUserId) return true;
      return acceptedRoles.includes(norm(u.role?.key));
    });
  }

  const depts = departmentsForRoleSlot(roleSlot);
  const allowed = depts?.map(norm) || [];
  const restrictByDept = Array.isArray(depts) && allowed.length > 0;

  return (users || []).filter((u) => {
    if (!u?.id) return false;
    if (currentUserId && u.id === currentUserId) return true;

    const roleKey = norm(u.role?.key);
    if (roleKey === 'super_admin' || roleKey === 'admin') return true;
    if (roleKey === slot) return true;

    if (!restrictByDept) return true; // project_manager / unknown → all

    const dept = norm(u.worker?.department);
    return !!dept && allowed.includes(dept);
  });
}

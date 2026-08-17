'use client';

import { useAuthStore } from '@/store/auth';
import { usePortalStore } from '@/store/portal';

// logoUrl defaults to the static /public/logo-file.png rather than null — every
// consumer of useBranding() (Sidebar, login pages, etc.) renders a plain
// letter-in-a-circle when logoUrl is falsy, so defaulting it here means the
// real logo shows everywhere out of the box, before any org has uploaded a
// custom one via Admin → Branding (which still overrides this via `source`).
import { BRAND } from '@/lib/brand';

const DEFAULTS = {
  brandName: 'Mohsin Designs Project Management',
  primaryColor: BRAND.primary,
  logoUrl: '/logo-file.png' as string | null,
};

export function useBranding() {
  const authBranding = useAuthStore((s) => s.branding);
  const portalBranding = usePortalStore((s) => s.branding);

  // Employee auth store takes priority; portal store is fallback for portal sessions
  const source = authBranding || portalBranding;

  return {
    brandName: source?.brandName || DEFAULTS.brandName,
    primaryColor: source?.primaryColor || DEFAULTS.primaryColor,
    logoUrl: source?.logoUrl || DEFAULTS.logoUrl,
  };
}

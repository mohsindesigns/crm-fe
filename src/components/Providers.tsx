'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Toaster } from 'sonner';
import { useBranding } from '@/hooks/useBranding';

function BrandingTitleSync() {
  const { brandName } = useBranding();
  const pathname = usePathname();

  useEffect(() => {
    const isPortal = pathname?.startsWith('/portal');
    const suffix = isPortal ? 'Client Portal' : 'Agency Operations Platform';
    document.title = `${brandName} — ${suffix}`;
  }, [brandName, pathname]);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Short enough that a missed invalidation recovers quickly; successful
            // mutations still call invalidateQueries so the active screen updates
            // immediately without waiting for this window.
            staleTime: 15 * 1000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingTitleSync />
      <Toaster richColors position="top-right" closeButton />
      {children}
    </QueryClientProvider>
  );
}

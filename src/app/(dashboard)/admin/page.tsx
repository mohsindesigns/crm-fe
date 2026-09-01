'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import {
  Palette, Settings, Workflow, Package, Shield, ScrollText, Building2, CreditCard,
  ClipboardCheck, Download,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import BrandingTab from '@/components/admin/BrandingTab';
import CompaniesTab from '@/components/admin/CompaniesTab';
import ServicesTab from '@/components/admin/ServicesTab';
import WorkflowsTab from '@/components/admin/WorkflowsTab';
import RolesTab from '@/components/admin/RolesTab';
import PackagesTab from '@/components/admin/PackagesTab';
import ClientReqBoilerplateTab from '@/components/admin/ClientReqBoilerplateTab';
import DocumentTemplatesTab from '@/components/admin/DocumentTemplatesTab';
import PaymentMethodsTab from '@/components/admin/PaymentMethodsTab';
import ExportDataTab from '@/components/admin/ExportDataTab';
import { cn } from '@/lib/utils';

type Tab = 'branding' | 'companies' | 'payments' | 'services' | 'workflows' | 'roles' | 'packages' | 'templates' | 'client-req-forms' | 'export';

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'branding',   label: 'Branding',   icon: Palette  },
  { key: 'companies',  label: 'Companies',  icon: Building2 },
  { key: 'payments',   label: 'Payments',   icon: CreditCard },
  { key: 'services',   label: 'Services',   icon: Settings },
  { key: 'workflows',  label: 'Workflows',  icon: Workflow },
  { key: 'roles',      label: 'Roles',      icon: Shield   },
  { key: 'packages',   label: 'Packages',   icon: Package  },
  { key: 'templates',  label: 'Document Templates', icon: ScrollText },
  { key: 'client-req-forms', label: 'Client Req Boilerplate', icon: ClipboardCheck },
  { key: 'export',     label: 'Export Data', icon: Download },
] as const;

const VALID_TABS = ['branding', 'companies', 'payments', 'services', 'workflows', 'roles', 'packages', 'templates', 'client-req-forms', 'export'] as const;

export default function AdminPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = rawTab && (VALID_TABS as readonly string[]).includes(rawTab) ? rawTab : 'branding';

  function setTab(key: Tab) {
    router.replace(`/admin?tab=${key}`, { scroll: false });
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Admin Panel" />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="space-y-6">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-fit overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 whitespace-nowrap',
                  tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'branding'  && <BrandingTab />}
          {tab === 'companies' && <CompaniesTab />}
          {tab === 'payments'  && <PaymentMethodsTab />}
          {tab === 'services'  && <ServicesTab />}
          {tab === 'workflows' && <WorkflowsTab />}
          {tab === 'roles'     && <RolesTab />}
          {tab === 'packages'  && <PackagesTab />}
          {tab === 'templates' && <DocumentTemplatesTab />}
          {tab === 'client-req-forms' && <ClientReqBoilerplateTab />}
          {tab === 'export'    && <ExportDataTab />}
        </div>
      </div>
    </div>
  );
}

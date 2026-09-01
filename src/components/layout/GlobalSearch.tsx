'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, FolderKanban, Users, ClipboardList, FileText, UserCircle, Target, ReceiptText } from 'lucide-react';
import api from '@/lib/api';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from '@/components/ui/command';

const GROUP_ICON: Record<string, any> = {
  clients: Users,
  projects: FolderKanban,
  tasks: ClipboardList,
  invoices: FileText,
  team: UserCircle,
  leads: Target,
  personalInvoices: ReceiptText,
  documents: FileText,
};

type SearchGroup = {
  type: string;
  label: string;
  items: { id: string; title: string; subtitle: string | null; href: string | null }[];
};

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), 250);
    return () => clearTimeout(t);
  }, [rawQuery]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) { setRawQuery(''); setQuery(''); }
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', query],
    queryFn: () => api.get('/search', { params: { q: query } }).then((r) => r.data),
    enabled: open && query.trim().length >= 2,
    placeholderData: (prev) => prev,
  });

  const groups: SearchGroup[] = data?.groups || [];

  function go(href: string | null) {
    if (!href) return;
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 w-full max-w-xs px-3 py-1.5 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-gray-500 transition-colors"
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left truncate">Search…</span>
        <kbd className="shrink-0 text-[10px] font-medium text-gray-400 bg-white border border-gray-200 rounded px-1.5 py-0.5">
          Ctrl K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        aria-label="Search"
      >
        <Search className="w-4.5 h-4.5" />
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search clients, projects, tasks, invoices, leads, documents and team"
      >
        <CommandInput
          placeholder="Search anything…"
          value={rawQuery}
          onValueChange={setRawQuery}
        />
        <CommandList>
          {query.trim().length < 2 ? (
            <CommandEmpty>Type at least 2 characters to search.</CommandEmpty>
          ) : isFetching && !data ? (
            <CommandEmpty>Searching…</CommandEmpty>
          ) : groups.length === 0 ? (
            <CommandEmpty>No results for &quot;{query}&quot;.</CommandEmpty>
          ) : (
            groups.map((g) => {
              const Icon = GROUP_ICON[g.type] || Search;
              return (
                <CommandGroup key={g.type} heading={g.label}>
                  {g.items.map((item) => (
                    <CommandItem
                      key={`${g.type}-${item.id}`}
                      value={`${g.type}-${item.id}-${item.title}`}
                      onSelect={() => go(item.href)}
                      className="cursor-pointer"
                    >
                      <Icon className="w-4 h-4" />
                      <span className="flex-1 min-w-0 truncate">{item.title}</span>
                      {item.subtitle && (
                        <span className="text-xs text-gray-400 truncate max-w-[40%]">{item.subtitle}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}

import { create } from 'zustand';

interface SidebarState {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  /** Desktop-only auto-collapse, driven by the current route (e.g. project
   *  detail collapses the nav to make room for its right-hand status panel) —
   *  distinct from `isOpen`, which is purely the mobile drawer's open state. */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** Manual override — the edge toggle button on the rail itself. Routes only
   *  ever set an initial value on mount (see the project detail page's effect);
   *  this is what lets the user reopen it on demand and have that stick for
   *  the rest of that page visit. */
  toggleCollapsed: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),
  collapsed: false,
  setCollapsed: (v) => set({ collapsed: v }),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
}));

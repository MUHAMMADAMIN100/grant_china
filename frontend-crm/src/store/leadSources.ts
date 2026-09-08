import { useEffect } from 'react';
import { create } from 'zustand';
import { LEAD_SOURCE_LABEL } from '../api/types';
import { createLeadSource, listLeadSources, updateLeadSource, type LeadSourceItem } from '../api/leadSources';

interface LeadSourcesState {
  items: LeadSourceItem[];
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  add: (label: string) => Promise<{ item: LeadSourceItem; created: boolean }>;
  update: (code: string, patch: { label?: string; hidden?: boolean }) => Promise<LeadSourceItem>;
}

/**
 * 08.09.2026 — справочник источников привлечения, общий для всех экранов.
 *
 * Свои источники живут в базе, а не в коде, поэтому подписи нужны везде,
 * где показывается `source`: список заявок, карточка, консультации,
 * аналитика. Стор грузится один раз за сессию и дописывает подписи в
 * LEAD_SOURCE_LABEL — так старая функция leadSourceLabel() из api/types
 * продолжает работать во всех местах без правок, включая те, где нет
 * доступа к хукам.
 */
export const useLeadSourcesStore = create<LeadSourcesState>((set, get) => ({
  items: [],
  loaded: false,
  loading: false,

  async load() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const items = await listLeadSources();
      for (const i of items) LEAD_SOURCE_LABEL[i.code] = i.label;
      set({ items, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  async add(label) {
    const res = await createLeadSource(label);
    LEAD_SOURCE_LABEL[res.item.code] = res.item.label;
    set((s) => ({ items: s.items.some((i) => i.code === res.item.code) ? s.items.map((i) => (i.code === res.item.code ? res.item : i)) : [...s.items, res.item] }));
    return res;
  },

  async update(code, patch) {
    const item = await updateLeadSource(code, patch);
    LEAD_SOURCE_LABEL[item.code] = item.label;
    set((s) => ({ items: s.items.map((i) => (i.code === code ? item : i)) }));
    return item;
  },
}));

/** Хук для экранов: подгружает справочник при первом использовании и отдаёт список. */
export function useLeadSources(): LeadSourceItem[] {
  const items = useLeadSourcesStore((s) => s.items);
  const loaded = useLeadSourcesStore((s) => s.loaded);
  const load = useLeadSourcesStore((s) => s.load);
  useEffect(() => {
    if (!loaded) load().catch(() => undefined);
  }, [loaded, load]);
  return items;
}

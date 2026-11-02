import type { SupabaseClient } from '@supabase/supabase-js';

/** A named set of questions a member saved to reload and export again ("Mock 1"). */
export interface SavedSelection {
  id: string;
  subject: string;
  name: string;
  questionIds: string[];
  updatedAt: string;
}

export interface SavedSelectionStore {
  list(): Promise<SavedSelection[]>;
  /** Saving under an existing name for the subject replaces that set. */
  save(subject: string, name: string, questionIds: string[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export const MAX_SAVED_QUESTIONS = 500;

/** Per account, through the member-checked functions in the saved_selections migration. */
export function supabaseSelections(client: SupabaseClient): SavedSelectionStore {
  return {
    async list() {
      const { data, error } = await client.rpc('list_saved_selections');
      if (error) throw error;
      return ((data ?? []) as { id: string; subject: string; name: string; question_ids: string[]; updated_at: string }[])
        .map((row) => ({ id: row.id, subject: row.subject, name: row.name, questionIds: row.question_ids, updatedAt: row.updated_at }));
    },
    async save(subject, name, questionIds) {
      const { error } = await client.rpc('save_selection', { subject, name, question_ids: questionIds.slice(0, MAX_SAVED_QUESTIONS) });
      if (error) throw error;
    },
    async remove(id) {
      const { error } = await client.rpc('delete_saved_selection', { selection_id: id });
      if (error) throw error;
    },
  };
}

/** Local development (no account): the same sets, kept in this browser only. */
export function browserSelections(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage()): SavedSelectionStore {
  const KEY = 'ibqf.savedSelections';
  const read = (): SavedSelection[] => {
    try { return JSON.parse(storage?.getItem(KEY) ?? '[]') as SavedSelection[]; } catch { return []; }
  };
  const write = (sets: SavedSelection[]) => { try { storage?.setItem(KEY, JSON.stringify(sets)); } catch { /* storage full or blocked */ } };
  return {
    async list() { return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async save(subject, name, questionIds) {
      const sets = read().filter((s) => !(s.subject === subject && s.name === name.trim()));
      sets.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, subject, name: name.trim(), questionIds: questionIds.slice(0, MAX_SAVED_QUESTIONS), updatedAt: new Date().toISOString() });
      write(sets);
    },
    async remove(id) { write(read().filter((s) => s.id !== id)); },
  };
}

function safeStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

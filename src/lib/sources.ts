import { createSourcesRepository } from './sources-repository';
import { withDeadline } from './capture-network';
import { getSupabase } from './supabase';
export { EMPTY_SOURCE, SOURCE_TYPES, suggestSource, validateSource, type SourceValues } from '../../supabase/functions/_shared/source-contract';
export type { NoteSource } from './sources-repository';
const repo = () => createSourcesRepository(getSupabase());
export const getNoteSource = (userId: string, noteId: string) => withDeadline(() => repo().get(userId, noteId), 15000);
export const saveNoteSource: ReturnType<typeof createSourcesRepository>['save'] = (...args) => withDeadline(() => repo().save(...args), 15000);

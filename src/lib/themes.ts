import { createThemesRepository, type ThemePeriod } from "./themes-repository";
import { getSupabase } from "./supabase";
import { withDeadline } from "./capture-network";
export type {
  ThemePeriod,
  ThemeSnapshot,
  ThemeMember,
  NoteTheme,
} from "./themes-repository";
export const readThemes = (period: ThemePeriod, signal?: AbortSignal) =>
  withDeadline(
    (inner) => createThemesRepository(getSupabase()).snapshot(period, inner),
    15000,
    signal,
  );
export const readThemeMembers = (
  id: string,
  period: ThemePeriod,
  offset = 0,
  signal?: AbortSignal,
) =>
  withDeadline(
    (inner) =>
      createThemesRepository(getSupabase()).members(id, period, offset, inner),
    15000,
    signal,
  );
export const changeTheme = (
  userId: string,
  id: string,
  change: { user_label?: string | null; dismissed?: boolean },
) =>
  withDeadline(
    () => createThemesRepository(getSupabase()).feedback(userId, id, change),
    15000,
  );
export async function requestThemes(
  options: { activate?: boolean; retry?: boolean; period?: ThemePeriod } = {},
) {
  return withDeadline(async (signal) => {
    const { data, error } = await getSupabase().functions.invoke(
      "note-themes",
      { body: options, signal, timeout: 20000 },
    );
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(
        detail?.error ?? "Themes could not be started. Your notes are safe.",
      );
    }
    return data as { status: string };
  }, 20000);
}

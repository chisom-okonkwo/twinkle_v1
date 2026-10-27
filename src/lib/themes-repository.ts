import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
export type ThemePeriod = "all" | "recent";
export type NoteTheme = {
  id: string;
  label: string;
  generated_label: string;
  description: string;
  note_count: number;
  first_at: string | null;
  last_at: string | null;
  unknown_dates: number;
  recurring: boolean;
  months: { month: string; note_count: number }[];
};
export type ThemeSnapshot = {
  status:
    | "disabled"
    | "not_started"
    | "processing"
    | "failed"
    | "paused"
    | "pending"
    | "ready";
  date_coverage?: {
    in_period: number;
    outside_period: number;
    unknown_date: number;
  };
  all_time_group_count?: number;
  total: number;
  checked: number;
  pending: number;
  indexed: number;
  scheduled: boolean;
  waiting: number;
  deferred: number;
  indexing: number;
  index_failed: number;
  validation_failed: number;
  validating: number;
  jobs_pending: number;
  unsupported: number;
  excluded: number;
  hidden_groups: number;
  budget_resume_at: string | null;
  no_candidates: number;
  ai_empty: number;
  invalid_output: number;
  suppressed: number;
  themes: NoteTheme[];
};
export type ThemeMember = {
  theme_id: string;
  note_id: string;
  quote: string;
  created_at: string | null;
  title: string;
  preview: string;
  capture_method: string;
};
export function createThemesRepository(client: SupabaseClient<Database>) {
  return {
    async snapshot(
      period: ThemePeriod,
      signal?: AbortSignal,
    ): Promise<ThemeSnapshot> {
      let query = client.rpc("note_theme_snapshot", { period });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !Array.isArray(data.themes) ||
        typeof data.status !== "string" ||
        typeof data.checked !== "number" ||
        typeof data.total !== "number"
      )
        throw new Error("Themes could not be read.");
      return data as ThemeSnapshot;
    },
    async members(
      themeId: string,
      period: ThemePeriod,
      offset = 0,
      signal?: AbortSignal,
    ): Promise<ThemeMember[]> {
      let query = client.rpc("read_note_theme_members", {
        target_id: themeId,
        period,
        page_offset: offset,
      });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      if (!Array.isArray(data))
        throw new Error("These thoughts could not be read.");
      return data as ThemeMember[];
    },
    async feedback(
      userId: string,
      themeId: string,
      change: { user_label?: string | null; dismissed?: boolean },
    ) {
      if (
        change.user_label !== undefined &&
        change.user_label !== null &&
        (!change.user_label.trim() ||
          Array.from(change.user_label).length > 80 ||
          /[\r\n\x00-\x1f]/.test(change.user_label))
      )
        throw new Error("Keep the name between 1 and 80 characters.");
      const { data, error } = await client
        .from("note_themes")
        .update(change)
        .eq("id", themeId)
        .eq("user_id", userId)
        .select("id")
        .single();
      if (error) throw error;
      if (!data) throw new Error("This group is no longer available.");
    },
  };
}

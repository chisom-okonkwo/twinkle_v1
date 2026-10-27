import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { Comparison } from "../../supabase/functions/_shared/reflection-contract";
export type ReflectionScope = "note" | "theme";
export type ReflectionSnapshot = {
  status:
    | "disabled"
    | "insufficient"
    | "not_started"
    | "processing"
    | "failed"
    | "completed";
  comparisons: Comparison[];
  notes: { id: string; title: string; captured_at: string }[];
  prompt: { id: string; question: string; quote: string } | null;
  can_prompt: boolean;
  prompt_status: string | null;
  responses: {
    id: string;
    question: string;
    created_at: string;
    title: string;
    preview: string;
  }[];
};
export function createReflectionsRepository(client: SupabaseClient<Database>) {
  return {
    async read(
      kind: ReflectionScope,
      targetId: string,
      signal?: AbortSignal,
    ): Promise<ReflectionSnapshot> {
      let query = client.rpc("read_reflection_experience", {
        kind,
        target_id: targetId,
      });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      if (
        !data || typeof data !== "object" || Array.isArray(data) ||
        !Array.isArray(data.comparisons) || !Array.isArray(data.notes) ||
        !Array.isArray(data.responses) || typeof data.status !== "string"
      ) throw new Error("These reflections could not be read.");
      return data as unknown as ReflectionSnapshot;
    },
    async answer(promptId: string, body: string) {
      if (!body.trim() || Array.from(body).length > 100000) {
        throw new Error("Write a response under 100,000 characters.");
      }
      const { data, error } = await client.rpc("answer_reflective_prompt", {
        prompt_id: promptId,
        body,
      });
      if (error) {
        throw new Error(
          "Your response could not be saved. Keep your text here and retry. The question may have changed.",
        );
      }
      return data!;
    },
    async dismiss(promptId: string) {
      const { error } = await client.rpc("dismiss_reflective_prompt", {
        prompt_id: promptId,
      });
      if (error) {
        throw new Error("This question could not be hidden. Please retry.");
      }
    },
    async origin(noteId: string) {
      const { data, error } = await client.from("note_reflections").select(
        "original_note_id,question,created_at",
      ).eq("response_note_id", noteId).maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}

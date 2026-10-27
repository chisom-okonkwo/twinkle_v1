import {
  createReflectionsRepository,
  type ReflectionScope,
} from "./reflections-repository";
import { getSupabase } from "./supabase";
import { withDeadline } from "./capture-network";
export type {
  ReflectionScope,
  ReflectionSnapshot,
} from "./reflections-repository";
const repo = () => createReflectionsRepository(getSupabase());
export const readReflections = (
  kind: ReflectionScope,
  id: string,
  signal?: AbortSignal,
) => withDeadline((inner) => repo().read(kind, id, inner), 15000, signal);
export const answerReflection = (id: string, body: string) =>
  withDeadline(() => repo().answer(id, body), 15000);
export const dismissReflection = (id: string) =>
  withDeadline(() => repo().dismiss(id), 15000);
export const reflectionOrigin = (id: string) =>
  withDeadline(() => repo().origin(id), 15000);
export async function requestReflection(
  kind: ReflectionScope | "prompt",
  targetId: string,
) {
  return withDeadline(async (signal) => {
    const { data, error } = await getSupabase().functions.invoke(
      "note-reflection",
      { body: { kind, targetId }, signal, timeout: 20000 },
    );
    if (error) {
      throw new Error(
        "Reflection could not be started. Your notes are safe. Please retry.",
      );
    }
    return data as { status: string };
  }, 20000);
}

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.118.0";
export const semanticAdmin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(12000),
          }),
      },
    },
  );
export async function semanticRpc(
  admin: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const r = await admin.rpc(name, args);
  if (r.error)
    throw Object.assign(new Error("persistence"), {
      operation: name,
      code: r.error.code,
    });
  return r.data;
}

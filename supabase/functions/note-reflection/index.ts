import { semanticAdmin, semanticRpc } from "../_shared/semantic-db.ts";
import { analyzeReflection } from "../_shared/reflection-ai.ts";
declare const EdgeRuntime: { waitUntil: (work: Promise<unknown>) => void };
const admin = semanticAdmin();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { ...cors, "Cache-Control": "no-store" },
  });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const bearer = req.headers.get("Authorization") ?? "";
    if (!bearer.startsWith("Bearer ")) {
      return reply({ error: "Sign in to continue." }, 401);
    }
    const auth = await admin.auth.getUser(bearer.slice(7));
    if (auth.error || !auth.data.user) {
      return reply({ error: "Sign in again." }, 401);
    }
    const raw = await req.text();
    if (raw.length > 512) return reply({ error: "Request too large." }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({ error: "Invalid request." }, 400);
    }
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((k) => !["kind", "targetId"].includes(k)) ||
      !["note", "theme", "prompt"].includes(body.kind) ||
      typeof body.targetId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.targetId,
      )
    ) return reply({ error: "Invalid request." }, 400);
    const args = {
      caller_id: auth.data.user.id,
      kind: body.kind,
      target_id: body.targetId,
    };
    const claim = await semanticRpc(admin, "claim_reflection_analysis", args);
    if (claim.status === "claimed") {
      EdgeRuntime.waitUntil((async () => {
        try {
          const result = await analyzeReflection(
            claim.notes,
            body.kind,
            body.targetId,
            {
              key: Deno.env.get("OPENAI_API_KEY") ?? "",
              model: Deno.env.get("OPENAI_REFLECTION_MODEL") ??
                Deno.env.get("OPENAI_THEME_MODEL") ??
                Deno.env.get("OPENAI_CONTEXT_MODEL") ?? "gpt-6-luna",
            },
          );
          await semanticRpc(admin, "finish_reflection_analysis", {
            ...args,
            claim_token: claim.token,
            expected_hash: claim.hash,
            result,
          });
        } catch {
          // Never log note content, generated statements, responses, or keys.
          await semanticRpc(admin, "fail_reflection_analysis", {
            ...args,
            claim_token: claim.token,
          }).catch(() => {});
        }
      })());
    }
    return reply({
      status: claim.status === "claimed" ? "processing" : claim.status,
    }, claim.status === "claimed" ? 202 : 200);
  } catch {
    return reply(
      { error: "Reflection is unavailable. Your notes are safe." },
      503,
    );
  }
});

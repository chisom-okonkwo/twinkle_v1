import {
  semanticAdmin,
  semanticRpc,
  processSemanticRun,
} from "./semantic-worker.ts";
declare const EdgeRuntime: { waitUntil: (work: Promise<unknown>) => void };
const admin = semanticAdmin();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { ...cors, "Cache-Control": "no-store" },
  });
export async function semanticRequest(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const bearer = req.headers.get("Authorization") ?? "";
    if (!bearer.startsWith("Bearer "))
      return reply({ error: "Sign in to continue." }, 401);
    const auth = await admin.auth.getUser(bearer.slice(7));
    if (auth.error || !auth.data.user)
      return reply({ error: "Sign in again." }, 401);
    const raw = await req.text();
    if (raw.length > 1024) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) =>
          ![
            "activate",
            "retry",
            "period",
            "range_start",
            "range_end",
            "timezone",
          ].includes(k),
      ) ||
      (body.activate !== undefined && typeof body.activate !== "boolean") ||
      (body.retry !== undefined && typeof body.retry !== "boolean")
    )
      return reply({ error: "Invalid request." }, 400);
    if (
      body.period !== undefined &&
      !["all", "recent", "custom"].includes(body.period)
    )
      return reply({ error: "Invalid period." }, 400);
    if (
      body.period === "custom" &&
      (!["range_start", "range_end"].every(
        (k) =>
          typeof body[k] === "string" &&
          /^\d{4}-\d\d-\d\dT/.test(body[k]) &&
          Number.isFinite(Date.parse(body[k])),
      ) ||
        Date.parse(body.range_start) >= Date.parse(body.range_end))
    )
      return reply({ error: "Invalid date range." }, 400);
    if (
      body.timezone !== undefined &&
      (typeof body.timezone !== "string" || body.timezone.length > 80)
    )
      return reply({ error: "Invalid time zone." }, 400);
    const userId = auth.data.user.id;
    if (body.activate)
      await semanticRpc(admin, "activate_semantic_history", {
        caller_id: userId,
      });
    const scope = await semanticRpc(admin, "prepare_semantic_scope", {
      caller_id: userId,
      period: body.period ?? "all",
      range_start: body.range_start ?? null,
      range_end: body.range_end ?? null,
      zone: body.timezone ?? null,
    });
    if (body.retry)
      await semanticRpc(admin, "retry_semantic_groups", { caller_id: userId });
    await semanticRpc(admin, "request_semantic_work", {
      caller_id: userId,
      scope: scope.key,
      retry: body.retry === true,
    });
    const claim = await semanticRpc(admin, "claim_semantic_run", {
      caller_id: userId,
      retry: body.retry === true,
    });
    if (claim.status === "claimed")
      EdgeRuntime.waitUntil(
        processSemanticRun(admin, userId, claim.token, scope.key),
      );
    return reply(
      { status: claim.status === "claimed" ? "processing" : claim.status },
      claim.status === "claimed" ? 202 : 200,
    );
  } catch {
    return reply(
      { error: "Indexing is unavailable. Your notes are safe." },
      409,
    );
  }
}

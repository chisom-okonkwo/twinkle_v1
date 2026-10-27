import {
  semanticAdmin,
  semanticRpc,
  processSemanticRun,
} from "../_shared/semantic-worker.ts";
declare const EdgeRuntime: { waitUntil: (work: Promise<unknown>) => void };
const admin = semanticAdmin();
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    const secret = req.headers.get("x-semantic-secret");
    if (
      !secret ||
      secret.length !== 64 ||
      !(await semanticRpc(admin, "authorize_semantic_worker", { secret }))
    )
      return new Response(null, { status: 401 });
    const tasks = (await semanticRpc(admin, "semantic_backlog", {})) as {
      user_id: string;
      scope: string;
    }[];
    EdgeRuntime.waitUntil(
      Promise.all(
        tasks.map(async (task) => {
          const claim = await semanticRpc(admin, "claim_semantic_run", {
            caller_id: task.user_id,
          });
          if (claim.status === "claimed")
            await processSemanticRun(
              admin,
              task.user_id,
              claim.token,
              task.scope,
            );
        }),
      ).catch(() => {}),
    );
    return Response.json(
      { accepted: tasks.length },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Processing is unavailable." },
      { status: 503 },
    );
  }
});

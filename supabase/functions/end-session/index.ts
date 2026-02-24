import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { z } from "https://esm.sh/zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EndSessionSchema = z.object({
  session_id: z
    .string({ required_error: "session_id is required" })
    .regex(uuidRegex, "session_id must be a valid UUID"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const parsed = EndSessionSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      return json({ error: message }, 400);
    }

    const { session_id } = parsed.data;

    // Update session - RLS ensures user can only update own sessions
    const { data, error } = await supabaseUser
      .from("sessions")
      .update({
        status: "ended" as const,
        ended_at: new Date().toISOString(),
      })
      .eq("id", session_id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      return json({ error: "Failed to end session: " + error.message }, 500);
    }

    return json({
      session_id: data.id,
      status: data.status,
      ended_at: data.ended_at,
    });
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
});

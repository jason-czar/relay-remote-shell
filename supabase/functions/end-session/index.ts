import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

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
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const { session_id } = await req.json();

    if (!session_id || typeof session_id !== "string") {
      return json({ error: "session_id is required" }, 400);
    }

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

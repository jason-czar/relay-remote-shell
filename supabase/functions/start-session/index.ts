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

  // Validate JWT
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

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
    const { device_id } = await req.json();

    if (!device_id || typeof device_id !== "string" || device_id.length > 36) {
      return json({ error: "Valid device_id is required" }, 400);
    }

    // Basic UUID format check
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(device_id)) {
      return json({ error: "Invalid device_id format" }, 400);
    }

    // Verify device exists and user has access
    const { data: device, error: devErr } = await supabaseUser
      .from("devices")
      .select("*")
      .eq("id", device_id)
      .single();

    if (devErr || !device) {
      return json({ error: "Device not found or access denied" }, 404);
    }

    // Create session using admin client (bypasses RLS for insert)
    const { data: session, error: sesErr } = await supabaseAdmin
      .from("sessions")
      .insert({
        device_id,
        user_id: user.id,
        status: "active",
      })
      .select()
      .single();

    if (sesErr) {
      return json({ error: "Failed to create session: " + sesErr.message }, 500);
    }

    return json({
      session_id: session.id,
      device_id: session.device_id,
      status: session.status,
      started_at: session.started_at,
    });
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
});

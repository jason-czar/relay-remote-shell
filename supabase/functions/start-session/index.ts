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

const StartSessionSchema = z.object({
  device_id: z
    .string({ required_error: "device_id is required" })
    .regex(uuidRegex, "device_id must be a valid UUID"),
});

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
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const parsed = StartSessionSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      return json({ error: message }, 400);
    }

    const { device_id } = parsed.data;

    // Verify device exists using admin client, then check access via RLS function
    const { data: device, error: devErr } = await supabaseAdmin
      .from("devices")
      .select("*")
      .eq("id", device_id)
      .single();

    if (devErr || !device) {
      console.error("[start-session] Device lookup failed", {
        device_id,
        user_id: user.id,
        error: devErr?.message ?? "not found",
      });
      return json({ error: "Device not found or access denied" }, 404);
    }

    // Verify the user has access to this device via RLS function
    const { data: hasAccess, error: rpcErr } = await supabaseUser
      .rpc("is_device_in_user_project", { _device_id: device_id });

    // Also allow direct ownership
    const isOwner = device.user_id === user.id;

    if (!hasAccess && !isOwner) {
      console.error("[start-session] Access denied", {
        device_id,
        user_id: user.id,
        device_owner: device.user_id,
        project_id: device.project_id,
        hasAccess,
        rpc_error: rpcErr?.message ?? null,
      });
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
      console.error("[start-session] Session insert failed", {
        device_id,
        user_id: user.id,
        error: sesErr.message,
      });
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

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

  try {
    const { pairing_code, name } = await req.json();

    if (!pairing_code || typeof pairing_code !== "string" || pairing_code.length > 20) {
      return json({ error: "Valid pairing_code is required" }, 400);
    }

    if (name && (typeof name !== "string" || name.length > 100)) {
      return json({ error: "Device name must be under 100 characters" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find device by pairing code
    const { data: device, error: findErr } = await supabase
      .from("devices")
      .select("*")
      .eq("pairing_code", pairing_code.trim().toUpperCase())
      .eq("paired", false)
      .single();

    if (findErr || !device) {
      return json({ error: "Invalid or expired pairing code" }, 404);
    }

    // Generate a device token
    const token = crypto.randomUUID() + "-" + crypto.randomUUID();

    // Update device: mark paired, set token, set online, clear pairing code
    const { error: updateErr } = await supabase
      .from("devices")
      .update({
        paired: true,
        device_token: token,
        status: "online",
        last_seen: new Date().toISOString(),
        pairing_code: null,
        name: name && typeof name === "string" ? name : device.name,
      })
      .eq("id", device.id);

    if (updateErr) {
      return json({ error: "Failed to pair device" }, 500);
    }

    // Construct relay URL (placeholder — replace with your actual relay)
    const relayUrl = `wss://${Deno.env.get("SUPABASE_URL")?.replace("https://", "")}/connect`;

    return json({
      device_id: device.id,
      token,
      relay_url: relayUrl,
    });
  } catch (e) {
    return json({ error: "Invalid request body" }, 400);
  }
});

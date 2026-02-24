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

const PairDeviceSchema = z.object({
  pairing_code: z
    .string({ required_error: "pairing_code is required" })
    .min(1, "pairing_code cannot be empty")
    .max(20, "pairing_code must be 20 characters or fewer")
    .regex(/^[A-Za-z0-9]+$/, "pairing_code must be alphanumeric"),
  name: z
    .string()
    .max(100, "Device name must be under 100 characters")
    .regex(/^[^<>]*$/, "Device name contains invalid characters")
    .optional()
    .nullable(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const parsed = PairDeviceSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      return json({ error: message }, 400);
    }

    const { pairing_code, name } = parsed.data;

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

    // Use configured relay URL
    const relayUrl = Deno.env.get("RELAY_URL");
    if (!relayUrl) {
      return json({ error: "Relay server not configured" }, 500);
    }

    return json({
      device_id: device.id,
      token,
      relay_url: relayUrl,
    });
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
});

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

const InviteMemberSchema = z.object({
  email: z
    .string({ required_error: "email is required" })
    .email("Invalid email address")
    .max(255, "Email must be under 255 characters")
    .transform((v) => v.toLowerCase().trim()),
  project_id: z
    .string({ required_error: "project_id is required" })
    .regex(uuidRegex, "project_id must be a valid UUID"),
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const parsed = InviteMemberSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      return json({ error: message }, 400);
    }

    const { email, project_id } = parsed.data;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is project owner
    const { data: membership } = await adminClient
      .from("project_members")
      .select("role")
      .eq("project_id", project_id)
      .eq("user_id", user.id)
      .single();

    if (membership?.role !== "owner") {
      return json({ error: "Only project owners can invite members" }, 403);
    }

    // Check if user already a member
    const { data: existingUser } = await adminClient.auth.admin.listUsers();
    const targetUser = existingUser?.users?.find(
      (u) => u.email?.toLowerCase() === email
    );

    if (targetUser) {
      // Check if already a member
      const { data: existingMember } = await adminClient
        .from("project_members")
        .select("id")
        .eq("project_id", project_id)
        .eq("user_id", targetUser.id)
        .single();

      if (existingMember) {
        return json({ error: "User is already a member of this project" }, 409);
      }

      // Add directly as member
      const { error: insertError } = await adminClient
        .from("project_members")
        .insert({
          project_id,
          user_id: targetUser.id,
          role: "member",
          invited_by: user.id,
        });

      if (insertError) {
        return json({ error: insertError.message }, 500);
      }

      // Also create an accepted invitation record
      await adminClient.from("invitations").insert({
        project_id,
        email,
        invited_by: user.id,
        status: "accepted",
      });

      return json({ status: "added", message: "User added to project" });
    }

    // User doesn't exist yet — create pending invitation
    const { error: inviteError } = await adminClient.from("invitations").insert({
      project_id,
      email,
      invited_by: user.id,
      status: "pending",
    });

    if (inviteError) {
      if (inviteError.code === "23505") {
        return json({ error: "Invitation already sent to this email" }, 409);
      }
      return json({ error: inviteError.message }, 500);
    }

    return json({ status: "invited", message: "Invitation created. User will be added when they sign up." });
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
});

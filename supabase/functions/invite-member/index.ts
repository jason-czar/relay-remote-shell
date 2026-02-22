import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, project_id } = await req.json();

    if (!email || !project_id) {
      return new Response(JSON.stringify({ error: "email and project_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is project owner
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: membership } = await adminClient
      .from("project_members")
      .select("role")
      .eq("project_id", project_id)
      .eq("user_id", user.id)
      .single();

    if (membership?.role !== "owner") {
      return new Response(JSON.stringify({ error: "Only project owners can invite members" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user already a member
    const { data: existingUser } = await adminClient.auth.admin.listUsers();
    const targetUser = existingUser?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
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
        return new Response(JSON.stringify({ error: "User is already a member of this project" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Also create an accepted invitation record
      await adminClient.from("invitations").insert({
        project_id,
        email: email.toLowerCase(),
        invited_by: user.id,
        status: "accepted",
      });

      return new Response(JSON.stringify({ status: "added", message: "User added to project" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User doesn't exist yet — create pending invitation
    const { error: inviteError } = await adminClient.from("invitations").insert({
      project_id,
      email: email.toLowerCase(),
      invited_by: user.id,
      status: "pending",
    });

    if (inviteError) {
      if (inviteError.code === "23505") {
        return new Response(JSON.stringify({ error: "Invitation already sent to this email" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "invited", message: "Invitation created. User will be added when they sign up." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

type ProjectRole = Database["public"]["Enums"]["project_role"];

export function useProjectRole(projectId: string | undefined) {
  const { user } = useAuth();
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !projectId) {
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      const { data } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .single();

      setRole(data?.role ?? null);
      setLoading(false);
    };

    fetchRole();
  }, [user, projectId]);

  return { role, isOwner: role === "owner", isMember: role !== null, loading };
}

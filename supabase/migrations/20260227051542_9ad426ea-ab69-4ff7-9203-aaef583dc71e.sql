
-- Make project_id nullable on devices (devices can exist without a project)
ALTER TABLE public.devices ALTER COLUMN project_id DROP NOT NULL;

-- Add user_id column for direct ownership when no project is used
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS user_id uuid;

-- Drop old RLS policies that required project membership
DROP POLICY IF EXISTS "Members can view devices" ON public.devices;
DROP POLICY IF EXISTS "Owners can add devices" ON public.devices;
DROP POLICY IF EXISTS "Owners can delete devices" ON public.devices;
DROP POLICY IF EXISTS "Owners can update devices" ON public.devices;

-- New policies: device visible if user owns it directly OR is a project member
CREATE POLICY "Users can view their devices"
ON public.devices FOR SELECT
USING (
  (user_id = auth.uid()) OR
  (project_id IS NOT NULL AND is_project_member(project_id))
);

CREATE POLICY "Users can add devices"
ON public.devices FOR INSERT
WITH CHECK (
  (user_id = auth.uid() AND project_id IS NULL) OR
  (project_id IS NOT NULL AND is_project_owner(project_id))
);

CREATE POLICY "Users can delete their devices"
ON public.devices FOR DELETE
USING (
  (user_id = auth.uid()) OR
  (project_id IS NOT NULL AND is_project_owner(project_id))
);

CREATE POLICY "Users can update their devices"
ON public.devices FOR UPDATE
USING (
  (user_id = auth.uid()) OR
  (project_id IS NOT NULL AND is_project_owner(project_id))
);

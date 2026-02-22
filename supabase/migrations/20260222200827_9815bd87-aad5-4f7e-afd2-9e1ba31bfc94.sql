
-- Invitations table for pending team invites
CREATE TABLE public.invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: one pending invite per email per project
CREATE UNIQUE INDEX idx_invitations_unique_pending 
  ON public.invitations (project_id, email) 
  WHERE status = 'pending';

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Project members can view invitations for their projects
CREATE POLICY "Members can view invitations"
  ON public.invitations FOR SELECT
  USING (public.is_project_member(project_id));

-- Owners can create invitations
CREATE POLICY "Owners can create invitations"
  ON public.invitations FOR INSERT
  WITH CHECK (public.is_project_owner(project_id) AND invited_by = auth.uid());

-- Owners can delete invitations
CREATE POLICY "Owners can delete invitations"
  ON public.invitations FOR DELETE
  USING (public.is_project_owner(project_id));

-- Owners can update invitations
CREATE POLICY "Owners can update invitations"
  ON public.invitations FOR UPDATE
  USING (public.is_project_owner(project_id));

-- Function to auto-accept pending invitations when a user signs up
CREATE OR REPLACE FUNCTION public.accept_pending_invitations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  FOR inv IN
    SELECT id, project_id FROM public.invitations
    WHERE email = NEW.email AND status = 'pending'
  LOOP
    INSERT INTO public.project_members (project_id, user_id, role, invited_by)
    VALUES (inv.project_id, NEW.id, 'member', NULL)
    ON CONFLICT DO NOTHING;

    UPDATE public.invitations SET status = 'accepted' WHERE id = inv.id;
  END LOOP;
  RETURN NEW;
END;
$$;

-- Trigger on auth.users to accept invitations on signup
CREATE TRIGGER on_user_created_accept_invitations
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.accept_pending_invitations();


-- 1. Add RLS policies to rate_limit_pairing (used by edge functions with service role)
-- Deny all direct access from anon/authenticated users; only service role can interact
CREATE POLICY "Deny select for users"
  ON public.rate_limit_pairing FOR SELECT
  USING (false);

CREATE POLICY "Deny insert for users"
  ON public.rate_limit_pairing FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny update for users"
  ON public.rate_limit_pairing FOR UPDATE
  USING (false);

CREATE POLICY "Deny delete for users"
  ON public.rate_limit_pairing FOR DELETE
  USING (false);

-- 2. Tighten session_recordings INSERT policy: only allow inserts for sessions owned by the user
DROP POLICY "Service role can insert recordings" ON public.session_recordings;

CREATE POLICY "Users can insert recordings for their sessions"
  ON public.session_recordings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.id = session_recordings.session_id
        AND s.user_id = auth.uid()
    )
  );

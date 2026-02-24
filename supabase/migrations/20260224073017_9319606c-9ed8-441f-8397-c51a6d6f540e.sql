
-- Create session_recordings table to store terminal playback data
CREATE TABLE public.session_recordings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  frames JSONB NOT NULL DEFAULT '[]'::jsonb,
  frame_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: one recording per session
CREATE UNIQUE INDEX idx_session_recordings_session_id ON public.session_recordings(session_id);

-- Enable RLS
ALTER TABLE public.session_recordings ENABLE ROW LEVEL SECURITY;

-- Users can view recordings for sessions they own or are in their project
CREATE POLICY "Users can view recordings for their sessions"
ON public.session_recordings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = session_id
    AND (s.user_id = auth.uid() OR is_device_in_user_project(s.device_id))
  )
);

-- Only service role inserts (from relay server), no user inserts needed
-- But allow for edge function inserts with service role
CREATE POLICY "Service role can insert recordings"
ON public.session_recordings
FOR INSERT
WITH CHECK (true);

-- Users can delete their own session recordings
CREATE POLICY "Users can delete their own recordings"
ON public.session_recordings
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = session_id AND s.user_id = auth.uid()
  )
);

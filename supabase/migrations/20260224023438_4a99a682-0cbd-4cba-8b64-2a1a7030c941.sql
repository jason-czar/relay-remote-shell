
-- Table to persist relay skill configurations per user
CREATE TABLE public.skill_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  skill_slug TEXT NOT NULL DEFAULT 'remote-relay',
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_slug)
);

-- Enable RLS
ALTER TABLE public.skill_configs ENABLE ROW LEVEL SECURITY;

-- Users can only access their own configs
CREATE POLICY "Users can view their own skill configs"
  ON public.skill_configs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own skill configs"
  ON public.skill_configs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own skill configs"
  ON public.skill_configs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own skill configs"
  ON public.skill_configs FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update timestamp
CREATE TRIGGER update_skill_configs_updated_at
  BEFORE UPDATE ON public.skill_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

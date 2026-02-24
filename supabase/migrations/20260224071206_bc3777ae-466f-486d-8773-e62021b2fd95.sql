
-- Rate limiting table for tracking pairing attempts
CREATE TABLE public.rate_limit_pairing (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address text NOT NULL,
  attempted_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for efficient lookups by IP + time window
CREATE INDEX idx_rate_limit_pairing_ip_time ON public.rate_limit_pairing (ip_address, created_at DESC);

-- RLS: no public access, only service role
ALTER TABLE public.rate_limit_pairing ENABLE ROW LEVEL SECURITY;

-- Auto-cleanup: delete entries older than 1 hour via a cron-like approach
-- We'll do cleanup in the edge function itself for simplicity

-- No RLS policies = only service_role can access (which is what we want)

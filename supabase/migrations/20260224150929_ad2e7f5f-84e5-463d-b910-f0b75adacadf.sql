-- Add workdir column to devices table
ALTER TABLE public.devices ADD COLUMN workdir text DEFAULT NULL;

COMMENT ON COLUMN public.devices.workdir IS 'Default working directory for terminal sessions on this device';
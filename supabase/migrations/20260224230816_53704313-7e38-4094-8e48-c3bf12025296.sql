-- Update default skill_slug from 'private-bridge' to 'privaclaw'
ALTER TABLE public.skill_configs ALTER COLUMN skill_slug SET DEFAULT 'privaclaw';

-- Update existing rows
UPDATE public.skill_configs SET skill_slug = 'privaclaw' WHERE skill_slug = 'private-bridge';
UPDATE public.skill_configs SET skill_slug = 'privaclaw' WHERE skill_slug = 'remote-relay';
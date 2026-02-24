
-- Drop existing unique constraint on (user_id, skill_slug)
ALTER TABLE public.skill_configs DROP CONSTRAINT IF EXISTS skill_configs_user_id_skill_slug_key;

-- Add a node_id column to distinguish configs per node
ALTER TABLE public.skill_configs ADD COLUMN node_id TEXT NOT NULL DEFAULT 'default';

-- Add a display name for the node config
ALTER TABLE public.skill_configs ADD COLUMN name TEXT NOT NULL DEFAULT 'My Node';

-- New unique constraint: one config per user per skill per node
ALTER TABLE public.skill_configs ADD CONSTRAINT skill_configs_user_skill_node_key UNIQUE (user_id, skill_slug, node_id);

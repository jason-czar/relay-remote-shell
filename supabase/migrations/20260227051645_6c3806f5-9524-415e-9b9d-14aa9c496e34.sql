
-- Update is_device_in_user_project to also return true for directly-owned devices
CREATE OR REPLACE FUNCTION public.is_device_in_user_project(_device_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.devices d
    LEFT JOIN public.project_members pm ON pm.project_id = d.project_id
    WHERE d.id = _device_id
      AND (
        d.user_id = auth.uid()
        OR (pm.user_id = auth.uid())
      )
  )
$function$;

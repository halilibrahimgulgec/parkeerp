-- Add DELETE policy to production_entries to allow admins and field managers to delete entries
DROP POLICY IF EXISTS "Admins can delete production entries" ON public.production_entries;
CREATE POLICY "Admins can delete production entries" 
  ON public.production_entries FOR DELETE TO authenticated 
  USING (get_user_role() IN ('admin', 'field_manager'));

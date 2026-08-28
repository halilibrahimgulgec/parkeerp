-- Add DELETE policy to shipments to allow admins and weighbridge users to delete shipments
DROP POLICY IF EXISTS "Weighbridge and admins can delete shipments" ON public.shipments;
CREATE POLICY "Weighbridge and admins can delete shipments" 
  ON public.shipments FOR DELETE TO authenticated 
  USING (get_user_role() IN ('admin', 'weighbridge'));

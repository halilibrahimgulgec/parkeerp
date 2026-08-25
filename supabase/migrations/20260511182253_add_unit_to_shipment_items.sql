/*
  # Add unit column to shipment_items

  Adds a `unit` column (m2, adet, metre) to the shipment_items table
  so each line item can track its own unit of measure.

  Default is 'm2' to preserve existing data.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shipment_items' AND column_name = 'unit'
  ) THEN
    ALTER TABLE shipment_items ADD COLUMN unit text NOT NULL DEFAULT 'm2';
  END IF;
END $$;

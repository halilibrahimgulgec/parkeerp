-- ================================================================
-- ÇOK FİRMALI DİNAMİK MAKİNE YÖNETİMİ MİGRASYONU
-- ================================================================
-- 1. machine_definitions tablosunda her firmanın kendi makine numaralarını
--    (1, 2, 3...) bağımsız olarak kullanabilmesi için birincil anahtarı (company_id, machine_no) yapar.
-- 2. Geçmiş tablolarla (production_plan_items) olan bağımlılıkları güvenle günceller.
-- ================================================================

DO $$
BEGIN
  -- 1. Varsa production_plan_items fkey kısıtını kaldır (bağımsız makine numaralandırma için)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'production_plan_items_machine_no_fkey'
  ) THEN
    ALTER TABLE public.production_plan_items DROP CONSTRAINT production_plan_items_machine_no_fkey;
  END IF;

  -- 2. company_id'si boş olan eski kayıtları ilk aktif firmaya ata
  UPDATE public.machine_definitions 
  SET company_id = (SELECT id FROM public.companies WHERE is_active = true ORDER BY created_at ASC LIMIT 1)
  WHERE company_id IS NULL;

  -- 3. Eski tekil primary key kısıtını kaldır ve (company_id, machine_no) bileşik anahtar yap
  -- Not: Eğer machine_definitions_pkey mevcutsa yeniden yapılandır
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'machine_definitions_pkey' AND conrelid = 'public.machine_definitions'::regclass
  ) THEN
    ALTER TABLE public.machine_definitions DROP CONSTRAINT machine_definitions_pkey CASCADE;
    ALTER TABLE public.machine_definitions ADD CONSTRAINT machine_definitions_pkey PRIMARY KEY (company_id, machine_no);
  END IF;

END $$;

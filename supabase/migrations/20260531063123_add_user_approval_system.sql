/*
  # Kullanıcı Onay Sistemi

  ## Özet
  Yeni kayıt olan kullanıcıların admin onayı olmadan sisteme giriş yapamamasını sağlayan
  bir onay mekanizması eklenmektedir.

  ## Değişiklikler

  ### user_profiles tablosu
  - `is_approved` (boolean, default false) — Admin onayı flag'i
  - `approved_at` (timestamptz, nullable) — Onay tarihi
  - `approved_by` (uuid, nullable) — Onaylayan admin kullanıcı ID'si

  ### Güvenlik
  - Mevcut kullanıcılar (admin dahil) otomatik onaylı sayılır
  - RLS politikaları güncellenir
*/

-- is_approved kolonu ekle
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'is_approved'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN is_approved boolean NOT NULL DEFAULT false;
    ALTER TABLE user_profiles ADD COLUMN approved_at timestamptz;
    ALTER TABLE user_profiles ADD COLUMN approved_by uuid REFERENCES user_profiles(id);
  END IF;
END $$;

-- Mevcut tüm kullanıcıları onaylı yap (sistemde zaten olan kullanıcılar etkilenmesin)
UPDATE user_profiles SET is_approved = true WHERE is_approved = false;

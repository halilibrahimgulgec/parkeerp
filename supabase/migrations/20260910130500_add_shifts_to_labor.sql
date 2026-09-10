-- Add 2-shift system (Gündüz / Gece) to employees and attendance_records

ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS default_shift text NOT NULL DEFAULT 'Gündüz';

ALTER TABLE public.attendance_records 
ADD COLUMN IF NOT EXISTS shift text NOT NULL DEFAULT 'Gündüz';

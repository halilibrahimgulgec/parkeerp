-- Create Labor, Attendance, Overtime, and Payroll Schema

-- 1. Employees Table
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  role_title text NOT NULL DEFAULT 'İşçi',
  phone text DEFAULT '',
  tc_no text DEFAULT '',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  wage_type text NOT NULL DEFAULT 'monthly' CHECK (wage_type IN ('monthly', 'daily')),
  base_wage numeric NOT NULL DEFAULT 0,
  overtime_multiplier numeric NOT NULL DEFAULT 1.5,
  monthly_hours_divisor numeric NOT NULL DEFAULT 225,
  iban text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Attendance Records Table (Puantaj)
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL DEFAULT 'full_day' CHECK (status IN ('full_day', 'half_day', 'leave', 'absent', 'holiday')),
  overtime_hours numeric NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  overtime_multiplier numeric DEFAULT 1.5,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_employee_date UNIQUE (employee_id, date)
);

-- 3. Payroll Transactions Table (Avans, Prim, Kesinti)
CREATE TABLE IF NOT EXISTS public.payroll_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  type text NOT NULL CHECK (type IN ('advance', 'bonus', 'deduction')),
  amount numeric NOT NULL CHECK (amount >= 0),
  description text NOT NULL DEFAULT '',
  period_month integer NOT NULL DEFAULT EXTRACT(MONTH FROM CURRENT_DATE)::integer,
  period_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::integer,
  created_at timestamptz DEFAULT now()
);

-- 4. Payroll Payments Table (Aylık Tahakkuk ve Ödeme Durumu)
CREATE TABLE IF NOT EXISTS public.payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_month integer NOT NULL,
  period_year integer NOT NULL,
  base_salary numeric NOT NULL DEFAULT 0,
  days_worked numeric NOT NULL DEFAULT 0,
  earned_base_wage numeric NOT NULL DEFAULT 0,
  overtime_hours numeric NOT NULL DEFAULT 0,
  overtime_amount numeric NOT NULL DEFAULT 0,
  bonus_amount numeric NOT NULL DEFAULT 0,
  deduction_amount numeric NOT NULL DEFAULT 0,
  advance_amount numeric NOT NULL DEFAULT 0,
  net_salary numeric NOT NULL DEFAULT 0,
  is_paid boolean NOT NULL DEFAULT false,
  payment_date date,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_employee_period UNIQUE (employee_id, period_year, period_month)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Employees
DROP POLICY IF EXISTS "Authenticated users can view employees" ON public.employees;
CREATE POLICY "Authenticated users can view employees"
  ON public.employees FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins and field managers can manage employees" ON public.employees;
CREATE POLICY "Admins and field managers can manage employees"
  ON public.employees FOR ALL TO authenticated
  USING (get_user_role() IN ('admin', 'field_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

-- RLS Policies for Attendance
DROP POLICY IF EXISTS "Authenticated users can view attendance" ON public.attendance_records;
CREATE POLICY "Authenticated users can view attendance"
  ON public.attendance_records FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins and field managers can manage attendance" ON public.attendance_records;
CREATE POLICY "Admins and field managers can manage attendance"
  ON public.attendance_records FOR ALL TO authenticated
  USING (get_user_role() IN ('admin', 'field_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

-- RLS Policies for Transactions
DROP POLICY IF EXISTS "Authenticated users can view payroll transactions" ON public.payroll_transactions;
CREATE POLICY "Authenticated users can view payroll transactions"
  ON public.payroll_transactions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins and field managers can manage payroll transactions" ON public.payroll_transactions;
CREATE POLICY "Admins and field managers can manage payroll transactions"
  ON public.payroll_transactions FOR ALL TO authenticated
  USING (get_user_role() IN ('admin', 'field_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

-- RLS Policies for Payments
DROP POLICY IF EXISTS "Authenticated users can view payroll payments" ON public.payroll_payments;
CREATE POLICY "Authenticated users can view payroll payments"
  ON public.payroll_payments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins and field managers can manage payroll payments" ON public.payroll_payments;
CREATE POLICY "Admins and field managers can manage payroll payments"
  ON public.payroll_payments FOR ALL TO authenticated
  USING (get_user_role() IN ('admin', 'field_manager'))
  WITH CHECK (get_user_role() IN ('admin', 'field_manager'));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON public.attendance_records(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_payroll_tx_employee_period ON public.payroll_transactions(employee_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_payroll_pay_period ON public.payroll_payments(period_year, period_month);

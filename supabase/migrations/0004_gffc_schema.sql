-- Chickboy / GFFC Butchery Training Center — target schema, replacing the
-- Google Sheets tabs (Users, Applicants, Attendance, Schedule, Tool Orders,
-- Tools Catalog, Inventory Purchases, Sales, Expense Accounts, Expenses,
-- Email Log) that the current Apps Script app (Code.gs) reads/writes.
--
-- Ground truth for roles/columns is Code.gs itself, not the prose migration
-- docs shipped alongside it — those docs listed a stale role scheme
-- (Admin1/Admin2/Student) that the app already migrated away from. The real,
-- currently-enforced roles are VALID_ROLES in Code.gs:
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  must_reset_password boolean not null default true,
  role text not null check (role in ('Super Admin', 'Admin', 'Instructor', 'Staff', 'Kiosk', 'Trainees')),
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  password_changed_at timestamptz,
  face_photo_url text,
  face_descriptor jsonb,
  face_enrolled_at timestamptz
);

create table applicants (
  id uuid primary key default gen_random_uuid(),
  reference_number text unique not null,
  submitted_at timestamptz not null default now(),
  last_name text not null,
  first_name text not null,
  middle_name text,
  gender text,
  birthday date,
  age int,
  province text,
  municipality text,
  barangay text,
  street_purok text,
  mobile_number text,
  email text,
  emergency_contact_person text,
  emergency_contact_relationship text,
  emergency_contact_number text,
  educational_attainment text,
  school_name text,
  school_year_graduated text,
  strand text,
  course text,
  applicant_photo_url text,
  face_descriptor jsonb,
  valid_id_url text,
  psa_url text,
  barangay_clearance_url text,
  drug_test_url text,
  drug_test_date date,
  current_work_status text,
  current_work_details text,
  previous_work text,
  referred_by text,
  hear_about_source text,
  purpose_of_enrolling text,
  other_tesda_courses text,
  batch_number text,
  review_status text not null default 'Pending Review',
  reviewed_by uuid references users (id),
  reviewed_at timestamptz,
  approval_status text not null default 'Pending',
  approved_by uuid references users (id),
  approved_at timestamptz,
  training_result text not null default 'Not Yet Available',
  result_approval_status text not null default 'Pending',
  result_approved_by uuid references users (id),
  result_approved_at timestamptz,
  student_id_number text unique,
  student_user_id uuid references users (id),
  student_account_created_at timestamptz,
  photo_reprocessed_at timestamptz,
  psa_status text,
  drug_test_status text,
  agreement_accepted boolean,
  agreement_accepted_at timestamptz
);

create index applicants_batch_number_idx on applicants (batch_number);
create index applicants_review_status_idx on applicants (review_status);

create table training_schedule (
  id uuid primary key default gen_random_uuid(),
  batch_name text not null,
  start_date date,
  end_date date,
  venue text,
  slots int,
  status text not null default 'Open',
  notes text,
  submitted_by uuid references users (id),
  approval_status text not null default 'Pending Approval',
  approved_by uuid references users (id),
  created_at timestamptz not null default now(),
  tuition_fee numeric not null default 0
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  attendance_date date not null,
  person_type text not null check (person_type in ('Staff', 'Student')),
  person_ref text not null,
  full_name text not null,
  time_in timestamptz,
  time_out timestamptz,
  recorded_by uuid references users (id),
  match_distance_in numeric,
  match_distance_out numeric,
  unique (attendance_date, person_type, person_ref)
);

create table tools_catalog (
  item_id text primary key,
  name text,
  description text,
  unit text,
  price numeric,
  active boolean not null default true,
  status text not null default 'Live' check (status in ('Live', 'Pending Add', 'Pending Edit', 'Pending Remove')),
  pending_data jsonb,
  submitted_by uuid references users (id),
  submitted_at timestamptz,
  reviewed_by uuid references users (id),
  reviewed_at timestamptz,
  review_notes text
);

create table inventory_purchases (
  id uuid primary key default gen_random_uuid(),
  purchased_at timestamptz not null default now(),
  item_id text references tools_catalog (item_id),
  item_name text not null,
  quantity numeric not null,
  unit_cost numeric not null,
  total_cost numeric generated always as (quantity * unit_cost) stored,
  supplier text,
  notes text,
  recorded_by uuid references users (id)
);

create table tool_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  created_at timestamptz not null default now(),
  student_username text,
  student_full_name text,
  student_id_number text,
  items_summary text,
  items jsonb not null,
  notes text,
  status text not null default 'Pending',
  processed_by uuid references users (id),
  processed_at timestamptz
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  sold_at timestamptz not null default now(),
  sale_type text not null,
  source_ref text,
  description text,
  customer_name text,
  batch_number text,
  amount numeric not null,
  recorded_by uuid references users (id)
);

create unique index sales_source_ref_unique
  on sales (sale_type, source_ref)
  where source_ref is not null;

create table expense_accounts (
  name text primary key,
  monthly_budget numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  account text references expense_accounts (name),
  description text,
  amount numeric not null,
  requested_by uuid references users (id),
  status text not null default 'Pending',
  approval_level_required text,
  decided_by uuid references users (id),
  decided_at timestamptz,
  decision_notes text
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  logged_at timestamptz not null default now(),
  context text,
  detail text
);

-- Lock every table down by default. Granular per-role policies (matching
-- the ~20 canX_(role) checks in Code.gs) get added alongside the auth
-- Edge Function, once there's a real JWT role claim for policies to check
-- against — see SUPABASE_STEP_BY_STEP_GUIDE.md Phase 5. Until then, only
-- the service role (used by the one-time data import, and later by Edge
-- Functions) can read/write these tables — safest default given this data
-- includes biometric face descriptors and personal documents.
alter table users enable row level security;
alter table applicants enable row level security;
alter table training_schedule enable row level security;
alter table attendance enable row level security;
alter table tools_catalog enable row level security;
alter table inventory_purchases enable row level security;
alter table tool_orders enable row level security;
alter table sales enable row level security;
alter table expense_accounts enable row level security;
alter table expenses enable row level security;
alter table email_log enable row level security;

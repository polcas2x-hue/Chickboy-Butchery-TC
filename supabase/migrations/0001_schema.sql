-- Core schema: profiles, requests, approval_steps, audit_log

create type user_role as enum ('requester', 'manager', 'admin');
create type request_status as enum (
  'draft', 'pending_manager', 'pending_admin', 'approved', 'rejected', 'cancelled'
);
create type approver_role as enum ('manager', 'admin');
create type step_status as enum ('pending', 'approved', 'rejected', 'skipped');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role user_role not null default 'requester',
  manager_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  title text not null,
  description text,
  amount numeric,
  status request_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index requests_requester_id_idx on requests (requester_id);
create index requests_status_idx on requests (status);

create table approval_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests (id) on delete cascade,
  step_order int not null,
  approver_role approver_role not null,
  approver_id uuid references profiles (id) on delete set null,
  status step_status not null default 'pending',
  comment text,
  decided_at timestamptz,
  unique (request_id, step_order)
);

create index approval_steps_request_id_idx on approval_steps (request_id);
create index approval_steps_approver_id_idx on approval_steps (approver_id);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests (id) on delete cascade,
  actor_id uuid references profiles (id) on delete set null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_request_id_idx on audit_log (request_id);

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger requests_set_updated_at
  before update on requests
  for each row execute function set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up.
create function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'requester');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

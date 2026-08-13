-- Auth foundation: custom session tokens, a near 1:1 port of Code.gs's
-- CacheService-based login/session model (login/logout/getSessionInfo,
-- requireSession_/requireRole_, revokeSessionsForUser_ — see Code.gs
-- lines 771-880). Edge Functions are the sole access-control layer; RLS on
-- every data table stays service-role-only, matching how Code.gs enforces
-- permissions today (in function code, not "the database").

create table sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index sessions_user_id_idx on sessions (user_id);

alter table sessions enable row level security; -- service-role only, no policies

-- Set by a future admin-user-management Edge Function (the equivalent of
-- Code.gs's revokeSessionsForUser_) whenever an account is deactivated,
-- renamed, has its role changed, or has its password reset by an admin.
-- Every session lookup treats any session issued at or before this
-- timestamp as invalid, even if it hasn't expired yet.
alter table users add column sessions_invalid_after timestamptz;

create or replace function verify_password(plain_password text, hash text)
returns boolean as $$
  select crypt(plain_password, hash) = hash;
$$ language sql security definer set search_path = public;

create or replace function hash_password(plain_password text)
returns text as $$
  select crypt(plain_password, gen_salt('bf'));
$$ language sql security definer set search_path = public;

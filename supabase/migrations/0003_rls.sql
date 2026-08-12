-- Row Level Security. Status/approval transitions all go through the
-- security-definer RPCs in 0002_functions.sql, which run as the table owner
-- and so aren't constrained by these policies -- these only govern what
-- regular users can read/write directly from the client.

alter table profiles enable row level security;
alter table requests enable row level security;
alter table approval_steps enable row level security;
alter table audit_log enable row level security;

-- profiles --------------------------------------------------------------

create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or current_profile_role() = 'admin'
    or manager_id = auth.uid()
  );

create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin on profiles for update
  using (current_profile_role() = 'admin')
  with check (true);

-- Only admins may change someone's role or reporting manager.
create function guard_profile_privileged_fields() returns trigger as $$
begin
  if (new.role is distinct from old.role or new.manager_id is distinct from old.manager_id)
     and current_profile_role() <> 'admin' then
    raise exception 'Only an admin can change role or manager_id';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger profiles_guard_privileged_fields
  before update on profiles
  for each row execute function guard_profile_privileged_fields();

-- requests ----------------------------------------------------------------

create policy requests_select on requests for select
  using (
    requester_id = auth.uid()
    or current_profile_role() = 'admin'
    or exists (
      select 1 from profiles p
      where p.id = requests.requester_id and p.manager_id = auth.uid()
    )
    or exists (
      select 1 from approval_steps s
      where s.request_id = requests.id
        and s.status = 'pending'
        and (s.approver_id = auth.uid() or (s.approver_id is null and s.approver_role::text = current_profile_role()::text))
    )
  );

create policy requests_insert on requests for insert
  with check (requester_id = auth.uid() and status = 'draft');

create policy requests_update_own_draft on requests for update
  using (requester_id = auth.uid() and status = 'draft')
  with check (requester_id = auth.uid());

-- approval_steps ------------------------------------------------------------

create policy approval_steps_select on approval_steps for select
  using (
    approver_id = auth.uid()
    or (approver_id is null and approver_role::text = current_profile_role()::text)
    or current_profile_role() = 'admin'
    or exists (
      select 1 from requests r where r.id = approval_steps.request_id and r.requester_id = auth.uid()
    )
  );

-- audit_log -------------------------------------------------------------

create policy audit_log_select on audit_log for select
  using (
    current_profile_role() = 'admin'
    or exists (
      select 1 from requests r where r.id = audit_log.request_id and r.requester_id = auth.uid()
    )
    or exists (
      select 1 from requests r
      join profiles p on p.id = r.requester_id
      where r.id = audit_log.request_id and p.manager_id = auth.uid()
    )
  );

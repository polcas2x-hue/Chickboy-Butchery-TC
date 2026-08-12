-- Helper + RPC functions that drive the approval workflow.
-- security definer so RLS on the underlying tables can't be bypassed by
-- calling these directly with mismatched arguments, but callers still can't
-- act on someone else's behalf because each function checks auth.uid().

create function current_profile_role() returns user_role as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public;

-- Creates the approval chain for a draft request and moves it to
-- pending_manager. Only the requester who owns the draft may call this.
create function submit_request(p_request_id uuid) returns void as $$
declare
  v_requester_id uuid;
  v_status request_status;
  v_manager_id uuid;
begin
  select requester_id, status into v_requester_id, v_status
  from requests where id = p_request_id
  for update;

  if v_requester_id is null then
    raise exception 'Request not found';
  end if;

  if v_requester_id <> auth.uid() then
    raise exception 'Only the requester can submit this request';
  end if;

  if v_status <> 'draft' then
    raise exception 'Request has already been submitted';
  end if;

  select manager_id into v_manager_id from profiles where id = v_requester_id;

  insert into approval_steps (request_id, step_order, approver_role, approver_id)
  values
    (p_request_id, 1, 'manager', v_manager_id),
    (p_request_id, 2, 'admin', null);

  update requests set status = 'pending_manager' where id = p_request_id;

  insert into audit_log (request_id, actor_id, action, metadata)
  values (p_request_id, auth.uid(), 'submitted', null);
end;
$$ language plpgsql security definer set search_path = public;

-- Approves or rejects a step. Validates the caller is the assigned approver
-- (or, for unassigned admin steps, any admin) and that it's actually their
-- turn, then advances or terminates the parent request.
create function decide_step(
  p_step_id uuid,
  p_decision step_status,
  p_comment text default null
) returns void as $$
declare
  v_step approval_steps%rowtype;
  v_request requests%rowtype;
  v_caller_role user_role;
  v_expected_status request_status;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into v_step from approval_steps where id = p_step_id for update;
  if v_step.id is null then
    raise exception 'Approval step not found';
  end if;

  select * into v_request from requests where id = v_step.request_id for update;

  v_caller_role := current_profile_role();

  if v_step.status <> 'pending' then
    raise exception 'This step has already been decided';
  end if;

  if v_step.approver_role = 'manager' then
    v_expected_status := 'pending_manager';
  else
    v_expected_status := 'pending_admin';
  end if;

  if v_request.status <> v_expected_status then
    raise exception 'This request is not awaiting this step';
  end if;

  if v_step.approver_id is not null then
    if v_step.approver_id <> auth.uid() then
      raise exception 'You are not the assigned approver for this step';
    end if;
  else
    if v_caller_role <> v_step.approver_role and v_caller_role <> 'admin' then
      raise exception 'You do not have permission to decide this step';
    end if;
  end if;

  update approval_steps
  set status = p_decision, comment = p_comment, decided_at = now(), approver_id = auth.uid()
  where id = p_step_id;

  if p_decision = 'rejected' then
    update requests set status = 'rejected' where id = v_request.id;
    insert into audit_log (request_id, actor_id, action, metadata)
    values (v_request.id, auth.uid(), 'rejected', jsonb_build_object('step_id', p_step_id, 'comment', p_comment));
    return;
  end if;

  if v_step.approver_role = 'manager' then
    update requests set status = 'pending_admin' where id = v_request.id;
  else
    update requests set status = 'approved' where id = v_request.id;
  end if;

  insert into audit_log (request_id, actor_id, action, metadata)
  values (v_request.id, auth.uid(), 'approved', jsonb_build_object('step_id', p_step_id, 'comment', p_comment));
end;
$$ language plpgsql security definer set search_path = public;

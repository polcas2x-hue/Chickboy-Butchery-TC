-- Atomic per-year sequence counters, replacing Code.gs's Script-Properties
-- + LockService approach (generateReferenceNumber_ / generateStudentIdNumber_,
-- Code.gs lines 1559-1582). A single `insert ... on conflict do update
-- ... returning` is atomic under Postgres row locking, so no advisory lock
-- or global mutex is needed the way Apps Script required one.

create table counters (
  name text primary key,
  value integer not null default 0
);

-- Seed from the real imported data so the next generated reference number
-- can't collide with an existing one (real applicants already used
-- GFFC/CHICKBOY-2026-0005 through -0009 — see supabase/MIGRATION.md).
insert into counters (name, value)
select 'reference_number_' || extract(year from submitted_at)::text,
       max(substring(reference_number from '(\d+)$')::int)
from applicants
group by extract(year from submitted_at)
on conflict (name) do update set value = greatest(counters.value, excluded.value);

create or replace function next_counter_value(counter_name text)
returns integer as $$
  insert into counters (name, value) values (counter_name, 1)
  on conflict (name) do update set value = counters.value + 1
  returning value;
$$ language sql;

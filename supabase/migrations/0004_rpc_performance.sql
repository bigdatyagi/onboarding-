-- ============================================================
-- 0004_rpc_performance.sql — RPC API: performance engine,
-- leaderboard, dashboard stats, admin ops, reminders
-- ============================================================

-- ---------- PERFORMANCE ENGINE ----------
-- overall_score =
--   30% task completion rate + 25% on-time rate + 20% attendance +
--   15% avg quality (x20 → 100 scale) + 10% activity (comments+checklist, capped)
create or replace function public.compute_performance(p_user uuid, p_start date, p_end date)
returns table (
  attendance_pct numeric, tasks_assigned int, tasks_done int,
  on_time_pct numeric, avg_quality numeric, points_earned int,
  activity_score numeric, overall_score numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_workdays int; v_present int;
  v_assigned int; v_done int; v_on_time int;
  v_quality numeric; v_points int; v_activity numeric;
  v_att numeric; v_comp numeric; v_ot numeric; v_overall numeric;
begin
  -- workdays = weekdays in range
  select count(*) into v_workdays
  from generate_series(p_start, p_end, interval '1 day') d
  where extract(isodow from d) < 6;

  select count(*) into v_present from public.attendance
  where user_id = p_user and work_date between p_start and p_end
    and status in ('present','late','excused');

  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status = 'done' and (due_at is null or completed_at <= due_at)),
         avg(quality_rating) filter (where quality_rating is not null),
         coalesce(sum(awarded_points) filter (where status = 'done'), 0)
    into v_assigned, v_done, v_on_time, v_quality, v_points
  from public.tasks
  where assignee_id = p_user and deleted_at is null
    and created_at::date <= p_end
    and (completed_at is null or completed_at::date >= p_start);

  select least(100, count(*) * 4)::numeric into v_activity
  from public.task_comments
  where author_id = p_user and created_at::date between p_start and p_end and deleted_at is null;

  v_att  := case when v_workdays > 0 then round(v_present::numeric * 100 / v_workdays, 2) else 0 end;
  v_comp := case when v_assigned > 0 then round(v_done::numeric * 100 / v_assigned, 2) else 0 end;
  v_ot   := case when v_done > 0 then round(v_on_time::numeric * 100 / v_done, 2) else 0 end;
  v_overall := round(
      0.30 * v_comp + 0.25 * v_ot + 0.20 * least(v_att,100) +
      0.15 * coalesce(v_quality,0) * 20 + 0.10 * v_activity, 2);

  return query select v_att, v_assigned, v_done, v_ot,
                      round(coalesce(v_quality,0),2), v_points, v_activity, v_overall;
end $$;

-- Snapshot generator (manager/admin, or self)
create or replace function public.generate_performance_snapshot(p_user uuid, p_period text)
returns public.performance_snapshots
language plpgsql security definer set search_path = public as $$
declare
  d_start date; d_end date; r record; snap public.performance_snapshots;
begin
  if not (public.is_manager() or p_user = auth.uid()) then
    raise exception 'Not authorized';
  end if;
  d_end := (now() at time zone 'utc')::date;
  d_start := case p_period
    when 'daily'     then d_end
    when 'weekly'    then date_trunc('week',  d_end)::date
    when 'monthly'   then date_trunc('month', d_end)::date
    when 'quarterly' then date_trunc('quarter', d_end)::date
    when 'yearly'    then date_trunc('year',  d_end)::date
    else null end;
  if d_start is null then raise exception 'Invalid period %', p_period; end if;

  select * into r from public.compute_performance(p_user, d_start, d_end);

  insert into public.performance_snapshots
    (user_id, period, period_start, period_end, attendance_pct, tasks_assigned,
     tasks_done, on_time_pct, avg_quality, points_earned, activity_score, overall_score)
  values (p_user, p_period, d_start, d_end, r.attendance_pct, r.tasks_assigned,
          r.tasks_done, r.on_time_pct, nullif(r.avg_quality,0), r.points_earned, r.activity_score, r.overall_score)
  on conflict (user_id, period, period_start) do update set
    period_end = excluded.period_end, attendance_pct = excluded.attendance_pct,
    tasks_assigned = excluded.tasks_assigned, tasks_done = excluded.tasks_done,
    on_time_pct = excluded.on_time_pct, avg_quality = excluded.avg_quality,
    points_earned = excluded.points_earned, activity_score = excluded.activity_score,
    overall_score = excluded.overall_score, created_at = now()
  returning * into snap;
  return snap;
end $$;

-- ---------- LEADERBOARD ----------
create or replace function public.get_leaderboard(p_period text default 'monthly', p_limit int default 50)
returns table (
  user_id uuid, full_name text, avatar_url text, role public.user_role,
  department_name text, points int, tasks_done int, on_time_pct numeric,
  attendance_pct numeric, overall_score numeric, rank bigint
)
language plpgsql stable security definer set search_path = public as $$
declare d_start date; d_end date;
begin
  if not public.is_approved() then raise exception 'Not authorized'; end if;
  d_end := (now() at time zone 'utc')::date;
  d_start := case p_period
    when 'daily'     then d_end
    when 'weekly'    then date_trunc('week',  d_end)::date
    when 'monthly'   then date_trunc('month', d_end)::date
    when 'quarterly' then date_trunc('quarter', d_end)::date
    when 'yearly'    then date_trunc('year',  d_end)::date
    else date_trunc('month', d_end)::date end;

  return query
  with scored as (
    select p.id, p.full_name, p.avatar_url, p.role, d.name as dept, p.points, c.*
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    cross join lateral public.compute_performance(p.id, d_start, d_end) c
    where p.deleted_at is null and p.status = 'approved'
  )
  select s.id, s.full_name, s.avatar_url, s.role, s.dept, s.points,
         s.tasks_done, s.on_time_pct, s.attendance_pct, s.overall_score,
         rank() over (order by s.overall_score desc, s.points desc)
  from scored s
  order by 11 asc
  limit p_limit;
end $$;

-- ---------- DASHBOARD STATS ----------
create or replace function public.get_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); result jsonb; today date := (now() at time zone 'utc')::date;
begin
  if not public.is_approved() then raise exception 'Not authorized'; end if;
  select jsonb_build_object(
    'my_open_tasks',    (select count(*) from public.tasks where assignee_id = uid and status in ('todo','in_progress','changes_requested') and deleted_at is null),
    'my_in_review',     (select count(*) from public.tasks where assignee_id = uid and status = 'in_review' and deleted_at is null),
    'my_done_month',    (select count(*) from public.tasks where assignee_id = uid and status = 'done' and completed_at >= date_trunc('month', now()) and deleted_at is null),
    'my_overdue',       (select count(*) from public.tasks where assignee_id = uid and status not in ('done','cancelled') and due_at < now() and deleted_at is null),
    'my_points',        (select points from public.profiles where id = uid),
    'my_reviews_pending',(select count(*) from public.tasks where reviewer_id = uid and status = 'in_review' and deleted_at is null),
    'checked_in_today', (select exists(select 1 from public.attendance where user_id = uid and work_date = today and check_in_at is not null)),
    'checked_out_today',(select exists(select 1 from public.attendance where user_id = uid and work_date = today and check_out_at is not null)),
    'unread_notifications',(select count(*) from public.notifications where user_id = uid and read_at is null),
    'team', case when public.is_manager() then (select jsonb_build_object(
        'total_users',    (select count(*) from public.profiles where deleted_at is null and status = 'approved'),
        'pending_users',  (select count(*) from public.profiles where deleted_at is null and status = 'pending'),
        'open_tasks',     (select count(*) from public.tasks where status not in ('done','cancelled') and deleted_at is null),
        'overdue_tasks',  (select count(*) from public.tasks where status not in ('done','cancelled') and due_at < now() and deleted_at is null),
        'present_today',  (select count(*) from public.attendance where work_date = today and status in ('present','late')),
        'done_this_week', (select count(*) from public.tasks where status = 'done' and completed_at >= date_trunc('week', now()) and deleted_at is null)
      )) else null end,
    'status_breakdown', (select coalesce(jsonb_object_agg(status, ct), '{}'::jsonb) from (
        select status, count(*) ct from public.tasks
        where deleted_at is null and (public.is_manager() or assignee_id = uid)
        group by status) x),
    'weekly_completions', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'count', coalesce(ct,0)) order by d), '[]'::jsonb)
      from generate_series(today - 6, today, interval '1 day') d
      left join (
        select completed_at::date cd, count(*) ct from public.tasks
        where status = 'done' and deleted_at is null and completed_at >= today - 6
          and (public.is_manager() or assignee_id = uid)
        group by 1) t on t.cd = d::date)
  ) into result;
  return result;
end $$;

-- ---------- DUE REMINDERS (called on app load; idempotent per day) ----------
create or replace function public.run_due_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    select t.id, t.title, t.assignee_id, t.due_at,
           (t.due_at < now()) as overdue
    from public.tasks t
    where t.deleted_at is null and t.assignee_id is not null
      and t.status not in ('done','cancelled')
      and t.due_at is not null and t.due_at < now() + interval '24 hours'
      and not exists (
        select 1 from public.notifications nn
        where nn.user_id = t.assignee_id
          and nn.link = '/tasks/' || t.id
          and nn.kind in ('task_due_soon','task_overdue')
          and nn.created_at > now() - interval '20 hours')
  loop
    insert into public.notifications(user_id, kind, title, body, link)
    values (r.assignee_id,
            case when r.overdue then 'task_overdue'::public.notification_kind else 'task_due_soon'::public.notification_kind end,
            case when r.overdue then '⚠ Task overdue' else '⏰ Task due soon' end,
            r.title, '/tasks/' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- ADMIN: approve / suspend / set role ----------
create or replace function public.admin_set_user_status(p_user uuid, p_status public.account_status)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  update public.profiles set status = p_status where id = p_user;
  insert into public.notifications(user_id, kind, title, body)
  values (p_user,
          case when p_status = 'approved' then 'account_approved'::public.notification_kind else 'account_suspended'::public.notification_kind end,
          case p_status when 'approved' then 'Your account was approved 🎉'
                        when 'suspended' then 'Your account was suspended'
                        when 'rejected' then 'Your account application was rejected'
                        else 'Account status changed' end,
          'Status: ' || p_status);
  insert into public.audit_logs(actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'set_status', 'profile', p_user::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_set_user_role(p_user uuid, p_role public.user_role)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_role = 'super_admin' and public.current_role() <> 'super_admin' then
    raise exception 'Only super_admin can grant super_admin';
  end if;
  update public.profiles set role = p_role where id = p_user;
  insert into public.notifications(user_id, kind, title, body)
  values (p_user, 'role_changed', 'Your role was updated', 'New role: ' || p_role);
  insert into public.audit_logs(actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'set_role', 'profile', p_user::text, jsonb_build_object('role', p_role));
end $$;

-- soft delete task (assignee's manager or admin)
create or replace function public.soft_delete_task(p_task uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.tasks where id = p_task and deleted_at is null;
  if t is null then raise exception 'Task not found'; end if;
  if not (public.is_manager() or t.created_by = auth.uid()) then
    raise exception 'Not authorized';
  end if;
  update public.tasks set deleted_at = now() where id = p_task;
  insert into public.audit_logs(actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'soft_delete', 'task', p_task::text, jsonb_build_object('title', t.title));
end $$;

-- ---------- VIEWS ----------
create or replace view public.v_task_board as
select t.*,
       a.full_name  as assignee_name,  a.avatar_url as assignee_avatar,
       c.full_name  as creator_name,
       r.full_name  as reviewer_name,
       d.name       as department_name,
       (select count(*) from public.task_checklist_items ci where ci.task_id = t.id)                    as checklist_total,
       (select count(*) from public.task_checklist_items ci where ci.task_id = t.id and ci.is_done)     as checklist_done,
       (select count(*) from public.task_comments cm where cm.task_id = t.id and cm.deleted_at is null) as comment_count,
       (select count(*) from public.task_attachments at2 where at2.task_id = t.id)                      as attachment_count,
       (select count(*) from public.tasks st where st.parent_task_id = t.id and st.deleted_at is null)  as subtask_count
from public.tasks t
left join public.profiles a on a.id = t.assignee_id
left join public.profiles c on c.id = t.created_by
left join public.profiles r on r.id = t.reviewer_id
left join public.departments d on d.id = t.department_id
where t.deleted_at is null;

-- run views with caller's permissions so RLS applies
alter view public.v_task_board set (security_invoker = true);

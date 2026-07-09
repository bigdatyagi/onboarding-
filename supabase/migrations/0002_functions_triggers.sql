-- ============================================================
-- 0002_functions_triggers.sql — helpers, triggers, notifications
-- ============================================================

-- ---------- ROLE HELPERS (security definer, used by RLS) ----------
create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','owner') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','owner','teacher','team_leader') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_approved()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'approved' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.my_department()
returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid()
$$;

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_touch_departments before update on public.departments for each row execute function public.touch_updated_at();
create trigger trg_touch_profiles    before update on public.profiles    for each row execute function public.touch_updated_at();
create trigger trg_touch_tasks       before update on public.tasks       for each row execute function public.touch_updated_at();
create trigger trg_touch_checklist   before update on public.task_checklist_items for each row execute function public.touch_updated_at();
create trigger trg_touch_comments    before update on public.task_comments for each row execute function public.touch_updated_at();
create trigger trg_touch_attendance  before update on public.attendance  for each row execute function public.touch_updated_at();

-- ---------- AUTO-CREATE PROFILE on signup ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, full_name, employee_id, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    'EMP-' || nextval('public.employee_id_seq'),
    case when is_first then 'super_admin'::public.user_role else 'intern'::public.user_role end,
    case when is_first then 'approved'::public.account_status else 'pending'::public.account_status end
  );
  return new;
end $$;

create trigger trg_on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- PROFILE COMPLETENESS ----------
create or replace function public.compute_profile_complete()
returns trigger language plpgsql as $$
begin
  new.profile_complete :=
    coalesce(new.full_name,'') <> '' and
    coalesce(new.phone,'') <> '' and
    new.avatar_url is not null and
    new.department_id is not null;
  return new;
end $$;
create trigger trg_profile_complete before insert or update on public.profiles
for each row execute function public.compute_profile_complete();

-- ---------- TASK LIFECYCLE: history + timestamps + points award ----------
create or replace function public.log_task_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.task_history(task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), 'status', old.status::text, new.status::text);
      if new.status = 'in_progress' and old.started_at is null then new.started_at = now(); end if;
      if new.status = 'done' then
        new.completed_at = now();
        new.progress = 100;
        -- award points: base + bonus - late penalty if overdue
        new.awarded_points = greatest(0,
          new.points + new.bonus -
          case when new.due_at is not null and now() > new.due_at then new.late_penalty else 0 end);
        update public.profiles set points = points + new.awarded_points where id = new.assignee_id;
      elsif old.status = 'done' and new.status <> 'done' then
        -- reopened: claw back points
        update public.profiles set points = greatest(0, points - coalesce(old.awarded_points,0)) where id = old.assignee_id;
        new.awarded_points = null;
        new.completed_at = null;
      end if;
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      insert into public.task_history(task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), 'assignee', old.assignee_id::text, new.assignee_id::text);
    end if;
    if new.priority is distinct from old.priority then
      insert into public.task_history(task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), 'priority', old.priority::text, new.priority::text);
    end if;
    if new.due_at is distinct from old.due_at then
      insert into public.task_history(task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), 'due_at', old.due_at::text, new.due_at::text);
    end if;
    if new.progress is distinct from old.progress then
      insert into public.task_history(task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), 'progress', old.progress::text, new.progress::text);
    end if;
  elsif tg_op = 'INSERT' then
    insert into public.task_history(task_id, actor_id, field, old_value, new_value)
    values (new.id, auth.uid(), 'created', null, new.title);
  end if;
  return new;
end $$;
create trigger trg_task_log before insert or update on public.tasks
for each row execute function public.log_task_change();

-- ---------- RECURRING TASKS: spawn next occurrence when done ----------
create or replace function public.spawn_recurring_task()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from new.status
     and new.recurrence <> 'none' and new.due_at is not null then
    insert into public.tasks (title, description, priority, difficulty, points, late_penalty, bonus,
                              due_at, created_by, assignee_id, reviewer_id, department_id, recurrence, status)
    values (new.title, new.description, new.priority, new.difficulty, new.points, new.late_penalty, new.bonus,
            case new.recurrence
              when 'daily'   then new.due_at + interval '1 day'
              when 'weekly'  then new.due_at + interval '7 days'
              when 'monthly' then new.due_at + interval '1 month'
            end,
            new.created_by, new.assignee_id, new.reviewer_id, new.department_id, new.recurrence, 'todo');
  end if;
  return new;
end $$;
create trigger trg_task_recur after update on public.tasks
for each row execute function public.spawn_recurring_task();

-- ---------- NOTIFICATIONS: task assigned / status / comments ----------
create or replace function public.notify_task_events()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.assignee_id is not null and new.assignee_id <> new.created_by then
    insert into public.notifications(user_id, kind, title, body, link)
    values (new.assignee_id, 'task_assigned', 'New task assigned',
            new.title, '/tasks/' || new.id);
  elsif tg_op = 'UPDATE' then
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null and new.assignee_id <> auth.uid() then
      insert into public.notifications(user_id, kind, title, body, link)
      values (new.assignee_id, 'task_assigned', 'Task assigned to you', new.title, '/tasks/' || new.id);
    end if;
    if new.status is distinct from old.status then
      if new.status = 'in_review' and new.reviewer_id is not null and new.reviewer_id <> auth.uid() then
        insert into public.notifications(user_id, kind, title, body, link)
        values (new.reviewer_id, 'task_reviewed', 'Task awaiting your review', new.title, '/tasks/' || new.id);
      end if;
      if new.status in ('done','changes_requested') and new.assignee_id is not null and new.assignee_id <> auth.uid() then
        insert into public.notifications(user_id, kind, title, body, link)
        values (new.assignee_id, 'task_reviewed',
                case when new.status = 'done' then 'Task approved ✓' else 'Changes requested' end,
                new.title, '/tasks/' || new.id);
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_task_notify after insert or update on public.tasks
for each row execute function public.notify_task_events();

create or replace function public.notify_comment()
returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select assignee_id, created_by, title into t from public.tasks where id = new.task_id;
  if t.assignee_id is not null and t.assignee_id <> new.author_id then
    insert into public.notifications(user_id, kind, title, body, link)
    values (t.assignee_id, 'task_commented', 'New comment on task', t.title, '/tasks/' || new.task_id);
  end if;
  if t.created_by <> new.author_id and t.created_by is distinct from t.assignee_id then
    insert into public.notifications(user_id, kind, title, body, link)
    values (t.created_by, 'task_commented', 'New comment on task', t.title, '/tasks/' || new.task_id);
  end if;
  return new;
end $$;
create trigger trg_comment_notify after insert on public.task_comments
for each row execute function public.notify_comment();

-- ---------- CHECKLIST → auto progress ----------
create or replace function public.sync_task_progress()
returns trigger
language plpgsql security definer set search_path = public as $$
declare tid uuid; total int; done_ct int;
begin
  tid := coalesce(new.task_id, old.task_id);
  select count(*), count(*) filter (where is_done) into total, done_ct
  from public.task_checklist_items where task_id = tid;
  if total > 0 then
    update public.tasks set progress = (done_ct * 100 / total)
    where id = tid and status not in ('done','cancelled');
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_checklist_progress after insert or update or delete on public.task_checklist_items
for each row execute function public.sync_task_progress();

-- ---------- DEPENDENCY GUARD: can't start until dependencies done ----------
create or replace function public.check_dependencies()
returns trigger
language plpgsql security definer set search_path = public as $$
declare blocked int;
begin
  if new.status in ('in_progress','in_review','done') and old.status in ('backlog','todo') then
    select count(*) into blocked
    from public.task_dependencies d
    join public.tasks t on t.id = d.depends_on_id
    where d.task_id = new.id and t.status <> 'done' and t.deleted_at is null;
    if blocked > 0 then
      raise exception 'Task has % unfinished dependencies', blocked;
    end if;
  end if;
  return new;
end $$;
create trigger trg_task_deps before update on public.tasks
for each row execute function public.check_dependencies();

-- ---------- ATTENDANCE: auto late detection (09:15 UTC cutoff) ----------
create or replace function public.mark_attendance_status()
returns trigger language plpgsql as $$
begin
  if new.check_in_at is not null and new.status = 'present' then
    if (new.check_in_at at time zone 'utc')::time > time '09:15' then
      new.status = 'late';
    end if;
  end if;
  return new;
end $$;
create trigger trg_attendance_late before insert or update on public.attendance
for each row execute function public.mark_attendance_status();

-- ==========================================
-- SOURCE: supabase\migrations\0001_schema.sql
-- ==========================================
-- ============================================================
-- 0001_schema.sql — Core schema for Team/Intern Management Platform
-- Run in Supabase SQL Editor (or supabase db push) in order 0001→0004
-- ============================================================

-- ---------- ENUMS ----------
create type public.user_role as enum ('super_admin','owner','teacher','team_leader','student','intern');
create type public.account_status as enum ('pending','approved','suspended','rejected');
create type public.task_status as enum ('backlog','todo','in_progress','in_review','changes_requested','done','cancelled');
create type public.task_priority as enum ('low','medium','high','urgent');
create type public.task_difficulty as enum ('trivial','easy','medium','hard','expert');
create type public.recurrence_kind as enum ('none','daily','weekly','monthly');
create type public.attendance_status as enum ('present','late','absent','excused');
create type public.notification_kind as enum (
  'task_assigned','task_updated','task_commented','task_reviewed','task_due_soon','task_overdue',
  'account_approved','account_suspended','role_changed','mention','system'
);

-- ---------- DEPARTMENTS ----------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(name) between 2 and 80),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- PROFILES (1:1 with auth.users) ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  employee_id   text unique,                      -- unique human ID, auto-generated (trigger)
  full_name     text not null default '' check (char_length(full_name) <= 120),
  email         text not null unique,
  phone         text check (phone is null or phone ~ '^[+0-9() -]{6,24}$'),
  role          public.user_role not null default 'intern',
  status        public.account_status not null default 'pending',
  department_id uuid references public.departments(id) on delete set null,
  avatar_url    text,
  bio           text check (bio is null or char_length(bio) <= 1000),
  points        integer not null default 0,
  profile_complete boolean not null default false,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_profiles_role       on public.profiles(role) where deleted_at is null;
create index idx_profiles_status     on public.profiles(status) where deleted_at is null;
create index idx_profiles_department on public.profiles(department_id) where deleted_at is null;
create index idx_profiles_points     on public.profiles(points desc) where deleted_at is null;

-- ---------- TASKS ----------
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(title) between 1 and 200),
  description    text check (description is null or char_length(description) <= 20000),
  status         public.task_status not null default 'todo',
  priority       public.task_priority not null default 'medium',
  difficulty     public.task_difficulty not null default 'medium',
  progress       smallint not null default 0 check (progress between 0 and 100),
  points         integer not null default 10 check (points between 0 and 1000),
  late_penalty   integer not null default 0 check (late_penalty between 0 and 1000),
  bonus          integer not null default 0 check (bonus between 0 and 1000),
  due_at         timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_by     uuid not null references public.profiles(id) on delete cascade,
  assignee_id    uuid references public.profiles(id) on delete set null,
  reviewer_id    uuid references public.profiles(id) on delete set null,
  department_id  uuid references public.departments(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete cascade,   -- subtasks
  recurrence     public.recurrence_kind not null default 'none',
  awarded_points integer,                          -- final points after review (trigger)
  review_note    text,
  quality_rating smallint check (quality_rating is null or quality_rating between 1 and 5),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint no_self_parent check (parent_task_id is distinct from id)
);
create index idx_tasks_assignee on public.tasks(assignee_id) where deleted_at is null;
create index idx_tasks_status   on public.tasks(status) where deleted_at is null;
create index idx_tasks_due      on public.tasks(due_at) where deleted_at is null;
create index idx_tasks_parent   on public.tasks(parent_task_id) where deleted_at is null;
create index idx_tasks_dept     on public.tasks(department_id) where deleted_at is null;

-- ---------- TASK DEPENDENCIES ----------
create table public.task_dependencies (
  task_id       uuid not null references public.tasks(id) on delete cascade,
  depends_on_id uuid not null references public.tasks(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (task_id, depends_on_id),
  constraint no_self_dependency check (task_id <> depends_on_id)
);

-- ---------- CHECKLIST ITEMS ----------
create table public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 300),
  is_done    boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_checklist_task on public.task_checklist_items(task_id);

-- ---------- COMMENTS ----------
create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_comments_task on public.task_comments(task_id) where deleted_at is null;

-- ---------- ATTACHMENTS ----------
create table public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  uploaded_by  uuid not null references public.profiles(id) on delete cascade,
  file_name    text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes between 0 and 52428800),
  created_at   timestamptz not null default now()
);
create index idx_attachments_task on public.task_attachments(task_id);

-- ---------- TASK HISTORY (audit per task, trigger-populated) ----------
create table public.task_history (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  field      text not null,
  old_value  text,
  new_value  text,
  created_at timestamptz not null default now()
);
create index idx_history_task on public.task_history(task_id, created_at desc);

-- ---------- ATTENDANCE ----------
create table public.attendance (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  work_date     date not null default (now() at time zone 'utc')::date,
  check_in_at   timestamptz,
  check_out_at  timestamptz,
  status        public.attendance_status not null default 'present',
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, work_date),
  constraint checkout_after_checkin check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at)
);
create index idx_attendance_user_date on public.attendance(user_id, work_date desc);
create index idx_attendance_date      on public.attendance(work_date desc);

-- ---------- NOTIFICATIONS ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       public.notification_kind not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, created_at desc);
create index idx_notifications_unread on public.notifications(user_id) where read_at is null;

-- ---------- AUDIT LOGS (global) ----------
create table public.audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_created on public.audit_logs(created_at desc);
create index idx_audit_actor   on public.audit_logs(actor_id, created_at desc);

-- ---------- PERFORMANCE SNAPSHOTS (computed periodically / on demand) ----------
create table public.performance_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  period         text not null check (period in ('daily','weekly','monthly','quarterly','yearly')),
  period_start   date not null,
  period_end     date not null,
  attendance_pct numeric(5,2) not null default 0,
  tasks_assigned integer not null default 0,
  tasks_done     integer not null default 0,
  on_time_pct    numeric(5,2) not null default 0,
  avg_quality    numeric(4,2),
  points_earned  integer not null default 0,
  activity_score numeric(6,2) not null default 0,
  overall_score  numeric(6,2) not null default 0,
  created_at     timestamptz not null default now(),
  unique (user_id, period, period_start)
);
create index idx_perf_user on public.performance_snapshots(user_id, period, period_start desc);

-- ---------- SEQUENCE for human-readable employee IDs ----------
create sequence public.employee_id_seq start 1001;

-- ==========================================
-- SOURCE: supabase\migrations\0002_functions_triggers.sql
-- ==========================================
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
        -- system flag lets the profile column-guard allow this internal update
        perform set_config('teampulse.system_op', 'on', true);
        update public.profiles set points = points + new.awarded_points where id = new.assignee_id;
        perform set_config('teampulse.system_op', '', true);
      elsif old.status = 'done' and new.status <> 'done' then
        -- reopened: claw back points
        perform set_config('teampulse.system_op', 'on', true);
        update public.profiles set points = greatest(0, points - coalesce(old.awarded_points,0)) where id = old.assignee_id;
        perform set_config('teampulse.system_op', '', true);
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
  end if;
  return new;
end $$;
create trigger trg_task_log before update on public.tasks
for each row execute function public.log_task_change();

-- Creation history must be AFTER INSERT (task row must exist for the FK)
create or replace function public.log_task_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.task_history(task_id, actor_id, field, old_value, new_value)
  values (new.id, auth.uid(), 'created', null, new.title);
  return new;
end $$;
create trigger trg_task_insert_log after insert on public.tasks
for each row execute function public.log_task_insert();

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

-- ==========================================
-- SOURCE: supabase\migrations\0003_rls_policies.sql
-- ==========================================
-- ============================================================
-- 0003_rls_policies.sql — Row Level Security & RBAC enforcement
-- Role matrix:
--   super_admin/owner  → full control
--   teacher/team_leader→ manage tasks & attendance in own department, view all
--   student/intern     → own tasks, own attendance, read shared data
-- All access requires status = 'approved' (except reading own profile)
-- ============================================================

alter table public.departments          enable row level security;
alter table public.profiles             enable row level security;
alter table public.tasks                enable row level security;
alter table public.task_dependencies    enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_comments        enable row level security;
alter table public.task_attachments     enable row level security;
alter table public.task_history         enable row level security;
alter table public.attendance           enable row level security;
alter table public.notifications        enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.performance_snapshots enable row level security;

-- ---------- DEPARTMENTS ----------
create policy dept_select on public.departments for select
  using (auth.uid() is not null and deleted_at is null);
create policy dept_admin_all on public.departments for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- PROFILES ----------
-- everyone authenticated can read own profile even if pending (needed for status gate UI)
create policy profiles_select_own on public.profiles for select
  using (id = auth.uid());
-- approved users can read all non-deleted profiles (directory, leaderboard)
create policy profiles_select_all on public.profiles for select
  using (public.is_approved() and deleted_at is null);
-- users can update their own profile but NOT role/status/points (column guard trigger below)
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- admins can update anyone
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- Column-level guard: non-admins cannot change protected columns
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- allow trusted internal operations (points award/clawback from task triggers)
  if coalesce(current_setting('teampulse.system_op', true), '') = 'on' then
    return new;
  end if;
  if not public.is_admin() then
    if new.role       is distinct from old.role
    or new.status     is distinct from old.status
    or new.points     is distinct from old.points
    or new.employee_id is distinct from old.employee_id then
      raise exception 'Not authorized to change protected profile fields';
    end if;
  end if;
  -- nobody may self-escalate to super_admin except an existing super_admin
  if new.role = 'super_admin' and old.role <> 'super_admin'
     and public.current_role() <> 'super_admin' then
    raise exception 'Only a super_admin can grant super_admin';
  end if;
  return new;
end $$;
create trigger trg_guard_profile before update on public.profiles
for each row execute function public.guard_profile_columns();

-- ---------- TASKS ----------
-- read: admin all; manager all; member = own (assignee/creator/reviewer) or department tasks
create policy tasks_select on public.tasks for select using (
  public.is_approved() and deleted_at is null and (
    public.is_manager()
    or assignee_id = auth.uid() or created_by = auth.uid() or reviewer_id = auth.uid()
    or (department_id is not null and department_id = public.my_department())
  )
);
-- create: managers anywhere; members may create tasks assigned to themselves
create policy tasks_insert on public.tasks for insert with check (
  public.is_approved() and created_by = auth.uid() and (
    public.is_manager() or assignee_id = auth.uid()
  )
);
-- update: admins all; teacher/team_leader own dept or tasks they created/review;
-- members only their own assigned tasks (status/progress workflow — protected cols guarded below)
create policy tasks_update on public.tasks for update using (
  public.is_approved() and deleted_at is null and (
    public.is_admin()
    or (public.is_manager() and (department_id = public.my_department() or created_by = auth.uid() or reviewer_id = auth.uid()))
    or assignee_id = auth.uid()
  )
);
-- delete = soft delete via update; hard delete admins only
create policy tasks_delete on public.tasks for delete using (public.is_admin());

-- Column guard: plain members can't change points/penalty/bonus/reviewer or approve their own review
create or replace function public.guard_task_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    if new.points       is distinct from old.points
    or new.late_penalty is distinct from old.late_penalty
    or new.bonus        is distinct from old.bonus
    or new.reviewer_id  is distinct from old.reviewer_id
    or new.quality_rating is distinct from old.quality_rating then
      raise exception 'Not authorized to change scoring fields';
    end if;
    -- members cannot self-approve: in_review → done requires reviewer or manager
    if old.status = 'in_review' and new.status = 'done' and old.reviewer_id is distinct from auth.uid() then
      raise exception 'Only the reviewer can approve this task';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_task before update on public.tasks
for each row execute function public.guard_task_columns();

-- ---------- TASK SUB-RESOURCES (visible if parent task visible) ----------
create or replace function public.can_see_task(tid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = tid and t.deleted_at is null and (
      public.is_manager()
      or t.assignee_id = auth.uid() or t.created_by = auth.uid() or t.reviewer_id = auth.uid()
      or (t.department_id is not null and t.department_id = public.my_department())
    )
  ) and public.is_approved()
$$;

create policy deps_select on public.task_dependencies for select using (public.can_see_task(task_id));
create policy deps_write  on public.task_dependencies for insert with check (public.is_manager() and public.can_see_task(task_id));
create policy deps_delete on public.task_dependencies for delete using (public.is_manager() and public.can_see_task(task_id));

create policy checklist_select on public.task_checklist_items for select using (public.can_see_task(task_id));
create policy checklist_insert on public.task_checklist_items for insert with check (public.can_see_task(task_id));
create policy checklist_update on public.task_checklist_items for update using (public.can_see_task(task_id));
create policy checklist_delete on public.task_checklist_items for delete using (public.can_see_task(task_id));

create policy comments_select on public.task_comments for select using (public.can_see_task(task_id) and deleted_at is null);
create policy comments_insert on public.task_comments for insert with check (public.can_see_task(task_id) and author_id = auth.uid());
create policy comments_update on public.task_comments for update using (author_id = auth.uid() or public.is_admin());

create policy attachments_select on public.task_attachments for select using (public.can_see_task(task_id));
create policy attachments_insert on public.task_attachments for insert with check (public.can_see_task(task_id) and uploaded_by = auth.uid());
create policy attachments_delete on public.task_attachments for delete using (uploaded_by = auth.uid() or public.is_admin());

create policy history_select on public.task_history for select using (public.can_see_task(task_id));

-- ---------- ATTENDANCE ----------
create policy attendance_select_own on public.attendance for select using (user_id = auth.uid());
create policy attendance_select_mgr on public.attendance for select using (public.is_manager());
create policy attendance_insert_own on public.attendance for insert with check (public.is_approved() and user_id = auth.uid());
create policy attendance_update_own on public.attendance for update
  using (user_id = auth.uid() and work_date = (now() at time zone 'utc')::date);
create policy attendance_mgr_all on public.attendance for all using (public.is_manager()) with check (public.is_manager());

-- ---------- NOTIFICATIONS ----------
create policy notif_select on public.notifications for select using (user_id = auth.uid());
create policy notif_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete using (user_id = auth.uid());

-- ---------- AUDIT LOGS ----------
create policy audit_select_admin on public.audit_logs for select using (public.is_admin());
create policy audit_insert on public.audit_logs for insert with check (auth.uid() is not null and actor_id = auth.uid());

-- ---------- PERFORMANCE SNAPSHOTS ----------
create policy perf_select_own on public.performance_snapshots for select using (user_id = auth.uid());
create policy perf_select_mgr on public.performance_snapshots for select using (public.is_manager());

-- ---------- STORAGE BUCKETS ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars','avatars', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments','attachments', false, 52428800)
on conflict (id) do nothing;

-- avatars: anyone reads, user writes only into own folder <uid>/...
create policy avatar_read on storage.objects for select using (bucket_id = 'avatars');
create policy avatar_write on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatar_update on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatar_delete on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- attachments: authenticated read; write into own folder
create policy attach_read on storage.objects for select
  using (bucket_id = 'attachments' and auth.uid() is not null);
create policy attach_write on storage.objects for insert
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy attach_delete on storage.objects for delete
  using (bucket_id = 'attachments' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ==========================================
-- SOURCE: supabase\migrations\0004_rpc_performance.sql
-- ==========================================
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

-- ==========================================
-- SOURCE: supabase\seed_demo.sql
-- ==========================================
-- ============================================================
-- seed_demo.sql — DEMO DATA for TeamPulse
-- Run AFTER migrations 0001→0004, in the Supabase SQL Editor.
-- Creates 6 login-ready demo accounts (email already confirmed):
--
--   admin@teampulse.demo    / Demo1234!   → Super Admin
--   owner@teampulse.demo    / Demo1234!   → Owner
--   teacher@teampulse.demo  / Demo1234!   → Teacher
--   lead@teampulse.demo     / Demo1234!   → Team Leader
--   student@teampulse.demo  / Demo1234!   → Student
--   intern@teampulse.demo   / Demo1234!   → Intern
--
-- ⚠ FOR TESTING ONLY. Delete these accounts before real production use:
--   delete from auth.users where email like '%@teampulse.demo';
-- ============================================================

-- ---------- 0. Temporarily disable column-guard triggers ----------
-- (they block role/status/points changes for non-admin sessions — the SQL
--  editor has no auth.uid(), so we lift the guards just for this seed)
alter table public.profiles disable trigger trg_guard_profile;
alter table public.tasks    disable trigger trg_guard_task;

-- ---------- 1. Demo auth users (trigger auto-creates profiles) ----------
do $$
declare
  uids uuid[] := array[
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666'
  ];
  emails text[] := array[
    'admin@teampulse.demo','owner@teampulse.demo','teacher@teampulse.demo',
    'lead@teampulse.demo','student@teampulse.demo','intern@teampulse.demo'
  ];
  names text[] := array[
    'Ava Anderson','Oliver Owens','Tara Torres','Liam Lee','Sofia Silva','Ivan Ivanov'
  ];
  i int;
begin
  for i in 1..6 loop
    if not exists (select 1 from auth.users where id = uids[i]) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, recovery_token,
        email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', uids[i], 'authenticated', 'authenticated',
        emails[i], crypt('Demo1234!', gen_salt('bf')),
        now(), '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', names[i]),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        uids[i]::text, uids[i],
        jsonb_build_object('sub', uids[i]::text, 'email', emails[i], 'email_verified', true),
        'email', now(), now(), now()
      );
    end if;
  end loop;
end $$;

-- ---------- 2. Departments ----------
insert into public.departments (id, name, description) values
  ('aaaa0001-0000-4000-8000-000000000001', 'Engineering',  'Product development and infrastructure'),
  ('aaaa0001-0000-4000-8000-000000000002', 'Design',       'UI/UX and brand design'),
  ('aaaa0001-0000-4000-8000-000000000003', 'Education',    'Training programs and mentorship')
on conflict (name) do nothing;

-- ---------- 3. Promote roles + approve + assign departments ----------
-- (profiles were auto-created by the signup trigger; first-ever user may
--  already be super_admin — these updates are idempotent and explicit)
update public.profiles set role='super_admin', status='approved', department_id='aaaa0001-0000-4000-8000-000000000001',
  phone='+1 555 010 0001', bio='Platform administrator. Keeps the lights on.' where id='11111111-1111-4111-8111-111111111111';
update public.profiles set role='owner', status='approved', department_id='aaaa0001-0000-4000-8000-000000000001',
  phone='+1 555 010 0002', bio='Company owner. Big-picture person.' where id='22222222-2222-4222-8222-222222222222';
update public.profiles set role='teacher', status='approved', department_id='aaaa0001-0000-4000-8000-000000000003',
  phone='+1 555 010 0003', bio='Mentor and instructor for the intern program.' where id='33333333-3333-4333-8333-333333333333';
update public.profiles set role='team_leader', status='approved', department_id='aaaa0001-0000-4000-8000-000000000001',
  phone='+1 555 010 0004', bio='Leads the platform squad.' where id='44444444-4444-4444-8444-444444444444';
update public.profiles set role='student', status='approved', department_id='aaaa0001-0000-4000-8000-000000000002',
  phone='+1 555 010 0005', bio='Design student, learning fast.' where id='55555555-5555-4555-8555-555555555555';
update public.profiles set role='intern', status='approved', department_id='aaaa0001-0000-4000-8000-000000000001',
  phone='+1 555 010 0006', bio='Engineering intern, first rotation.' where id='66666666-6666-4666-8666-666666666666';

-- ---------- 4. Tasks across the whole workflow ----------
-- helper aliases
-- admin=1111, owner=2222, teacher=3333, lead=4444, student=5555, intern=6666
insert into public.tasks (id, title, description, status, priority, difficulty, points, late_penalty, bonus,
                          due_at, created_by, assignee_id, reviewer_id, department_id, recurrence) values
-- intern's tasks
('bbbb0001-0000-4000-8000-000000000001','Set up local development environment',
 'Install toolchain, clone repos, run the app locally. Document any issues you hit.',
 'done','high','easy',10,2,0, now() - interval '5 days',
 '44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444',
 'aaaa0001-0000-4000-8000-000000000001','none'),
('bbbb0001-0000-4000-8000-000000000002','Fix login page validation bug',
 'Email field accepts invalid formats. Add proper validation and error messages.',
 'in_progress','urgent','medium',25,5,5, now() + interval '1 day',
 '44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444',
 'aaaa0001-0000-4000-8000-000000000001','none'),
('bbbb0001-0000-4000-8000-000000000003','Write unit tests for auth module',
 'Cover happy path + edge cases. Target 80% coverage on the auth service.',
 'in_review','high','hard',40,5,10, now() + interval '2 days',
 '44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333',
 'aaaa0001-0000-4000-8000-000000000001','none'),
('bbbb0001-0000-4000-8000-000000000004','Weekly progress report',
 'Summarize what you shipped, blockers, and next week''s plan.',
 'todo','medium','trivial',5,1,0, now() + interval '3 days',
 '33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',null,
 'aaaa0001-0000-4000-8000-000000000001','weekly'),
-- student's tasks
('bbbb0001-0000-4000-8000-000000000005','Redesign dashboard empty states',
 'Create friendly illustrations + copy for all empty states in the app.',
 'in_progress','medium','medium',20,3,5, now() + interval '4 days',
 '44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',
 'aaaa0001-0000-4000-8000-000000000002','none'),
('bbbb0001-0000-4000-8000-000000000006','Design system color audit',
 'Check contrast ratios (WCAG AA) across light and dark themes.',
 'done','high','medium',30,5,10, now() - interval '2 days',
 '33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333',
 'aaaa0001-0000-4000-8000-000000000002','none'),
('bbbb0001-0000-4000-8000-000000000007','Mobile navigation prototype',
 'Figma prototype for the new bottom-nav pattern. Test with 3 users.',
 'changes_requested','high','hard',35,5,0, now() + interval '5 days',
 '44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',
 'aaaa0001-0000-4000-8000-000000000002','none'),
-- lead's tasks
('bbbb0001-0000-4000-8000-000000000008','Q3 sprint planning',
 'Break down the Q3 roadmap into sprints. Estimate with the team.',
 'todo','urgent','hard',50,10,15, now() + interval '2 days',
 '22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
 'aaaa0001-0000-4000-8000-000000000001','none'),
('bbbb0001-0000-4000-8000-000000000009','Code review backlog cleanup',
 'Clear the review queue — 12 PRs waiting.',
 'in_progress','high','medium',20,5,0, now() + interval '1 day',
 '44444444-4444-4444-8444-444444444444','44444444-4444-4444-8444-444444444444',null,
 'aaaa0001-0000-4000-8000-000000000001','none'),
-- teacher's tasks
('bbbb0001-0000-4000-8000-000000000010','Prepare onboarding workshop',
 'Slides + hands-on exercises for the new intern cohort.',
 'in_progress','medium','medium',25,3,5, now() + interval '6 days',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
 'aaaa0001-0000-4000-8000-000000000003','none'),
('bbbb0001-0000-4000-8000-000000000011','Monthly mentorship 1:1s',
 'Individual check-ins with every student and intern.',
 'todo','medium','easy',15,2,0, now() + interval '7 days',
 '33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333',null,
 'aaaa0001-0000-4000-8000-000000000003','monthly'),
-- backlog & misc
('bbbb0001-0000-4000-8000-000000000012','Evaluate CI pipeline speed',
 'Builds take 14 min. Investigate caching and parallelization.',
 'backlog','low','hard',30,0,10, null,
 '44444444-4444-4444-8444-444444444444',null,null,
 'aaaa0001-0000-4000-8000-000000000001','none'),
('bbbb0001-0000-4000-8000-000000000013','Accessibility audit of public pages',
 'Screen-reader pass + keyboard navigation check.',
 'backlog','medium','medium',25,0,5, null,
 '33333333-3333-4333-8333-333333333333',null,null,
 'aaaa0001-0000-4000-8000-000000000002','none'),
('bbbb0001-0000-4000-8000-000000000014','Deprecated API cleanup',
 'Remove v1 endpoints after the migration window closes.',
 'cancelled','low','easy',10,0,0, now() - interval '10 days',
 '44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666',null,
 'aaaa0001-0000-4000-8000-000000000001','none')
on conflict (id) do nothing;

-- subtask example
insert into public.tasks (id, title, status, priority, difficulty, points,
                          created_by, assignee_id, department_id, parent_task_id) values
('bbbb0001-0000-4000-8000-000000000015','Add validation error styles','done','medium','easy',5,
 '44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666',
 'aaaa0001-0000-4000-8000-000000000001','bbbb0001-0000-4000-8000-000000000002'),
('bbbb0001-0000-4000-8000-000000000016','Add e2e test for login flow','todo','medium','medium',10,
 '44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666',
 'aaaa0001-0000-4000-8000-000000000001','bbbb0001-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- dependency: sprint planning depends on review backlog cleanup
insert into public.task_dependencies (task_id, depends_on_id) values
('bbbb0001-0000-4000-8000-000000000008','bbbb0001-0000-4000-8000-000000000009')
on conflict do nothing;

-- ---------- 5. Checklists ----------
insert into public.task_checklist_items (task_id, label, is_done, position) values
('bbbb0001-0000-4000-8000-000000000002','Reproduce the bug locally', true, 1),
('bbbb0001-0000-4000-8000-000000000002','Add email regex validation', true, 2),
('bbbb0001-0000-4000-8000-000000000002','Show inline error message', false, 3),
('bbbb0001-0000-4000-8000-000000000002','Add regression test', false, 4),
('bbbb0001-0000-4000-8000-000000000005','Inventory all empty states', true, 1),
('bbbb0001-0000-4000-8000-000000000005','Draft illustrations', false, 2),
('bbbb0001-0000-4000-8000-000000000005','Write friendly copy', false, 3),
('bbbb0001-0000-4000-8000-000000000010','Outline curriculum', true, 1),
('bbbb0001-0000-4000-8000-000000000010','Build slide deck', false, 2),
('bbbb0001-0000-4000-8000-000000000010','Prepare exercises', false, 3);

-- ---------- 6. Comments ----------
insert into public.task_comments (task_id, author_id, body) values
('bbbb0001-0000-4000-8000-000000000002','44444444-4444-4444-8444-444444444444','Priority bump — this is blocking the release. Let me know if you need help.'),
('bbbb0001-0000-4000-8000-000000000002','66666666-6666-4666-8666-666666666666','Found the root cause: regex was missing the TLD check. Fix incoming today.'),
('bbbb0001-0000-4000-8000-000000000003','66666666-6666-4666-8666-666666666666','Submitted for review — coverage is at 84%.'),
('bbbb0001-0000-4000-8000-000000000007','44444444-4444-4444-8444-444444444444','The tab bar overlaps the safe area on iPhone. Please adjust bottom padding and resubmit.'),
('bbbb0001-0000-4000-8000-000000000005','55555555-5555-4555-8555-555555555555','Empty state inventory done — 9 screens total. Starting sketches.'),
('bbbb0001-0000-4000-8000-000000000010','22222222-2222-4222-8222-222222222222','Can you include a section on our code review culture?');

-- ---------- 7. Attendance (last 7 days for everyone) ----------
insert into public.attendance (user_id, work_date, check_in_at, check_out_at, status)
select p.id, d::date,
  d + time '08:55' + (random() * interval '35 minutes'),
  d + time '17:30' + (random() * interval '60 minutes'),
  'present'
from public.profiles p
cross join generate_series(current_date - 6, current_date - 1, interval '1 day') d
where p.email like '%@teampulse.demo'
  and extract(isodow from d) < 6
on conflict (user_id, work_date) do nothing;
-- (the trigger auto-marks 'late' where check-in landed after 09:15)

-- one excused absence for the student
update public.attendance set status='excused', note='Medical appointment', check_in_at=null, check_out_at=null
where user_id='55555555-5555-4555-8555-555555555555' and work_date = current_date - 3;

-- ---------- 7b. Fix up tasks seeded directly as 'done' ----------
-- (the points trigger fires on status TRANSITIONS; direct inserts need explicit values)
update public.tasks set
  completed_at = coalesce(completed_at, updated_at),
  progress = 100,
  awarded_points = points + bonus,
  quality_rating = 5,
  started_at = coalesce(started_at, created_at)
where id in ('bbbb0001-0000-4000-8000-000000000001',
             'bbbb0001-0000-4000-8000-000000000006',
             'bbbb0001-0000-4000-8000-000000000015')
  and status = 'done' and awarded_points is null;

-- credit earned points to profiles
update public.profiles p set points = p.points + sub.total
from (
  select assignee_id, sum(awarded_points) as total
  from public.tasks
  where status = 'done' and awarded_points is not null
    and assignee_id is not null
  group by assignee_id
) sub
where p.id = sub.assignee_id and p.points = 0;

-- ---------- 8. Welcome notifications ----------
insert into public.notifications (user_id, kind, title, body)
select id, 'system', 'Welcome to TeamPulse 🎉', 'This is a demo workspace. Explore tasks, the board, attendance and the leaderboard.'
from public.profiles where email like '%@teampulse.demo';

-- ---------- 9. Re-enable security guards ----------
alter table public.profiles enable trigger trg_guard_profile;
alter table public.tasks    enable trigger trg_guard_task;

-- ---------- 10. Sanity check ----------
select 'users' as entity, count(*) from public.profiles where email like '%@teampulse.demo'
union all select 'departments', count(*) from public.departments
union all select 'tasks', count(*) from public.tasks
union all select 'checklist items', count(*) from public.task_checklist_items
union all select 'comments', count(*) from public.task_comments
union all select 'attendance rows', count(*) from public.attendance;


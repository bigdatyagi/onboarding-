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

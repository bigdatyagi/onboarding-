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

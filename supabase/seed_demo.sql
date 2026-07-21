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

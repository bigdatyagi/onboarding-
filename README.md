# TeamPulse — Team & Intern Management Platform

## Project Overview
- **Name**: TeamPulse (`webapp`)
- **Goal**: Enterprise team/intern management — tasks, attendance, performance scoring, RBAC
- **Stack**: Hono (Cloudflare Pages) + Supabase (Postgres/Auth/Storage/Realtime) + Vanilla ES-module SPA + TailwindCSS + Chart.js

## URLs
- **Sandbox (dev)**: https://3000-i730s7t0vx3yn3gi9ntmt-2e1b9533.sandbox.novita.ai
- **Production**: not yet deployed (Cloudflare Pages ready)

## ✅ Completed Features
- **Auth**: email/password signup with verification, login, forgot/reset password, session management, route guards
- **Account lifecycle**: first user auto-becomes `super_admin` + approved; everyone else is `pending` until an admin approves (gate screen for pending/suspended/rejected)
- **RBAC**: 6 roles (super_admin, owner, teacher, team_leader, student, intern) enforced in **both UI and database** (RLS + column-guard triggers; no self-escalation, no self-approval of reviews)
- **Profiles**: photo upload (canvas center-crop → 512px WebP compress → Supabase Storage), phone, department, bio, auto employee ID (`EMP-1001…`), profile-completeness tracking, points
- **Tasks**: priority, difficulty, deadline, status workflow (backlog→todo→in_progress→in_review→changes_requested→done/cancelled), progress, points/late-penalty/bonus, checklists (auto-sync progress %), threaded comments, file attachments (private bucket, signed URLs), subtasks, dependencies (DB-enforced blocking), recurring tasks (auto-respawn), full per-task history, review flow with quality rating (1–5★) + review note
- **Task list**: search, status/priority/scope filters, column sorting, pagination, CSV export
- **Kanban board**: drag & drop between columns, realtime auto-refresh
- **Attendance**: check-in/out, auto late detection (>09:15 UTC), monthly calendar, manager team-today view
- **Performance engine** (SQL): score = 30% completion + 25% on-time + 20% attendance + 15% quality + 10% activity; daily/weekly/monthly/quarterly/yearly periods; snapshots table
- **Leaderboard**: ranked podium + table per period
- **Dashboard**: live personal + team KPIs, 7-day completions bar chart, status doughnut, recent activity, check-in quick action
- **Notifications**: realtime (Supabase channels) — task assigned/reviewed/commented, due-soon/overdue reminders (idempotent RPC), account events; unread badge, mark-all-read
- **Admin panel**: user approval/reject/suspend/reinstate, role management, departments CRUD, global audit log
- **UX**: dark/light mode (no flash), glassmorphism, skeleton loaders, toasts, command palette (⌘K), keyboard nav, responsive (mobile sidebar), a11y labels, online presence dots

## Data Architecture
- **Storage**: Supabase Postgres (12 tables), Storage buckets `avatars` (public) & `attachments` (private), Realtime channels
- **Migrations** (`supabase/migrations/`, run in order in the SQL Editor):
  1. `0001_schema.sql` — enums, tables, indexes, constraints
  2. `0002_functions_triggers.sql` — role helpers, auto-profile on signup, task lifecycle/points/history/recurrence/notification triggers
  3. `0003_rls_policies.sql` — RLS on every table, column guards, storage policies
  4. `0004_rpc_performance.sql` — performance engine, leaderboard, dashboard stats, reminders, admin RPCs, `v_task_board` view
- **Key security**: all queries via anon key + RLS; `security definer` RPCs check roles internally; protected columns (role/status/points) blocked by triggers

## 🧪 Demo Accounts (after running `supabase/seed_demo.sql`)
All demo accounts share the password **`Demo1234!`** (emails are pre-confirmed):

| Email | Role | Department |
|---|---|---|
| `admin@teampulse.demo` | Super Admin | Engineering |
| `owner@teampulse.demo` | Owner | Engineering |
| `teacher@teampulse.demo` | Teacher | Education |
| `lead@teampulse.demo` | Team Leader | Engineering |
| `student@teampulse.demo` | Student | Engineering |
| `intern@teampulse.demo` | Intern | Engineering |

Seed data: 3 departments, 16 tasks (all statuses, subtasks, a dependency, recurring tasks), checklists, comments, 7 days of attendance, notifications.

> ⚠️ Demo accounts are for testing only — delete them (or change passwords) before real production use:
> `delete from auth.users where email like '%@teampulse.demo';`

## Setup Guide
1. Create a project at supabase.com → SQL Editor → run migrations 0001→0004 in order
   - **One-paste option**: run `teampulse_setup_with_demo.sql` (all migrations + demo data) in the SQL Editor
2. (Recommended) Auth → Providers → Email: keep "Confirm email" ON
3. Auth → URL Configuration → set Site URL to your app URL
4. Provide env vars:
   - Local: fill `.dev.vars` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) then restart
   - Production: `npx wrangler pages secret put SUPABASE_URL` / `SUPABASE_ANON_KEY` (or dashboard env vars)
5. Sign up — the **first account becomes Super Admin automatically**
6. Admin → Departments: create departments; Admin → Users: approve teammates

## User Guide
- **Members**: check in daily, work tasks through the workflow, submit for review, earn points
- **Managers**: create/assign tasks with points & reviewers, review submissions with quality ratings, monitor attendance & leaderboard
- **Admins**: approve accounts, manage roles/departments, inspect audit log

## ✅ Test Results (validated on PostgreSQL 17 with Supabase-compatible shim)
- All 4 migrations + demo seed apply cleanly end-to-end
- 30/30 HTTP tests pass (API, all 14 SPA routes, all 14 static assets)
- Points engine: award on done (base+bonus−late), clawback on reopen ✓
- Task history logging, checklist→progress sync ✓
- Dependency blocking (unfinished blocker prevents start) ✓
- Recurring task respawn (weekly → next due date) ✓
- Attendance late detection (09:30 → late, 08:55 → present) ✓
- Notification fan-out on assignment ✓
- RBAC guards: self role-escalation blocked, points tampering blocked, scoring-field tampering blocked, self review-approval blocked ✓
- RLS: intern sees 10/16 tasks, admin 16/16, unauthenticated 0; notifications strictly per-user ✓
- RPCs: leaderboard, compute_performance, dashboard stats, snapshots, reminders (idempotent), admin ops, soft delete ✓
- Security headers live; no secrets in git; `.dev.vars` ignored

## 🔜 Not Yet Implemented
- Production deployment to Cloudflare Pages (awaiting user's choice: BYOK vs Genspark-hosted)
- Scheduled snapshot generation (currently on-demand; could use Supabase pg_cron)
- Bulk task actions & import
- Automated test suite (Playwright E2E scaffold recommended next)

## Deployment
- **Platform**: Cloudflare Pages (Hono edge) — build: `npm run build`, output `dist/`
- **Status**: ✅ Dev running (PM2 + wrangler pages dev) · ⬜ Production pending
- **Last Updated**: 2026-07-24

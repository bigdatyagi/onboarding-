// ============ Dashboard: live stats, charts, activity, attendance quick action ============
import { state, esc, toast, navigate, skeletonList, fromNow, avatarHtml, isManager, STATUS_META } from './core.js'
import { renderShell } from './layout.js'

let charts = []

export async function renderDashboard() {
  const content = renderShell('/', skeletonList(5, 20))
  charts.forEach(c => c.destroy()); charts = []

  // fire reminders check (idempotent server-side)
  state.sb.rpc('run_due_reminders').then(() => {})

  const [{ data: stats, error }, { data: recentTasks }] = await Promise.all([
    state.sb.rpc('get_dashboard_stats'),
    state.sb.from('v_task_board').select('*').is('parent_task_id', null)
      .order('updated_at', { ascending: false }).limit(6),
  ])
  if (error) { content.innerHTML = `<div class="card p-8 text-center text-rose-500">${esc(error.message)}</div>`; return }

  const p = state.profile
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const team = stats.team

  content.innerHTML = `
  <section aria-labelledby="dash-heading">
    <header class="flex flex-wrap items-center gap-4 mb-6">
      <div class="flex-1">
        <h1 id="dash-heading" class="text-2xl font-extrabold tracking-tight">${greeting}, ${esc((p.full_name || '').split(' ')[0] || 'there')} 👋</h1>
        <p class="text-sm text-slate-400">Here's what's happening today.</p>
      </div>
      <div class="flex gap-2">
        ${!stats.checked_in_today
          ? '<button id="btn-checkin" class="btn btn-primary"><i class="fas fa-fingerprint"></i> Check in</button>'
          : !stats.checked_out_today
            ? '<button id="btn-checkout" class="btn btn-ghost"><i class="fas fa-door-open"></i> Check out</button>'
            : '<span class="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 py-2 px-3"><i class="fas fa-check"></i> Day complete</span>'}
      </div>
    </header>

    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      ${statCard('fa-list-check','indigo','Open tasks', stats.my_open_tasks, '/tasks')}
      ${statCard('fa-eye','amber','In review', stats.my_in_review, '/tasks')}
      ${statCard('fa-fire','rose','Overdue', stats.my_overdue, '/tasks')}
      ${statCard('fa-circle-check','emerald','Done this month', stats.my_done_month, '/tasks')}
      ${statCard('fa-clipboard-check','violet','Reviews pending', stats.my_reviews_pending, '/tasks')}
      ${statCard('fa-star','amber','My points', stats.my_points, '/leaderboard')}
    </div>

    ${team ? `
    <h2 class="text-sm font-bold uppercase tracking-wide text-slate-400 mb-3">Team overview</h2>
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      ${statCard('fa-users','sky','Active members', team.total_users, '/team')}
      ${statCard('fa-user-clock','amber','Pending approval', team.pending_users, '/admin')}
      ${statCard('fa-list','indigo','Open tasks', team.open_tasks, '/tasks')}
      ${statCard('fa-triangle-exclamation','rose','Overdue', team.overdue_tasks, '/tasks')}
      ${statCard('fa-calendar-check','emerald','Present today', team.present_today, '/attendance')}
      ${statCard('fa-bolt','violet','Done this week', team.done_this_week, '/tasks')}
    </div>` : ''}

    <div class="grid lg:grid-cols-3 gap-5">
      <div class="card p-5 lg:col-span-2">
        <h2 class="font-bold mb-4"><i class="fas fa-chart-line text-indigo-400 mr-2"></i>Completions — last 7 days</h2>
        <div class="h-56"><canvas id="chart-week" role="img" aria-label="Task completions over the last 7 days"></canvas></div>
      </div>
      <div class="card p-5">
        <h2 class="font-bold mb-4"><i class="fas fa-chart-pie text-indigo-400 mr-2"></i>Tasks by status</h2>
        <div class="h-56"><canvas id="chart-status" role="img" aria-label="Task status breakdown"></canvas></div>
      </div>
    </div>

    <div class="card p-5 mt-5">
      <header class="flex items-center justify-between mb-4">
        <h2 class="font-bold"><i class="fas fa-clock-rotate-left text-indigo-400 mr-2"></i>Recently updated</h2>
        <a href="/tasks" data-link class="text-xs font-semibold text-indigo-500 hover:underline">View all →</a>
      </header>
      <ul class="divide-y divide-slate-100 dark:divide-slate-800">
        ${(recentTasks||[]).map(t => `
          <li><a href="/tasks/${t.id}" data-link class="flex items-center gap-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg px-2 -mx-2">
            <span class="badge ${STATUS_META[t.status].color}">${STATUS_META[t.status].label}</span>
            <span class="text-sm font-medium flex-1 truncate">${esc(t.title)}</span>
            ${avatarHtml({ full_name: t.assignee_name, avatar_url: t.assignee_avatar }, 5)}
            <span class="text-xs text-slate-400 hidden sm:inline">${fromNow(t.updated_at)}</span>
          </a></li>`).join('') || '<li class="py-6 text-center text-sm text-slate-400">No tasks yet — create your first one!</li>'}
      </ul>
    </div>
  </section>`

  // attendance quick actions
  document.getElementById('btn-checkin')?.addEventListener('click', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await state.sb.from('attendance').upsert(
      { user_id: state.session.user.id, work_date: today, check_in_at: new Date().toISOString(), status: 'present' },
      { onConflict: 'user_id,work_date' })
    if (error) return toast(error.message, 'error')
    toast('Checked in — have a great day!', 'success')
    renderDashboard()
  })
  document.getElementById('btn-checkout')?.addEventListener('click', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await state.sb.from('attendance')
      .update({ check_out_at: new Date().toISOString() })
      .eq('user_id', state.session.user.id).eq('work_date', today)
    if (error) return toast(error.message, 'error')
    toast('Checked out — see you tomorrow!', 'success')
    renderDashboard()
  })

  // charts (live data from RPC)
  const dark = document.documentElement.classList.contains('dark')
  const gridColor = dark ? 'rgba(148,163,184,.12)' : 'rgba(148,163,184,.2)'
  const textColor = dark ? '#94a3b8' : '#64748b'
  const weekly = stats.weekly_completions || []
  const weekCtx = document.getElementById('chart-week')
  if (weekCtx) charts.push(new Chart(weekCtx, {
    type: 'bar',
    data: {
      labels: weekly.map(w => dayjs(w.day).format('ddd D')),
      datasets: [{ label: 'Completed', data: weekly.map(w => w.count),
        backgroundColor: 'rgba(99,102,241,.7)', borderRadius: 6, maxBarThickness: 42 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0, color: textColor }, grid: { color: gridColor } },
                x: { ticks: { color: textColor }, grid: { display: false } } } }
  }))
  const sb = stats.status_breakdown || {}
  const keys = Object.keys(sb)
  const colors = { backlog:'#94a3b8', todo:'#38bdf8', in_progress:'#6366f1', in_review:'#f59e0b', changes_requested:'#fb923c', done:'#10b981', cancelled:'#f43f5e' }
  const statusCtx = document.getElementById('chart-status')
  if (statusCtx) charts.push(new Chart(statusCtx, {
    type: 'doughnut',
    data: { labels: keys.map(k => STATUS_META[k]?.label || k),
      datasets: [{ data: keys.map(k => sb[k]), backgroundColor: keys.map(k => colors[k] || '#a3a3a3'), borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { color: textColor, boxWidth: 10, font: { size: 11 } } } } }
  }))
}

function statCard(icon, color, label, value, link) {
  const colorMap = {
    indigo:'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10', amber:'text-amber-500 bg-amber-50 dark:bg-amber-500/10',
    rose:'text-rose-500 bg-rose-50 dark:bg-rose-500/10', emerald:'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10',
    violet:'text-violet-500 bg-violet-50 dark:bg-violet-500/10', sky:'text-sky-500 bg-sky-50 dark:bg-sky-500/10',
  }
  return `<a href="${link}" data-link class="card p-4 hover:shadow-md transition-shadow">
    <div class="w-9 h-9 rounded-lg ${colorMap[color]} flex items-center justify-center mb-3"><i class="fas ${icon}"></i></div>
    <div class="text-2xl font-extrabold leading-none">${value ?? 0}</div>
    <div class="text-xs text-slate-400 mt-1">${label}</div>
  </a>`
}

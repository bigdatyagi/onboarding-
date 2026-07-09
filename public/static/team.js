// ============ Team directory + member performance drill-down ============
import { state, esc, toast, skeletonList, avatarHtml, isManager, fromNow, debounce,
         ROLE_LABEL, ROLE_COLOR, openModal, closeModal } from './core.js'
import { renderShell } from './layout.js'

let filter = { search: '', dept: '', role: '' }

export async function renderTeam() {
  const content = renderShell('/team', `
    <section aria-labelledby="team-heading">
      <header class="flex flex-wrap items-center gap-3 mb-5">
        <h1 id="team-heading" class="text-xl font-extrabold tracking-tight">Team</h1>
        <div class="flex-1"></div>
      </header>
      <div class="card p-4 mb-4">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="relative">
            <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
            <input id="tm-search" class="input pl-9" placeholder="Search members…" aria-label="Search members">
          </div>
          <select id="tm-dept" class="input" aria-label="Filter by department">
            <option value="">All departments</option>
            ${state.departments.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
          </select>
          <select id="tm-role" class="input" aria-label="Filter by role">
            <option value="">All roles</option>
            ${Object.entries(ROLE_LABEL).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="team-grid" class="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">${skeletonList(4, 24)}</div>
    </section>`)

  document.getElementById('tm-search').addEventListener('input', debounce((e) => { filter.search = e.target.value.toLowerCase(); paint() }))
  document.getElementById('tm-dept').onchange = (e) => { filter.dept = e.target.value; paint() }
  document.getElementById('tm-role').onchange = (e) => { filter.role = e.target.value; paint() }
  paint()
}

function paint() {
  const grid = document.getElementById('team-grid')
  if (!grid) return
  const deptName = (id) => state.departments.find(d => d.id === id)?.name || '—'
  const online = (u) => u.last_seen_at && (Date.now() - new Date(u.last_seen_at).getTime()) < 5 * 60 * 1000
  const rows = state.users.filter(u =>
    (!filter.search || u.full_name.toLowerCase().includes(filter.search) || (u.email||'').toLowerCase().includes(filter.search)) &&
    (!filter.dept || u.department_id === filter.dept) &&
    (!filter.role || u.role === filter.role))
  if (!rows.length) {
    grid.innerHTML = '<div class="col-span-full card p-10 text-center text-slate-400"><i class="fas fa-user-slash text-3xl mb-3 block"></i>No members match your filters.</div>'
    return
  }
  grid.innerHTML = rows.map(u => `
    <article class="card p-5 text-center hover:shadow-md transition-shadow cursor-pointer" data-member="${u.id}" tabindex="0" role="button" aria-label="View ${esc(u.full_name)}">
      <div class="relative inline-block mb-3">
        ${avatarHtml(u, 14)}
        <span class="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 ${online(u) ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}" title="${online(u) ? 'Online' : 'Offline'}"></span>
      </div>
      <h3 class="font-bold text-sm truncate">${esc(u.full_name)}</h3>
      <p class="text-[11px] text-slate-400 truncate mb-2">${esc(u.email)}</p>
      <span class="badge ${ROLE_COLOR[u.role]}">${ROLE_LABEL[u.role]}</span>
      <div class="flex justify-center gap-4 mt-3 text-xs text-slate-400">
        <span title="Department"><i class="fas fa-building"></i> ${esc(deptName(u.department_id))}</span>
        <span title="Points" class="font-bold text-indigo-500"><i class="fas fa-star"></i> ${u.points}</span>
      </div>
    </article>`).join('')
  grid.querySelectorAll('[data-member]').forEach(el => {
    const open = () => openMember(el.dataset.member)
    el.onclick = open
    el.onkeydown = (e) => { if (e.key === 'Enter') open() }
  })
}

async function openMember(id) {
  const u = state.users.find(x => x.id === id)
  if (!u) return
  openModal(`<div class="text-center">${skeletonList(3, 12)}</div>`)
  const [{ data: perf }, { data: openTasks }] = await Promise.all([
    state.sb.rpc('compute_performance', {
      p_user: id,
      p_start: dayjs().startOf('month').format('YYYY-MM-DD'),
      p_end: dayjs().format('YYYY-MM-DD'),
    }),
    state.sb.from('v_task_board').select('id,title,status').eq('assignee_id', id)
      .not('status', 'in', '("done","cancelled")').limit(5),
  ])
  const p = perf?.[0]
  const deptName = state.departments.find(d => d.id === u.department_id)?.name || '—'
  openModal(`
    <div class="text-center mb-5">
      <div class="flex justify-center mb-3">${avatarHtml(u, 16)}</div>
      <h3 class="text-lg font-bold">${esc(u.full_name)}</h3>
      <p class="text-xs text-slate-400">${esc(u.email)} · ${esc(u.employee_id || '')}</p>
      <span class="badge ${ROLE_COLOR[u.role]} mt-2">${ROLE_LABEL[u.role]}</span>
      <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300 mt-2 ml-1"><i class="fas fa-building"></i> ${esc(deptName)}</span>
    </div>
    ${p ? `
    <h4 class="font-bold text-xs uppercase tracking-wide text-slate-400 mb-3">This month</h4>
    <div class="grid grid-cols-4 gap-2 mb-5 text-center">
      <div class="card p-2"><div class="font-extrabold text-indigo-500">${(+p.overall_score).toFixed(0)}</div><div class="text-[10px] text-slate-400">Score</div></div>
      <div class="card p-2"><div class="font-extrabold">${p.tasks_done}/${p.tasks_assigned}</div><div class="text-[10px] text-slate-400">Tasks</div></div>
      <div class="card p-2"><div class="font-extrabold">${(+p.on_time_pct).toFixed(0)}%</div><div class="text-[10px] text-slate-400">On-time</div></div>
      <div class="card p-2"><div class="font-extrabold">${(+p.attendance_pct).toFixed(0)}%</div><div class="text-[10px] text-slate-400">Attend</div></div>
    </div>` : ''}
    ${openTasks?.length ? `
    <h4 class="font-bold text-xs uppercase tracking-wide text-slate-400 mb-2">Open tasks</h4>
    <ul class="space-y-1 mb-4">${openTasks.map(t => `
      <li><a href="/tasks/${t.id}" data-link class="text-sm text-indigo-500 hover:underline truncate block">• ${esc(t.title)}</a></li>`).join('')}
    </ul>` : ''}
    <button class="btn btn-ghost w-full" id="mb-close">Close</button>`)
  document.getElementById('mb-close').onclick = closeModal
}

// ============ Leaderboard: ranked performance across periods ============
import { state, esc, toast, skeletonList, avatarHtml, ROLE_LABEL, ROLE_COLOR } from './core.js'
import { renderShell } from './layout.js'

let period = 'monthly'

export async function renderLeaderboard() {
  const content = renderShell('/leaderboard', `
    <section aria-labelledby="lb-heading">
      <header class="flex flex-wrap items-center gap-3 mb-5">
        <h1 id="lb-heading" class="text-xl font-extrabold tracking-tight">Leaderboard</h1>
        <div class="flex-1"></div>
        <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1" role="tablist" aria-label="Period">
          ${['daily','weekly','monthly','quarterly','yearly'].map(pd => `
            <button role="tab" aria-selected="${period===pd}" data-period="${pd}"
              class="px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${period===pd ? 'bg-white dark:bg-slate-700 shadow text-indigo-600 dark:text-indigo-300' : 'text-slate-500'}">
              ${pd[0].toUpperCase()+pd.slice(1)}</button>`).join('')}
        </div>
      </header>
      <div id="lb-body">${skeletonList(6, 14)}</div>
    </section>`)
  content.querySelectorAll('[data-period]').forEach(btn => {
    btn.onclick = () => { period = btn.dataset.period; renderLeaderboard() }
  })
  await loadRows()
}

async function loadRows() {
  const body = document.getElementById('lb-body')
  const { data, error } = await state.sb.rpc('get_leaderboard', { p_period: period, p_limit: 50 })
  if (error) { body.innerHTML = `<div class="card p-8 text-center text-rose-500">${esc(error.message)}</div>`; return }
  if (!data?.length) { body.innerHTML = '<div class="card p-10 text-center text-slate-400"><i class="fas fa-trophy text-3xl mb-3 block"></i>No data yet for this period.</div>'; return }

  const podium = data.slice(0, 3)
  const rest = data.slice(3)
  const medal = ['🥇','🥈','🥉']

  body.innerHTML = `
    <div class="grid grid-cols-3 gap-4 mb-6">
      ${podium.map((u, i) => `
        <article class="card p-5 text-center ${i===0 ? 'ring-2 ring-amber-400 order-2' : i===1 ? 'order-1' : 'order-3'} ${u.user_id === state.session.user.id ? 'bg-indigo-50/50 dark:bg-indigo-500/5' : ''}">
          <div class="text-3xl mb-2">${medal[i]}</div>
          <div class="flex justify-center mb-2">${avatarHtml(u, 12)}</div>
          <h3 class="font-bold text-sm truncate">${esc(u.full_name)}</h3>
          <span class="badge ${ROLE_COLOR[u.role]} mt-1">${ROLE_LABEL[u.role]}</span>
          <div class="text-2xl font-extrabold text-indigo-500 mt-2">${(+u.overall_score).toFixed(1)}</div>
          <div class="text-[11px] text-slate-400">overall score</div>
        </article>`).join('')}
    </div>
    <div class="card overflow-x-auto">
      <table class="table-pro">
        <thead><tr><th>#</th><th>Member</th><th>Dept</th><th>Score</th><th>Done</th><th>On-time</th><th>Attendance</th><th>Points</th></tr></thead>
        <tbody>
          ${data.map(u => `
            <tr class="${u.user_id === state.session.user.id ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : ''}">
              <td class="font-bold text-slate-400">${u.rank}</td>
              <td><div class="flex items-center gap-2">${avatarHtml(u, 7)}
                <div><div class="font-semibold text-sm">${esc(u.full_name)}${u.user_id === state.session.user.id ? ' <span class="text-[10px] text-indigo-500 font-bold">YOU</span>' : ''}</div>
                <span class="badge ${ROLE_COLOR[u.role]}">${ROLE_LABEL[u.role]}</span></div></div></td>
              <td class="text-xs text-slate-400">${esc(u.department_name || '—')}</td>
              <td><div class="flex items-center gap-2 min-w-[110px]">
                <div class="progress-track flex-1"><div class="progress-fill" style="width:${Math.min(100, u.overall_score)}%"></div></div>
                <span class="font-bold text-sm">${(+u.overall_score).toFixed(1)}</span></div></td>
              <td class="font-semibold">${u.tasks_done}</td>
              <td>${(+u.on_time_pct).toFixed(0)}%</td>
              <td>${(+u.attendance_pct).toFixed(0)}%</td>
              <td class="font-bold text-indigo-500">${u.points}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="text-[11px] text-slate-400 mt-3"><i class="fas fa-circle-info"></i>
      Score = 30% completion + 25% on-time + 20% attendance + 15% quality + 10% activity</p>`
}

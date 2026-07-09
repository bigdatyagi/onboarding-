// ============ Attendance: my calendar + manager team view ============
import { state, esc, toast, skeletonList, avatarHtml, isManager, fmtDateTime } from './core.js'
import { renderShell } from './layout.js'

const STATUS_BADGE = {
  present: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  late:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  absent:  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  excused: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
}
let month = dayjs().startOf('month')

export async function renderAttendance() {
  const content = renderShell('/attendance', skeletonList(4, 20))
  await draw(content)
}

async function draw(content) {
  const today = dayjs().format('YYYY-MM-DD')
  const mStart = month.format('YYYY-MM-DD')
  const mEnd = month.endOf('month').format('YYYY-MM-DD')

  const [{ data: mine }, teamRes] = await Promise.all([
    state.sb.from('attendance').select('*').eq('user_id', state.session.user.id)
      .gte('work_date', mStart).lte('work_date', mEnd).order('work_date'),
    isManager()
      ? state.sb.from('attendance').select('*, user:profiles!attendance_user_id_fkey(full_name, avatar_url, employee_id)')
          .eq('work_date', today).order('check_in_at')
      : Promise.resolve({ data: null }),
  ])
  const byDate = Object.fromEntries((mine || []).map(a => [a.work_date, a]))
  const todayRec = byDate[today]

  // calendar grid
  const firstDow = (month.day() + 6) % 7 // Monday-first
  const daysInMonth = month.daysInMonth()
  let cells = ''
  for (let i = 0; i < firstDow; i++) cells += '<div></div>'
  for (let d = 1; d <= daysInMonth; d++) {
    const date = month.date(d)
    const key = date.format('YYYY-MM-DD')
    const rec = byDate[key]
    const isToday = key === today
    const weekend = [6, 0].includes(date.day())
    cells += `<div class="aspect-square flex flex-col items-center justify-center rounded-xl text-sm relative
        ${isToday ? 'ring-2 ring-indigo-500' : ''} ${weekend ? 'opacity-40' : ''}
        ${rec ? (rec.status === 'late' ? 'bg-amber-100 dark:bg-amber-500/15' : rec.status === 'absent' ? 'bg-rose-100 dark:bg-rose-500/15' : rec.status === 'excused' ? 'bg-sky-100 dark:bg-sky-500/15' : 'bg-emerald-100 dark:bg-emerald-500/15') : 'bg-slate-50 dark:bg-slate-800/50'}"
        title="${rec ? `${rec.status}${rec.check_in_at ? ' · in ' + dayjs(rec.check_in_at).format('HH:mm') : ''}${rec.check_out_at ? ' · out ' + dayjs(rec.check_out_at).format('HH:mm') : ''}` : ''}">
      <span class="font-semibold">${d}</span>
      ${rec ? `<i class="fas ${rec.status==='late'?'fa-clock text-amber-500':rec.status==='absent'?'fa-xmark text-rose-500':rec.status==='excused'?'fa-notes-medical text-sky-500':'fa-check text-emerald-500'} text-[10px]"></i>` : ''}
    </div>`
  }

  const workdays = (mine || []).filter(a => ['present','late','excused'].includes(a.status)).length
  const lates = (mine || []).filter(a => a.status === 'late').length

  content.innerHTML = `
  <section aria-labelledby="att-heading">
    <header class="flex flex-wrap items-center gap-3 mb-5">
      <h1 id="att-heading" class="text-xl font-extrabold tracking-tight">Attendance</h1>
      <div class="flex-1"></div>
      ${!todayRec?.check_in_at
        ? '<button id="att-checkin" class="btn btn-primary btn-sm"><i class="fas fa-fingerprint"></i> Check in</button>'
        : !todayRec?.check_out_at
          ? '<button id="att-checkout" class="btn btn-ghost btn-sm"><i class="fas fa-door-open"></i> Check out</button>'
          : `<span class="text-xs text-slate-400">In ${dayjs(todayRec.check_in_at).format('HH:mm')} · Out ${dayjs(todayRec.check_out_at).format('HH:mm')}</span>`}
    </header>

    <div class="grid lg:grid-cols-3 gap-5">
      <div class="card p-5 lg:col-span-2">
        <header class="flex items-center justify-between mb-4">
          <h2 class="font-bold">${month.format('MMMM YYYY')}</h2>
          <div class="flex gap-1">
            <button id="cal-prev" class="btn btn-ghost btn-sm" aria-label="Previous month"><i class="fas fa-chevron-left"></i></button>
            <button id="cal-today" class="btn btn-ghost btn-sm">Today</button>
            <button id="cal-next" class="btn btn-ghost btn-sm" aria-label="Next month"><i class="fas fa-chevron-right"></i></button>
          </div>
        </header>
        <div class="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-slate-400 mb-2">
          <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
        </div>
        <div class="grid grid-cols-7 gap-1.5">${cells}</div>
        <footer class="flex gap-4 mt-4 text-xs text-slate-400">
          <span><i class="fas fa-check text-emerald-500"></i> Present</span>
          <span><i class="fas fa-clock text-amber-500"></i> Late</span>
          <span><i class="fas fa-notes-medical text-sky-500"></i> Excused</span>
          <span><i class="fas fa-xmark text-rose-500"></i> Absent</span>
        </footer>
      </div>

      <div class="space-y-5">
        <div class="card p-5">
          <h2 class="font-bold text-sm uppercase tracking-wide text-slate-400 mb-4">This month</h2>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between"><dt class="text-slate-400">Days attended</dt><dd class="font-bold">${workdays}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Late arrivals</dt><dd class="font-bold ${lates ? 'text-amber-500' : ''}">${lates}</dd></div>
          </dl>
        </div>
        ${teamRes.data ? `
        <div class="card p-5">
          <h2 class="font-bold text-sm uppercase tracking-wide text-slate-400 mb-4">Team — today (${teamRes.data.length})</h2>
          <ul class="space-y-3 max-h-96 overflow-y-auto">
            ${teamRes.data.map(a => `
              <li class="flex items-center gap-3">
                ${avatarHtml(a.user, 7)}
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold truncate">${esc(a.user?.full_name)}</div>
                  <div class="text-[11px] text-slate-400">${a.check_in_at ? 'In ' + dayjs(a.check_in_at).format('HH:mm') : ''}${a.check_out_at ? ' · Out ' + dayjs(a.check_out_at).format('HH:mm') : ''}</div>
                </div>
                <span class="badge ${STATUS_BADGE[a.status]}">${a.status}</span>
              </li>`).join('') || '<li class="text-sm text-slate-400">Nobody checked in yet.</li>'}
          </ul>
        </div>` : ''}
      </div>
    </div>
  </section>`

  document.getElementById('cal-prev').onclick = () => { month = month.subtract(1, 'month'); draw(content) }
  document.getElementById('cal-next').onclick = () => { month = month.add(1, 'month'); draw(content) }
  document.getElementById('cal-today').onclick = () => { month = dayjs().startOf('month'); draw(content) }
  document.getElementById('att-checkin')?.addEventListener('click', async () => {
    const { error } = await state.sb.from('attendance').upsert(
      { user_id: state.session.user.id, work_date: today, check_in_at: new Date().toISOString(), status: 'present' },
      { onConflict: 'user_id,work_date' })
    if (error) return toast(error.message, 'error')
    toast('Checked in!', 'success'); draw(content)
  })
  document.getElementById('att-checkout')?.addEventListener('click', async () => {
    const { error } = await state.sb.from('attendance')
      .update({ check_out_at: new Date().toISOString() })
      .eq('user_id', state.session.user.id).eq('work_date', today)
    if (error) return toast(error.message, 'error')
    toast('Checked out!', 'success'); draw(content)
  })
}

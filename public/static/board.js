// ============ Kanban board with drag & drop + realtime refresh ============
import { state, esc, toast, navigate, avatarHtml, isManager, STATUS_META, PRIORITY_META, fmtDate } from './core.js'
import { renderShell } from './layout.js'
import { openTaskForm } from './tasks.js'

const COLS = ['backlog','todo','in_progress','in_review','changes_requested','done']
let boardChannel = null
let boardScope = 'mine'

export async function renderBoard() {
  const content = renderShell('/board', `
    <section aria-labelledby="board-heading">
      <header class="flex flex-wrap items-center gap-3 mb-5">
        <h1 id="board-heading" class="text-xl font-extrabold tracking-tight">Board</h1>
        <select id="board-scope" class="input" style="width:auto" aria-label="Board scope">
          <option value="mine" ${boardScope==='mine'?'selected':''}>My tasks</option>
          ${isManager() ? `<option value="all" ${boardScope==='all'?'selected':''}>All tasks</option>` : ''}
        </select>
        <div class="flex-1"></div>
        <button id="btn-board-new" class="btn btn-primary btn-sm"><i class="fas fa-plus"></i> New Task</button>
      </header>
      <div id="board-cols" class="flex gap-4 overflow-x-auto pb-4"></div>
    </section>`)

  document.getElementById('board-scope').onchange = (e) => { boardScope = e.target.value; loadBoard() }
  document.getElementById('btn-board-new').onclick = () => openTaskForm(null, null, loadBoard)

  // realtime: refresh board on any task change
  if (boardChannel) state.sb.removeChannel(boardChannel)
  boardChannel = state.sb.channel('board-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
      if (location.pathname === '/board') loadBoard()
    })
    .subscribe()
  state.channels.push(boardChannel)

  await loadBoard()
}

async function loadBoard() {
  const wrap = document.getElementById('board-cols')
  if (!wrap) return
  let q = state.sb.from('v_task_board').select('*').is('parent_task_id', null).neq('status','cancelled')
  if (boardScope === 'mine') q = q.or(`assignee_id.eq.${state.session.user.id},created_by.eq.${state.session.user.id},reviewer_id.eq.${state.session.user.id}`)
  const { data, error } = await q.order('priority', { ascending: false }).order('due_at', { ascending: true, nullsFirst: false }).limit(400)
  if (error) return toast(error.message, 'error')
  const byCol = Object.fromEntries(COLS.map(c => [c, []]))
  ;(data || []).forEach(t => { if (byCol[t.status]) byCol[t.status].push(t) })

  wrap.innerHTML = COLS.map(col => `
    <div class="kanban-col" data-col="${col}">
      <div class="flex items-center gap-2 mb-3 px-1">
        <span class="badge ${STATUS_META[col].color}"><i class="fas ${STATUS_META[col].icon}"></i>${STATUS_META[col].label}</span>
        <span class="text-xs text-slate-400 font-semibold">${byCol[col].length}</span>
      </div>
      <div class="space-y-2 min-h-[120px] rounded-xl" data-dropzone="${col}">
        ${byCol[col].map(t => cardHtml(t)).join('')}
      </div>
    </div>`).join('')

  // card events
  wrap.querySelectorAll('[data-card]').forEach(card => {
    card.onclick = () => navigate('/tasks/' + card.dataset.card)
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.card)
      card.classList.add('dragging')
    })
    card.addEventListener('dragend', () => card.classList.remove('dragging'))
  })
  // dropzones
  wrap.querySelectorAll('[data-dropzone]').forEach(zone => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.closest('.kanban-col').classList.add('drag-over') })
    zone.addEventListener('dragleave', () => zone.closest('.kanban-col').classList.remove('drag-over'))
    zone.addEventListener('drop', async (e) => {
      e.preventDefault()
      zone.closest('.kanban-col').classList.remove('drag-over')
      const taskId = e.dataTransfer.getData('text/plain')
      const to = zone.dataset.dropzone
      const { error } = await state.sb.from('tasks').update({ status: to }).eq('id', taskId)
      if (error) toast(error.message, 'error')
      else toast(`Moved to ${STATUS_META[to].label}`, 'success')
      loadBoard()
    })
  })
}

function cardHtml(t) {
  const pr = PRIORITY_META[t.priority]
  const overdue = t.due_at && new Date(t.due_at) < new Date() && !['done'].includes(t.status)
  return `
  <article class="kanban-card card p-3" draggable="true" data-card="${t.id}" tabindex="0" aria-label="${esc(t.title)}">
    <div class="flex items-start gap-2">
      <span class="text-xs font-bold ${pr.color} mt-0.5" title="${pr.label}"><i class="fas ${pr.icon}"></i></span>
      <h3 class="text-sm font-semibold flex-1 leading-snug">${esc(t.title)}</h3>
    </div>
    ${t.checklist_total > 0 ? `<div class="progress-track mt-2"><div class="progress-fill" style="width:${t.progress}%"></div></div>` : ''}
    <footer class="flex items-center gap-2 mt-2.5">
      ${avatarHtml({ full_name: t.assignee_name, avatar_url: t.assignee_avatar }, 5)}
      <span class="text-[11px] text-slate-400 flex-1 truncate">${esc(t.assignee_name || 'Unassigned')}</span>
      ${t.due_at ? `<span class="text-[11px] font-semibold ${overdue ? 'text-rose-500' : 'text-slate-400'}"><i class="fas fa-calendar"></i> ${fmtDate(t.due_at)}</span>` : ''}
      <span class="text-[11px] font-bold text-indigo-500">${t.points}pt</span>
    </footer>
  </article>`
}

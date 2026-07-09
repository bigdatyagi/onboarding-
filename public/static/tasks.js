// ============ Tasks: list (filter/sort/search/paginate/export), create/edit, detail ============
import { state, esc, fmtDate, fmtDateTime, fromNow, toast, openModal, closeModal, confirmDialog,
         navigate, skeletonList, avatarHtml, isManager, isAdmin,
         STATUS_META, PRIORITY_META, DIFFICULTY, debounce } from './core.js'
import { renderShell } from './layout.js'

const PAGE_SIZE = 15
const q = { search: '', status: '', priority: '', scope: 'mine', sort: 'created_at', dir: 'desc', page: 0 }

export async function renderTasks() {
  const content = renderShell('/tasks', `
    <section aria-labelledby="tasks-heading">
      <header class="flex flex-wrap items-center gap-3 mb-5">
        <h1 id="tasks-heading" class="text-xl font-extrabold tracking-tight">Tasks</h1>
        <div class="flex-1"></div>
        <button id="btn-export-csv" class="btn btn-ghost btn-sm"><i class="fas fa-file-export"></i> Export CSV</button>
        <button id="btn-new-task" class="btn btn-primary btn-sm"><i class="fas fa-plus"></i> New Task</button>
      </header>
      <div class="card p-4 mb-4">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div class="col-span-2 relative">
            <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
            <input id="f-search" class="input pl-9" placeholder="Search tasks…" value="${esc(q.search)}" aria-label="Search tasks">
          </div>
          <select id="f-scope" class="input" aria-label="Scope">
            <option value="mine" ${q.scope==='mine'?'selected':''}>My tasks</option>
            <option value="review" ${q.scope==='review'?'selected':''}>Needs my review</option>
            <option value="created" ${q.scope==='created'?'selected':''}>Created by me</option>
            ${isManager() ? `<option value="all" ${q.scope==='all'?'selected':''}>All tasks</option>` : ''}
          </select>
          <select id="f-status" class="input" aria-label="Filter by status">
            <option value="">All statuses</option>
            ${Object.entries(STATUS_META).map(([k,v]) => `<option value="${k}" ${q.status===k?'selected':''}>${v.label}</option>`).join('')}
          </select>
          <select id="f-priority" class="input" aria-label="Filter by priority">
            <option value="">All priorities</option>
            ${Object.entries(PRIORITY_META).map(([k,v]) => `<option value="${k}" ${q.priority===k?'selected':''}>${v.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="card overflow-x-auto">
        <table class="table-pro" id="tasks-table">
          <thead><tr>
            <th class="sortable" data-sort="title">Task <i class="fas fa-sort text-slate-300"></i></th>
            <th>Assignee</th>
            <th class="sortable" data-sort="status">Status <i class="fas fa-sort text-slate-300"></i></th>
            <th class="sortable" data-sort="priority">Priority <i class="fas fa-sort text-slate-300"></i></th>
            <th class="sortable" data-sort="due_at">Due <i class="fas fa-sort text-slate-300"></i></th>
            <th>Progress</th>
            <th class="sortable" data-sort="points">Pts <i class="fas fa-sort text-slate-300"></i></th>
          </tr></thead>
          <tbody id="tasks-tbody"><tr><td colspan="7">${skeletonList(5, 10)}</td></tr></tbody>
        </table>
        <footer class="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <span id="tasks-count" class="text-xs text-slate-400"></span>
          <div class="flex gap-1">
            <button id="pg-prev" class="btn btn-ghost btn-sm" aria-label="Previous page"><i class="fas fa-chevron-left"></i></button>
            <button id="pg-next" class="btn btn-ghost btn-sm" aria-label="Next page"><i class="fas fa-chevron-right"></i></button>
          </div>
        </footer>
      </div>
    </section>`)

  const reload = () => loadTaskRows()
  document.getElementById('f-search').addEventListener('input', debounce((e) => { q.search = e.target.value; q.page = 0; reload() }))
  document.getElementById('f-scope').onchange = (e) => { q.scope = e.target.value; q.page = 0; reload() }
  document.getElementById('f-status').onchange = (e) => { q.status = e.target.value; q.page = 0; reload() }
  document.getElementById('f-priority').onchange = (e) => { q.priority = e.target.value; q.page = 0; reload() }
  content.querySelectorAll('th.sortable').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.sort
      if (q.sort === col) q.dir = q.dir === 'asc' ? 'desc' : 'asc'
      else { q.sort = col; q.dir = 'asc' }
      reload()
    }
  })
  document.getElementById('pg-prev').onclick = () => { if (q.page > 0) { q.page--; reload() } }
  document.getElementById('pg-next').onclick = () => { q.page++; reload() }
  document.getElementById('btn-new-task').onclick = () => openTaskForm()
  document.getElementById('btn-export-csv').onclick = exportCsv
  await loadTaskRows()
}

function buildQuery() {
  let query = state.sb.from('v_task_board').select('*', { count: 'exact' }).is('parent_task_id', null)
  if (q.scope === 'mine')    query = query.eq('assignee_id', state.session.user.id)
  if (q.scope === 'review')  query = query.eq('reviewer_id', state.session.user.id).eq('status', 'in_review')
  if (q.scope === 'created') query = query.eq('created_by', state.session.user.id)
  if (q.status)   query = query.eq('status', q.status)
  if (q.priority) query = query.eq('priority', q.priority)
  if (q.search)   query = query.ilike('title', `%${q.search.replaceAll('%','')}%`)
  return query.order(q.sort, { ascending: q.dir === 'asc', nullsFirst: false })
}

async function loadTaskRows() {
  const tbody = document.getElementById('tasks-tbody')
  if (!tbody) return
  const from = q.page * PAGE_SIZE
  const { data, count, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
  if (error) { toast(error.message, 'error'); return }
  document.getElementById('tasks-count').textContent = `${count ?? 0} task${count === 1 ? '' : 's'} · page ${q.page + 1} of ${Math.max(1, Math.ceil((count||0)/PAGE_SIZE))}`
  document.getElementById('pg-prev').disabled = q.page === 0
  document.getElementById('pg-next').disabled = from + PAGE_SIZE >= (count || 0)
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-12 text-slate-400">
      <i class="fas fa-clipboard-list text-3xl mb-3 block"></i>No tasks match your filters.</td></tr>`
    return
  }
  tbody.innerHTML = data.map(t => {
    const s = STATUS_META[t.status], pr = PRIORITY_META[t.priority]
    const overdue = t.due_at && new Date(t.due_at) < new Date() && !['done','cancelled'].includes(t.status)
    return `<tr class="cursor-pointer" data-task="${t.id}" tabindex="0" role="link" aria-label="Open task ${esc(t.title)}">
      <td>
        <div class="font-semibold">${esc(t.title)}</div>
        <div class="text-xs text-slate-400 flex gap-3 mt-0.5">
          ${t.subtask_count > 0 ? `<span><i class="fas fa-diagram-project"></i> ${t.subtask_count}</span>` : ''}
          ${t.checklist_total > 0 ? `<span><i class="fas fa-square-check"></i> ${t.checklist_done}/${t.checklist_total}</span>` : ''}
          ${t.comment_count > 0 ? `<span><i class="fas fa-comment"></i> ${t.comment_count}</span>` : ''}
          ${t.attachment_count > 0 ? `<span><i class="fas fa-paperclip"></i> ${t.attachment_count}</span>` : ''}
          ${t.recurrence !== 'none' ? `<span><i class="fas fa-repeat"></i> ${t.recurrence}</span>` : ''}
        </div>
      </td>
      <td><div class="flex items-center gap-2">${avatarHtml({full_name: t.assignee_name, avatar_url: t.assignee_avatar}, 6)}<span class="text-xs">${esc(t.assignee_name || 'Unassigned')}</span></div></td>
      <td><span class="badge ${s.color}"><i class="fas ${s.icon}"></i>${s.label}</span></td>
      <td><span class="text-xs font-semibold ${pr.color}"><i class="fas ${pr.icon}"></i> ${pr.label}</span></td>
      <td class="${overdue ? 'text-rose-500 font-semibold' : ''}">${t.due_at ? fmtDate(t.due_at) : '—'}${overdue ? ' <i class="fas fa-fire"></i>' : ''}</td>
      <td class="min-w-[110px]"><div class="progress-track"><div class="progress-fill" style="width:${t.progress}%"></div></div><span class="text-[10px] text-slate-400">${t.progress}%</span></td>
      <td class="font-bold text-indigo-500">${t.awarded_points ?? t.points}</td>
    </tr>`
  }).join('')
  tbody.querySelectorAll('[data-task]').forEach(tr => {
    tr.onclick = () => navigate('/tasks/' + tr.dataset.task)
    tr.onkeydown = (e) => { if (e.key === 'Enter') navigate('/tasks/' + tr.dataset.task) }
  })
}

async function exportCsv() {
  const { data, error } = await buildQuery().range(0, 999)
  if (error) return toast(error.message, 'error')
  const cols = ['title','status','priority','difficulty','assignee_name','reviewer_name','department_name','due_at','progress','points','awarded_points','created_at','completed_at']
  const csv = [cols.join(',')].concat((data||[]).map(r =>
    cols.map(c => `"${String(r[c] ?? '').replaceAll('"','""')}"`).join(','))).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tasks_${dayjs().format('YYYY-MM-DD')}.csv` })
  a.click(); URL.revokeObjectURL(a.href)
  toast('CSV exported', 'success')
}

// ---------- create / edit form ----------
export function openTaskForm(task = null, parentId = null, onSaved = null) {
  const mgr = isManager()
  const users = state.users
  openModal(`
    <h3 class="text-lg font-bold mb-4">${task ? 'Edit task' : parentId ? 'New subtask' : 'New task'}</h3>
    <form id="task-form" novalidate>
      <div class="mb-3">
        <label class="field" for="t-title">Title *</label>
        <input id="t-title" class="input" required maxlength="200" value="${esc(task?.title || '')}" placeholder="What needs to be done?">
      </div>
      <div class="mb-3">
        <label class="field" for="t-desc">Description</label>
        <textarea id="t-desc" class="input" rows="3" maxlength="20000" placeholder="Details, context, acceptance criteria…">${esc(task?.description || '')}</textarea>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div><label class="field" for="t-priority">Priority</label>
          <select id="t-priority" class="input">${Object.entries(PRIORITY_META).map(([k,v]) => `<option value="${k}" ${(task?.priority||'medium')===k?'selected':''}>${v.label}</option>`).join('')}</select></div>
        <div><label class="field" for="t-difficulty">Difficulty</label>
          <select id="t-difficulty" class="input">${DIFFICULTY.map(d => `<option value="${d}" ${(task?.difficulty||'medium')===d?'selected':''}>${d[0].toUpperCase()+d.slice(1)}</option>`).join('')}</select></div>
        <div><label class="field" for="t-due">Due date</label>
          <input id="t-due" class="input" type="datetime-local" value="${task?.due_at ? dayjs(task.due_at).format('YYYY-MM-DDTHH:mm') : ''}"></div>
        <div><label class="field" for="t-recur">Recurrence</label>
          <select id="t-recur" class="input">${['none','daily','weekly','monthly'].map(r => `<option value="${r}" ${(task?.recurrence||'none')===r?'selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select></div>
        <div><label class="field" for="t-assignee">Assignee</label>
          <select id="t-assignee" class="input">
            ${mgr ? '<option value="">Unassigned</option>' : ''}
            ${users.filter(u => mgr || u.id === state.session.user.id).map(u =>
              `<option value="${u.id}" ${(task?.assignee_id || state.session.user.id)===u.id?'selected':''}>${esc(u.full_name)}</option>`).join('')}
          </select></div>
        <div><label class="field" for="t-reviewer">Reviewer</label>
          <select id="t-reviewer" class="input" ${mgr ? '' : 'disabled'}>
            <option value="">None</option>
            ${users.map(u => `<option value="${u.id}" ${task?.reviewer_id===u.id?'selected':''}>${esc(u.full_name)}</option>`).join('')}
          </select></div>
      </div>
      ${mgr ? `
      <div class="grid grid-cols-3 gap-3 mb-3">
        <div><label class="field" for="t-points">Points</label><input id="t-points" class="input" type="number" min="0" max="1000" value="${task?.points ?? 10}"></div>
        <div><label class="field" for="t-penalty">Late penalty</label><input id="t-penalty" class="input" type="number" min="0" max="1000" value="${task?.late_penalty ?? 0}"></div>
        <div><label class="field" for="t-bonus">Bonus</label><input id="t-bonus" class="input" type="number" min="0" max="1000" value="${task?.bonus ?? 0}"></div>
      </div>
      <div class="mb-4"><label class="field" for="t-dept">Department</label>
        <select id="t-dept" class="input"><option value="">None</option>
          ${state.departments.map(d => `<option value="${d.id}" ${task?.department_id===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}
        </select></div>` : ''}
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost" id="t-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="t-save">${task ? 'Save changes' : 'Create task'}</button>
      </div>
      <p id="t-err" class="text-sm text-rose-500 mt-3 hidden" role="alert"></p>
    </form>`, { maxWidth: '640px' })

  document.getElementById('t-cancel').onclick = closeModal
  document.getElementById('task-form').onsubmit = async (e) => {
    e.preventDefault()
    const title = document.getElementById('t-title').value.trim()
    const err = document.getElementById('t-err')
    err.classList.add('hidden')
    if (!title) { err.textContent = 'Title is required.'; err.classList.remove('hidden'); return }
    const due = document.getElementById('t-due').value
    const payload = {
      title,
      description: document.getElementById('t-desc').value.trim() || null,
      priority: document.getElementById('t-priority').value,
      difficulty: document.getElementById('t-difficulty').value,
      due_at: due ? new Date(due).toISOString() : null,
      recurrence: document.getElementById('t-recur').value,
      assignee_id: document.getElementById('t-assignee').value || null,
      reviewer_id: document.getElementById('t-reviewer').value || null,
    }
    if (isManager()) {
      payload.points = +document.getElementById('t-points').value || 0
      payload.late_penalty = +document.getElementById('t-penalty').value || 0
      payload.bonus = +document.getElementById('t-bonus').value || 0
      payload.department_id = document.getElementById('t-dept')?.value || null
    }
    const btn = document.getElementById('t-save')
    btn.disabled = true
    let res
    if (task) res = await state.sb.from('tasks').update(payload).eq('id', task.id)
    else res = await state.sb.from('tasks').insert({ ...payload, created_by: state.session.user.id, parent_task_id: parentId })
    btn.disabled = false
    if (res.error) { err.textContent = res.error.message; err.classList.remove('hidden'); return }
    closeModal()
    toast(task ? 'Task updated' : 'Task created', 'success')
    if (onSaved) onSaved(); else if (location.pathname === '/tasks') loadTaskRows(); else navigate(location.pathname, true)
  }
}

// ---------- allowed status transitions ----------
export function allowedTransitions(t) {
  const me = state.session.user.id
  const mine = t.assignee_id === me
  const reviewer = t.reviewer_id === me
  const mgr = isManager()
  const map = {
    backlog:  mine || mgr ? ['todo'] : [],
    todo:     mine || mgr ? ['in_progress', ...(mgr ? ['cancelled'] : [])] : [],
    in_progress: [
      ...(mine || mgr ? (t.reviewer_id ? ['in_review'] : ['done']) : []),
      ...(mgr ? ['cancelled'] : []),
    ],
    in_review: (reviewer || mgr) ? ['done', 'changes_requested'] : [],
    changes_requested: mine || mgr ? ['in_progress'] : [],
    done:      mgr ? ['in_progress'] : [],
    cancelled: mgr ? ['todo'] : [],
  }
  return map[t.status] || []
}

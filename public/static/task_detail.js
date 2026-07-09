// ============ Task detail: checklist, comments, attachments, subtasks, deps, history, review ============
import { state, esc, fmtDate, fmtDateTime, fromNow, toast, openModal, closeModal, confirmDialog,
         navigate, skeletonList, avatarHtml, isManager, isAdmin, STATUS_META, PRIORITY_META } from './core.js'
import { renderShell } from './layout.js'
import { openTaskForm, allowedTransitions } from './tasks.js'

export async function renderTaskDetail(params) {
  const content = renderShell('/tasks', skeletonList(6, 14))
  const { data: t, error } = await state.sb.from('v_task_board').select('*').eq('id', params.id).single()
  if (error || !t) {
    content.innerHTML = `<div class="card p-10 text-center text-slate-400"><i class="fas fa-ghost text-3xl mb-3 block"></i>Task not found or you don't have access.</div>`
    return
  }

  const [{ data: checklist }, { data: comments }, { data: attachments }, { data: subtasks }, { data: history }, { data: deps }] = await Promise.all([
    state.sb.from('task_checklist_items').select('*').eq('task_id', t.id).order('position').order('created_at'),
    state.sb.from('task_comments').select('*, author:profiles!task_comments_author_id_fkey(full_name, avatar_url)').eq('task_id', t.id).is('deleted_at', null).order('created_at'),
    state.sb.from('task_attachments').select('*').eq('task_id', t.id).order('created_at'),
    state.sb.from('v_task_board').select('*').eq('parent_task_id', t.id),
    state.sb.from('task_history').select('*, actor:profiles!task_history_actor_id_fkey(full_name)').eq('task_id', t.id).order('created_at', { ascending: false }).limit(25),
    state.sb.from('task_dependencies').select('depends_on_id, dep:tasks!task_dependencies_depends_on_id_fkey(id, title, status)').eq('task_id', t.id),
  ])

  const s = STATUS_META[t.status], pr = PRIORITY_META[t.priority]
  const transitions = allowedTransitions(t)
  const canEdit = isManager() || t.created_by === state.session.user.id || t.assignee_id === state.session.user.id
  const overdue = t.due_at && new Date(t.due_at) < new Date() && !['done','cancelled'].includes(t.status)

  content.innerHTML = `
  <nav class="text-xs text-slate-400 mb-4" aria-label="Breadcrumb">
    <a href="/tasks" data-link class="hover:text-indigo-500">Tasks</a> <i class="fas fa-chevron-right mx-1 text-[9px]"></i> ${esc(t.title)}
  </nav>
  <div class="grid lg:grid-cols-3 gap-5">
    <section class="lg:col-span-2 space-y-5">
      <article class="card p-6" aria-labelledby="task-title">
        <header class="flex flex-wrap items-start gap-3 mb-4">
          <div class="flex-1 min-w-0">
            <h1 id="task-title" class="text-xl font-extrabold">${esc(t.title)}</h1>
            <div class="flex flex-wrap gap-2 mt-2">
              <span class="badge ${s.color}"><i class="fas ${s.icon}"></i>${s.label}</span>
              <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300"><i class="fas ${pr.icon} ${pr.color}"></i>${pr.label}</span>
              <span class="badge bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300"><i class="fas fa-signal"></i>${t.difficulty}</span>
              ${t.recurrence !== 'none' ? `<span class="badge bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><i class="fas fa-repeat"></i>${t.recurrence}</span>` : ''}
              ${overdue ? '<span class="badge bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"><i class="fas fa-fire"></i>Overdue</span>' : ''}
            </div>
          </div>
          <div class="flex gap-2">
            ${canEdit ? `<button id="btn-edit-task" class="btn btn-ghost btn-sm"><i class="fas fa-pen"></i> Edit</button>` : ''}
            ${(isManager() || t.created_by === state.session.user.id) ? `<button id="btn-del-task" class="btn btn-ghost btn-sm text-rose-500" aria-label="Delete task"><i class="fas fa-trash"></i></button>` : ''}
          </div>
        </header>
        ${t.description ? `<p class="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap mb-4">${esc(t.description)}</p>` : ''}
        ${t.review_note ? `<div class="text-sm bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg p-3 mb-4"><strong class="text-amber-700 dark:text-amber-300"><i class="fas fa-clipboard-check mr-1"></i>Review note:</strong> ${esc(t.review_note)}</div>` : ''}
        <div class="mb-2 flex items-center gap-3">
          <div class="progress-track flex-1"><div class="progress-fill" style="width:${t.progress}%"></div></div>
          <span class="text-xs font-bold text-slate-500">${t.progress}%</span>
        </div>
        ${transitions.length ? `<footer class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          ${transitions.map(st => `<button class="btn btn-sm ${st==='done'?'btn-primary':st==='changes_requested'?'btn-danger':'btn-ghost'}" data-transition="${st}">
            <i class="fas ${STATUS_META[st].icon}"></i> ${st==='changes_requested'?'Request changes':st==='in_review'?'Submit for review':(st==='done'&&t.status==='in_review')?'Approve':'Move to '+STATUS_META[st].label}</button>`).join('')}
        </footer>` : ''}
      </article>

      <article class="card p-6" aria-labelledby="cl-heading">
        <h2 id="cl-heading" class="font-bold mb-3"><i class="fas fa-square-check text-indigo-400 mr-2"></i>Checklist
          <span class="text-xs font-normal text-slate-400">(${(checklist||[]).filter(c=>c.is_done).length}/${(checklist||[]).length})</span></h2>
        <ul id="cl-list" class="space-y-1 mb-3">${(checklist||[]).map(ci => `
          <li class="flex items-center gap-2 group">
            <input type="checkbox" class="w-4 h-4 accent-indigo-500" data-cl-check="${ci.id}" ${ci.is_done ? 'checked' : ''} aria-label="${esc(ci.label)}">
            <span class="text-sm flex-1 ${ci.is_done ? 'line-through text-slate-400' : ''}">${esc(ci.label)}</span>
            <button class="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 p-1" data-cl-del="${ci.id}" aria-label="Delete item"><i class="fas fa-xmark"></i></button>
          </li>`).join('') || '<li class="text-sm text-slate-400">No checklist items yet.</li>'}
        </ul>
        <form id="cl-form" class="flex gap-2">
          <input id="cl-input" class="input" placeholder="Add checklist item…" maxlength="300">
          <button class="btn btn-ghost btn-sm" type="submit" aria-label="Add checklist item"><i class="fas fa-plus"></i></button>
        </form>
      </article>

      <article class="card p-6" aria-labelledby="st-heading">
        <header class="flex items-center justify-between mb-3">
          <h2 id="st-heading" class="font-bold"><i class="fas fa-diagram-project text-indigo-400 mr-2"></i>Subtasks</h2>
          <button id="btn-new-sub" class="btn btn-ghost btn-sm"><i class="fas fa-plus"></i> Add</button>
        </header>
        <ul class="space-y-2">${(subtasks||[]).map(st2 => `
          <li><a href="/tasks/${st2.id}" data-link class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <span class="badge ${STATUS_META[st2.status].color}">${STATUS_META[st2.status].label}</span>
            <span class="text-sm flex-1">${esc(st2.title)}</span>
            <span class="text-xs text-slate-400">${esc(st2.assignee_name || '')}</span>
          </a></li>`).join('') || '<li class="text-sm text-slate-400">No subtasks.</li>'}
        </ul>
      </article>

      <article class="card p-6" aria-labelledby="cm-heading">
        <h2 id="cm-heading" class="font-bold mb-4"><i class="fas fa-comments text-indigo-400 mr-2"></i>Comments (${(comments||[]).length})</h2>
        <ul id="cm-list" class="space-y-4 mb-4">${(comments||[]).map(cm => `
          <li class="flex gap-3">
            ${avatarHtml(cm.author, 8)}
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="text-sm font-semibold">${esc(cm.author?.full_name || 'Unknown')}</span>
                <span class="text-[11px] text-slate-400">${fromNow(cm.created_at)}</span>
                ${cm.author_id === state.session.user.id || isAdmin() ? `<button class="text-[11px] text-slate-300 hover:text-rose-500" data-cm-del="${cm.id}">delete</button>` : ''}
              </div>
              <p class="text-sm whitespace-pre-wrap mt-0.5">${esc(cm.body)}</p>
            </div>
          </li>`).join('') || '<li class="text-sm text-slate-400">No comments yet — start the conversation.</li>'}
        </ul>
        <form id="cm-form" class="flex gap-2 items-start">
          <textarea id="cm-input" class="input" rows="2" placeholder="Write a comment…" maxlength="5000" required></textarea>
          <button class="btn btn-primary btn-sm mt-1" type="submit" aria-label="Post comment"><i class="fas fa-paper-plane"></i></button>
        </form>
      </article>
    </section>

    <aside class="space-y-5">
      <section class="card p-5" aria-labelledby="meta-heading">
        <h2 id="meta-heading" class="font-bold text-sm mb-4 uppercase tracking-wide text-slate-400">Details</h2>
        <dl class="space-y-3 text-sm">
          <div class="flex justify-between items-center"><dt class="text-slate-400">Assignee</dt><dd class="font-semibold flex items-center gap-2">${avatarHtml({full_name:t.assignee_name, avatar_url:t.assignee_avatar},5)}${esc(t.assignee_name || 'Unassigned')}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Reviewer</dt><dd class="font-semibold">${esc(t.reviewer_name || '—')}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Creator</dt><dd class="font-semibold">${esc(t.creator_name || '—')}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Department</dt><dd class="font-semibold">${esc(t.department_name || '—')}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Due</dt><dd class="font-semibold ${overdue?'text-rose-500':''}">${fmtDateTime(t.due_at)}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Points</dt><dd class="font-bold text-indigo-500">${t.points}${t.bonus?` +${t.bonus}⭐`:''}${t.late_penalty?` −${t.late_penalty}⚠`:''}</dd></div>
          ${t.awarded_points != null ? `<div class="flex justify-between"><dt class="text-slate-400">Awarded</dt><dd class="font-bold text-emerald-500">${t.awarded_points}</dd></div>` : ''}
          ${t.quality_rating ? `<div class="flex justify-between"><dt class="text-slate-400">Quality</dt><dd class="text-amber-400">${'★'.repeat(t.quality_rating)}${'☆'.repeat(5-t.quality_rating)}</dd></div>` : ''}
          <div class="flex justify-between"><dt class="text-slate-400">Created</dt><dd>${fmtDate(t.created_at)}</dd></div>
          ${t.completed_at ? `<div class="flex justify-between"><dt class="text-slate-400">Completed</dt><dd>${fmtDateTime(t.completed_at)}</dd></div>` : ''}
        </dl>
      </section>

      <section class="card p-5" aria-labelledby="dep-heading">
        <header class="flex items-center justify-between mb-3">
          <h2 id="dep-heading" class="font-bold text-sm uppercase tracking-wide text-slate-400">Depends on</h2>
          ${isManager() ? '<button id="btn-add-dep" class="text-xs font-semibold text-indigo-500 hover:underline">+ Add</button>' : ''}
        </header>
        <ul class="space-y-2">${(deps||[]).map(d => `
          <li class="flex items-center gap-2 text-sm">
            <i class="fas ${d.dep.status==='done'?'fa-circle-check text-emerald-500':'fa-circle-half-stroke text-amber-500'}"></i>
            <a href="/tasks/${d.dep.id}" data-link class="hover:text-indigo-500 flex-1 truncate">${esc(d.dep.title)}</a>
            ${isManager() ? `<button class="text-slate-300 hover:text-rose-500" data-dep-del="${d.depends_on_id}" aria-label="Remove dependency"><i class="fas fa-xmark"></i></button>` : ''}
          </li>`).join('') || '<li class="text-sm text-slate-400">None</li>'}
        </ul>
      </section>

      <section class="card p-5" aria-labelledby="att-heading">
        <h2 id="att-heading" class="font-bold text-sm mb-3 uppercase tracking-wide text-slate-400">Attachments</h2>
        <ul class="space-y-2 mb-3">${(attachments||[]).map(a => `
          <li class="flex items-center gap-2 text-sm">
            <i class="fas fa-paperclip text-slate-400"></i>
            <button class="hover:text-indigo-500 flex-1 truncate text-left" data-att-dl="${esc(a.storage_path)}" data-att-name="${esc(a.file_name)}">${esc(a.file_name)}</button>
            <span class="text-[11px] text-slate-400">${a.size_bytes ? (a.size_bytes/1024).toFixed(0)+' KB' : ''}</span>
            ${a.uploaded_by === state.session.user.id || isAdmin() ? `<button class="text-slate-300 hover:text-rose-500" data-att-del="${a.id}" data-att-path="${esc(a.storage_path)}" aria-label="Delete attachment"><i class="fas fa-xmark"></i></button>` : ''}
          </li>`).join('') || '<li class="text-sm text-slate-400">No files</li>'}
        </ul>
        <label class="btn btn-ghost btn-sm w-full cursor-pointer"><i class="fas fa-upload"></i> Upload file
          <input id="att-input" type="file" class="hidden"></label>
      </section>

      <section class="card p-5" aria-labelledby="hist-heading">
        <h2 id="hist-heading" class="font-bold text-sm mb-3 uppercase tracking-wide text-slate-400">History</h2>
        <ul class="space-y-2 text-xs text-slate-500 dark:text-slate-400 max-h-64 overflow-y-auto">${(history||[]).map(h => `
          <li><span class="font-semibold">${esc(h.actor?.full_name || 'System')}</span>
            ${h.field === 'created' ? 'created this task' : `changed <span class="font-semibold">${esc(h.field)}</span>${h.new_value ? ` → ${esc((STATUS_META[h.new_value]?.label) || h.new_value)}` : ''}`}
            <span class="text-slate-300 dark:text-slate-600">· ${fromNow(h.created_at)}</span></li>`).join('') || '<li>No history</li>'}
        </ul>
      </section>
    </aside>
  </div>`

  bindEvents(t)
}

function bindEvents(t) {
  const reload = () => renderTaskDetail({ id: t.id })

  document.getElementById('btn-edit-task')?.addEventListener('click', () => openTaskForm(t, null, reload))
  document.getElementById('btn-del-task')?.addEventListener('click', async () => {
    if (!await confirmDialog('Delete task?', 'This will soft-delete the task. Admins can restore it from the database.', { danger: true, okLabel: 'Delete' })) return
    const { error } = await state.sb.rpc('soft_delete_task', { p_task: t.id })
    if (error) return toast(error.message, 'error')
    toast('Task deleted', 'success'); navigate('/tasks')
  })
  document.getElementById('btn-new-sub')?.addEventListener('click', () => openTaskForm(null, t.id, reload))

  // status transitions
  document.querySelectorAll('[data-transition]').forEach(btn => {
    btn.onclick = async () => {
      const to = btn.dataset.transition
      // reviewer flow with rating + note
      if (t.status === 'in_review' && (to === 'done' || to === 'changes_requested')) {
        openModal(`
          <h3 class="text-lg font-bold mb-4">${to === 'done' ? 'Approve task' : 'Request changes'}</h3>
          ${to === 'done' ? `<div class="mb-4"><label class="field">Quality rating</label>
            <div id="stars" class="flex gap-1 text-2xl text-amber-400">${[1,2,3,4,5].map(i => `<button type="button" data-star="${i}" aria-label="${i} stars"><i class="far fa-star"></i></button>`).join('')}</div></div>` : ''}
          <div class="mb-4"><label class="field" for="rv-note">Review note</label>
            <textarea id="rv-note" class="input" rows="3" placeholder="${to === 'done' ? 'Great work…' : 'Please fix…'}"></textarea></div>
          <div class="flex justify-end gap-2">
            <button class="btn btn-ghost" id="rv-cancel">Cancel</button>
            <button class="btn ${to==='done'?'btn-primary':'btn-danger'}" id="rv-ok">${to==='done'?'Approve':'Request changes'}</button>
          </div>`)
        let rating = 0
        document.querySelectorAll('[data-star]').forEach(sb => sb.onclick = () => {
          rating = +sb.dataset.star
          document.querySelectorAll('[data-star]').forEach(s2 =>
            s2.innerHTML = `<i class="${+s2.dataset.star <= rating ? 'fas' : 'far'} fa-star"></i>`)
        })
        document.getElementById('rv-cancel').onclick = closeModal
        document.getElementById('rv-ok').onclick = async () => {
          const patch = { status: to, review_note: document.getElementById('rv-note').value.trim() || null }
          if (to === 'done' && rating > 0) patch.quality_rating = rating
          closeModal()
          const { error } = await state.sb.from('tasks').update(patch).eq('id', t.id)
          if (error) return toast(error.message, 'error')
          toast(to === 'done' ? 'Task approved ✓' : 'Changes requested', 'success'); reload()
        }
        return
      }
      const { error } = await state.sb.from('tasks').update({ status: to }).eq('id', t.id)
      if (error) return toast(error.message, 'error')
      toast('Status updated', 'success'); reload()
    }
  })

  // checklist
  document.getElementById('cl-form').onsubmit = async (e) => {
    e.preventDefault()
    const label = document.getElementById('cl-input').value.trim()
    if (!label) return
    const { error } = await state.sb.from('task_checklist_items').insert({ task_id: t.id, label })
    if (error) return toast(error.message, 'error')
    reload()
  }
  document.querySelectorAll('[data-cl-check]').forEach(cb => cb.onchange = async () => {
    const { error } = await state.sb.from('task_checklist_items').update({ is_done: cb.checked }).eq('id', cb.dataset.clCheck)
    if (error) return toast(error.message, 'error')
    reload()
  })
  document.querySelectorAll('[data-cl-del]').forEach(btn => btn.onclick = async () => {
    await state.sb.from('task_checklist_items').delete().eq('id', btn.dataset.clDel)
    reload()
  })

  // comments
  document.getElementById('cm-form').onsubmit = async (e) => {
    e.preventDefault()
    const body = document.getElementById('cm-input').value.trim()
    if (!body) return
    const { error } = await state.sb.from('task_comments').insert({ task_id: t.id, author_id: state.session.user.id, body })
    if (error) return toast(error.message, 'error')
    reload()
  }
  document.querySelectorAll('[data-cm-del]').forEach(btn => btn.onclick = async () => {
    if (!await confirmDialog('Delete comment?', 'This cannot be undone.', { danger: true, okLabel: 'Delete' })) return
    await state.sb.from('task_comments').update({ deleted_at: new Date().toISOString() }).eq('id', btn.dataset.cmDel)
    reload()
  })

  // attachments
  document.getElementById('att-input').onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) return toast('Max file size is 50 MB', 'error')
    const path = `${state.session.user.id}/${t.id}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`
    toast('Uploading…', 'info')
    const { error: upErr } = await state.sb.storage.from('attachments').upload(path, file)
    if (upErr) return toast(upErr.message, 'error')
    const { error } = await state.sb.from('task_attachments').insert({
      task_id: t.id, uploaded_by: state.session.user.id,
      file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size,
    })
    if (error) return toast(error.message, 'error')
    toast('File uploaded', 'success'); reload()
  }
  document.querySelectorAll('[data-att-dl]').forEach(btn => btn.onclick = async () => {
    const { data, error } = await state.sb.storage.from('attachments').createSignedUrl(btn.dataset.attDl, 300)
    if (error) return toast(error.message, 'error')
    window.open(data.signedUrl, '_blank')
  })
  document.querySelectorAll('[data-att-del]').forEach(btn => btn.onclick = async () => {
    if (!await confirmDialog('Delete attachment?', 'The file will be permanently removed.', { danger: true, okLabel: 'Delete' })) return
    await state.sb.storage.from('attachments').remove([btn.dataset.attPath])
    await state.sb.from('task_attachments').delete().eq('id', btn.dataset.attDel)
    reload()
  })

  // dependencies
  document.getElementById('btn-add-dep')?.addEventListener('click', async () => {
    const { data: candidates } = await state.sb.from('v_task_board')
      .select('id, title, status').neq('id', t.id).is('parent_task_id', null)
      .not('status', 'in', '("done","cancelled")').order('created_at', { ascending: false }).limit(100)
    openModal(`
      <h3 class="text-lg font-bold mb-4">Add dependency</h3>
      <p class="text-xs text-slate-400 mb-3">This task cannot start until the selected task is done.</p>
      <select id="dep-select" class="input mb-4">
        ${(candidates||[]).map(c => `<option value="${c.id}">${esc(c.title)} (${STATUS_META[c.status].label})</option>`).join('')}
      </select>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost" id="dep-cancel">Cancel</button>
        <button class="btn btn-primary" id="dep-ok">Add</button>
      </div>`)
    document.getElementById('dep-cancel').onclick = closeModal
    document.getElementById('dep-ok').onclick = async () => {
      const depId = document.getElementById('dep-select').value
      if (!depId) return
      const { error } = await state.sb.from('task_dependencies').insert({ task_id: t.id, depends_on_id: depId })
      closeModal()
      if (error) return toast(error.message, 'error')
      toast('Dependency added', 'success'); reload()
    }
  })
  document.querySelectorAll('[data-dep-del]').forEach(btn => btn.onclick = async () => {
    await state.sb.from('task_dependencies').delete().eq('task_id', t.id).eq('depends_on_id', btn.dataset.depDel)
    reload()
  })
}

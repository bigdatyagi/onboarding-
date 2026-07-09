// ============ Admin: user approval, roles, departments, audit log ============
import { state, esc, toast, skeletonList, avatarHtml, isAdmin, fromNow, confirmDialog,
         openModal, closeModal, loadDirectory, navigate, ROLES, ROLE_LABEL, ROLE_COLOR } from './core.js'
import { renderShell } from './layout.js'

let tab = 'users'

export async function renderAdmin() {
  if (!isAdmin()) { navigate('/', true); return }
  const content = renderShell('/admin', `
    <section aria-labelledby="ad-heading">
      <h1 id="ad-heading" class="text-xl font-extrabold tracking-tight mb-5">Admin</h1>
      <div class="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1 mb-5 w-fit" role="tablist">
        ${[['users','Users','fa-users'],['departments','Departments','fa-building'],['audit','Audit Log','fa-scroll']].map(([k, label, icon]) => `
          <button role="tab" aria-selected="${tab===k}" data-tab="${k}"
            class="px-4 py-2 rounded-md text-sm font-bold transition-colors ${tab===k ? 'bg-white dark:bg-slate-700 shadow text-indigo-600 dark:text-indigo-300' : 'text-slate-500'}">
            <i class="fas ${icon} mr-1"></i>${label}</button>`).join('')}
      </div>
      <div id="ad-body">${skeletonList(5, 14)}</div>
    </section>`)
  content.querySelectorAll('[data-tab]').forEach(btn => btn.onclick = () => { tab = btn.dataset.tab; renderAdmin() })
  if (tab === 'users') await usersTab()
  else if (tab === 'departments') await deptsTab()
  else await auditTab()
}

// ---------- USERS ----------
async function usersTab() {
  const body = document.getElementById('ad-body')
  const { data: users, error } = await state.sb.from('profiles')
    .select('*').is('deleted_at', null).order('created_at', { ascending: false })
  if (error) return body.innerHTML = `<div class="card p-8 text-rose-500 text-center">${esc(error.message)}</div>`

  const pending = users.filter(u => u.status === 'pending')
  const rest = users.filter(u => u.status !== 'pending')
  const deptName = (id) => state.departments.find(d => d.id === id)?.name || '—'
  const statusBadge = {
    approved:'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    pending:'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    suspended:'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    rejected:'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-400',
  }
  const row = (u) => `
    <tr>
      <td><div class="flex items-center gap-2">${avatarHtml(u, 7)}
        <div><div class="font-semibold text-sm">${esc(u.full_name || '(no name)')}</div>
        <div class="text-[11px] text-slate-400">${esc(u.email)} · ${esc(u.employee_id || '')}</div></div></div></td>
      <td>
        <select class="input py-1 text-xs" style="width:auto" data-role-for="${u.id}" ${u.id === state.profile.id ? 'disabled title="You cannot change your own role"' : ''} aria-label="Role for ${esc(u.full_name)}">
          ${ROLES.map(r => `<option value="${r}" ${u.role===r?'selected':''} ${r==='super_admin' && state.profile.role!=='super_admin' ? 'disabled' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
        </select></td>
      <td class="text-xs">${esc(deptName(u.department_id))}</td>
      <td><span class="badge ${statusBadge[u.status]}">${u.status}</span></td>
      <td class="font-bold text-indigo-500">${u.points}</td>
      <td class="text-right whitespace-nowrap">
        ${u.status === 'pending' ? `
          <button class="btn btn-primary btn-sm" data-approve="${u.id}"><i class="fas fa-check"></i> Approve</button>
          <button class="btn btn-ghost btn-sm text-rose-500" data-reject="${u.id}">Reject</button>` : ''}
        ${u.status === 'approved' && u.id !== state.profile.id ? `<button class="btn btn-ghost btn-sm text-amber-500" data-suspend="${u.id}"><i class="fas fa-user-lock"></i> Suspend</button>` : ''}
        ${u.status === 'suspended' ? `<button class="btn btn-ghost btn-sm text-emerald-500" data-approve="${u.id}"><i class="fas fa-user-check"></i> Reinstate</button>` : ''}
      </td>
    </tr>`

  body.innerHTML = `
    ${pending.length ? `
    <div class="card overflow-x-auto mb-5 border-amber-300 dark:border-amber-500/40">
      <div class="px-4 py-3 bg-amber-50 dark:bg-amber-500/10 font-bold text-sm"><i class="fas fa-user-clock text-amber-500 mr-2"></i>Pending approval (${pending.length})</div>
      <table class="table-pro"><thead><tr><th>User</th><th>Role</th><th>Dept</th><th>Status</th><th>Pts</th><th></th></tr></thead>
      <tbody>${pending.map(row).join('')}</tbody></table>
    </div>` : ''}
    <div class="card overflow-x-auto">
      <table class="table-pro"><thead><tr><th>User</th><th>Role</th><th>Dept</th><th>Status</th><th>Pts</th><th></th></tr></thead>
      <tbody>${rest.map(row).join('')}</tbody></table>
    </div>`

  const call = async (fn, args, okMsg) => {
    const { error } = await state.sb.rpc(fn, args)
    if (error) return toast(error.message, 'error')
    toast(okMsg, 'success'); await loadDirectory(); usersTab()
  }
  body.querySelectorAll('[data-approve]').forEach(b => b.onclick = () =>
    call('admin_set_user_status', { p_user: b.dataset.approve, p_status: 'approved' }, 'User approved'))
  body.querySelectorAll('[data-reject]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('Reject application?', 'The user will be notified.', { danger: true, okLabel: 'Reject' }))
      call('admin_set_user_status', { p_user: b.dataset.reject, p_status: 'rejected' }, 'User rejected')
  })
  body.querySelectorAll('[data-suspend]').forEach(b => b.onclick = async () => {
    if (await confirmDialog('Suspend user?', 'They will lose access immediately.', { danger: true, okLabel: 'Suspend' }))
      call('admin_set_user_status', { p_user: b.dataset.suspend, p_status: 'suspended' }, 'User suspended')
  })
  body.querySelectorAll('[data-role-for]').forEach(sel => sel.onchange = () =>
    call('admin_set_user_role', { p_user: sel.dataset.roleFor, p_role: sel.value }, 'Role updated'))
}

// ---------- DEPARTMENTS ----------
async function deptsTab() {
  const body = document.getElementById('ad-body')
  const { data: deps, error } = await state.sb.from('departments').select('*').is('deleted_at', null).order('name')
  if (error) return body.innerHTML = `<div class="card p-8 text-rose-500 text-center">${esc(error.message)}</div>`
  const memberCount = (id) => state.users.filter(u => u.department_id === id).length

  body.innerHTML = `
    <div class="flex justify-end mb-4">
      <button id="btn-new-dept" class="btn btn-primary btn-sm"><i class="fas fa-plus"></i> New Department</button>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${deps.map(d => `
        <article class="card p-5">
          <header class="flex items-start justify-between mb-2">
            <h3 class="font-bold">${esc(d.name)}</h3>
            <div class="flex gap-1">
              <button class="text-slate-400 hover:text-indigo-500 p-1" data-edit-dept="${d.id}" aria-label="Edit"><i class="fas fa-pen text-xs"></i></button>
              <button class="text-slate-400 hover:text-rose-500 p-1" data-del-dept="${d.id}" aria-label="Delete"><i class="fas fa-trash text-xs"></i></button>
            </div>
          </header>
          <p class="text-sm text-slate-400 mb-3">${esc(d.description || 'No description')}</p>
          <span class="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"><i class="fas fa-users"></i> ${memberCount(d.id)} members</span>
        </article>`).join('') || '<div class="col-span-full card p-10 text-center text-slate-400">No departments yet.</div>'}
    </div>`

  const form = (d = null) => {
    openModal(`
      <h3 class="text-lg font-bold mb-4">${d ? 'Edit' : 'New'} department</h3>
      <form id="dept-form">
        <div class="mb-3"><label class="field" for="dp-name">Name *</label>
          <input id="dp-name" class="input" required minlength="2" maxlength="80" value="${esc(d?.name || '')}"></div>
        <div class="mb-4"><label class="field" for="dp-desc">Description</label>
          <textarea id="dp-desc" class="input" rows="2">${esc(d?.description || '')}</textarea></div>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-ghost" id="dp-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${d ? 'Save' : 'Create'}</button>
        </div>
        <p id="dp-err" class="text-sm text-rose-500 mt-3 hidden" role="alert"></p>
      </form>`)
    document.getElementById('dp-cancel').onclick = closeModal
    document.getElementById('dept-form').onsubmit = async (e) => {
      e.preventDefault()
      const name = document.getElementById('dp-name').value.trim()
      const err = document.getElementById('dp-err')
      if (name.length < 2) { err.textContent = 'Name required (2+ chars).'; err.classList.remove('hidden'); return }
      const payload = { name, description: document.getElementById('dp-desc').value.trim() || null }
      const res = d
        ? await state.sb.from('departments').update(payload).eq('id', d.id)
        : await state.sb.from('departments').insert(payload)
      if (res.error) { err.textContent = res.error.message; err.classList.remove('hidden'); return }
      closeModal(); toast(d ? 'Department updated' : 'Department created', 'success')
      await loadDirectory(); deptsTab()
    }
  }
  document.getElementById('btn-new-dept').onclick = () => form()
  body.querySelectorAll('[data-edit-dept]').forEach(b => b.onclick = () => form(deps.find(d => d.id === b.dataset.editDept)))
  body.querySelectorAll('[data-del-dept]').forEach(b => b.onclick = async () => {
    if (!await confirmDialog('Delete department?', 'Members will be unassigned; tasks keep their history.', { danger: true, okLabel: 'Delete' })) return
    const { error } = await state.sb.from('departments').update({ deleted_at: new Date().toISOString() }).eq('id', b.dataset.delDept)
    if (error) return toast(error.message, 'error')
    toast('Department deleted', 'success'); await loadDirectory(); deptsTab()
  })
}

// ---------- AUDIT LOG ----------
async function auditTab() {
  const body = document.getElementById('ad-body')
  const { data: logs, error } = await state.sb.from('audit_logs')
    .select('*, actor:profiles!audit_logs_actor_id_fkey(full_name)')
    .order('created_at', { ascending: false }).limit(100)
  if (error) return body.innerHTML = `<div class="card p-8 text-rose-500 text-center">${esc(error.message)}</div>`
  body.innerHTML = `
    <div class="card overflow-x-auto">
      <table class="table-pro">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
        <tbody>${(logs||[]).map(l => `
          <tr>
            <td class="whitespace-nowrap text-xs text-slate-400">${fromNow(l.created_at)}</td>
            <td class="font-semibold text-sm">${esc(l.actor?.full_name || 'System')}</td>
            <td><span class="badge bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300">${esc(l.action)}</span></td>
            <td class="text-xs">${esc(l.entity)}</td>
            <td class="text-xs font-mono text-slate-400 max-w-[280px] truncate">${esc(JSON.stringify(l.detail || {}))}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="text-center py-10 text-slate-400">No audit entries yet.</td></tr>'}
        </tbody>
      </table>
    </div>`
}

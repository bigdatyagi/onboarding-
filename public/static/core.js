// ============ TeamPulse core: state, supabase, router, UI helpers ============
dayjs.extend(dayjs_plugin_relativeTime)

export const state = {
  sb: null,            // supabase client
  session: null,
  profile: null,       // my profile row
  departments: [],
  users: [],           // approved user directory (for pickers)
  configured: false,
  channels: [],        // realtime channels
  unread: 0,
}

export const ROLES = ['super_admin','owner','teacher','team_leader','student','intern']
export const ROLE_LABEL = { super_admin:'Super Admin', owner:'Owner', teacher:'Teacher', team_leader:'Team Leader', student:'Student', intern:'Intern' }
export const ROLE_COLOR = {
  super_admin:'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  owner:'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  teacher:'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  team_leader:'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  student:'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  intern:'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
}
export const STATUS_META = {
  backlog:            { label:'Backlog',           color:'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300', icon:'fa-inbox' },
  todo:               { label:'To Do',             color:'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', icon:'fa-circle' },
  in_progress:        { label:'In Progress',       color:'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300', icon:'fa-spinner' },
  in_review:          { label:'In Review',         color:'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', icon:'fa-eye' },
  changes_requested:  { label:'Changes Requested', color:'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300', icon:'fa-rotate-left' },
  done:               { label:'Done',              color:'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', icon:'fa-check' },
  cancelled:          { label:'Cancelled',         color:'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', icon:'fa-ban' },
}
export const PRIORITY_META = {
  low:    { label:'Low',    color:'text-slate-500',  icon:'fa-angle-down' },
  medium: { label:'Medium', color:'text-sky-500',    icon:'fa-equals' },
  high:   { label:'High',   color:'text-amber-500',  icon:'fa-angle-up' },
  urgent: { label:'Urgent', color:'text-rose-500',   icon:'fa-angles-up' },
}
export const DIFFICULTY = ['trivial','easy','medium','hard','expert']

export const isAdmin   = () => ['super_admin','owner'].includes(state.profile?.role)
export const isManager = () => ['super_admin','owner','teacher','team_leader'].includes(state.profile?.role)

// ---------- utils ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export const fmtDate = (d) => d ? dayjs(d).format('MMM D, YYYY') : '—'
export const fmtDateTime = (d) => d ? dayjs(d).format('MMM D, YYYY HH:mm') : '—'
export const fromNow = (d) => d ? dayjs(d).fromNow() : '—'
export const initials = (name) => (name || '?').split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase()
export const debounce = (fn, ms=300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

export function avatarHtml(user, size = 8) {
  const px = size * 4
  if (user?.avatar_url) return `<img src="${esc(user.avatar_url)}" alt="${esc(user.full_name)}" class="avatar w-${size} h-${size}" width="${px}" height="${px}" loading="lazy">`
  return `<span class="avatar w-${size} h-${size} inline-flex items-center justify-center text-xs font-bold text-slate-500 dark:text-slate-300" style="width:${px}px;height:${px}px">${esc(initials(user?.full_name))}</span>`
}

// ---------- toast ----------
export function toast(msg, type = 'info') {
  const colors = { info:'bg-slate-800', success:'bg-emerald-600', error:'bg-rose-600', warn:'bg-amber-600' }
  const icons = { info:'fa-circle-info', success:'fa-circle-check', error:'fa-circle-exclamation', warn:'fa-triangle-exclamation' }
  const el = document.createElement('div')
  el.className = `toast ${colors[type]}`
  el.setAttribute('role', 'status')
  el.innerHTML = `<i class="fas ${icons[type]} mt-0.5"></i><span>${esc(msg)}</span>`
  document.getElementById('toast-root').appendChild(el)
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320) }, 4200)
}

// ---------- modal ----------
export function openModal(html, { maxWidth = '560px' } = {}) {
  closeModal()
  const root = document.getElementById('modal-root')
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-panel card p-6" style="max-width:${maxWidth}" role="dialog" aria-modal="true">${html}</div>
    </div>`
  const bd = document.getElementById('modal-backdrop')
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) closeModal() })
  document.addEventListener('keydown', escClose)
  const first = bd.querySelector('input,textarea,select,button')
  if (first) setTimeout(() => first.focus(), 60)
  return bd
}
function escClose(e) { if (e.key === 'Escape') closeModal() }
export function closeModal() {
  document.getElementById('modal-root').innerHTML = ''
  document.removeEventListener('keydown', escClose)
}

export function confirmDialog(title, body, { danger = false, okLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    openModal(`
      <h3 class="text-lg font-bold mb-2">${esc(title)}</h3>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-5">${esc(body)}</p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost" id="cf-no">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cf-yes">${esc(okLabel)}</button>
      </div>`)
    document.getElementById('cf-no').onclick = () => { closeModal(); resolve(false) }
    document.getElementById('cf-yes').onclick = () => { closeModal(); resolve(true) }
  })
}

// ---------- skeleton ----------
export const skeletonList = (n = 4, h = 16) =>
  Array.from({length:n}, () => `<div class="skeleton mb-3" style="height:${h*4}px"></div>`).join('')

// ---------- router ----------
const routes = []
export function route(pattern, handler) { routes.push({ pattern, handler }) }
export function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path)
  dispatch()
}
export async function dispatch() {
  const path = location.pathname
  for (const r of routes) {
    const keys = []
    const rx = new RegExp('^' + r.pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)' }) + '$')
    const m = path.match(rx)
    if (m) {
      const params = {}
      keys.forEach((k, i) => params[k] = decodeURIComponent(m[i+1]))
      try { await r.handler(params) } catch (err) {
        console.error(err)
        toast(err.message || 'Something went wrong', 'error')
      }
      return
    }
  }
  navigate('/', true)
}
window.addEventListener('popstate', dispatch)
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]')
  if (a) { e.preventDefault(); navigate(a.getAttribute('href')) }
})

// ---------- theme ----------
export function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark')
  localStorage.setItem('theme', dark ? 'dark' : 'light')
}

// ---------- supabase bootstrap ----------
export async function initSupabase() {
  const res = await fetch('/api/config')
  const cfg = await res.json()
  state.configured = cfg.configured
  if (!cfg.configured) return false
  state.sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
  const { data: { session } } = await state.sb.auth.getSession()
  state.session = session
  state.sb.auth.onAuthStateChange((_e, s) => { state.session = s })
  return true
}

export async function loadProfile() {
  if (!state.session) return null
  const { data, error } = await state.sb.from('profiles').select('*').eq('id', state.session.user.id).single()
  if (error) { console.error(error); return null }
  state.profile = data
  return data
}

export async function loadDirectory() {
  const [{ data: deps }, { data: users }] = await Promise.all([
    state.sb.from('departments').select('*').is('deleted_at', null).order('name'),
    state.sb.from('profiles').select('id,full_name,email,avatar_url,role,department_id,points,employee_id,status,last_seen_at').is('deleted_at', null).eq('status','approved').order('full_name'),
  ])
  state.departments = deps || []
  state.users = users || []
}

export function cleanupChannels() {
  state.channels.forEach(ch => state.sb.removeChannel(ch))
  state.channels = []
}

// track presence heartbeat
export function heartbeat() {
  if (!state.session) return
  state.sb.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', state.session.user.id).then(() => {})
}

// ============ App shell: sidebar, topbar, notifications, command palette ============
import { state, esc, fromNow, toast, navigate, toggleTheme, avatarHtml, isManager, isAdmin, ROLE_LABEL, ROLE_COLOR, cleanupChannels } from './core.js'

const NAV = [
  { path: '/',            icon: 'fa-gauge-high',     label: 'Dashboard' },
  { path: '/tasks',       icon: 'fa-list-check',     label: 'Tasks' },
  { path: '/board',       icon: 'fa-table-columns',  label: 'Board' },
  { path: '/attendance',  icon: 'fa-calendar-check', label: 'Attendance' },
  { path: '/leaderboard', icon: 'fa-trophy',         label: 'Leaderboard' },
  { path: '/team',        icon: 'fa-users',          label: 'Team' },
  { path: '/profile',     icon: 'fa-user-gear',      label: 'My Profile' },
  { path: '/admin',       icon: 'fa-shield-halved',  label: 'Admin', admin: true },
]

let notifChannel = null

export function renderShell(activePath, contentHtml) {
  const p = state.profile
  const app = document.getElementById('app')
  app.innerHTML = `
  <div class="flex h-full">
    <aside id="sidebar" class="w-64 h-full flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div class="flex items-center gap-3 px-5 py-5">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/30"><i class="fas fa-bolt"></i></div>
        <div>
          <div class="font-extrabold tracking-tight leading-none">TeamPulse</div>
          <div class="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">Enterprise</div>
        </div>
      </div>
      <nav id="main-nav" class="flex-1 px-3 space-y-1 overflow-y-auto" aria-label="Main navigation">
        ${NAV.filter(n => !n.admin || isAdmin()).map(n => `
          <a href="${n.path}" data-link class="nav-item ${activePath === n.path ? 'active' : ''}" ${activePath === n.path ? 'aria-current="page"' : ''}>
            <i class="fas ${n.icon} w-5 text-center"></i><span>${n.label}</span>
          </a>`).join('')}
      </nav>
      <div class="p-3 border-t border-slate-200 dark:border-slate-800">
        <div class="flex items-center gap-3 px-2 py-2">
          ${avatarHtml(p, 9)}
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate">${esc(p.full_name || 'Unnamed')}</div>
            <span class="badge ${ROLE_COLOR[p.role]}">${ROLE_LABEL[p.role]}</span>
          </div>
          <button id="btn-logout" class="text-slate-400 hover:text-rose-500 p-2" title="Sign out" aria-label="Sign out"><i class="fas fa-arrow-right-from-bracket"></i></button>
        </div>
      </div>
    </aside>

    <div class="flex-1 flex flex-col min-w-0 h-full">
      <header id="topbar" class="flex items-center gap-3 px-4 lg:px-6 py-3 bg-white/70 dark:bg-slate-900/70 backdrop-blur border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40">
        <button id="btn-menu" class="lg:hidden p-2 text-slate-500" aria-label="Open menu"><i class="fas fa-bars"></i></button>
        <button id="btn-cmdk" class="hidden md:flex items-center gap-2 text-sm text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:border-indigo-400 transition-colors w-64">
          <i class="fas fa-magnifying-glass"></i><span>Search…</span>
          <kbd class="ml-auto text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
        </button>
        <div class="flex-1"></div>
        <button id="btn-theme" class="p-2 text-slate-500 hover:text-indigo-500" title="Toggle theme" aria-label="Toggle theme">
          <i class="fas fa-moon dark:hidden"></i><i class="fas fa-sun hidden dark:inline"></i>
        </button>
        <div class="relative">
          <button id="btn-notif" class="p-2 text-slate-500 hover:text-indigo-500 relative" title="Notifications" aria-label="Notifications">
            <i class="fas fa-bell"></i>
            <span id="notif-dot" class="hidden absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"></span>
          </button>
          <div id="notif-panel" class="hidden absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] card shadow-xl z-50">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <span class="font-bold text-sm">Notifications</span>
              <button id="notif-mark-all" class="text-xs font-semibold text-indigo-500 hover:underline">Mark all read</button>
            </div>
            <div id="notif-list" class="max-h-96 overflow-y-auto"></div>
          </div>
        </div>
      </header>
      <main id="content" class="flex-1 overflow-y-auto p-4 lg:p-6 animate-fade-in">${contentHtml}</main>
    </div>
  </div>
  <div id="sidebar-backdrop" class="hidden fixed inset-0 bg-black/40 z-50 lg:hidden"></div>`

  // events
  document.getElementById('btn-logout').onclick = async () => {
    cleanupChannels()
    await state.sb.auth.signOut()
    state.profile = null
    navigate('/login')
  }
  document.getElementById('btn-theme').onclick = toggleTheme
  document.getElementById('btn-menu').onclick = () => {
    document.getElementById('sidebar').classList.add('open')
    document.getElementById('sidebar-backdrop').classList.remove('hidden')
  }
  document.getElementById('sidebar-backdrop').onclick = () => {
    document.getElementById('sidebar').classList.remove('open')
    document.getElementById('sidebar-backdrop').classList.add('hidden')
  }
  document.getElementById('btn-cmdk').onclick = openCommandPalette
  setupNotifications()
  return document.getElementById('content')
}

// ---------- notifications ----------
async function refreshNotifCount() {
  const { count } = await state.sb.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', state.session.user.id).is('read_at', null)
  state.unread = count || 0
  const dot = document.getElementById('notif-dot')
  if (!dot) return
  if (state.unread > 0) { dot.textContent = state.unread > 99 ? '99+' : state.unread; dot.classList.remove('hidden') }
  else dot.classList.add('hidden')
}

async function renderNotifList() {
  const list = document.getElementById('notif-list')
  list.innerHTML = '<div class="p-4"><div class="skeleton h-10 mb-2"></div><div class="skeleton h-10"></div></div>'
  const { data } = await state.sb.from('notifications')
    .select('*').eq('user_id', state.session.user.id)
    .order('created_at', { ascending: false }).limit(30)
  if (!data?.length) {
    list.innerHTML = '<div class="p-8 text-center text-sm text-slate-400"><i class="fas fa-bell-slash text-2xl mb-2 block"></i>All caught up!</div>'
    return
  }
  list.innerHTML = data.map(n => `
    <button class="w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800/60 ${n.read_at ? 'opacity-60' : ''}" data-nid="${n.id}" data-nlink="${esc(n.link || '')}">
      <span class="w-2 h-2 mt-1.5 rounded-full flex-shrink-0 ${n.read_at ? 'bg-slate-300 dark:bg-slate-600' : 'bg-indigo-500'}"></span>
      <span class="min-w-0">
        <span class="block text-sm font-semibold truncate">${esc(n.title)}</span>
        ${n.body ? `<span class="block text-xs text-slate-500 truncate">${esc(n.body)}</span>` : ''}
        <span class="block text-[11px] text-slate-400 mt-0.5">${fromNow(n.created_at)}</span>
      </span>
    </button>`).join('')
  list.querySelectorAll('[data-nid]').forEach(btn => {
    btn.onclick = async () => {
      await state.sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', btn.dataset.nid)
      refreshNotifCount()
      document.getElementById('notif-panel').classList.add('hidden')
      if (btn.dataset.nlink) navigate(btn.dataset.nlink)
    }
  })
}

function setupNotifications() {
  refreshNotifCount()
  const btn = document.getElementById('btn-notif')
  const panel = document.getElementById('notif-panel')
  btn.onclick = (e) => {
    e.stopPropagation()
    const wasHidden = panel.classList.contains('hidden')
    panel.classList.toggle('hidden')
    if (wasHidden) renderNotifList()
  }
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.add('hidden')
  })
  document.getElementById('notif-mark-all').onclick = async () => {
    await state.sb.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', state.session.user.id).is('read_at', null)
    refreshNotifCount(); renderNotifList()
  }
  // realtime subscription (created once per session)
  if (!notifChannel) {
    notifChannel = state.sb.channel('notif-' + state.session.user.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${state.session.user.id}`
      }, (payload) => {
        toast(payload.new.title, 'info')
        refreshNotifCount()
      })
      .subscribe()
    state.channels.push(notifChannel)
  }
}

// ---------- command palette ----------
export function openCommandPalette() {
  const actions = [
    { icon:'fa-gauge-high', label:'Go to Dashboard', run: () => navigate('/') },
    { icon:'fa-list-check', label:'Go to Tasks', run: () => navigate('/tasks') },
    { icon:'fa-table-columns', label:'Go to Board', run: () => navigate('/board') },
    { icon:'fa-calendar-check', label:'Go to Attendance', run: () => navigate('/attendance') },
    { icon:'fa-trophy', label:'Go to Leaderboard', run: () => navigate('/leaderboard') },
    { icon:'fa-users', label:'Go to Team', run: () => navigate('/team') },
    { icon:'fa-user-gear', label:'Go to My Profile', run: () => navigate('/profile') },
    { icon:'fa-plus', label:'New Task', run: () => { navigate('/tasks'); setTimeout(() => document.getElementById('btn-new-task')?.click(), 350) } },
    { icon:'fa-moon', label:'Toggle Dark Mode', run: toggleTheme },
    ...(isAdmin() ? [{ icon:'fa-shield-halved', label:'Go to Admin', run: () => navigate('/admin') }] : []),
  ]
  const root = document.getElementById('modal-root')
  root.innerHTML = `
    <div class="modal-backdrop" id="cmdk-bd" style="align-items:flex-start;padding-top:12vh">
      <div class="modal-panel card p-3" style="max-width:520px">
        <input id="cmdk-input" class="input mb-2" placeholder="Type a command or search…" aria-label="Command search" autocomplete="off">
        <div id="cmdk-list" role="listbox"></div>
      </div>
    </div>`
  const bd = document.getElementById('cmdk-bd')
  const input = document.getElementById('cmdk-input')
  const listEl = document.getElementById('cmdk-list')
  let filtered = actions, selected = 0
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', keys) }
  const render = () => {
    listEl.innerHTML = filtered.map((a, i) => `
      <div class="cmdk-item ${i === selected ? 'selected' : ''}" data-i="${i}" role="option">
        <i class="fas ${a.icon} w-4 text-slate-400"></i><span>${a.label}</span>
      </div>`).join('') || '<div class="p-4 text-sm text-slate-400 text-center">No matches</div>'
    listEl.querySelectorAll('.cmdk-item').forEach(el => {
      el.onclick = () => { const a = filtered[+el.dataset.i]; close(); a.run() }
    })
  }
  const keys = (e) => {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, filtered.length - 1); render() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); render() }
    else if (e.key === 'Enter' && filtered[selected]) { e.preventDefault(); const a = filtered[selected]; close(); a.run() }
  }
  input.oninput = () => {
    const q = input.value.toLowerCase()
    filtered = actions.filter(a => a.label.toLowerCase().includes(q))
    selected = 0; render()
  }
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close() })
  document.addEventListener('keydown', keys)
  render(); input.focus()
}

// global shortcut
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (state.profile?.status === 'approved') openCommandPalette()
  }
})

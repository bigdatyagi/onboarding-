// ============ TeamPulse entry point: bootstrap, auth guard, routes ============
import { state, route, dispatch, navigate, initSupabase, loadProfile, loadDirectory, heartbeat } from './core.js'
import { renderLogin, renderSignup, renderForgot, renderResetPassword, renderStatusGate, renderSetupNeeded } from './auth.js'
import { renderDashboard } from './dashboard.js'
import { renderTasks } from './tasks.js'
import { renderTaskDetail } from './task_detail.js'
import { renderBoard } from './board.js'
import { renderAttendance } from './attendance.js'
import { renderLeaderboard } from './leaderboard.js'
import { renderTeam } from './team.js'
import { renderProfile } from './profile.js'
import { renderAdmin } from './admin.js'

const PUBLIC_ROUTES = ['/login', '/signup', '/forgot', '/reset-password']

// Guard wrapper: requires session + approved profile + loaded directory
function guarded(handler) {
  return async (params) => {
    if (!state.configured) return renderSetupNeeded()
    if (!state.session) return navigate('/login', true)
    if (!state.profile) await loadProfile()
    if (!state.profile) return navigate('/login', true)
    if (state.profile.status !== 'approved') return renderStatusGate(state.profile)
    if (!state.users.length) await loadDirectory()
    return handler(params)
  }
}

// Public wrapper: redirect authed users away from auth pages
function publicOnly(handler) {
  return async (params) => {
    if (!state.configured) return renderSetupNeeded()
    if (state.session && location.pathname !== '/reset-password') return navigate('/', true)
    return handler(params)
  }
}

route('/login', publicOnly(renderLogin))
route('/signup', publicOnly(renderSignup))
route('/forgot', publicOnly(renderForgot))
route('/reset-password', renderResetPassword)  // reachable while "authed" via recovery link
route('/', guarded(renderDashboard))
route('/tasks', guarded(renderTasks))
route('/tasks/:id', guarded(renderTaskDetail))
route('/board', guarded(renderBoard))
route('/attendance', guarded(renderAttendance))
route('/leaderboard', guarded(renderLeaderboard))
route('/team', guarded(renderTeam))
route('/profile', guarded(renderProfile))
route('/admin', guarded(renderAdmin))

async function boot() {
  const ok = await initSupabase()
  if (!ok) { renderSetupNeeded(); return }

  // Supabase recovery link lands with #access_token…type=recovery
  if (location.hash.includes('type=recovery')) {
    history.replaceState({}, '', '/reset-password')
  }

  // react to auth events
  state.sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      state.profile = null
      if (!PUBLIC_ROUTES.includes(location.pathname)) navigate('/login', true)
    }
    if (event === 'PASSWORD_RECOVERY') navigate('/reset-password', true)
  })

  await dispatch()

  // presence heartbeat every 2 min
  heartbeat()
  setInterval(heartbeat, 120000)
}

boot().catch(err => {
  console.error('Boot failed:', err)
  document.getElementById('app').innerHTML =
    `<div class="min-h-full flex items-center justify-center p-6">
      <div class="card p-8 text-center max-w-sm">
        <i class="fas fa-triangle-exclamation text-3xl text-rose-500 mb-3"></i>
        <h1 class="font-bold mb-2">Failed to start</h1>
        <p class="text-sm text-slate-400 mb-4">${err.message || 'Unknown error'}</p>
        <button class="btn btn-primary" onclick="location.reload()">Retry</button>
      </div>
    </div>`
})

// ============ Auth: login, signup, reset, verify, profile completion, pending gate ============
import { state, esc, toast, navigate, loadProfile, avatarHtml } from './core.js'

const wrap = (inner) => `
<main class="min-h-full flex items-center justify-center p-4 bg-gradient-to-br from-indigo-50 via-slate-50 to-violet-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
  <section class="w-full max-w-md animate-slide-up">
    <header class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-2xl shadow-lg shadow-indigo-500/30 mb-4">
        <i class="fas fa-bolt"></i>
      </div>
      <h1 class="text-2xl font-extrabold tracking-tight">TeamPulse</h1>
      <p class="text-sm text-slate-500 dark:text-slate-400">Team & Intern Management Platform</p>
    </header>
    <div class="glass card p-7">${inner}</div>
  </section>
</main>`

function bindPasswordToggles(root) {
  root.querySelectorAll('[data-pw-toggle]').forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById(btn.dataset.pwToggle)
      const show = input.type === 'password'
      input.type = show ? 'text' : 'password'
      btn.innerHTML = `<i class="fas ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`
    }
  })
}

export function renderLogin() {
  const app = document.getElementById('app')
  app.innerHTML = wrap(`
    <h2 class="text-lg font-bold mb-5">Welcome back</h2>
    <form id="login-form" novalidate>
      <div class="mb-4">
        <label class="field" for="login-email">Email</label>
        <input id="login-email" class="input" type="email" required autocomplete="email" placeholder="you@company.com">
      </div>
      <div class="mb-2">
        <label class="field" for="login-password">Password</label>
        <div class="relative">
          <input id="login-password" class="input pr-10" type="password" required minlength="8" autocomplete="current-password" placeholder="••••••••">
          <button type="button" data-pw-toggle="login-password" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Show password"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="flex justify-end mb-5">
        <a href="/forgot" data-link class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Forgot password?</a>
      </div>
      <button class="btn btn-primary w-full" id="login-btn" type="submit">Sign in</button>
      <p id="login-err" class="text-sm text-rose-500 mt-3 hidden" role="alert"></p>
    </form>
    <p class="text-sm text-center mt-6 text-slate-500">No account?
      <a href="/signup" data-link class="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Create one</a></p>`)
  bindPasswordToggles(app)
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault()
    const email = document.getElementById('login-email').value.trim()
    const password = document.getElementById('login-password').value
    const err = document.getElementById('login-err')
    err.classList.add('hidden')
    if (!email || !password) { err.textContent = 'Email and password are required.'; err.classList.remove('hidden'); return }
    const btn = document.getElementById('login-btn')
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…'
    const { error } = await state.sb.auth.signInWithPassword({ email, password })
    btn.disabled = false; btn.textContent = 'Sign in'
    if (error) {
      err.textContent = error.message === 'Email not confirmed'
        ? 'Please verify your email first — check your inbox.'
        : (error.message || 'Sign in failed.')
      err.classList.remove('hidden'); return
    }
    await loadProfile()
    toast('Welcome back!', 'success')
    navigate('/')
  }
}

export function renderSignup() {
  const app = document.getElementById('app')
  app.innerHTML = wrap(`
    <h2 class="text-lg font-bold mb-5">Create your account</h2>
    <form id="su-form" novalidate>
      <div class="mb-4">
        <label class="field" for="su-name">Full name</label>
        <input id="su-name" class="input" type="text" required minlength="2" maxlength="120" placeholder="Jane Doe">
      </div>
      <div class="mb-4">
        <label class="field" for="su-email">Email</label>
        <input id="su-email" class="input" type="email" required autocomplete="email" placeholder="you@company.com">
      </div>
      <div class="mb-4">
        <label class="field" for="su-password">Password</label>
        <div class="relative">
          <input id="su-password" class="input pr-10" type="password" required minlength="8" autocomplete="new-password" placeholder="Min 8 characters">
          <button type="button" data-pw-toggle="su-password" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Show password"><i class="fas fa-eye"></i></button>
        </div>
        <div class="progress-track mt-2"><div id="pw-meter" class="progress-fill" style="width:0%"></div></div>
        <p id="pw-hint" class="text-xs text-slate-400 mt-1">Use 8+ chars with numbers & symbols</p>
      </div>
      <div class="mb-5">
        <label class="field" for="su-password2">Confirm password</label>
        <input id="su-password2" class="input" type="password" required minlength="8" autocomplete="new-password" placeholder="Repeat password">
      </div>
      <button class="btn btn-primary w-full" id="su-btn" type="submit">Create account</button>
      <p id="su-err" class="text-sm text-rose-500 mt-3 hidden" role="alert"></p>
    </form>
    <p class="text-sm text-center mt-6 text-slate-500">Already registered?
      <a href="/login" data-link class="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Sign in</a></p>`)
  bindPasswordToggles(app)
  const pw = document.getElementById('su-password')
  pw.addEventListener('input', () => {
    let score = 0
    if (pw.value.length >= 8) score += 34
    if (/[0-9]/.test(pw.value)) score += 22
    if (/[^A-Za-z0-9]/.test(pw.value)) score += 22
    if (/[A-Z]/.test(pw.value)) score += 22
    document.getElementById('pw-meter').style.width = Math.min(100, score) + '%'
  })
  document.getElementById('su-form').onsubmit = async (e) => {
    e.preventDefault()
    const name = document.getElementById('su-name').value.trim()
    const email = document.getElementById('su-email').value.trim()
    const p1 = document.getElementById('su-password').value
    const p2 = document.getElementById('su-password2').value
    const err = document.getElementById('su-err')
    err.classList.add('hidden')
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden') }
    if (name.length < 2) return fail('Please enter your full name.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Please enter a valid email address.')
    if (p1.length < 8) return fail('Password must be at least 8 characters.')
    if (p1 !== p2) return fail('Passwords do not match.')
    const btn = document.getElementById('su-btn')
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…'
    const { data, error } = await state.sb.auth.signUp({
      email, password: p1,
      options: { data: { full_name: name }, emailRedirectTo: location.origin + '/login' }
    })
    btn.disabled = false; btn.textContent = 'Create account'
    if (error) return fail(error.message)
    if (data.session) { await loadProfile(); navigate('/') ; return }
    app.innerHTML = wrap(`
      <div class="text-center py-4">
        <div class="text-5xl mb-4 text-emerald-500"><i class="fas fa-envelope-circle-check"></i></div>
        <h2 class="text-lg font-bold mb-2">Verify your email</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">We sent a verification link to <strong>${esc(email)}</strong>. Click it, then sign in.</p>
        <a href="/login" data-link class="btn btn-primary w-full">Back to sign in</a>
      </div>`)
  }
}

export function renderForgot() {
  const app = document.getElementById('app')
  app.innerHTML = wrap(`
    <h2 class="text-lg font-bold mb-5">Reset your password</h2>
    <form id="fp-form" novalidate>
      <div class="mb-5">
        <label class="field" for="fp-email">Email</label>
        <input id="fp-email" class="input" type="email" required placeholder="you@company.com">
      </div>
      <button class="btn btn-primary w-full" id="fp-btn" type="submit">Send reset link</button>
      <p id="fp-msg" class="text-sm mt-3 hidden" role="alert"></p>
    </form>
    <p class="text-sm text-center mt-6"><a href="/login" data-link class="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">← Back to sign in</a></p>`)
  document.getElementById('fp-form').onsubmit = async (e) => {
    e.preventDefault()
    const email = document.getElementById('fp-email').value.trim()
    const msg = document.getElementById('fp-msg')
    const btn = document.getElementById('fp-btn')
    btn.disabled = true
    const { error } = await state.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/reset-password' })
    btn.disabled = false
    msg.classList.remove('hidden')
    if (error) { msg.className = 'text-sm mt-3 text-rose-500'; msg.textContent = error.message }
    else { msg.className = 'text-sm mt-3 text-emerald-600'; msg.textContent = 'If that email exists, a reset link is on its way.' }
  }
}

export function renderResetPassword() {
  const app = document.getElementById('app')
  app.innerHTML = wrap(`
    <h2 class="text-lg font-bold mb-5">Choose a new password</h2>
    <form id="rp-form" novalidate>
      <div class="mb-4">
        <label class="field" for="rp-p1">New password</label>
        <div class="relative">
          <input id="rp-p1" class="input pr-10" type="password" required minlength="8" autocomplete="new-password">
          <button type="button" data-pw-toggle="rp-p1" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-label="Show password"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="mb-5">
        <label class="field" for="rp-p2">Confirm password</label>
        <input id="rp-p2" class="input" type="password" required minlength="8" autocomplete="new-password">
      </div>
      <button class="btn btn-primary w-full" type="submit">Update password</button>
      <p id="rp-err" class="text-sm text-rose-500 mt-3 hidden" role="alert"></p>
    </form>`)
  bindPasswordToggles(app)
  document.getElementById('rp-form').onsubmit = async (e) => {
    e.preventDefault()
    const p1 = document.getElementById('rp-p1').value, p2 = document.getElementById('rp-p2').value
    const err = document.getElementById('rp-err')
    err.classList.add('hidden')
    if (p1.length < 8) { err.textContent = 'Minimum 8 characters.'; err.classList.remove('hidden'); return }
    if (p1 !== p2) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return }
    const { error } = await state.sb.auth.updateUser({ password: p1 })
    if (error) { err.textContent = error.message; err.classList.remove('hidden'); return }
    toast('Password updated. Please sign in.', 'success')
    await state.sb.auth.signOut()
    navigate('/login')
  }
}

// Gate shown to authenticated but pending/suspended users
export function renderStatusGate(profile) {
  const cfg = {
    pending:   { icon:'fa-hourglass-half', color:'text-amber-500', title:'Awaiting approval',
                 body:'Your account is pending review by an administrator. You will be notified once it is approved.' },
    suspended: { icon:'fa-user-lock', color:'text-rose-500', title:'Account suspended',
                 body:'Your account has been suspended. Contact an administrator for details.' },
    rejected:  { icon:'fa-user-xmark', color:'text-rose-500', title:'Application rejected',
                 body:'Your account application was not approved.' },
  }[profile.status]
  document.getElementById('app').innerHTML = wrap(`
    <div class="text-center py-4">
      <div class="text-5xl mb-4 ${cfg.color}"><i class="fas ${cfg.icon}"></i></div>
      <h2 class="text-lg font-bold mb-2">${cfg.title}</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">${cfg.body}</p>
      <p class="text-xs text-slate-400 mb-6">Signed in as ${esc(profile.email)}</p>
      <div class="flex gap-2 justify-center">
        <button id="gate-refresh" class="btn btn-ghost"><i class="fas fa-rotate"></i> Check again</button>
        <button id="gate-logout" class="btn btn-primary"><i class="fas fa-arrow-right-from-bracket"></i> Sign out</button>
      </div>
    </div>`)
  document.getElementById('gate-refresh').onclick = () => location.reload()
  document.getElementById('gate-logout').onclick = async () => { await state.sb.auth.signOut(); navigate('/login') }
}

// Setup-needed screen (no Supabase credentials yet)
export function renderSetupNeeded() {
  document.getElementById('app').innerHTML = wrap(`
    <div class="py-2">
      <div class="text-4xl mb-4 text-indigo-500 text-center"><i class="fas fa-plug-circle-bolt"></i></div>
      <h2 class="text-lg font-bold mb-3 text-center">Connect Supabase to finish setup</h2>
      <ol class="text-sm text-slate-600 dark:text-slate-300 space-y-3 list-decimal list-inside mb-5">
        <li>Create a project at <span class="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">supabase.com</span></li>
        <li>Run migrations <span class="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">0001 → 0004</span> in the SQL Editor</li>
        <li>Provide <span class="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">SUPABASE_URL</span> and <span class="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">SUPABASE_ANON_KEY</span> as environment variables</li>
        <li>Reload this page</li>
      </ol>
      <button class="btn btn-primary w-full" onclick="location.reload()"><i class="fas fa-rotate"></i> Reload</button>
    </div>`)
}

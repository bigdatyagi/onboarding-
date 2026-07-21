import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Security headers on every response
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})

app.use('/api/*', cors())

// Public runtime config — anon key is designed to be public (RLS protects data).
// Values come from Cloudflare env vars / .dev.vars, never hardcoded.
app.get('/api/config', (c) => {
  const url = c.env?.SUPABASE_URL || ''
  const anonKey = c.env?.SUPABASE_ANON_KEY || ''
  return c.json({
    configured: Boolean(url && anonKey),
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
  })
})

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// SPA shell — all client routes render this page
const page = `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TeamPulse — Team & Intern Management</title>
  <meta name="description" content="Enterprise team, task, attendance and performance management platform" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: { extend: {
        colors: { brand: { 50:'#eef2ff',100:'#e0e7ff',200:'#c7d2fe',300:'#a5b4fc',400:'#818cf8',500:'#6366f1',600:'#4f46e5',700:'#4338ca',800:'#3730a3',900:'#312e81' } },
        fontFamily: { sans: ['Inter','system-ui','sans-serif'] },
        animation: { 'fade-in': 'fadeIn .25s ease-out', 'slide-up': 'slideUp .3s ease-out' },
        keyframes: {
          fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
          slideUp: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } }
        }
      }}
    }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="/static/styles.css" rel="stylesheet">
  <script>
    // Apply theme before paint to avoid flash
    if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
    }
  </script>
</head>
<body class="h-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-sans antialiased">
  <div id="app" class="h-full"></div>
  <div id="modal-root"></div>
  <div id="toast-root" class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2"></div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/plugin/relativeTime.js"></script>
  <script type="module" src="/static/app.js"></script>
</body>
</html>`

app.get('*', (c) => c.html(page))

export default app

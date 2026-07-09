// ============ My Profile: edit info, avatar upload w/ preview+crop+compress, my performance ============
import { state, esc, toast, skeletonList, avatarHtml, loadProfile, ROLE_LABEL, ROLE_COLOR } from './core.js'
import { renderShell } from './layout.js'

export async function renderProfile() {
  const content = renderShell('/profile', skeletonList(4, 20))
  const p = state.profile
  const [{ data: perf }] = await Promise.all([
    state.sb.rpc('compute_performance', {
      p_user: p.id,
      p_start: dayjs().startOf('month').format('YYYY-MM-DD'),
      p_end: dayjs().format('YYYY-MM-DD'),
    }),
  ])
  const perfRow = perf?.[0]

  content.innerHTML = `
  <section aria-labelledby="pf-heading">
    <h1 id="pf-heading" class="text-xl font-extrabold tracking-tight mb-5">My Profile</h1>
    ${!p.profile_complete ? `
    <div class="card p-4 mb-5 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 flex items-center gap-3">
      <i class="fas fa-triangle-exclamation text-amber-500 text-lg"></i>
      <p class="text-sm"><strong>Complete your profile.</strong> Add your photo, phone and department so your team can find you.</p>
    </div>` : ''}
    <div class="grid lg:grid-cols-3 gap-5">
      <div class="card p-6 text-center">
        <div class="relative inline-block mb-4">
          <span id="avatar-preview">${avatarHtml(p, 24)}</span>
          <label class="absolute bottom-0 right-0 w-8 h-8 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full flex items-center justify-center cursor-pointer shadow" title="Change photo">
            <i class="fas fa-camera text-xs"></i>
            <input id="avatar-input" type="file" accept="image/jpeg,image/png,image/webp" class="hidden">
          </label>
        </div>
        ${p.avatar_url ? '<button id="avatar-remove" class="block mx-auto text-xs text-rose-400 hover:text-rose-500 mb-3">Remove photo</button>' : ''}
        <h2 class="font-bold">${esc(p.full_name || 'Unnamed')}</h2>
        <p class="text-xs text-slate-400 mb-2">${esc(p.email)}</p>
        <span class="badge ${ROLE_COLOR[p.role]}">${ROLE_LABEL[p.role]}</span>
        <dl class="text-sm mt-5 space-y-2 text-left">
          <div class="flex justify-between"><dt class="text-slate-400">Employee ID</dt><dd class="font-mono font-semibold">${esc(p.employee_id || '—')}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Points</dt><dd class="font-bold text-indigo-500">${p.points}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-400">Member since</dt><dd>${dayjs(p.created_at).format('MMM YYYY')}</dd></div>
        </dl>
      </div>

      <div class="card p-6 lg:col-span-2">
        <h2 class="font-bold mb-4">Edit details</h2>
        <form id="pf-form" novalidate>
          <div class="grid md:grid-cols-2 gap-4 mb-4">
            <div><label class="field" for="pf-name">Full name *</label>
              <input id="pf-name" class="input" required minlength="2" maxlength="120" value="${esc(p.full_name || '')}"></div>
            <div><label class="field" for="pf-phone">Phone *</label>
              <input id="pf-phone" class="input" type="tel" pattern="[+0-9() -]{6,24}" placeholder="+1 555 000 1234" value="${esc(p.phone || '')}"></div>
            <div><label class="field" for="pf-dept">Department *</label>
              <select id="pf-dept" class="input">
                <option value="">Select…</option>
                ${state.departments.map(d => `<option value="${d.id}" ${p.department_id===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}
              </select></div>
            <div><label class="field" for="pf-email">Email</label>
              <input id="pf-email" class="input" value="${esc(p.email)}" disabled title="Email is managed by your login"></div>
          </div>
          <div class="mb-5"><label class="field" for="pf-bio">Bio</label>
            <textarea id="pf-bio" class="input" rows="3" maxlength="1000" placeholder="A few words about you…">${esc(p.bio || '')}</textarea></div>
          <button class="btn btn-primary" type="submit" id="pf-save">Save changes</button>
          <p id="pf-err" class="text-sm text-rose-500 mt-3 hidden" role="alert"></p>
        </form>
      </div>
    </div>

    ${perfRow ? `
    <h2 class="font-bold text-sm uppercase tracking-wide text-slate-400 mt-6 mb-3">My performance — this month</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
      ${[['Overall', (+perfRow.overall_score).toFixed(1), 'fa-gauge-high', 'indigo'],
         ['Tasks done', `${perfRow.tasks_done}/${perfRow.tasks_assigned}`, 'fa-list-check', 'emerald'],
         ['On-time', (+perfRow.on_time_pct).toFixed(0)+'%', 'fa-stopwatch', 'sky'],
         ['Attendance', (+perfRow.attendance_pct).toFixed(0)+'%', 'fa-calendar-check', 'violet'],
         ['Avg quality', perfRow.avg_quality > 0 ? (+perfRow.avg_quality).toFixed(1)+'★' : '—', 'fa-star', 'amber'],
         ['Points earned', perfRow.points_earned, 'fa-coins', 'amber'],
         ['Activity', (+perfRow.activity_score).toFixed(0), 'fa-bolt', 'rose']]
        .map(([label, val, icon]) => `
        <div class="card p-4">
          <i class="fas ${icon} text-indigo-400 mb-2 block"></i>
          <div class="text-xl font-extrabold">${val}</div>
          <div class="text-[11px] text-slate-400">${label}</div>
        </div>`).join('')}
    </div>` : ''}
  </section>`

  // --- form save ---
  document.getElementById('pf-form').onsubmit = async (e) => {
    e.preventDefault()
    const err = document.getElementById('pf-err')
    err.classList.add('hidden')
    const full_name = document.getElementById('pf-name').value.trim()
    const phone = document.getElementById('pf-phone').value.trim()
    const department_id = document.getElementById('pf-dept').value || null
    if (full_name.length < 2) { err.textContent = 'Name must be at least 2 characters.'; err.classList.remove('hidden'); return }
    if (phone && !/^[+0-9() -]{6,24}$/.test(phone)) { err.textContent = 'Invalid phone format.'; err.classList.remove('hidden'); return }
    const btn = document.getElementById('pf-save')
    btn.disabled = true
    const { error } = await state.sb.from('profiles').update({
      full_name, phone: phone || null, department_id,
      bio: document.getElementById('pf-bio').value.trim() || null,
    }).eq('id', p.id)
    btn.disabled = false
    if (error) { err.textContent = error.message; err.classList.remove('hidden'); return }
    await loadProfile()
    toast('Profile saved', 'success')
    renderProfile()
  }

  // --- avatar upload: resize/compress to 512px webp via canvas ---
  document.getElementById('avatar-input').onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return toast('Max image size is 5 MB', 'error')
    toast('Processing image…', 'info')
    try {
      const blob = await squareCrop(file, 512)
      const path = `${p.id}/avatar_${Date.now()}.webp`
      const { error: upErr } = await state.sb.storage.from('avatars').upload(path, blob, { contentType: 'image/webp', upsert: true })
      if (upErr) throw upErr
      const { data: pub } = state.sb.storage.from('avatars').getPublicUrl(path)
      // delete old file
      if (p.avatar_url?.includes('/avatars/')) {
        const old = p.avatar_url.split('/avatars/')[1]
        if (old) state.sb.storage.from('avatars').remove([decodeURIComponent(old)]).then(() => {})
      }
      const { error } = await state.sb.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', p.id)
      if (error) throw error
      await loadProfile()
      toast('Photo updated', 'success')
      renderProfile()
    } catch (ex) { toast(ex.message || 'Upload failed', 'error') }
  }

  document.getElementById('avatar-remove')?.addEventListener('click', async () => {
    if (p.avatar_url?.includes('/avatars/')) {
      const old = p.avatar_url.split('/avatars/')[1]
      if (old) await state.sb.storage.from('avatars').remove([decodeURIComponent(old)])
    }
    await state.sb.from('profiles').update({ avatar_url: null }).eq('id', p.id)
    await loadProfile()
    toast('Photo removed', 'success')
    renderProfile()
  })
}

// center square crop + resize + webp compress
function squareCrop(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = size; canvas.height = size
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size)
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image processing failed')), 'image/webp', 0.86)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = URL.createObjectURL(file)
  })
}

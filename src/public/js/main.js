document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initUserMenu();
  initNotifications();
  initGlobalSearch();
  initCountAnimations();
  initKeyboardShortcuts();
  initFadeAnimations();
});

// ═══════════════════════════════════════════════════════════════════════════
//  Sidebar — 3 modes: full / collapsed / hidden
// ═══════════════════════════════════════════════════════════════════════════

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
    document.getElementById('sidebarOverlay')?.classList.toggle('show', sidebar.classList.contains('open'));
  } else {
    toggleSidebarMode();
  }
}

function toggleSidebarMode() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    localStorage.setItem('krs-sidebar', 'full');
  } else {
    sidebar.classList.add('collapsed');
    localStorage.setItem('krs-sidebar', 'collapsed');
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
}

function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Restore saved state (desktop only)
  if (window.innerWidth > 768) {
    const saved = localStorage.getItem('krs-sidebar');
    if (saved === 'collapsed') sidebar.classList.add('collapsed');
  }

  /* No click listener on .sidebar-toggle here. The button carries
     onclick="toggleSidebar()" in partials/navbar.ejs, and this block used to
     add a second one that toggled .open as well -- so below 768px the two
     handlers cancelled each other out and the hamburger did nothing. Left as a
     note rather than deleted silently, because the button still exists and the
     next person will want to know where its behaviour lives. */

  // Close on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!e.target.closest('.sidebar') && !e.target.closest('.sidebar-toggle')) {
        sidebar.classList.remove('open');
      }
    }
  });

  // Update sidebar on resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('collapsed');
      } else {
        const saved = localStorage.getItem('krs-sidebar');
        if (saved === 'collapsed') sidebar.classList.add('collapsed');
      }
    }, 200);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  User Menu
// ═══════════════════════════════════════════════════════════════════════════

function toggleUserMenu() {
  document.getElementById('userMenu')?.classList.toggle('show');
}

function initUserMenu() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu') && !e.target.closest('.user-btn')) {
      document.getElementById('userMenu')?.classList.remove('show');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Notifications
// ═══════════════════════════════════════════════════════════════════════════

function toggleNotif() {
  document.getElementById('notifMenu')?.classList.toggle('show');
}

function initNotifications() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notifications-dropdown')) {
      document.getElementById('notifMenu')?.classList.remove('show');
    }
  });

  const notifBtn = document.querySelector('.notif-btn');
  notifBtn?.addEventListener('click', async () => {
    try {
      const res = await fetch('/alerts');
      const data = await res.json();
      updateNotifPanel(data);
    } catch {}
  });
}

function updateNotifPanel(data) {
  const list = document.getElementById('notifList');
  const count = document.getElementById('notifCount');
  const badge = document.getElementById('notifBadge');

  if (!list) return;

  if (badge) badge.textContent = data.unread?.length || 0;
  if (count) count.textContent = `${data.unread?.length || 0} جديدة`;

  const all = data.all || [];
  if (all.length === 0) {
    list.innerHTML = '<div class="notif-empty">لا توجد إشعارات</div>';
    return;
  }

  list.innerHTML = all.slice(0, 10).map(n => `
    <div class="notif-item" onclick="markRead('${n._id || n.id}')">
      <strong>${n.title}</strong>
      <span style="font-size:0.75rem;color:var(--text-muted)">${n.message}</span>
    </div>
  `).join('');
}

async function markRead(alertId) {
  await fetch('/alerts/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alertId }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Global Search
// ═══════════════════════════════════════════════════════════════════════════

function initGlobalSearch() {
  const search = document.getElementById('globalSearch');
  if (!search) return;

  let searchTimeout;
  search.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const q = search.value.trim().toLowerCase();
      if (!q || q.length < 2) return;

      const links = document.querySelectorAll('.nav-link, .quick-nav-item, .guild-item, .action-item');
      let found = false;
      for (const link of links) {
        /* A class, not link.style.background. The inline version wrote
           rgba(88,101,242,.1) -- Discord blurple, the one colour the shared
           palette had already retired -- and the `background` shorthand resets
           every background layer behind it, so typing in the search box wiped
           the active row's fill on the way past. */
        const hit = link.textContent.toLowerCase().includes(q);
        link.classList.toggle('search-hit', hit);
        if (hit) found = true;
      }
      if (!found && q.length >= 2) showToast('🔍 لم يتم العثور على نتائج');
    }, 300);
  });

  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = search.value.trim().toLowerCase();
      if (!q) return;

      const links = document.querySelectorAll('.nav-link, .quick-nav-item, .guild-item, .action-item');
      for (const link of links) {
        if (link.textContent.toLowerCase().includes(q)) {
          window.location.href = link.href;
          return;
        }
      }
      showToast('🔍 لم يتم العثور على نتائج');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Tabs
// ═══════════════════════════════════════════════════════════════════════════

function switchTab(btn, tabName) {
  const parent = btn.closest('.tabs')?.parentElement;
  if (!parent) return;

  parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  parent.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const target = parent.querySelector(`#tab-${tabName}`);
  if (target) {
    target.classList.add('active');
    target.style.animation = 'fadeIn 0.3s ease';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Toast Notifications
// ═══════════════════════════════════════════════════════════════════════════

function showToast(message, type) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.className = 'toast glass fade-in-up';
  toast.textContent = (icons[type] || '') + ' ' + message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Count Animation
// ═══════════════════════════════════════════════════════════════════════════

function initCountAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.stat-number[data-target]').forEach(el => {
    observer.observe(el);
  });
}

function animateCount(el) {
  const target = parseInt(el.dataset.target);
  if (isNaN(target)) return;
  const duration = 1500;
  const frames = 60;
  const increment = target / frames;
  let current = 0;
  const step = () => {
    current += increment;
    if (current >= target) {
      el.textContent = target;
      return;
    }
    el.textContent = Math.floor(current);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Form Helpers
// ═══════════════════════════════════════════════════════════════════════════

function serializeForm(form) {
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = v; });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Keyboard Shortcuts
// ═══════════════════════════════════════════════════════════════════════════

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      const search = document.getElementById('globalSearch');
      if (search) search.focus();
    }
    if (e.key === 'Escape') {
      document.querySelectorAll('.show').forEach(el => el.classList.remove('show'));
      const sidebar = document.getElementById('sidebar');
      if (sidebar && window.innerWidth <= 768) sidebar.classList.remove('open');
    }
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      toggleSidebarMode();
    }
    if (e.key === '?' && !e.target.closest('input,textarea,select')) {
      document.getElementById('shortcutsPanel')?.classList.toggle('show');
    }
  });
}

function toggleShortcuts() {
  document.getElementById('shortcutsPanel')?.classList.toggle('show');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fade-in Animation for Cards
// ═══════════════════════════════════════════════════════════════════════════

function initFadeAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animation = 'fadeInUp 0.5s ease forwards';
        entry.target.style.opacity = '1';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  // .doc-card is deliberately not in this list: the command guide runs its own
  // staggered rise (see views/docs.ejs) and would otherwise be animated twice.
  document.querySelectorAll('.stat-card, .card, .feature-card, .command-card, .guild-card').forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
  });
}

// ──────────────────────────────────────────────���────────────────────────────
//  initTooltips() used to live here, copying each nav row's label onto its title
//  attribute. There is no label copy any more: the rows print data-tip in the
//  markup, and js/shell.js draws the one tooltip both rails use. That function
//  could only have worked because the label was on the element as text, which is
//  why it read querySelector('span') -- and that is exactly what stops working
//  the moment the rail is collapsed, since the label is then display:none and
//  textContent is still there but the copy it guarded was no longer what anyone
//  saw.  Deleted rather than repointed: nothing calls it and nothing should.
// ───────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  Modal System
// ═══════════════════════════════════════════════════════════════════════════

function showModal(title, message, confirmText, onConfirm) {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.innerHTML = `
    <div class="modal-box fade-in-up">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="closeModal(this)"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">${message}</div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeModal(this)">إلغاء</button>
        <button class="btn-primary" id="modalConfirmBtn">${confirmText || 'تأكيد'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('modalConfirmBtn').addEventListener('click', async () => {
    if (onConfirm) await onConfirm();
    closeModal(overlay);
  });
}

function closeModal(el) {
  const overlay = el?.closest('.modal-overlay') || document.querySelector('.modal-overlay');
  if (overlay) {
    overlay.style.animation = 'fadeIn 0.2s ease reverse';
    setTimeout(() => overlay.remove(), 200);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Loading Overlay
// ═══════════════════════════════════════════════════════════════════════════

function showLoading(message) {
  const existing = document.querySelector('.loading-overlay');
  if (existing) return existing;
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = `
    <div class="loading-card glass fade-in-up">
      <div class="spinner spinner-lg" style="margin:0 auto 16px"></div>
      <p>${message || 'جاري التحميل...'}</p>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function hideLoading(overlay) {
  if (overlay) overlay.remove();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Confetti Effect
// ═══════════════════════════════════════════════════════════════════════════

function showConfetti() {
  // The brand's two violets plus its gold, green and red. The leading entry
  // used to be #5865f2, Discord blurple, so the confetti on a premium purchase
  // was a different colour from the site it was celebrating.
  const colors = ['#a855f7', '#d8b4fe', '#ffd93d', '#57f287', '#ed4245', '#ffffff'];
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (Math.random() * 6 + 4) + 'px';
    piece.style.height = (Math.random() * 6 + 4) + 'px';
    piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Locked Sections — show "no permission" instead of hiding links
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-link.locked, .user-menu-dropdown a.locked').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showToast('⛔ ليس لديك صلاحيات لهذه المنطقة', 'warning');
    });
  });

  document.querySelectorAll('.nav-link[data-req]').forEach(link => {
    link.addEventListener('click', (e) => {
      if (link.classList.contains('locked')) {
        e.preventDefault();
        e.stopPropagation();
        showToast('⛔ ليس لديك صلاحيات لهذه المنطقة', 'warning');
      }
    });
  });
});

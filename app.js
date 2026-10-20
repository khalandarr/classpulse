/**
 * ClassPulse — app.js
 * Main application logic: auth, routing, CRUD, alerts
 */

// ============================================================
// 1. SUPABASE CONFIGURATION
// ============================================================
// Replace the values below with your actual Supabase project URL and anon key.
// Find them in: Supabase Dashboard → Project Settings → API
const SUPABASE_URL = 'https://zakubqfnjptgtcibdqae.supabase.co';   // e.g. https://xxxx.supabase.co
const SUPABASE_KEY = 'sb_publishable_GaJMXTq35XcMCeKwc6j1EQ_nnJnXfji';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// 2. ALERT RULES  (transparent, rule-based — no ML)
// ============================================================
const RULES = {
  LOW_ATTENDANCE: { threshold: 75, label: 'Low Attendance', severity: 'danger' },
  VERY_LOW_ATTENDANCE: { threshold: 60, label: 'Critical Attendance', severity: 'danger' },
  LOW_MARKS: { threshold: 40, label: 'Low Marks', severity: 'warning' },
  FAIL_MARKS: { threshold: 33, label: 'Failing Marks', severity: 'danger' },
  DECLINING: { label: 'Declining Performance', severity: 'warning' },
};

const SUGGESTIONS = {
  LOW_ATTENDANCE: 'Schedule a one-on-one check-in to understand attendance barriers.',
  VERY_LOW_ATTENDANCE: 'Contact student and guardian immediately. Consider academic counselling.',
  LOW_MARKS: 'Review concept gaps. Suggest practice problems and peer study groups.',
  FAIL_MARKS: 'Arrange remedial sessions. Notify department if risk of course failure.',
  DECLINING: 'Compare recent vs. earlier assessment scores. Discuss study strategies.',
};

// ============================================================
// 3. STATE
// ============================================================
let currentUser = null;
let students = [];
let assessments = [];
let allMarks = [];
let allAttendance = [];
let followups = [];
let editingStudentId = null;

// ============================================================
// 4. UTILITY HELPERS
// ============================================================
const $ = id => document.getElementById(id);

function showToast(msg, type = 'success') {
  const c = $('toast-container');
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  c.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getInitials(name = '') {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function attendanceColor(p) {
  if (p >= 75) return 'green';
  if (p >= 60) return 'yellow';
  return 'red';
}

function marksBadge(score, max) {
  const p = pct(score, max);
  if (p >= 60) return 'badge-green';
  if (p >= 40) return 'badge-yellow';
  return 'badge-red';
}

// ============================================================
// 5. AUTH
// ============================================================
async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) onLogin(session.user);

  db.auth.onAuthStateChange((_event, session) => {
    if (session) onLogin(session.user);
    else onLogout();
  });
}

function onLogin(user) {
  currentUser = user;
  showApp();
  loadDashboard();
}

function onLogout() {
  currentUser = null;
  showAuth();
}

function showApp() {
  $('auth-section').style.display = 'none';
  $('app-section').classList.add('visible');
  const email = currentUser?.email || '';
  $('user-name-display').textContent = email.split('@')[0];
  $('user-avatar-text').textContent = getInitials(email.split('@')[0]);
}

function showAuth() {
  $('auth-section').style.display = 'flex';
  $('app-section').classList.remove('visible');
}

// ─ Login ───────────────────────────────────────────────────
$('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors('form-login');
  const email = $('login-email').value.trim();
  const pass = $('login-pass').value;
  if (!validateEmail(email)) return fieldError('login-email', 'Enter a valid email.');
  if (!pass) return fieldError('login-pass', 'Password is required.');

  const btn = e.submitter;
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) showToast(error.message, 'error');
});

// ─ Register ────────────────────────────────────────────────
$('form-register').addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors('form-register');
  const email = $('reg-email').value.trim();
  const pass = $('reg-pass').value;
  const pass2 = $('reg-pass2').value;
  let ok = true;
  if (!validateEmail(email)) { fieldError('reg-email', 'Enter a valid email.'); ok = false; }
  if (pass.length < 6) { fieldError('reg-pass', 'Min 6 characters.'); ok = false; }
  if (pass !== pass2) { fieldError('reg-pass2', 'Passwords do not match.'); ok = false; }
  if (!ok) return;

  const btn = e.submitter;
  btn.disabled = true; btn.textContent = 'Creating account…';
  const { error } = await db.auth.signUp({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Create Account';
  if (error) showToast(error.message, 'error');
  else showToast('Account created! Check your email to confirm, then sign in.', 'success');
});

// ─ Logout ──────────────────────────────────────────────────
$('btn-logout').addEventListener('click', async () => {
  await db.auth.signOut();
});

// ─ Auth tab toggle ─────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('login-form').style.display = btn.dataset.tab === 'login' ? 'block' : 'none';
    $('register-form').style.display = btn.dataset.tab === 'register' ? 'block' : 'none';
  });
});

// ============================================================
// 6. NAVIGATION
// ============================================================
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $(page).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  $('topbar-title').textContent = pageTitles[page] || 'ClassPulse';
  // Close sidebar on mobile
  $('sidebar').classList.remove('open');
  // Lazy-load page data
  pageLoaders[page]?.();
}

const pageTitles = {
  'page-dashboard': 'Dashboard',
  'page-students': 'Students',
  'page-attendance': 'Attendance',
  'page-assessments': 'Assessments',
  'page-followups': 'Follow-ups',
};

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
});

$('menu-toggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
});

// ============================================================
// 7. DATA LOADING
// ============================================================
async function fetchStudents() {
  const { data, error } = await db
    .from('students').select('*').order('name');
  if (error) { showToast('Failed to load students', 'error'); return []; }
  return data || [];
}

async function fetchAttendance() {
  const { data, error } = await db
    .from('attendance').select('*');
  if (error) { showToast('Failed to load attendance', 'error'); return []; }
  return data || [];
}

async function fetchAssessments() {
  const { data, error } = await db
    .from('assessments').select('*').order('date');
  if (error) { showToast('Failed to load assessments', 'error'); return []; }
  return data || [];
}

async function fetchMarks() {
  const { data, error } = await db
    .from('marks').select('*');
  if (error) { showToast('Failed to load marks', 'error'); return []; }
  return data || [];
}

async function fetchFollowups() {
  const { data, error } = await db
    .from('followups').select('*').order('created_at', { ascending: false });
  if (error) { showToast('Failed to load follow-ups', 'error'); return []; }
  return data || [];
}

async function loadAllData() {
  [students, allAttendance, assessments, allMarks, followups] = await Promise.all([
    fetchStudents(), fetchAttendance(), fetchAssessments(), fetchMarks(), fetchFollowups()
  ]);
}

// ============================================================
// 8. ALERT ENGINE (transparent rule-based)
// ============================================================
function computeStudentStats(sid) {
  // Attendance
  const att = allAttendance.filter(a => a.student_id === sid);
  const total = att.length;
  const present = att.filter(a => a.status === 'present' || a.status === 'late').length;
  const attPct = pct(present, total);

  // Marks per assessment
  const mks = allMarks.filter(m => m.student_id === sid);
  const scoredAssessments = assessments.map(a => {
    const m = mks.find(x => x.assessment_id === a.id);
    return m ? {
      name: a.name, score: m.score, max: a.max_marks, date: a.date,
      pct: pct(m.score, a.max_marks)
    } : null;
  }).filter(Boolean);

  // Average marks %
  const avgPct = scoredAssessments.length
    ? Math.round(scoredAssessments.reduce((s, a) => s + a.pct, 0) / scoredAssessments.length)
    : null;

  // Declining: last 2 have lower % than first ones (need ≥3 assessments)
  let declining = false;
  if (scoredAssessments.length >= 3) {
    const sorted = [...scoredAssessments].sort((a, b) => new Date(a.date) - new Date(b.date));
    const half = Math.floor(sorted.length / 2);
    const early = sorted.slice(0, half);
    const recent = sorted.slice(-half);
    const earlyAvg = early.reduce((s, a) => s + a.pct, 0) / early.length;
    const recentAvg = recent.reduce((s, a) => s + a.pct, 0) / recent.length;
    declining = recentAvg < earlyAvg - 10;   // 10 pp drop → declining
  }

  return { attPct, total, present, avgPct, scoredAssessments, declining };
}

function generateAlerts(sid, stats) {
  const alerts = [];
  const { attPct, total, avgPct, declining } = stats;

  if (total > 0) {
    if (attPct < RULES.VERY_LOW_ATTENDANCE.threshold) {
      alerts.push({
        type: 'VERY_LOW_ATTENDANCE',
        rule: `Attendance is ${attPct}% — below the 60% critical threshold.`,
        suggestion: SUGGESTIONS.VERY_LOW_ATTENDANCE,
        severity: 'danger',
      });
    } else if (attPct < RULES.LOW_ATTENDANCE.threshold) {
      alerts.push({
        type: 'LOW_ATTENDANCE',
        rule: `Attendance is ${attPct}% — below the 75% minimum requirement.`,
        suggestion: SUGGESTIONS.LOW_ATTENDANCE,
        severity: 'danger',
      });
    }
  }

  if (avgPct !== null) {
    if (avgPct < RULES.FAIL_MARKS.threshold) {
      alerts.push({
        type: 'FAIL_MARKS',
        rule: `Average marks are ${avgPct}% — below 33% pass mark.`,
        suggestion: SUGGESTIONS.FAIL_MARKS,
        severity: 'danger',
      });
    } else if (avgPct < RULES.LOW_MARKS.threshold) {
      alerts.push({
        type: 'LOW_MARKS',
        rule: `Average marks are ${avgPct}% — below 40% threshold.`,
        suggestion: SUGGESTIONS.LOW_MARKS,
        severity: 'warning',
      });
    }
  }

  if (declining) {
    alerts.push({
      type: 'DECLINING',
      rule: 'Recent assessment scores dropped more than 10 percentage points vs. earlier scores.',
      suggestion: SUGGESTIONS.DECLINING,
      severity: 'warning',
    });
  }

  return alerts;
}

function getAllAlerts() {
  const result = [];
  students.forEach(s => {
    const stats = computeStudentStats(s.id);
    const alerts = generateAlerts(s.id, stats);
    alerts.forEach(a => result.push({ ...a, student: s, stats }));
  });
  return result;
}

// ============================================================
// 9. DASHBOARD
// ============================================================
async function loadDashboard() {
  await loadAllData();
  renderDashboard();
}

function renderDashboard() {
  // Stats
  const allAlerts = getAllAlerts();
  const attPcts = students.map(s => computeStudentStats(s.id).attPct);
  const avgAtt = attPcts.length ? Math.round(attPcts.reduce((a, b) => a + b, 0) / attPcts.length) : 0;
  const atRisk = new Set(allAlerts.filter(a => a.severity === 'danger').map(a => a.student.id)).size;

  $('stat-students').textContent = students.length;
  $('stat-avg-att').textContent = students.length ? `${avgAtt}%` : '—';
  $('stat-alerts').textContent = allAlerts.length;
  $('stat-at-risk').textContent = atRisk;

  // Alert list (top 10)
  const container = $('dashboard-alerts');
  if (!allAlerts.length) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
      <h3>No alerts</h3><p>All students are doing well.</p></div>`;
    return;
  }

  container.innerHTML = allAlerts.slice(0, 15).map(a => `
    <div class="alert-item ${a.severity}">
      <div class="alert-row">
        <span class="alert-title">${escHtml(a.student.name)}
          <span style="font-weight:400;color:var(--text-secondary)"> — ${RULES[a.type]?.label || a.type}</span>
        </span>
        <button class="btn btn-sm btn-outline" onclick="openStudentDetail('${a.student.id}')">View</button>
      </div>
      <div class="alert-rule">📋 Rule: ${a.rule}</div>
      <div class="alert-suggestion">💡 <strong>Suggested Action:</strong> ${a.suggestion}</div>
    </div>`).join('');

  // Render dashboard chart
  renderDashboardChart();
}

function renderDashboardChart() {
  const canvas = $('dash-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = students.slice(0, 12).map(s => s.name.split(' ')[0]);
  const data = students.slice(0, 12).map(s => computeStudentStats(s.id).attPct);

  if (window._dashChart) window._dashChart.destroy();
  window._dashChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Attendance %',
        data,
        backgroundColor: data.map(v => v >= 75 ? '#dcfce7' : v >= 60 ? '#fef3c7' : '#fee2e2'),
        borderColor: data.map(v => v >= 75 ? '#16a34a' : v >= 60 ? '#d97706' : '#dc2626'),
        borderWidth: 2,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// ============================================================
// 10. STUDENTS PAGE
// ============================================================
const pageLoaders = {
  'page-dashboard': () => renderDashboard(),
  'page-students': () => renderStudentsPage(),
  'page-attendance': () => renderAttendancePage(),
  'page-assessments': () => renderAssessmentsPage(),
  'page-followups': () => renderFollowupsPage(),
};

function renderStudentsPage() {
  renderStudentTable($('students-search').value.trim());
}

function renderStudentTable(query = '') {
  const tbody = $('students-tbody');
  const filtered = query
    ? students.filter(s => s.name.toLowerCase().includes(query.toLowerCase())
      || s.roll_number.toLowerCase().includes(query.toLowerCase())
      || s.course.toLowerCase().includes(query.toLowerCase()))
    : students;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state" style="padding:2rem">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
        <h3>${query ? 'No results found' : 'No students yet'}</h3>
        <p>${query ? 'Try a different search.' : 'Add your first student to get started.'}</p>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const stats = computeStudentStats(s.id);
    const alerts = generateAlerts(s.id, stats);
    const attBadge = stats.total > 0
      ? `<span class="badge badge-${stats.attPct >= 75 ? 'green' : stats.attPct >= 60 ? 'yellow' : 'red'}">${stats.attPct}%</span>`
      : `<span class="badge badge-gray">—</span>`;
    const marksBadgeHtml = stats.avgPct !== null
      ? `<span class="badge ${stats.avgPct >= 60 ? 'badge-green' : stats.avgPct >= 40 ? 'badge-yellow' : 'badge-red'}">${stats.avgPct}%</span>`
      : `<span class="badge badge-gray">—</span>`;

    return `<tr>
      <td>${escHtml(s.name)}</td>
      <td>${escHtml(s.roll_number)}</td>
      <td>${escHtml(s.course)}</td>
      <td>${attBadge}</td>
      <td>${marksBadgeHtml}</td>
      <td>${alerts.length ? `<span class="badge badge-red">${alerts.length}</span>` : '<span class="badge badge-green">0</span>'}</td>
      <td>
        <div style="display:flex;gap:.3rem">
          <button class="btn-icon" title="View" onclick="openStudentDetail('${s.id}')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
          <button class="btn-icon" title="Edit" onclick="openEditStudent('${s.id}')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="btn-icon danger" title="Delete" onclick="deleteStudent('${s.id}','${escHtml(s.name)}')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Search
$('students-search').addEventListener('input', () => {
  renderStudentTable($('students-search').value);
});

// ─ Add/Edit Student Modal ───────────────────────────────────
$('btn-add-student').addEventListener('click', () => {
  editingStudentId = null;
  $('student-modal-title').textContent = 'Add Student';
  $('form-student').reset();
  clearErrors('form-student');
  openModal('modal-student');
});

function openEditStudent(id) {
  const s = students.find(x => x.id === id);
  if (!s) return;
  editingStudentId = id;
  $('student-modal-title').textContent = 'Edit Student';
  $('s-name').value = s.name;
  $('s-roll').value = s.roll_number;
  $('s-email').value = s.email || '';
  $('s-phone').value = s.phone || '';
  $('s-course').value = s.course;
  $('s-semester').value = s.semester;
  clearErrors('form-student');
  openModal('modal-student');
}

$('form-student').addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors('form-student');
  const name = $('s-name').value.trim();
  const roll = $('s-roll').value.trim();
  const email = $('s-email').value.trim();
  const phone = $('s-phone').value.trim();
  const course = $('s-course').value.trim();
  const semester = parseInt($('s-semester').value, 10);
  let ok = true;

  if (!name) { fieldError('s-name', 'Name is required.'); ok = false; }
  if (!roll) { fieldError('s-roll', 'Roll number is required.'); ok = false; }
  if (!course) { fieldError('s-course', 'Course is required.'); ok = false; }
  if (!semester || semester < 1 || semester > 8) { fieldError('s-semester', 'Enter semester 1–8.'); ok = false; }
  if (email && !validateEmail(email)) { fieldError('s-email', 'Enter a valid email.'); ok = false; }
  if (!ok) return;

  const payload = {
    name, roll_number: roll, email: email || null,
    phone: phone || null, course, semester, teacher_id: currentUser.id
  };
  const btn = e.submitter;
  btn.disabled = true;

  let error;
  if (editingStudentId) {
    ({ error } = await db.from('students').update(payload).eq('id', editingStudentId));
  } else {
    ({ error } = await db.from('students').insert([payload]));
  }
  btn.disabled = false;

  if (error) {
    if (error.code === '23505') showToast('Roll number already exists.', 'error');
    else showToast(error.message, 'error');
    return;
  }
  showToast(editingStudentId ? 'Student updated.' : 'Student added.');
  closeModal('modal-student');
  students = await fetchStudents();
  renderStudentTable($('students-search').value);
  renderDashboard();
});

async function deleteStudent(id, name) {
  if (!confirm(`Delete student "${name}"? This will also remove their attendance and marks.`)) return;
  const { error } = await db.from('students').delete().eq('id', id);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Student deleted.');
  students = await fetchStudents();
  allAttendance = await fetchAttendance();
  allMarks = await fetchMarks();
  followups = await fetchFollowups();
  renderStudentTable($('students-search').value);
  renderDashboard();
}

// ─ Student Detail Modal ─────────────────────────────────────
function openStudentDetail(sid) {
  const s = students.find(x => x.id === sid);
  if (!s) return;
  const stats = computeStudentStats(sid);
  const alerts = generateAlerts(sid, stats);

  $('detail-student-name').textContent = s.name;

  $('detail-info').innerHTML = `
    <div class="detail-item"><div class="label">Roll No.</div><div class="value">${escHtml(s.roll_number)}</div></div>
    <div class="detail-item"><div class="label">Course</div><div class="value">${escHtml(s.course)}</div></div>
    <div class="detail-item"><div class="label">Semester</div><div class="value">${s.semester}</div></div>
    <div class="detail-item"><div class="label">Email</div><div class="value">${s.email ? escHtml(s.email) : '—'}</div></div>
    <div class="detail-item"><div class="label">Phone</div><div class="value">${s.phone ? escHtml(s.phone) : '—'}</div></div>
    <div class="detail-item"><div class="label">Added</div><div class="value">${formatDate(s.created_at)}</div></div>
  `;

  // Attendance summary
  const attColor = attendanceColor(stats.attPct);
  $('detail-attendance').innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:.75rem">
      <div style="font-size:2rem;font-weight:700;color:var(--${attColor === 'green' ? 'success' : attColor === 'yellow' ? 'warning' : 'danger'})">${stats.total ? stats.attPct + '%' : '—'}</div>
      <div style="font-size:.85rem;color:var(--text-secondary)">${stats.present} present / ${stats.total} classes</div>
    </div>
    <div class="progress-bar-outer">
      <div class="progress-bar-inner ${attColor}" style="width:${stats.attPct}%"></div>
    </div>
  `;

  // Marks table
  if (!stats.scoredAssessments.length) {
    $('detail-marks').innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No marks recorded yet.</p>';
  } else {
    $('detail-marks').innerHTML = `
      <table>
        <thead><tr><th>Assessment</th><th>Date</th><th>Score</th><th>Max</th><th>%</th></tr></thead>
        <tbody>${stats.scoredAssessments.map(a => `
          <tr>
            <td>${escHtml(a.name)}</td>
            <td>${formatDate(a.date)}</td>
            <td>${a.score}</td>
            <td>${a.max}</td>
            <td><span class="badge ${marksBadge(a.score, a.max)}">${a.pct}%</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // Chart
  renderDetailChart(sid, stats);

  // Alerts
  if (!alerts.length) {
    $('detail-alerts').innerHTML = '<div class="empty-state" style="padding:1rem"><p>No alerts for this student. 🎉</p></div>';
  } else {
    $('detail-alerts').innerHTML = alerts.map(a => `
      <div class="alert-item ${a.severity}" style="margin-bottom:.6rem">
        <div class="alert-title">${RULES[a.type]?.label || a.type}</div>
        <div class="alert-rule">📋 Rule: ${a.rule}</div>
        <div class="alert-suggestion">💡 <strong>Suggested Action:</strong> ${a.suggestion}</div>
        <div style="margin-top:.5rem">
          <button class="btn btn-sm btn-outline" onclick="addFollowupFromAlert('${sid}','${a.type}')">Log Follow-up</button>
        </div>
      </div>`).join('');
  }

  openModal('modal-student-detail');
}

function renderDetailChart(sid, stats) {
  const canvas = $('detail-chart');
  if (!canvas || !stats.scoredAssessments.length || typeof Chart === 'undefined') return;
  const sorted = [...stats.scoredAssessments].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (window._detailChart) window._detailChart.destroy();
  window._detailChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: sorted.map(a => a.name),
      datasets: [{
        label: 'Score %',
        data: sorted.map(a => a.pct),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,.08)',
        borderWidth: 2,
        pointRadius: 4,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#f1f5f9' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// ============================================================
// 11. ATTENDANCE PAGE
// ============================================================
function renderAttendancePage() {
  populateStudentSelects();
  // Set today's date
  const today = new Date().toISOString().split('T')[0];
  $('att-date').value = today;
  renderAttGrid();
}

function renderAttGrid() {
  const date = $('att-date').value;
  const tbody = $('att-grid-tbody');
  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)">Add students first.</td></tr>`;
    return;
  }
  tbody.innerHTML = students.map(s => {
    const existing = allAttendance.find(a => a.student_id === s.id && a.date === date);
    const status = existing?.status || '';
    return `<tr>
      <td>${escHtml(s.name)}</td>
      <td>${escHtml(s.roll_number)}</td>
      <td>${escHtml(s.course)} (Sem ${s.semester})</td>
      <td>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-sm ${status === 'present' ? 'btn-primary' : 'btn-outline'}" onclick="markAttendance('${s.id}','${date}','present',this)">Present</button>
          <button class="btn btn-sm ${status === 'late' ? 'btn-primary' : 'btn-outline'}" onclick="markAttendance('${s.id}','${date}','late',this)">Late</button>
          <button class="btn btn-sm ${status === 'absent' ? 'btn-danger' : 'btn-outline'}" onclick="markAttendance('${s.id}','${date}','absent',this)">Absent</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

$('att-date').addEventListener('change', renderAttGrid);

async function markAttendance(studentId, date, status, btn) {
  // Check if record exists
  const existing = allAttendance.find(a => a.student_id === studentId && a.date === date);
  let error;
  if (existing) {
    ({ error } = await db.from('attendance').update({ status }).eq('id', existing.id));
    if (!error) existing.status = status;
  } else {
    const { data, error: e } = await db.from('attendance').insert([{
      student_id: studentId, date, status, teacher_id: currentUser.id
    }]).select().single();
    error = e;
    if (!error) allAttendance.push(data);
  }
  if (error) { showToast(error.message, 'error'); return; }
  renderAttGrid();
}

// Attendance history
$('btn-att-history').addEventListener('click', async () => {
  const sid = $('att-history-student').value;
  if (!sid) { showToast('Select a student first.', 'warning'); return; }
  const recs = allAttendance.filter(a => a.student_id === sid)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const tbody = $('att-history-tbody');
  if (!recs.length) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;padding:1rem;color:var(--text-muted)">No records found.</td></tr>`;
  } else {
    tbody.innerHTML = recs.map(r => `
      <tr>
        <td>${formatDate(r.date)}</td>
        <td><span class="badge ${r.status === 'present' ? 'badge-green' : r.status === 'late' ? 'badge-yellow' : 'badge-red'}">${r.status}</span></td>
      </tr>`).join('');
  }
  $('att-history-section').style.display = 'block';
});

// ============================================================
// 12. ASSESSMENTS PAGE
// ============================================================
function renderAssessmentsPage() {
  renderAssessmentList();
}

function renderAssessmentList() {
  const list = $('assessment-list');
  if (!assessments.length) {
    list.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 3a2 2 0 110 4 2 2 0 010-4zm4 12H8v-.7c0-1.4 2.7-2.1 4-2.1s4 .7 4 2.1V18z"/></svg>
      <h3>No assessments yet</h3><p>Create your first assessment.</p>
    </div>`;
    return;
  }
  list.innerHTML = assessments.map(a => `
    <div class="card" style="margin-bottom:.75rem">
      <div class="card-header">
        <div style="flex:1">
          <div style="font-weight:600">${escHtml(a.name)}</div>
          <div style="font-size:.8rem;color:var(--text-secondary)">Max marks: ${a.max_marks} · ${formatDate(a.date)}</div>
        </div>
        <button class="btn btn-sm btn-outline" onclick="openMarkEntry('${a.id}')">Enter Marks</button>
        <button class="btn-icon danger" onclick="deleteAssessment('${a.id}','${escHtml(a.name)}')">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>`).join('');
}

$('btn-add-assessment').addEventListener('click', () => {
  $('form-assessment').reset();
  clearErrors('form-assessment');
  openModal('modal-assessment');
});

$('form-assessment').addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors('form-assessment');
  const name = $('a-name').value.trim();
  const max = parseInt($('a-max').value, 10);
  const date = $('a-date').value;
  let ok = true;
  if (!name) { fieldError('a-name', 'Assessment name is required.'); ok = false; }
  if (!max || max < 1) { fieldError('a-max', 'Max marks must be a positive number.'); ok = false; }
  if (!date) { fieldError('a-date', 'Date is required.'); ok = false; }
  if (!ok) return;

  const btn = e.submitter; btn.disabled = true;
  const { error } = await db.from('assessments').insert([{
    name, max_marks: max, date, teacher_id: currentUser.id
  }]);
  btn.disabled = false;
  if (error) {
    if (error.code === '23505') showToast('Assessment name already exists.', 'error');
    else showToast(error.message, 'error');
    return;
  }
  showToast('Assessment created.');
  closeModal('modal-assessment');
  assessments = await fetchAssessments();
  renderAssessmentList();
});

async function deleteAssessment(id, name) {
  if (!confirm(`Delete assessment "${name}"? All associated marks will be removed.`)) return;
  const { error } = await db.from('assessments').delete().eq('id', id);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Assessment deleted.');
  assessments = await fetchAssessments();
  allMarks = await fetchMarks();
  renderAssessmentList();
}

// ─ Mark Entry Modal ─────────────────────────────────────────
let markEntryAssessmentId = null;

function openMarkEntry(aid) {
  const a = assessments.find(x => x.id === aid);
  if (!a) return;
  markEntryAssessmentId = aid;
  $('mark-entry-title').textContent = `Marks — ${a.name} (Max: ${a.max_marks})`;

  const rows = students.map(s => {
    const existing = allMarks.find(m => m.student_id === s.id && m.assessment_id === aid);
    return `<tr>
      <td>${escHtml(s.name)}</td>
      <td>${escHtml(s.roll_number)}</td>
      <td>
        <input type="number" class="form-input" style="width:90px"
          id="mark-${s.id}" min="0" max="${a.max_marks}" step="0.5"
          value="${existing ? existing.score : ''}" placeholder="—">
      </td>
    </tr>`;
  });

  $('mark-entry-tbody').innerHTML = students.length
    ? rows.join('')
    : `<tr><td colspan="3" style="text-align:center;padding:1rem;color:var(--text-muted)">No students added yet.</td></tr>`;

  openModal('modal-mark-entry');
}

$('btn-save-marks').addEventListener('click', async () => {
  const a = assessments.find(x => x.id === markEntryAssessmentId);
  if (!a) return;
  const toUpsert = [];
  let hasError = false;

  students.forEach(s => {
    const inp = $(`mark-${s.id}`);
    if (!inp) return;
    const val = inp.value.trim();
    if (val === '') return;  // skip blank
    const score = parseFloat(val);
    if (isNaN(score) || score < 0 || score > a.max_marks) {
      inp.classList.add('error');
      hasError = true;
    } else {
      inp.classList.remove('error');
      toUpsert.push({
        student_id: s.id, assessment_id: a.id,
        teacher_id: currentUser.id, score
      });
    }
  });

  if (hasError) { showToast(`Scores must be between 0 and ${a.max_marks}.`, 'error'); return; }
  if (!toUpsert.length) { closeModal('modal-mark-entry'); return; }

  const { error } = await db.from('marks')
    .upsert(toUpsert, { onConflict: 'student_id,assessment_id' });
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Marks saved.');
  closeModal('modal-mark-entry');
  allMarks = await fetchMarks();
  renderDashboard();
});

// ============================================================
// 13. FOLLOW-UPS PAGE
// ============================================================
function renderFollowupsPage() {
  populateStudentSelects();
  renderFollowupTable();
}

function renderFollowupTable(filter = 'all') {
  const tbody = $('followups-tbody');
  let list = [...followups];
  if (filter !== 'all') list = list.filter(f => f.status === filter);

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5">
      <div class="empty-state" style="padding:1.5rem">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
        <h3>No follow-ups</h3><p>Follow-ups you log from alerts appear here.</p>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(f => {
    const s = students.find(x => x.id === f.student_id);
    const statusBadge = {
      pending: '<span class="badge badge-yellow">Pending</span>',
      in_progress: '<span class="badge badge-blue">In Progress</span>',
      resolved: '<span class="badge badge-green">Resolved</span>',
    }[f.status] || '';
    return `<tr>
      <td>${s ? escHtml(s.name) : '—'}</td>
      <td>${RULES[f.alert_type]?.label || f.alert_type}</td>
      <td>${f.note ? escHtml(f.note) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${statusBadge}</td>
      <td>
        <select class="form-select" style="padding:.25rem .5rem;font-size:.8rem;width:130px"
          onchange="updateFollowupStatus('${f.id}', this.value)">
          <option value="pending"     ${f.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${f.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="resolved"    ${f.status === 'resolved' ? 'selected' : ''}>Resolved</option>
        </select>
      </td>
    </tr>`;
  }).join('');
}

document.querySelectorAll('.followup-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.followup-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderFollowupTable(btn.dataset.filter);
  });
});

async function updateFollowupStatus(id, status) {
  const { error } = await db.from('followups').update({ status }).eq('id', id);
  if (error) { showToast(error.message, 'error'); return; }
  followups = await fetchFollowups();
  renderFollowupTable($('.followup-filter-btn.active')?.dataset.filter || 'all');
  showToast('Follow-up status updated.');
}

function addFollowupFromAlert(sid, alertType) {
  $('fu-student').value = sid;
  $('fu-alert-type').value = alertType;
  $('fu-note').value = '';
  clearErrors('form-followup');
  openModal('modal-followup');
}

$('btn-add-followup').addEventListener('click', () => {
  $('form-followup').reset();
  clearErrors('form-followup');
  populateStudentSelects();
  openModal('modal-followup');
});

$('form-followup').addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors('form-followup');
  const sid = $('fu-student').value;
  const atype = $('fu-alert-type').value;
  const note = $('fu-note').value.trim();
  let ok = true;
  if (!sid) { fieldError('fu-student', 'Select a student.'); ok = false; }
  if (!atype) { fieldError('fu-alert-type', 'Select an alert type.'); ok = false; }
  if (!ok) return;

  const btn = e.submitter; btn.disabled = true;
  const { error } = await db.from('followups').insert([{
    student_id: sid, alert_type: atype,
    note: note || null, teacher_id: currentUser.id
  }]);
  btn.disabled = false;
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Follow-up logged.');
  closeModal('modal-followup');
  followups = await fetchFollowups();
  renderFollowupTable($('.followup-filter-btn.active')?.dataset.filter || 'all');
});

// ============================================================
// 14. HELPERS
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function fieldError(id, msg) {
  const el = $(id);
  if (el) el.classList.add('error');
  const err = document.querySelector(`[data-error="${id}"]`);
  if (err) err.textContent = msg;
}

function clearErrors(formId) {
  const form = $(formId);
  if (!form) return;
  form.querySelectorAll('.form-input, .form-select, .form-textarea').forEach(el => el.classList.remove('error'));
  form.querySelectorAll('.form-error').forEach(el => el.textContent = '');
}

function populateStudentSelects() {
  ['att-history-student', 'fu-student'].forEach(selId => {
    const sel = $(selId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Select student…</option>` +
      students.map(s => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${escHtml(s.name)} (${escHtml(s.roll_number)})</option>`).join('');
  });
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.remove('open'));
});

// ============================================================
// 15. CONFIG CHECK
// ============================================================
function checkConfig() {
  if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    $('config-banner').classList.add('show');
  }
}

// ============================================================
// 16. BOOT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  checkConfig();
  navigate('page-dashboard');
  initAuth();
});

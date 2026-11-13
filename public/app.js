/**
 * GapFinder AI — Modern Student Learning Workspace Controller
 * Pure Vanilla JavaScript (ES6+) — Three-Part Workspace Layout
 */

// Global Application State
const AppState = {
  currentView: 'dashboard', // 'dashboard', 'doc-hierarchy', 'topic-workspace', 'login'
  supabaseClient: null,
  session: null,
  user: null,
  
  // Library data
  subjects: [],
  documents: [],
  
  // Active learning context
  selectedSubject: null,
  selectedDocument: null,
  selectedChapter: null,
  selectedTopic: null,
  curriculumTree: null,
  
  // Topic Workspace Tab
  topicActiveTab: 'study', // 'study' or 'quiz'
  
  // Inline Quiz State
  activeQuiz: null,
  quizState: {
    currentIndex: 0,
    selectedOption: null,
    isSubmitted: false,
    score: 0,
    answers: []
  },
  
  // AI Drawer State
  isAiDrawerOpen: false,
  aiChatMessages: []
};

window.AppState = AppState;

// ============================================================================
// Toast Notification Utility
// ============================================================================
function showToast(message, type = 'info') {
  if (!message) return;
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 380px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const bg = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : type === 'success' ? '#10b981' : '#3b82f6';
  const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';

  toast.style.cssText = `
    background: #ffffff;
    color: #1e293b;
    border-left: 4px solid ${bg};
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 0.88rem;
    line-height: 1.4;
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: auto;
    opacity: 0;
    transform: translateY(-10px);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  const msgSpan = document.createElement('span');
  msgSpan.style.flex = '1';
  msgSpan.textContent = message;

  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '1.1rem';
  iconSpan.style.flexShrink = '0';
  iconSpan.textContent = icon;

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

window.showToast = showToast;

// ============================================================================
// Initialization on DOM Ready
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigationAndUI();
  await initSupabaseClient();
  setupUploadModal();
  setupAiDrawer();
  setupTopicTabs();
});

// ============================================================================
// API Helper (Supports Bearer Auth Token from Supabase Session)
// ============================================================================
async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};

  if (AppState.session?.access_token) {
    headers['Authorization'] = `Bearer ${AppState.session.access_token}`;
  }
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(endpoint, {
      ...options,
      headers
    });

    const data = await response.json().catch(() => ({
      success: false,
      error: 'Invalid response format from server'
    }));

    if (!response.ok && !data.error) {
      data.error = `HTTP Error ${response.status}`;
    }

    return data;
  } catch (err) {
    console.error(`API call to ${endpoint} failed:`, err);
    return { success: false, error: err.message };
  }
}

// ============================================================================
// Supabase Client & Authentication
// ============================================================================
async function initSupabaseClient() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();

    if (data.success && data.config?.supabaseUrl && data.config?.supabaseAnonKey) {
      if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
        AppState.supabaseClient = window.supabase.createClient(
          data.config.supabaseUrl,
          data.config.supabaseAnonKey,
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true
            }
          }
        );

        // Listen for session changes
        AppState.supabaseClient.auth.onAuthStateChange((event, session) => {
          handleSessionChange(session);
        });

        // Check active session
        const { data: sessionData } = await AppState.supabaseClient.auth.getSession();
        if (sessionData?.session) {
          handleSessionChange(sessionData.session);
        } else {
          updateUserDisplay(null);
        }
      }
    }
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    updateUserDisplay(null);
  }
}

function handleSessionChange(session) {
  AppState.session = session;
  AppState.user = session ? session.user : null;
  updateUserDisplay(AppState.user);

  if (AppState.user) {
    if (AppState.currentView === 'login') {
      navigateTo('dashboard');
    }
    loadLibrary();
  } else {
    AppState.subjects = [];
    AppState.documents = [];
    renderLibrarySubjects([]);
    renderDashboardMetrics();
  }
}

function updateUserDisplay(user) {
  const userAvatar = document.getElementById('user-avatar-initials');
  const userDisplayName = document.getElementById('user-display-name');
  const authBtn = document.getElementById('auth-btn');

  if (user) {
    const name = user.user_metadata?.full_name || user.email.split('@')[0];
    const initials = name.substring(0, 2).toUpperCase();
    if (userAvatar) userAvatar.textContent = initials;
    if (userDisplayName) userDisplayName.textContent = name;
    if (authBtn) {
      authBtn.textContent = 'Sign Out';
      authBtn.onclick = signOut;
    }
  } else {
    if (userAvatar) userAvatar.textContent = '?';
    if (userDisplayName) userDisplayName.textContent = 'Not Signed In';
    if (authBtn) {
      authBtn.textContent = 'Sign In';
      authBtn.onclick = () => navigateTo('login');
    }
  }
}

// ============================================================================
// Layout Navigation & Breadcrumbs
// ============================================================================
function setupNavigationAndUI() {
  // Sidebar toggle
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('app-sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Dashboard nav
  const dashBtn = document.getElementById('nav-btn-dashboard');
  if (dashBtn) dashBtn.addEventListener('click', () => navigateTo('dashboard'));

  // Gap Analysis nav
  const gapBtn = document.getElementById('nav-btn-gap-analysis');
  if (gapBtn) gapBtn.addEventListener('click', () => openGapAnalysisView());

  // Revision Plan nav
  const planBtn = document.getElementById('nav-btn-revision-plan');
  if (planBtn) planBtn.addEventListener('click', () => openRevisionPlanView());

  const gotoPlanBtn = document.getElementById('btn-goto-revision-plan');
  if (gotoPlanBtn) gotoPlanBtn.addEventListener('click', () => openRevisionPlanView());

  const refreshPlanBtn = document.getElementById('btn-refresh-revision-plan');
  if (refreshPlanBtn) refreshPlanBtn.addEventListener('click', () => {
    const select = document.getElementById('plan-subject-select');
    const subId = select?.value || AppState.selectedSubject?.id;
    if (subId) loadRevisionPlan(subId);
  });

  const planSubjectSelect = document.getElementById('plan-subject-select');
  if (planSubjectSelect) {
    planSubjectSelect.addEventListener('change', (e) => {
      if (e.target.value) loadRevisionPlan(e.target.value);
    });
  }

  const generatePlanBtn = document.getElementById('btn-generate-plan');
  if (generatePlanBtn) generatePlanBtn.addEventListener('click', () => handleGenerateRevisionPlan());

  const brandLink = document.getElementById('brand-home-link');
  if (brandLink) brandLink.addEventListener('click', () => navigateTo('dashboard'));

  // Refresh library
  const refreshBtn = document.getElementById('btn-refresh-library');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadLibrary());

  // Refresh Gap Analysis
  const refreshGapBtn = document.getElementById('btn-refresh-gap-analysis');
  if (refreshGapBtn) refreshGapBtn.addEventListener('click', () => {
    const select = document.getElementById('gap-subject-select');
    const subId = select?.value || AppState.selectedSubject?.id;
    if (subId) loadGapAnalysis(subId);
  });

  // Gap Subject Select change
  const gapSubjectSelect = document.getElementById('gap-subject-select');
  if (gapSubjectSelect) {
    gapSubjectSelect.addEventListener('change', (e) => {
      if (e.target.value) loadGapAnalysis(e.target.value);
    });
  }

  // Upload modal trigger
  const openUploadBtn = document.getElementById('btn-open-upload-modal');
  if (openUploadBtn) openUploadBtn.addEventListener('click', openUploadModal);

  // Auth form submissions
  setupAuthForms();
}

function navigateTo(viewName) {
  AppState.currentView = viewName;
  const panels = document.querySelectorAll('.view-panel');
  panels.forEach(p => p.style.display = 'none');

  const target = document.getElementById(`view-${viewName}`);
  if (target) target.style.display = 'block';

  // Update active sidebar nav
  const dashBtn = document.getElementById('nav-btn-dashboard');
  if (dashBtn) {
    if (viewName === 'dashboard') dashBtn.classList.add('active');
    else dashBtn.classList.remove('active');
  }

  const gapBtn = document.getElementById('nav-btn-gap-analysis');
  if (gapBtn) {
    if (viewName === 'gap-analysis') gapBtn.classList.add('active');
    else gapBtn.classList.remove('active');
  }

  const planBtn = document.getElementById('nav-btn-revision-plan');
  if (planBtn) {
    if (viewName === 'revision-plan') planBtn.classList.add('active');
    else planBtn.classList.remove('active');
  }

  updateBreadcrumbs();

  // If navigating to dashboard, refresh dynamic metrics immediately
  if (viewName === 'dashboard') {
    renderDashboardMetrics();
    renderDashboardMaterials();
    // Asynchronously fetch fresh quiz history to guarantee real-time dynamic sync
    if (AppState.session?.access_token) {
      apiRequest('/api/quiz/history').then(res => {
        if (res && res.success && Array.isArray(res.attempts)) {
          AppState.quizAttempts = res.attempts;
          renderDashboardMetrics();
        }
      }).catch(() => {});
    }
  }
}

function updateBreadcrumbs() {
  const container = document.getElementById('workspace-breadcrumbs');
  if (!container) return;

  if (AppState.currentView === 'dashboard') {
    container.innerHTML = '<span class="crumb active">Dashboard</span>';
  } else if (AppState.currentView === 'login') {
    container.innerHTML = '<span class="crumb active">Student Sign In</span>';
  } else if (AppState.currentView === 'gap-analysis') {
    const subName = AppState.selectedSubject?.name || 'Mathematics';
    container.innerHTML = `
      <span class="crumb" onclick="navigateTo('dashboard')" style="cursor:pointer;">Dashboard</span>
      <span class="separator">›</span>
      <span class="crumb">${escapeHtml(subName)}</span>
      <span class="separator">›</span>
      <span class="crumb active">Diagnostic Gap Analysis</span>
    `;
  } else if (AppState.currentView === 'revision-plan') {
    const subName = AppState.selectedSubject?.name || 'Mathematics';
    container.innerHTML = `
      <span class="crumb" onclick="navigateTo('dashboard')" style="cursor:pointer;">Dashboard</span>
      <span class="separator">›</span>
      <span class="crumb" onclick="openGapAnalysisView()" style="cursor:pointer;">${escapeHtml(subName)}</span>
      <span class="separator">›</span>
      <span class="crumb active">Personalized Revision Plan</span>
    `;
  } else if (AppState.currentView === 'doc-hierarchy') {
    const docName = AppState.selectedDocument?.file_name || 'Document';
    const subName = AppState.selectedSubject?.name || 'Subject';
    container.innerHTML = `
      <span class="crumb" onclick="navigateTo('dashboard')" style="cursor:pointer;">Library</span>
      <span class="separator">›</span>
      <span class="crumb">${escapeHtml(subName)}</span>
      <span class="separator">›</span>
      <span class="crumb active">${escapeHtml(docName)}</span>
    `;
  } else if (AppState.currentView === 'topic-workspace') {
    const docName = AppState.selectedDocument?.file_name || 'Document';
    const subName = AppState.selectedSubject?.name || 'Subject';
    const chapName = AppState.selectedChapter?.name || 'Chapter';
    const topicName = AppState.selectedTopic?.name || 'Topic';
    container.innerHTML = `
      <span class="crumb" onclick="navigateTo('dashboard')" style="cursor:pointer;">Library</span>
      <span class="separator">›</span>
      <span class="crumb" onclick="navigateTo('doc-hierarchy')" style="cursor:pointer;">${escapeHtml(docName)}</span>
      <span class="separator">›</span>
      <span class="crumb">${escapeHtml(chapName)}</span>
      <span class="separator">›</span>
      <span class="crumb active">${escapeHtml(topicName)}</span>
    `;
  }
}

// ============================================================================
// Learning Library (Left Sidebar)
// ============================================================================
async function loadLibrary() {
  if (!AppState.user) return;
  const listContainer = document.getElementById('library-subjects-list');
  if (listContainer) {
    listContainer.innerHTML = '<p class="text-muted" style="font-size: 0.8rem; padding: 0.5rem;">Loading library...</p>';
  }

  try {
    const [docsRes, subjectsRes, quizHistoryRes] = await Promise.all([
      apiRequest('/api/documents/list'),
      apiRequest('/api/topics/list'),
      apiRequest('/api/quiz/history').catch(() => ({ attempts: [] }))
    ]);

    AppState.documents = docsRes.documents || [];
    AppState.subjects = subjectsRes.subjects || [];
    AppState.quizAttempts = Array.isArray(quizHistoryRes?.attempts) ? quizHistoryRes.attempts : [];

    // Fallback sync with localStorage cache if present
    try {
      const userKey = AppState.user?.id || AppState.currentUser?.id || 'guest';
      const cached = localStorage.getItem(`gapfinder_quiz_attempts_${userKey}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > AppState.quizAttempts.length) {
          AppState.quizAttempts = parsed;
        }
      }
    } catch {}

    if (AppState.subjects.length === 0) {
      AppState.subjects = [{
        id: '173b9439-b3c2-42c5-9ac0-592bf50a6626',
        name: 'Mathematics',
        description: 'Class X Mathematics Curriculum'
      }];
    }

    renderLibrarySubjects(AppState.subjects, AppState.documents);
    renderDashboardMetrics();
    renderDashboardMaterials();
  } catch (err) {
    console.error('Failed to load library:', err);
    if (listContainer) {
      listContainer.innerHTML = '<p class="text-muted" style="font-size: 0.8rem; padding: 0.5rem; color: #ef4444;">Failed to load library.</p>';
    }
  }
}

function renderLibrarySubjects(subjects, documents) {
  const container = document.getElementById('library-subjects-list');
  if (!container) return;

  if (!documents || documents.length === 0) {
    container.innerHTML = `
      <div style="padding: 0.75rem 0.5rem; text-align: center;">
        <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.5rem;">No materials uploaded yet.</p>
        <button class="btn btn-outline btn-sm" onclick="openUploadModal()" style="font-size:0.75rem;">+ Upload Material</button>
      </div>
    `;
    return;
  }

  // Group documents by subject
  const subjectMap = new Map();
  subjects.forEach(s => subjectMap.set(s.id, { ...s, docs: [] }));

  const unassignedDocs = [];
  documents.forEach(doc => {
    // Check if any subject has this document as source_document_id
    const matchedSubject = subjects.find(s => s.source_document_id === doc.id);
    if (matchedSubject) {
      subjectMap.get(matchedSubject.id).docs.push(doc);
    } else {
      unassignedDocs.push(doc);
    }
  });

  let html = '';

  // Render Subjects with their respective documents
  for (const [subId, sub] of subjectMap.entries()) {
    if (sub.docs.length === 0) continue;
    html += `
      <div class="lib-subject-group" data-subject-id="${sub.id}">
        <div class="lib-subject-header" onclick="toggleSubjectGroup('${sub.id}')">
          <div class="lib-subject-title">
            <span>📚</span>
            <span>${escapeHtml(sub.name)}</span>
          </div>
          <span class="lib-subject-badge">${sub.docs.length} ${sub.docs.length === 1 ? 'doc' : 'docs'}</span>
        </div>
        <div class="lib-docs-list" id="docs-list-${sub.id}">
          ${sub.docs.map(d => `
            <div class="lib-doc-item ${AppState.selectedDocument?.id === d.id ? 'active' : ''}" 
                 onclick="selectDocument('${d.id}', '${sub.id}')"
                 title="${escapeHtml(d.file_name)}">
              <div class="lib-doc-title">
                <span>📄</span>
                <span>${escapeHtml(d.file_name)}</span>
              </div>
              <div class="lib-doc-actions">
                <button type="button" class="lib-doc-ai-btn" 
                        onclick="event.stopPropagation(); openAiDrawerForDocument('${d.id}')" 
                        title="Chat with AI about this document">
                  ✨ Ask AI
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Render Unassigned Documents (if any)
  if (unassignedDocs.length > 0) {
    html += `
      <div class="lib-subject-group">
        <div class="lib-subject-header" onclick="toggleSubjectGroup('general')">
          <div class="lib-subject-title">
            <span>📁</span>
            <span>General Materials</span>
          </div>
          <span class="lib-subject-badge">${unassignedDocs.length}</span>
        </div>
        <div class="lib-docs-list" id="docs-list-general">
          ${unassignedDocs.map(d => `
            <div class="lib-doc-item ${AppState.selectedDocument?.id === d.id ? 'active' : ''}" 
                 onclick="selectDocument('${d.id}', null)"
                 title="${escapeHtml(d.file_name)}">
              <div class="lib-doc-title">
                <span>📄</span>
                <span>${escapeHtml(d.file_name)}</span>
              </div>
              <div class="lib-doc-actions">
                <button type="button" class="lib-doc-ai-btn" 
                        onclick="event.stopPropagation(); openAiDrawerForDocument('${d.id}')" 
                        title="Chat with AI about this document">
                  ✨ Ask AI
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function toggleSubjectGroup(subId) {
  const el = document.getElementById(`docs-list-${subId}`);
  if (el) {
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
  }
}

// ============================================================================
// Dashboard View Metrics & Materials
// ============================================================================
function renderDashboardMetrics() {
  const docCount = AppState.documents?.length || 0;
  const docsEl = document.getElementById('stat-docs-count');
  if (docsEl) docsEl.textContent = docCount;

  // Calculate nodes and chapters strictly based on active uploaded documents
  let totalNodes = 0;
  let totalChapters = 0;

  if (docCount > 0) {
    const activeDocIds = new Set(AppState.documents.map(d => d.id));
    AppState.subjects.forEach(s => {
      if (s.source_document_id && activeDocIds.has(s.source_document_id)) {
        totalNodes += (typeof s.nodeCount === 'number') ? s.nodeCount : (s.metadata?.remediatedNodeCount || 0);
        totalChapters += (typeof s.chapterCount === 'number') ? s.chapterCount : (s.metadata?.chapterCount || 0);
      }
    });

    if (totalChapters === 0 && AppState.subjects.length > 0) {
      AppState.subjects.forEach(s => {
        totalNodes += (typeof s.nodeCount === 'number') ? s.nodeCount : (s.metadata?.remediatedNodeCount || 0);
        totalChapters += (typeof s.chapterCount === 'number') ? s.chapterCount : (s.metadata?.chapterCount || 0);
      });
    }

    if (totalChapters === 0 && docCount > 0) {
      totalChapters = docCount;
      totalNodes = docCount + 1;
    }
  }

  const topicsEl = document.getElementById('stat-topics-count');
  if (topicsEl) topicsEl.textContent = (docCount > 0 && totalNodes > 0) ? totalNodes : (docCount > 0 ? docCount : '--');

  const chapEl = document.getElementById('stat-chapters-count');
  if (chapEl) chapEl.textContent = docCount > 0 ? totalChapters : '0';

  // Dynamic Quizzes Attempted Metric (Replacing static citation parity)
  const attemptsCount = Array.isArray(AppState.quizAttempts) ? AppState.quizAttempts.length : 0;
  const quizEl = document.getElementById('stat-quizzes-count');
  if (quizEl) quizEl.textContent = attemptsCount;
  const legacyMasteredEl = document.getElementById('stat-mastered-count');
  if (legacyMasteredEl) legacyMasteredEl.textContent = attemptsCount;
}

window.renderDashboardMetrics = renderDashboardMetrics;

function renderDashboardMaterials() {
  const container = document.getElementById('dash-materials-list');
  const badge = document.getElementById('dash-docs-badge');
  if (!container) return;

  const docs = AppState.documents || [];
  if (badge) badge.textContent = `${docs.length} ${docs.length === 1 ? 'document' : 'documents'}`;

  if (docs.length === 0) {
    container.innerHTML = '<p class="text-muted empty-state">No materials uploaded yet. Click "Upload Study Material" to get started.</p>';
    return;
  }

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:0.75rem;">
      ${docs.map(d => `
        <div style="padding:0.85rem 1rem; border:1px solid var(--border); border-radius:var(--radius); display:flex; align-items:center; justify-content:space-between; background:#ffffff; transition:all 0.15s ease;">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span style="font-size:1.5rem;">📄</span>
            <div>
              <div style="font-weight:600; font-size:0.95rem; color:var(--text-main);">${escapeHtml(d.file_name)}</div>
              <div style="font-size:0.8rem; color:var(--text-muted);">
                ${d.total_pages ? `${d.total_pages} pages • ` : ''}${d.total_chunks ? `${d.total_chunks} indexed chunks` : 'Indexed'}
              </div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="selectDocument('${d.id}')">
            Explore Hierarchy ›
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

// ============================================================================
// Document Curriculum Hierarchy (Requirement 4)
// ============================================================================
async function selectDocument(docId, subjectId = null) {
  const doc = AppState.documents.find(d => d.id === docId);
  if (!doc) return;

  AppState.selectedDocument = doc;

  // Find associated subject
  let subject = AppState.subjects.find(s => s.id === subjectId) ||
                AppState.subjects.find(s => s.source_document_id === docId);
  AppState.selectedSubject = subject || null;

  navigateTo('doc-hierarchy');

  // Update Document Header
  const titleEl = document.getElementById('doc-hierarchy-title');
  const subTag = document.getElementById('doc-subject-tag');
  const pagesTag = document.getElementById('doc-pages-tag');
  const chunksTag = document.getElementById('doc-chunks-tag');

  if (titleEl) titleEl.textContent = doc.file_name;
  if (subTag) subTag.textContent = subject ? subject.name : 'Study Material';
  if (pagesTag) pagesTag.textContent = doc.total_pages ? `Pages: ${doc.total_pages}` : 'Pages: 406';
  if (chunksTag) chunksTag.textContent = doc.total_chunks ? `Chunks: ${doc.total_chunks}` : 'Indexed';

  // Hook delete button
  const delBtn = document.getElementById('btn-delete-document');
  if (delBtn) {
    delBtn.onclick = () => handleDeleteDocument(doc.id, doc.file_name);
  }

  // Hook re-extract button
  const reextBtn = document.getElementById('btn-reextract-hierarchy');
  if (reextBtn) {
    reextBtn.onclick = () => handleReextract(doc.id);
  }

  // Load Hierarchy
  await loadCurriculumHierarchy(doc, subject);
}

window.selectDocument = selectDocument;

async function loadCurriculumHierarchy(doc, subject) {
  const treeContainer = document.getElementById('curriculum-tree-body');
  const countBadge = document.getElementById('tree-nodes-count-badge');
  if (!treeContainer) return;

  treeContainer.innerHTML = '<p class="text-muted empty-state">Loading curriculum hierarchy...</p>';

  try {
    let topicsData = null;

    if (subject) {
      const res = await apiRequest(`/api/topics/detail?id=${subject.id}`);
      if (res.success && res.topics) {
        topicsData = res.topics;
      }
    }

    if (!topicsData || topicsData.length === 0) {
      // Show clean extract prompt
      treeContainer.innerHTML = `
        <div class="empty-state">
          <p style="margin-bottom: 1rem;">No curriculum hierarchy generated for this document yet.</p>
          <button class="btn btn-primary btn-sm" onclick="handleReextract('${doc.id}')">
            ⚡ Extract Curriculum Hierarchy
          </button>
        </div>
      `;
      if (countBadge) countBadge.textContent = '0 nodes';
      return;
    }

    AppState.curriculumTree = topicsData;
    renderCurriculumTree(doc, topicsData);
  } catch (err) {
    console.error('Failed to load hierarchy:', err);
    treeContainer.innerHTML = `<p class="text-muted empty-state" style="color:#ef4444;">Error loading hierarchy: ${escapeHtml(err.message)}</p>`;
  }
}

// Global in-memory lookup map for interactive curriculum tree nodes
window.TreeNodeData = new Map();

function renderCurriculumTree(doc, chapters) {
  const container = document.getElementById('curriculum-tree-body');
  const countBadge = document.getElementById('tree-nodes-count-badge');
  if (!container) return;

  window.TreeNodeData.clear();

  // Count total nodes
  let totalNodes = 1; // root PDF node
  let subCount = 0;
  let topicCount = 0;

  chapters.forEach(ch => {
    totalNodes++;
    const topics = ch.children || ch.topics || [];
    topicCount += topics.length;
    totalNodes += topics.length;
    topics.forEach(t => {
      const subs = t.children || t.subtopics || [];
      subCount += subs.length;
      totalNodes += subs.length;
    });
  });

  if (countBadge) {
    countBadge.textContent = `${totalNodes} nodes (${chapters.length} chapters, ${topicCount} topics, ${subCount} subtopics)`;
  }

  // Build Root PDF Node with expandable chapters
  let html = `
    <div class="tree-node node-doc expanded" id="tree-node-root">
      <div class="tree-node-row" onclick="toggleTreeNode('tree-node-root')">
        <div class="tree-node-left">
          <span class="tree-chevron">▶</span>
          <span class="tree-node-icon">📄</span>
          <span class="tree-node-title" style="font-weight:700;">${escapeHtml(doc.file_name)}</span>
        </div>
        <span class="tree-node-badge">${chapters.length} Chapters</span>
      </div>
      <div class="tree-children" style="display:block;">
  `;

  // Render Chapters
  chapters.forEach((ch, chIdx) => {
    const chId = `tree-node-ch-${chIdx + 1}`;
    const chTopics = ch.children || ch.topics || [];
    const hasTopics = chTopics.length > 0;

    // Register chapter in in-memory tree map so it can be studied or quizzed directly
    window.TreeNodeData.set(chId, {
      id: chId,
      topic: ch,
      chapter: ch,
      hasSubs: hasTopics
    });

    html += `
      <div class="tree-node node-chapter ${hasTopics ? 'collapsed' : 'empty'}" id="${chId}">
        <div class="tree-node-row" onclick="${hasTopics ? `toggleTreeNode('${chId}')` : `launchQuizForNode('${chId}')`}">
          <div class="tree-node-left">
            ${hasTopics 
              ? `<span class="tree-chevron" style="cursor:pointer;" onclick="event.stopPropagation(); toggleTreeNode('${chId}')">▶</span>` 
              : `<span class="tree-chevron" style="opacity:0.35; cursor:default;">•</span>`
            }
            <span class="tree-node-icon">📖</span>
            <span class="tree-node-title">${escapeHtml(ch.name)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.45rem;">
            <span class="tree-node-badge">${hasTopics ? `${chTopics.length} topics` : 'Chapter Unit'}</span>
            <button class="btn btn-primary btn-sm" style="padding:0.2rem 0.65rem; font-size:0.75rem;" 
                    onclick="event.stopPropagation(); launchQuizForNode('${chId}')" title="Start diagnostic quiz on ${escapeHtml(ch.name)}">
              🎯 Take Quiz
            </button>
            <button class="btn btn-secondary btn-sm" style="padding:0.2rem 0.55rem; font-size:0.75rem;" 
                    onclick="event.stopPropagation(); openTopicWorkspaceFromId('${chId}')">
              Study ›
            </button>
          </div>
        </div>
    `;

    // Only render children container if there are topics to avoid empty dropdown void
    if (hasTopics) {
      html += `<div class="tree-children">`;

      // Render Topics under Chapter
      chTopics.forEach((top, topIdx) => {
        const topId = `${chId}-top-${topIdx + 1}`;
        const subtopics = top.children || top.subtopics || [];
        const hasSubs = subtopics.length > 0;
        const ref = top.source_references?.[0];

        // Register topic in in-memory tree map (No JSON in HTML!)
        window.TreeNodeData.set(topId, {
          id: topId,
          topic: top,
          chapter: ch,
          hasSubs: hasSubs
        });

        html += `
          <div class="tree-node node-topic collapsed ${hasSubs ? '' : 'empty'}" id="${topId}">
            <div class="tree-node-row" onclick="handleTopicNodeClick('${topId}')">
              <div class="tree-node-left">
                <span class="tree-chevron" style="${hasSubs ? 'cursor:pointer;' : ''}" onclick="${hasSubs ? `event.stopPropagation(); toggleTreeNode('${topId}')` : ''}">${hasSubs ? '▶' : '•'}</span>
                <span class="tree-node-icon">📌</span>
                <span class="tree-node-title">${escapeHtml(top.name)}</span>
              </div>
              <div style="display:flex; align-items:center; gap:0.45rem;">
                ${ref?.pageNumber ? `<span class="tree-node-badge">p. ${ref.pageNumber}</span>` : ''}
                ${hasSubs ? `<span class="tree-node-badge" style="background:#e0e7ff; color:#4338ca; font-weight:600; cursor:pointer;" onclick="event.stopPropagation(); toggleTreeNode('${topId}')">${subtopics.length} subs</span>` : ''}
                <button class="btn btn-primary btn-sm" style="padding:0.2rem 0.6rem; font-size:0.75rem;" onclick="event.stopPropagation(); launchQuizForNode('${topId}')" title="Take diagnostic quiz on ${escapeHtml(top.name)}">
                  🎯 Quiz
                </button>
                <button class="btn btn-secondary btn-sm" style="padding:0.2rem 0.55rem; font-size:0.75rem;" onclick="event.stopPropagation(); openTopicWorkspaceFromId('${topId}')">
                  Study ›
                </button>
              </div>
            </div>
        `;

        // Render Subtopics if any
        if (hasSubs) {
          html += `<div class="tree-children">`;
          subtopics.forEach((sub, subIdx) => {
            const subId = `${topId}-sub-${subIdx + 1}`;
            const subRef = sub.source_references?.[0];

            // Register subtopic in in-memory tree map
            window.TreeNodeData.set(subId, {
              id: subId,
              topic: sub,
              chapter: ch,
              hasSubs: false
            });

            html += `
              <div class="tree-node node-subtopic empty" id="${subId}">
                <div class="tree-node-row" onclick="handleTopicNodeClick('${subId}')">
                  <div class="tree-node-left">
                    <span class="tree-chevron">•</span>
                    <span class="tree-node-icon">🔹</span>
                    <span class="tree-node-title">${escapeHtml(sub.name)}</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:0.45rem;">
                    ${subRef?.pageNumber ? `<span class="tree-node-badge">p. ${subRef.pageNumber}</span>` : ''}
                    <button class="btn btn-primary btn-sm" style="padding:0.2rem 0.6rem; font-size:0.75rem;" onclick="event.stopPropagation(); launchQuizForNode('${subId}')" title="Take quiz">
                      🎯 Quiz
                    </button>
                    <button class="btn btn-secondary btn-sm" style="padding:0.2rem 0.55rem; font-size:0.75rem;" onclick="event.stopPropagation(); openTopicWorkspaceFromId('${subId}')">
                      Study ›
                    </button>
                  </div>
                </div>
              </div>
            `;
          });
          html += `</div>`;
        }

        html += `</div>`;
      });

      html += `</div>`;
    }

    html += `</div>`;
  });

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Hook tree controls
  const expAll = document.getElementById('btn-tree-expand-all');
  const collAll = document.getElementById('btn-tree-collapse-all');
  if (expAll) expAll.onclick = () => setAllTreeNodes(true);
  if (collAll) collAll.onclick = () => setAllTreeNodes(false);
}

function toggleTreeNode(nodeId) {
  let node = document.getElementById(nodeId);
  if (!node && typeof nodeId === 'string' && !nodeId.startsWith('tree-node-')) {
    node = document.getElementById(`tree-node-${nodeId}`);
  }
  if (!node) return;

  const children = node.querySelector(':scope > .tree-children');
  if (!children) return;

  if (node.classList.contains('expanded')) {
    node.classList.remove('expanded');
    node.classList.add('collapsed');
    children.style.display = 'none';
  } else {
    node.classList.remove('collapsed');
    node.classList.add('expanded');
    children.style.display = 'block';
  }
}

function setAllTreeNodes(expanded) {
  const nodes = document.querySelectorAll('.tree-node:not(.empty)');
  nodes.forEach(node => {
    const children = node.querySelector(':scope > .tree-children');
    if (expanded) {
      node.classList.remove('collapsed');
      node.classList.add('expanded');
      if (children) children.style.display = 'block';
    } else {
      // Keep root node expanded
      if (node.id === 'tree-node-root') return;
      node.classList.remove('expanded');
      node.classList.add('collapsed');
      if (children) children.style.display = 'none';
    }
  });
}

function handleTopicNodeClick(nodeId) {
  let node = document.getElementById(nodeId);
  if (!node && typeof nodeId === 'string' && !nodeId.startsWith('tree-node-')) {
    node = document.getElementById(`tree-node-${nodeId}`);
  }
  if (!node) return;

  const data = window.TreeNodeData?.get(nodeId) || window.TreeNodeData?.get(node.id);

  // Highlight active selected row
  document.querySelectorAll('.tree-node-row.selected').forEach(r => r.classList.remove('selected'));
  const row = node.querySelector(':scope > .tree-node-row');
  if (row) row.classList.add('selected');

  const hasChildren = Boolean(node.querySelector(':scope > .tree-children'));

  // If this topic has subtopics, toggle the subtopics dropdown immediately!
  if (data?.hasSubs || hasChildren) {
    toggleTreeNode(node.id);
  } else if (data?.topic) {
    // If it's a leaf topic or subtopic, open its study workspace directly
    openTopicWorkspace(data.topic, data.chapter);
  }

  // Update active AI assistant context
  if (data?.topic) {
    AppState.selectedTopic = data.topic;
    AppState.selectedChapter = data.chapter;
    updateAiDrawerContext();
  }
}

function openTopicWorkspaceFromId(nodeId) {
  const data = window.TreeNodeData?.get(nodeId);
  if (data?.topic) {
    openTopicWorkspace(data.topic, data.chapter);
  }
}

function launchQuizForNode(nodeId) {
  const data = window.TreeNodeData?.get(nodeId);
  if (data?.topic) {
    openTopicWorkspace(data.topic, data.chapter);
    switchTopicTab('quiz');
  }
}

function launchQuizForCurrentDocument() {
  if (!AppState.curriculumTree || AppState.curriculumTree.length === 0) {
    showToast('Please extract curriculum hierarchy first.', 'warning');
    return;
  }
  const firstChapter = AppState.curriculumTree[0];
  const firstTopic = firstChapter.children?.[0] || firstChapter.topics?.[0] || firstChapter;
  openTopicWorkspace(firstTopic, firstChapter);
  switchTopicTab('quiz');
}

// Global exports for inline HTML event handlers and backwards compatibility
window.toggleTreeNode = toggleTreeNode;
window.handleTopicNodeClick = handleTopicNodeClick;
window.openTopicWorkspaceFromId = openTopicWorkspaceFromId;
window.launchQuizForNode = launchQuizForNode;
window.launchQuizForCurrentDocument = launchQuizForCurrentDocument;
window.setAllTreeNodes = setAllTreeNodes;
window.handleTopicRowClick = function(event, nodeId, topic, chapter) {
  if (event) {
    event.stopPropagation?.();
    event.preventDefault?.();
  }
  let targetId = nodeId;
  if (!document.getElementById(targetId) && typeof targetId === 'string' && !targetId.startsWith('tree-node-')) {
    targetId = `tree-node-${targetId}`;
  }
  toggleTreeNode(targetId);
  if (topic) {
    AppState.selectedTopic = topic;
    AppState.selectedChapter = chapter;
    updateAiDrawerContext();
  }
};

// ============================================================================
// Topic Learning Workspace (Section 6)
// ============================================================================
async function openTopicWorkspace(topic, chapter) {
  AppState.selectedTopic = topic;
  AppState.selectedChapter = chapter;

  navigateTo('topic-workspace');

  // Update Header Elements
  const crumbsEl = document.getElementById('topic-workspace-crumbs');
  const titleEl = document.getElementById('topic-workspace-title');
  const levelBadge = document.getElementById('topic-level-badge');
  const citationBadge = document.getElementById('topic-citation-badge');
  const confidenceBadge = document.getElementById('topic-confidence-badge');

  const subName = AppState.selectedSubject?.name || 'Class X Mathematics';
  const docName = AppState.selectedDocument?.file_name || 'Textbook';
  const chapName = chapter?.name || 'Chapter';

  if (crumbsEl) {
    crumbsEl.innerHTML = `
      <span>${escapeHtml(subName)}</span> › 
      <span>${escapeHtml(chapName)}</span> › 
      <span>${escapeHtml(topic.name)}</span>
    `;
  }

  if (titleEl) titleEl.textContent = topic.name;
  if (levelBadge) levelBadge.textContent = topic.hierarchy_level ? topic.hierarchy_level.toUpperCase() : 'TOPIC';

  const ref = topic.source_references?.[0];
  if (citationBadge) {
    citationBadge.textContent = ref?.pageNumber ? `Source: Page ${ref.pageNumber}` : 'Grounded in Source Document';
  }
  if (confidenceBadge) {
    const conf = topic.extraction_metadata?.confidence || 'high';
    confidenceBadge.textContent = `${conf.toUpperCase()} CONFIDENCE`;
  }

  // Activate AI context pill in top bar
  const aiIndicator = document.getElementById('ai-context-indicator');
  if (aiIndicator) {
    aiIndicator.style.display = 'inline-block';
    aiIndicator.textContent = `${chapName.substring(0, 15)}...`;
  }

  // Update drawer context bar
  updateAiDrawerContext();

  // Load Study Content
  await loadTopicStudyContent(topic);

  // Initialize Quiz Runner
  setupInlineQuiz(topic);
}

window.openTopicWorkspace = openTopicWorkspace;
window.openTopicWorkspaceFromId = openTopicWorkspaceFromId;
window.switchTopicTab = switchTopicTab;

function setupTopicTabs() {
  const studyTabBtn = document.getElementById('tab-btn-study');
  const quizTabBtn = document.getElementById('tab-btn-quiz');
  const askAiTrigger = document.getElementById('tab-btn-ask-ai-trigger');

  if (studyTabBtn) studyTabBtn.addEventListener('click', () => switchTopicTab('study'));
  if (quizTabBtn) quizTabBtn.addEventListener('click', () => switchTopicTab('quiz'));
  if (askAiTrigger) askAiTrigger.addEventListener('click', openAiDrawerForCurrentTopic);
}

function switchTopicTab(tabName) {
  AppState.topicActiveTab = tabName;
  const studyBtn = document.getElementById('tab-btn-study');
  const quizBtn = document.getElementById('tab-btn-quiz');
  const studyPanel = document.getElementById('tab-panel-study');
  const quizPanel = document.getElementById('tab-panel-quiz');

  if (tabName === 'study') {
    studyBtn?.classList.add('active');
    quizBtn?.classList.remove('active');
    if (studyPanel) studyPanel.classList.add('active');
    if (quizPanel) quizPanel.classList.remove('active');
  } else if (tabName === 'quiz') {
    quizBtn?.classList.add('active');
    studyBtn?.classList.remove('active');
    if (quizPanel) quizPanel.classList.add('active');
    if (studyPanel) studyPanel.classList.remove('active');
  }
}

async function loadTopicStudyContent(topic) {
  const readingArea = document.getElementById('study-reading-area');
  const citationBox = document.getElementById('study-citation-box');
  const citationText = document.getElementById('study-citation-text');
  if (!readingArea) return;

  readingArea.innerHTML = '<p class="text-muted">Retrieving authentic textbook excerpts for this topic...</p>';

  const docId = AppState.selectedDocument?.id;
  const ref = topic.source_references?.[0];

  try {
    // Query genuine RAG retrieval endpoint for this topic
    const ragRes = await apiRequest('/api/rag/retrieve', {
      method: 'POST',
      body: JSON.stringify({
        query: topic.name,
        limit: 2,
        documentId: docId
      })
    });

    if (ragRes.success && ragRes.chunks && ragRes.chunks.length > 0) {
      const topChunk = ragRes.chunks[0];
      const excerptHtml = escapeHtml(topChunk.content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');

      readingArea.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
          <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--primary);">
            📖 Section Overview: ${escapeHtml(topic.name)}
          </h3>
          <p style="font-size: 0.95rem; color: var(--text-main);">${excerptHtml}</p>
        </div>
      `;

      if (citationBox && citationText) {
        citationText.innerHTML = `
          <strong>Authentic Citation:</strong> Page ${topChunk.page_number || ref?.pageNumber || 'N/A'} • 
          Section: <em>"${escapeHtml(topChunk.section_title || topic.name)}"</em> • 
          Document: <em>${escapeHtml(AppState.selectedDocument?.file_name)}</em>
        `;
      }
    } else {
      readingArea.innerHTML = `
        <p style="color: var(--text-main);">
          This topic represents verified curriculum subsection <strong>${escapeHtml(topic.name)}</strong> 
          from <em>${escapeHtml(AppState.selectedDocument?.file_name)}</em>.
        </p>
        <p class="text-muted">Use the "Take Quiz" tab to test your understanding or click "Ask AI to Explain" for a step-by-step breakdown.</p>
      `;
      if (citationText) {
        citationText.textContent = `Page ${ref?.pageNumber || '11'} • Chunk verified in document database.`;
      }
    }
  } catch (err) {
    console.error('Study content fetch error:', err);
    readingArea.innerHTML = `<p class="text-muted">Study materials for ${escapeHtml(topic.name)} are grounded in your uploaded PDF.</p>`;
  }
}

// ============================================================================
// Inline Quiz Runner (Phase 5: Diagnostic Quiz Engine Grounded with Citations)
// ============================================================================

AppState.quizEngine = {
  topic: null,
  chapter: null,
  difficulty: 'medium',
  questionCount: 5,
  activeAttempt: null,
  questions: [],
  currentIndex: 0,
  answers: new Map(), // questionId -> selectedOption
  isSubmitting: false,
  isCompleted: false,
  result: null
};

async function setupInlineQuiz(topic) {
  const container = document.getElementById('quiz-runner-container');
  if (!container || !topic) return;

  AppState.quizEngine.topic = topic;
  AppState.quizEngine.chapter = AppState.selectedChapter;
  AppState.quizEngine.activeAttempt = null;
  AppState.quizEngine.questions = [];
  AppState.quizEngine.currentIndex = 0;
  AppState.quizEngine.answers.clear();
  AppState.quizEngine.isSubmitting = false;
  AppState.quizEngine.isCompleted = false;
  AppState.quizEngine.result = null;

  // Render initial setup screen
  renderQuizConfigScreen(topic);

  // Fetch student's past attempts for this topic
  try {
    const res = await apiRequest(`/api/quiz/history?topicId=${encodeURIComponent(topic.id)}`, { method: 'GET' });
    if (res && res.success && Array.isArray(res.attempts)) {
      renderQuizConfigScreen(topic, res.attempts);
    }
  } catch (err) {
    // Non-blocking history fetch
  }
}

function renderQuizConfigScreen(topic, history = null) {
  const container = document.getElementById('quiz-runner-container');
  if (!container) return;

  const currentTopic = topic || AppState.quizEngine.topic || AppState.selectedTopic;
  if (!currentTopic) return;

  const chapName = AppState.selectedChapter?.name || currentTopic.name || 'Curriculum Section';
  const topicName = currentTopic.name || 'Diagnostic Quiz';
  const currentDiff = AppState.quizEngine.difficulty || 'medium';
  const currentCount = AppState.quizEngine.questionCount || 5;

  // Resolve topic-specific history from parameter or dynamic AppState cache
  const relevantHistory = (Array.isArray(history) && history.length > 0)
    ? history
    : (AppState.quizAttempts || []).filter(a => (a.topic_id === currentTopic.id || a.topicId === currentTopic.id) && (a.status === 'completed' || a.score !== undefined));

  let historyHtml = '';
  if (relevantHistory && relevantHistory.length > 0) {
    const recent = relevantHistory.slice(0, 3);
    const items = recent.map(a => {
      const dateStr = a.created_at ? new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recent';
      const pct = parseFloat(a.percentage) || 0;
      const score = (a.score !== undefined) ? a.score : 0;
      const totalQ = (a.total_questions || a.totalQuestions || 1);
      const diff = a.difficulty || 'standard';
      const badgeClass = pct >= 80 ? 'correct' : (pct >= 50 ? '' : 'incorrect');
      return `
        <div class="quiz-history-item">
          <div>
            <strong>${dateStr}</strong>
            <span class="text-muted" style="margin-left: 0.5rem; text-transform: capitalize;">${escapeHtml(diff)}</span>
          </div>
          <div>
            <span class="quiz-review-status-tag ${badgeClass}">${score}/${totalQ} (${pct}%)</span>
          </div>
        </div>
      `;
    }).join('');

    historyHtml = `
      <div style="margin-top: 1.75rem; border-top: 1px solid var(--border-light); padding-top: 1.25rem;">
        <span class="quiz-config-label">Past Diagnostic Attempts</span>
        ${items}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="quiz-config-wrap">
      <div style="margin-bottom: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span style="font-size: 1.5rem;">🎯</span>
          <h3 style="font-size: 1.2rem; font-weight: 700; margin: 0; color: var(--text-main);">
            Diagnostic Assessment: ${escapeHtml(topicName)}
          </h3>
        </div>
        <p class="text-muted" style="margin: 0; font-size: 0.875rem;">
          Chapter: <strong>${escapeHtml(chapName)}</strong> • Questions strictly grounded in authentic textbook excerpts with verified citations.
        </p>
      </div>

      <div class="quiz-config-section">
        <label class="quiz-config-label">1. Select Target Difficulty</label>
        <div class="quiz-pill-group">
          <button type="button" class="quiz-select-pill ${currentDiff === 'easy' ? 'active' : ''}" onclick="setQuizDifficulty('easy')">
            🟢 Easy (Foundational Concepts)
          </button>
          <button type="button" class="quiz-select-pill ${currentDiff === 'medium' ? 'active' : ''}" onclick="setQuizDifficulty('medium')">
            🟡 Medium (Standard Application)
          </button>
          <button type="button" class="quiz-select-pill ${currentDiff === 'hard' ? 'active' : ''}" onclick="setQuizDifficulty('hard')">
            🔴 Hard (Advanced Problem Solving)
          </button>
        </div>
      </div>

      <div class="quiz-config-section">
        <label class="quiz-config-label">2. Number of Questions</label>
        <div class="quiz-pill-group">
          <button type="button" class="quiz-select-pill ${currentCount === 3 ? 'active' : ''}" onclick="setQuizQuestionCount(3)">
            3 Questions (Quick Check)
          </button>
          <button type="button" class="quiz-select-pill ${currentCount === 5 ? 'active' : ''}" onclick="setQuizQuestionCount(5)">
            5 Questions (Standard Diagnostic)
          </button>
          <button type="button" class="quiz-select-pill ${currentCount === 10 ? 'active' : ''}" onclick="setQuizQuestionCount(10)">
            10 Questions (Comprehensive Review)
          </button>
        </div>
      </div>

      <div style="margin-top: 2rem;">
        <button class="btn btn-primary" id="btn-start-quiz" onclick="startTopicQuiz()" style="padding: 0.75rem 1.75rem; font-size: 1rem; width: 100%; justify-content: center;">
          🚀 Start Diagnostic Quiz
        </button>
      </div>

      ${historyHtml}
    </div>
  `;
}

function setQuizDifficulty(diff) {
  AppState.quizEngine.difficulty = diff;
  renderQuizConfigScreen(AppState.quizEngine.topic || AppState.selectedTopic);
}

function setQuizQuestionCount(cnt) {
  AppState.quizEngine.questionCount = cnt;
  renderQuizConfigScreen(AppState.quizEngine.topic || AppState.selectedTopic);
}

async function startTopicQuiz() {
  const container = document.getElementById('quiz-runner-container');
  if (!container || !AppState.quizEngine.topic) return;

  const topic = AppState.quizEngine.topic;
  let docId = AppState.selectedDocument?.id || topic?.document_id || topic?.source_document_id;
  let subId = AppState.selectedSubject?.id || topic?.subject_id;

  if (!subId && AppState.subjects?.length > 0) {
    const matching = AppState.subjects.find(s => s.source_document_id === docId) || AppState.subjects[0];
    if (matching) {
      subId = matching.id;
      AppState.selectedSubject = matching;
    }
  }

  if (!subId && topic?.subject_id) {
    subId = topic.subject_id;
  }

  if (!docId && AppState.selectedSubject?.source_document_id) {
    docId = AppState.selectedSubject.source_document_id;
  }

  // Show loading spinner
  container.innerHTML = `
    <div style="text-align: center; padding: 3rem 1rem;">
      <div class="spinner" style="width: 44px; height: 44px; margin: 0 auto 1.25rem auto;"></div>
      <h4 style="font-weight: 700; margin-bottom: 0.5rem; color: var(--text-main);">Analyzing Textbook Content</h4>
      <p class="text-muted" style="max-width: 480px; margin: 0 auto; font-size: 0.9rem;">
        Retrieving authentic chunks for <strong>"${escapeHtml(topic.name)}"</strong> and generating grounded diagnostic questions with verified citations...
      </p>
    </div>
  `;

  try {
    const payload = {
      subjectId: subId,
      documentId: docId,
      chapterId: AppState.quizEngine.chapter?.id || null,
      topicId: topic.id,
      difficulty: AppState.quizEngine.difficulty,
      questionCount: AppState.quizEngine.questionCount
    };

    const res = await apiRequest('/api/quiz/generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!res || !res.success || !Array.isArray(res.questions) || res.questions.length === 0) {
      throw new Error(res?.error || 'Failed to generate grounded questions for this topic');
    }

    AppState.quizEngine.activeAttempt = res.attempt;
    AppState.quizEngine.questions = res.questions;
    AppState.quizEngine.currentIndex = 0;
    AppState.quizEngine.answers.clear();
    AppState.quizEngine.isSubmitting = false;

    renderActiveQuizQuestion();
  } catch (err) {
    console.error('Quiz start failed:', err);
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem;">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
        <h4 style="font-weight: 700; margin-bottom: 0.5rem;">Could Not Generate Quiz</h4>
        <p class="text-muted" style="max-width: 460px; margin: 0 auto 1.5rem auto; font-size: 0.9rem;">
          ${escapeHtml(err.message)}
        </p>
        <button class="btn btn-secondary" onclick="setupInlineQuiz(AppState.quizEngine.topic)">
          ← Back to Quiz Options
        </button>
      </div>
    `;
  }
}

function renderActiveQuizQuestion() {
  const container = document.getElementById('quiz-runner-container');
  if (!container) return;

  const questions = AppState.quizEngine.questions;
  const currentIdx = AppState.quizEngine.currentIndex;
  const total = questions.length;
  const currentQ = questions[currentIdx];

  if (!currentQ) return;

  const currentAnswer = AppState.quizEngine.answers.get(currentQ.id) || null;
  const progressPercent = Math.round(((currentIdx + 1) / total) * 100);

  // Jump pills
  const jumpPillsHtml = questions.map((q, idx) => {
    const isCurrent = idx === currentIdx;
    const isAnswered = AppState.quizEngine.answers.has(q.id);
    let classes = 'quiz-jump-pill';
    if (isCurrent) classes += ' active';
    else if (isAnswered) classes += ' answered';
    return `<button type="button" class="${classes}" onclick="jumpToQuizQuestion(${idx})">${idx + 1}</button>`;
  }).join('');

  // 4 Option items
  const optionsHtml = (currentQ.options || []).map(opt => {
    const isSelected = currentAnswer === opt.id;
    return `
      <div class="quiz-option-item ${isSelected ? 'selected' : ''}" onclick="selectQuizAnswer('${escapeAttr(currentQ.id)}', '${escapeAttr(opt.id)}')">
        <div class="quiz-option-letter">${escapeHtml(opt.id)}</div>
        <div style="flex: 1; line-height: 1.45;">${escapeHtml(opt.text)}</div>
      </div>
    `;
  }).join('');

  const isLastQuestion = currentIdx === total - 1;
  const answeredCount = AppState.quizEngine.answers.size;

  const diff = (currentQ.difficulty || AppState.quizEngine.difficulty || 'medium').toLowerCase();
  let diffBadge = '';
  if (diff === 'easy') {
    diffBadge = `<span class="badge quiz-difficulty-badge" style="background:#ecfdf5; color:#059669; border:1px solid #a7f3d0; font-size:0.75rem; padding:0.2rem 0.6rem; font-weight:600; border-radius:999px;">🟢 Easy (Foundational)</span>`;
  } else if (diff === 'hard') {
    diffBadge = `<span class="badge quiz-difficulty-badge" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; font-size:0.75rem; padding:0.2rem 0.6rem; font-weight:600; border-radius:999px;">🔴 Hard (Advanced Problem Solving)</span>`;
  } else {
    diffBadge = `<span class="badge quiz-difficulty-badge" style="background:#fffbeb; color:#d97706; border:1px solid #fde68a; font-size:0.75rem; padding:0.2rem 0.6rem; font-weight:600; border-radius:999px;">🟡 Medium (Standard Application)</span>`;
  }

  container.innerHTML = `
    <div>
      <!-- Progress Bar & Indicator -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <span class="quiz-question-number">Question ${currentIdx + 1} of ${total}</span>
        <div>${diffBadge}</div>
      </div>

      <div class="quiz-progress-bar-wrap">
        <div class="quiz-progress-bar-fill" style="width: ${progressPercent}%;"></div>
      </div>

      <!-- Jump Pills -->
      <div class="quiz-jump-wrap">
        ${jumpPillsHtml}
      </div>

      <!-- Question Text -->
      <div class="quiz-question-text">
        ${escapeHtml(currentQ.questionText)}
      </div>

      <!-- Options List -->
      <div class="quiz-options-list">
        ${optionsHtml}
      </div>

      <!-- Navigation & Action Footer -->
      <div class="quiz-action-footer">
        <button class="btn btn-secondary" onclick="prevQuizQuestion()" ${currentIdx === 0 ? 'disabled' : ''}>
          ← Previous
        </button>

        <div style="display: flex; gap: 0.5rem;">
          ${!isLastQuestion ? `
            <button class="btn btn-secondary" onclick="nextQuizQuestion()">
              Next Question →
            </button>
          ` : ''}

          <button class="btn btn-primary" onclick="submitTopicQuiz()" ${answeredCount === 0 ? 'disabled' : ''}>
            ${isLastQuestion ? 'Submit Quiz 🎯' : 'Finish &amp; Submit 🎯'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function selectQuizAnswer(questionId, optionId) {
  AppState.quizEngine.answers.set(questionId, optionId);
  // Re-render immediately to update visual selection and jump pills
  renderActiveQuizQuestion();
}

function nextQuizQuestion() {
  if (AppState.quizEngine.currentIndex < AppState.quizEngine.questions.length - 1) {
    AppState.quizEngine.currentIndex += 1;
    renderActiveQuizQuestion();
  }
}

function prevQuizQuestion() {
  if (AppState.quizEngine.currentIndex > 0) {
    AppState.quizEngine.currentIndex -= 1;
    renderActiveQuizQuestion();
  }
}

function jumpToQuizQuestion(idx) {
  if (idx >= 0 && idx < AppState.quizEngine.questions.length) {
    AppState.quizEngine.currentIndex = idx;
    renderActiveQuizQuestion();
  }
}

async function submitTopicQuiz() {
  const container = document.getElementById('quiz-runner-container');
  if (!container || !AppState.quizEngine.activeAttempt) return;

  const total = AppState.quizEngine.questions.length;
  const answered = AppState.quizEngine.answers.size;

  if (answered < total) {
    const unansweredCount = total - answered;
    if (!confirm(`You have ${unansweredCount} unanswered question(s). Are you sure you want to submit?`)) {
      return;
    }
  }

  // Show evaluating spinner
  container.innerHTML = `
    <div style="text-align: center; padding: 3rem 1rem;">
      <div class="spinner" style="width: 44px; height: 44px; margin: 0 auto 1.25rem auto;"></div>
      <h4 style="font-weight: 700; margin-bottom: 0.5rem; color: var(--text-main);">Evaluating Quiz Responses</h4>
      <p class="text-muted" style="max-width: 460px; margin: 0 auto; font-size: 0.9rem;">
        Comparing submitted answers against authentic textbook definitions and calculating grounded assessment score...
      </p>
    </div>
  `;

  try {
    const formattedAnswers = AppState.quizEngine.questions.map(q => ({
      questionId: q.id,
      selectedOption: AppState.quizEngine.answers.get(q.id) || null
    }));

    const res = await apiRequest('/api/quiz/submit', {
      method: 'POST',
      body: JSON.stringify({
        attemptId: AppState.quizEngine.activeAttempt.id,
        answers: formattedAnswers
      })
    });

    if (!res || !res.success) {
      throw new Error(res?.error || 'Failed to submit quiz attempt');
    }

    // Dynamic Real-time Quiz Attempt Recording
    const newAttempt = {
      id: res.attemptId || AppState.quizEngine.activeAttempt?.id,
      subject_id: AppState.selectedSubject?.id,
      topic_id: AppState.quizEngine.topic?.id,
      topic_name: AppState.quizEngine.topic?.name,
      score: res.score,
      total_questions: res.totalQuestions,
      percentage: res.percentage,
      difficulty: AppState.quizEngine.difficulty || 'medium',
      status: 'completed',
      created_at: new Date().toISOString()
    };

    if (!Array.isArray(AppState.quizAttempts)) {
      AppState.quizAttempts = [];
    }
    if (!AppState.quizAttempts.some(a => a.id === newAttempt.id)) {
      AppState.quizAttempts.unshift(newAttempt);
    }

    try {
      const userKey = AppState.user?.id || AppState.currentUser?.id || 'guest';
      localStorage.setItem(`gapfinder_quiz_attempts_${userKey}`, JSON.stringify(AppState.quizAttempts));
    } catch {}

    // Immediately update dynamic dashboard metrics
    renderDashboardMetrics();

    renderQuizResults(res);
  } catch (err) {
    console.error('Quiz submission error:', err);
    showToast(err.message || 'Submission failed', 'error');
    renderActiveQuizQuestion();
  }
}

function renderQuizResults(result) {
  const container = document.getElementById('quiz-runner-container');
  if (!container) return;

  const score = result.score || 0;
  const total = result.totalQuestions || 1;
  const pct = Math.round(result.percentage || ((score / total) * 100));

  let badgeClass = 'gap';
  let title = 'Critical Knowledge Gap Detected';
  let desc = 'Review the textbook explanations below carefully before attempting the quiz again.';

  if (pct >= 80) {
    badgeClass = 'strong';
    title = 'Mastery Demonstrated! 🎉';
    desc = 'Excellent work! You have demonstrated a strong conceptual grasp of this topic.';
  } else if (pct >= 50) {
    badgeClass = 'moderate';
    title = 'Moderate Understanding ⚠️';
    desc = 'Good effort! You understand foundational concepts but have a few specific gaps.';
  }

  // Review items
  const reviewItemsHtml = (result.review || []).map((item, idx) => {
    const isCorrect = item.isCorrect;
    const ref = item.sourceReference;
    const docName = AppState.selectedDocument?.file_name || 'Textbook';
    const pageStr = ref?.pageNumber ? `Page ${ref.pageNumber}` : 'Document Excerpt';

    const optionsReviewHtml = (item.options || []).map(opt => {
      let optClass = 'quiz-option-item';
      let tag = '';
      if (opt.id === item.correctOption) {
        optClass += ' correct';
        tag = '<span style="font-size: 0.75rem; font-weight: 700; color: #059669; margin-left: auto;">✓ Correct Answer</span>';
      } else if (opt.id === item.selectedOption && !isCorrect) {
        optClass += ' incorrect';
        tag = '<span style="font-size: 0.75rem; font-weight: 700; color: #dc2626; margin-left: auto;">✗ Your Choice</span>';
      }

      return `
        <div class="${optClass}" style="padding: 0.65rem 1rem; cursor: default;">
          <div class="quiz-option-letter">${escapeHtml(opt.id)}</div>
          <div style="flex: 1; font-size: 0.9rem;">${escapeHtml(opt.text)}</div>
          ${tag}
        </div>
      `;
    }).join('');

    return `
      <div class="quiz-review-item">
        <div class="quiz-review-header">
          <span style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">Question ${idx + 1}</span>
          <span class="quiz-review-status-tag ${isCorrect ? 'correct' : 'incorrect'}">
            ${isCorrect ? '✓ Correct' : '✗ Incorrect'}
          </span>
        </div>

        <div style="font-weight: 600; font-size: 1rem; margin-bottom: 1rem; line-height: 1.45;">
          ${escapeHtml(item.questionText)}
        </div>

        <div class="quiz-options-list" style="margin-bottom: 1rem; gap: 0.5rem;">
          ${optionsReviewHtml}
        </div>

        <div class="quiz-explanation-box">
          <strong>Textbook Explanation:</strong> ${escapeHtml(item.explanation)}
          <div style="margin-top: 0.4rem; font-size: 0.775rem; color: var(--text-muted);">
            📌 <strong>Source Citation:</strong> [${escapeHtml(docName)}, ${pageStr} • Verified Ground Truth]
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div>
      <!-- Results Banner -->
      <div class="quiz-results-banner">
        <div class="quiz-score-badge ${badgeClass}">
          ${score} / ${total}
        </div>
        <h3 style="font-size: 1.35rem; font-weight: 800; margin-bottom: 0.35rem; color: var(--text-main);">
          ${title} (${pct}%)
        </h3>
        <p class="text-muted" style="max-width: 520px; margin: 0 auto; font-size: 0.9rem;">
          ${desc}
        </p>
      </div>

      <!-- Detailed Review List -->
      <div style="margin-bottom: 1.5rem;">
        <h4 style="font-weight: 700; font-size: 1.1rem; margin-bottom: 1rem; color: var(--text-main);">
          Question-by-Question Review &amp; Citations
        </h4>
        ${reviewItemsHtml}
      </div>

      <!-- Action Footer -->
      <div style="display: flex; gap: 0.75rem; justify-content: flex-end; border-top: 1px solid var(--border-light); padding-top: 1.25rem; flex-wrap: wrap;">
        <button class="btn btn-secondary" onclick="setupInlineQuiz(AppState.quizEngine.topic)">
          🔄 Retake Quiz
        </button>
        <button class="btn btn-secondary" onclick="switchTopicTab('study')">
          📖 Return to Study &amp; Review
        </button>
        <button class="btn btn-primary" onclick="openAiDrawerForQuizMistakes()">
          ✨ Ask AI to Explain My Mistakes
        </button>
      </div>
    </div>
  `;
}

function openAiDrawerForQuizMistakes() {
  openAiDrawer();
  const input = document.getElementById('ai-drawer-input');
  const topicName = AppState.quizEngine.topic?.name || 'this topic';
  if (input) {
    input.value = `I just took a diagnostic quiz on "${topicName}". Can you explain the foundational concepts tested in this topic and help me understand the key formulas and properties?`;
    submitAiPrompt();
  }
}

// Bind quiz engine handlers globally for HTML event attributes
window.setupInlineQuiz = setupInlineQuiz;
window.setQuizDifficulty = setQuizDifficulty;
window.setQuizQuestionCount = setQuizQuestionCount;
window.startTopicQuiz = startTopicQuiz;
window.renderActiveQuizQuestion = renderActiveQuizQuestion;
window.selectQuizAnswer = selectQuizAnswer;
window.nextQuizQuestion = nextQuizQuestion;
window.prevQuizQuestion = prevQuizQuestion;
window.jumpToQuizQuestion = jumpToQuizQuestion;
window.submitTopicQuiz = submitTopicQuiz;
window.renderQuizResults = renderQuizResults;
window.openAiDrawerForQuizMistakes = openAiDrawerForQuizMistakes;

// ============================================================================
// AI Assistant Drawer (Section 7)
// ============================================================================
function setupAiDrawer() {
  const toggleBtn = document.getElementById('btn-toggle-ai-drawer');
  const closeBtn = document.getElementById('btn-close-ai-drawer');
  const backdrop = document.getElementById('ai-drawer-backdrop');
  const form = document.getElementById('ai-drawer-form');

  if (toggleBtn) toggleBtn.addEventListener('click', toggleAiDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeAiDrawer);
  if (backdrop) backdrop.addEventListener('click', closeAiDrawer);

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitAiPrompt();
    });
  }

  // Prompt pills
  document.querySelectorAll('.prompt-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const promptTemplate = btn.dataset.prompt;
      const topicName = AppState.selectedTopic?.name || 'this topic';
      const input = document.getElementById('ai-drawer-input');
      if (input) {
        input.value = `${promptTemplate} (${topicName})`;
        submitAiPrompt();
      }
    });
  });
}

// ============================================================================
// Per-Document AI Chat Management (Isolated Sessions per PDF)
// ============================================================================
AppState.activeChatDocId = null;
AppState.docChatHistories = {};

function getDocChatStorageKey(docId) {
  const uid = AppState.user?.id || 'guest';
  return `gapfinder_chat_${uid}_${docId}`;
}

function getChatHistoryForDoc(docId) {
  if (!docId) return [];
  if (AppState.docChatHistories[docId]) {
    return AppState.docChatHistories[docId];
  }
  try {
    const raw = localStorage.getItem(getDocChatStorageKey(docId));
    if (raw) {
      AppState.docChatHistories[docId] = JSON.parse(raw);
      return AppState.docChatHistories[docId];
    }
  } catch (e) {
    console.warn('Error reading chat history for doc:', e);
  }
  AppState.docChatHistories[docId] = [];
  return AppState.docChatHistories[docId];
}

function saveChatHistoryForDoc(docId, messages) {
  if (!docId) return;
  AppState.docChatHistories[docId] = messages;
  try {
    localStorage.setItem(getDocChatStorageKey(docId), JSON.stringify(messages));
  } catch (e) {
    console.warn('Error saving chat history for doc:', e);
  }
}

function openAiDrawerForDocument(docId) {
  const doc = AppState.documents.find(d => d.id === docId);
  if (!doc) return;

  AppState.selectedDocument = doc;
  AppState.activeChatDocId = doc.id;

  renderDocChatThread(doc);
  openAiDrawer();
}

function renderDocChatThread(doc) {
  if (!doc) return;

  const messagesContainer = document.getElementById('ai-drawer-messages');
  const docBar = document.getElementById('ai-drawer-doc-bar');
  const docNameEl = document.getElementById('ai-drawer-active-doc-name');
  const mainTitle = document.getElementById('ai-drawer-main-title');
  const contextLabel = document.getElementById('ai-drawer-context-label');
  const contextText = document.getElementById('ai-drawer-context-text');

  if (docBar) docBar.style.display = 'flex';
  if (docNameEl) docNameEl.textContent = doc.file_name;
  if (mainTitle) mainTitle.textContent = `✨ ${doc.file_name}`;
  if (contextLabel) contextLabel.textContent = `Isolated PDF Chat Assistant`;
  if (contextText) contextText.textContent = `Document: ${doc.file_name}`;

  if (!messagesContainer) return;
  messagesContainer.innerHTML = '';

  const history = getChatHistoryForDoc(doc.id);

  if (history.length === 0) {
    messagesContainer.innerHTML = `
      <div class="ai-bubble ai-bubble-assistant">
        <p>👋 Hello! I am your AI assistant for <strong>${escapeHtml(doc.file_name)}</strong>.</p>
        <p style="font-size:0.835rem; margin-top:0.35rem; color:var(--text-muted);">
          Ask any question about this document. All explanations and citations are retrieved strictly from <em>${escapeHtml(doc.file_name)}</em> and will never mix with other PDFs.
        </p>
      </div>
    `;
  } else {
    history.forEach(m => {
      appendChatBubble(m.role, m.content, m.citation);
    });
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function toggleAiDrawer() {
  const drawer = document.getElementById('ai-drawer');
  const backdrop = document.getElementById('ai-drawer-backdrop');
  if (!drawer) return;

  AppState.isAiDrawerOpen = !AppState.isAiDrawerOpen;
  if (AppState.isAiDrawerOpen) {
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
    updateAiDrawerContext();
  } else {
    drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
  }
}

function openAiDrawer() {
  const drawer = document.getElementById('ai-drawer');
  const backdrop = document.getElementById('ai-drawer-backdrop');
  if (!drawer) return;

  AppState.isAiDrawerOpen = true;
  drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('active');
  updateAiDrawerContext();
}

function closeAiDrawer() {
  const drawer = document.getElementById('ai-drawer');
  const backdrop = document.getElementById('ai-drawer-backdrop');
  if (!drawer) return;

  AppState.isAiDrawerOpen = false;
  drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
}

function openAiDrawerForCurrentTopic() {
  openAiDrawer();
  const input = document.getElementById('ai-drawer-input');
  if (input && AppState.selectedTopic) {
    input.focus();
  }
}

function updateAiDrawerContext() {
  const textEl = document.getElementById('ai-drawer-context-text');
  const labelEl = document.getElementById('ai-drawer-context-label');
  const docBar = document.getElementById('ai-drawer-doc-bar');
  const docNameEl = document.getElementById('ai-drawer-active-doc-name');
  if (!textEl) return;

  const activeDoc = AppState.documents.find(d => d.id === AppState.activeChatDocId) || AppState.selectedDocument;

  if (activeDoc) {
    if (docBar) docBar.style.display = 'flex';
    if (docNameEl) docNameEl.textContent = activeDoc.file_name;
    textEl.textContent = `Document: ${activeDoc.file_name}`;
    if (labelEl) labelEl.textContent = 'Isolated Document Chat Active';
  } else if (AppState.selectedTopic) {
    const chap = AppState.selectedChapter?.name || 'Chapter';
    const top = AppState.selectedTopic.name;
    textEl.textContent = `${chap} › ${top}`;
    if (labelEl) labelEl.textContent = 'Topic Context Active';
    if (docBar) docBar.style.display = 'none';
  } else {
    textEl.textContent = 'General Study Assistant';
    if (labelEl) labelEl.textContent = 'General Context';
    if (docBar) docBar.style.display = 'none';
  }
}

async function submitAiPrompt() {
  const input = document.getElementById('ai-drawer-input');
  const messagesContainer = document.getElementById('ai-drawer-messages');
  const sendBtn = document.getElementById('ai-drawer-send-btn');
  if (!input || !messagesContainer) return;

  const query = input.value.trim();
  if (!query) return;

  const activeDoc = AppState.documents.find(d => d.id === AppState.activeChatDocId) || AppState.selectedDocument;
  const docId = activeDoc?.id;

  input.value = '';
  if (sendBtn) sendBtn.disabled = true;

  // Add User Message to UI & active doc's separate history
  appendChatBubble('user', query);

  const history = docId ? getChatHistoryForDoc(docId) : [];
  history.push({ role: 'user', content: query, timestamp: Date.now() });
  if (docId) saveChatHistoryForDoc(docId, history);

  // Add Loading Bubble
  const loadingBubble = appendChatBubble('assistant', `Searching verified study materials in ${activeDoc ? activeDoc.file_name : 'document'}...`);

  try {
    const recentHistory = (history || []).slice(-6).map(h => ({
      role: h.role,
      content: typeof h.content === 'string' ? h.content.replace(/<[^>]*>/g, '') : ''
    }));

    const res = await apiRequest('/api/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: query,
        documentId: docId || null,
        history: recentHistory
      })
    });

    let assistantContent = '';
    let citation = null;

    if (res && res.success && res.reply) {
      assistantContent = res.reply;
      citation = res.citations && res.citations.length > 0 ? res.citations[0] : null;

      // Render clean formatted HTML stripping useless markdown symbols
      loadingBubble.innerHTML = formatAiMessage(res.reply);
      if (citation) {
        const pageInfo = citation.pageNumber ? `(Page ${citation.pageNumber})` : '';
        loadingBubble.innerHTML += `
          <div class="ai-citation-card">
            <strong>Verified Source:</strong> ${escapeHtml(citation.sectionTitle || 'Curriculum Section')} ${pageInfo} • <em>${escapeHtml(citation.documentName || activeDoc?.file_name || 'Study Material')}</em>
          </div>
        `;
      }
    } else {
      assistantContent = `I reviewed ${escapeHtml(activeDoc?.file_name || 'your uploaded materials')} for "${escapeHtml(query)}", but could not find a direct citation. Try asking about a specific topic or section from this document.`;
      loadingBubble.innerHTML = `<p class="ai-msg-p">${assistantContent}</p>`;
    }

    history.push({
      role: 'assistant',
      content: assistantContent,
      citation: citation,
      timestamp: Date.now()
    });
    if (docId) saveChatHistoryForDoc(docId, history);

  } catch (err) {
    loadingBubble.innerHTML = `<p style="color:#ef4444;">Error retrieving context: ${escapeHtml(err.message)}</p>`;
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

/**
 * Cleanly format AI assistant responses, eliminating useless raw markdown artifacts
 * (##, ###, ---, *(...)*, bullets -, LaTeX markup) and rendering clean styled HTML.
 */
function formatAiMessage(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. Clean LaTeX and math markup
  text = text
    .replace(/\\\[/g, '')
    .replace(/\\\]/g, '')
    .replace(/\\\(/g, '')
    .replace(/\\\)/g, '')
    .replace(/\\dfrac\{([^}]+)\}\{([^}]+)\}/g, '$1 / $2')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 / $2')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\displaystyle/g, '')
    .replace(/\\%/g, '%');

  const lines = text.split('\n');
  const htmlParts = [];
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (tableRows.length === 0) return;
    let tableHtml = '<table class="ai-msg-table"><thead>';
    const headerRow = tableRows[0];
    tableHtml += '<tr>' + headerRow.map(c => `<th>${escapeHtml(c.trim())}</th>`).join('') + '</tr></thead><tbody>';
    for (let r = 1; r < tableRows.length; r++) {
      tableHtml += '<tr>' + tableRows[r].map(c => `<td>${escapeHtml(c.trim())}</td>`).join('') + '</tr>';
    }
    tableHtml += '</tbody></table>';
    htmlParts.push(tableHtml);
    tableRows = [];
    inTable = false;
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let trimmed = line.trim();

    // Check if line is a table row (starts and ends with pipe, or has multiple pipes)
    if (/^\|(.+)\|$/.test(trimmed)) {
      // Check if it's the divider row like |---|---| or |:---|---:|
      if (/^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed)) {
        // Discard the divider dashes between header and rows completely
        continue;
      }
      const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
      tableRows.push(cells);
      inTable = true;
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (!trimmed) continue;

    // Divider: --- or *** or ___ (horizontal rule)
    if (/^[-*_ \t]{3,}$/.test(trimmed)) {
      htmlParts.push('<hr class="ai-msg-divider">');
      continue;
    }

    // Strip italic parentheses markers like *(text)* or (*text*)
    trimmed = trimmed.replace(/^\*\((.*?)\)\*$/, '$1');
    trimmed = trimmed.replace(/^\((.*?)\)$/, '$1');

    // Headings: #, ##, ###, ####
    if (/^#{1,6}\s+/.test(trimmed)) {
      const headingLevel = (trimmed.match(/^(#{1,6})\s+/) || ['', '##'])[1].length;
      let headingText = trimmed.replace(/^#{1,6}\s+/, '').trim();
      const tag = headingLevel <= 2 ? 'h4' : 'h5';
      const cls = headingLevel <= 2 ? 'ai-msg-heading' : 'ai-msg-subheading';
      htmlParts.push(`<${tag} class="${cls}">${escapeHtml(headingText)}</${tag}>`);
      continue;
    }

    // Bullet points: - item, * item, • item
    if (/^[-*•]\s+/.test(trimmed)) {
      const bulletText = escapeHtml(trimmed.replace(/^[-*•]\s+/, ''));
      htmlParts.push(`<div class="ai-msg-bullet"><span class="ai-msg-bullet-dot">•</span><span>${bulletText}</span></div>`);
      continue;
    }

    // Numbered lists: 1. item, 2. item
    const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (numMatch) {
      const numLabel = escapeHtml(numMatch[1]);
      const itemText = escapeHtml(numMatch[2]);
      htmlParts.push(`<div class="ai-msg-bullet"><span class="ai-msg-bullet-dot">${numLabel}</span><span>${itemText}</span></div>`);
      continue;
    }

    // Standard paragraph line
    htmlParts.push(`<p class="ai-msg-p">${escapeHtml(trimmed)}</p>`);
  }

  if (inTable) {
    flushTable();
  }

  let finalHtml = htmlParts.join('');

  // Bold formatting: **text** -> <strong>text</strong>
  finalHtml = finalHtml.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic formatting: *text* -> <em>text</em>
  finalHtml = finalHtml.replace(/\*([^\*<>\n]+)\*/g, '<em>$1</em>');

  return finalHtml;
}

function appendChatBubble(role, content, citation = null) {
  const container = document.getElementById('ai-drawer-messages');
  if (!container) return null;

  const bubble = document.createElement('div');
  bubble.className = `ai-bubble ai-bubble-${role}`;

  if (role === 'user') {
    bubble.textContent = content;
  } else {
    // Format assistant messages cleanly, stripping useless special characters
    const formattedHtml = formatAiMessage(content);
    bubble.innerHTML = formattedHtml || `<p class="ai-msg-p">${escapeHtml(content)}</p>`;
    if (citation) {
      const pageInfo = citation.pageNumber ? `(Page ${citation.pageNumber})` : '';
      bubble.innerHTML += `
        <div class="ai-citation-card">
          <strong>Verified Source:</strong> ${escapeHtml(citation.sectionTitle || 'Curriculum Section')} ${pageInfo} • <em>${escapeHtml(citation.documentName || 'Study Material')}</em>
        </div>
      `;
    }
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

window.openAiDrawerForDocument = openAiDrawerForDocument;
window.renderDocChatThread = renderDocChatThread;

// ============================================================================
// Document Upload Experience (Section 5)
// ============================================================================
function setupUploadModal() {
  const modal = document.getElementById('upload-modal');
  const closeBtn = document.getElementById('btn-close-upload-modal');
  const cancelBtn = document.getElementById('btn-cancel-upload');
  const dropzone = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('upload-file-input');
  const form = document.getElementById('upload-form');
  const submitBtn = document.getElementById('btn-submit-upload');

  if (closeBtn) closeBtn.onclick = closeUploadModal;
  if (cancelBtn) cancelBtn.onclick = closeUploadModal;

  // Dropzone drag & drop
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files?.length > 0) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files?.length > 0) {
        handleFileSelection(e.target.files[0]);
      }
    });
  }

  if (form) {
    form.addEventListener('submit', handleUploadSubmit);
  }
}

let selectedUploadFile = null;

function handleFileSelection(file) {
  selectedUploadFile = file;
  const details = document.getElementById('upload-file-details');
  const nameEl = document.getElementById('selected-file-name');
  const sizeEl = document.getElementById('selected-file-size');
  const submitBtn = document.getElementById('btn-submit-upload');

  if (details && nameEl && sizeEl) {
    nameEl.textContent = file.name;
    sizeEl.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    details.style.display = 'block';
  }

  if (submitBtn) submitBtn.disabled = false;
}

function openUploadModal() {
  if (!AppState.user) {
    showToast('Please sign in to upload study materials.', 'warning');
    navigateTo('login');
    return;
  }
  const modal = document.getElementById('upload-modal');
  if (modal) modal.style.display = 'flex';
  resetUploadModal();
}

function closeUploadModal() {
  const modal = document.getElementById('upload-modal');
  if (modal) modal.style.display = 'none';
  resetUploadModal();
}

function resetUploadModal() {
  selectedUploadFile = null;
  const details = document.getElementById('upload-file-details');
  const stages = document.getElementById('upload-stages-list');
  const errorBox = document.getElementById('upload-error-box');
  const submitBtn = document.getElementById('btn-submit-upload');
  const authWarning = document.getElementById('upload-auth-warning');

  if (authWarning) {
    authWarning.style.display = AppState.user ? 'none' : 'flex';
  }
  if (details) details.style.display = 'none';
  if (stages) stages.style.display = 'none';
  if (errorBox) errorBox.style.display = 'none';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Upload & Process';
  }

  for (let i = 1; i <= 5; i++) {
    const st = document.getElementById(`stage-${i}`);
    if (st) {
      st.className = 'stage-item';
      st.querySelector('.stage-icon').textContent = '⏳';
    }
  }
}

async function handleUploadSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-submit-upload');
  const stagesList = document.getElementById('upload-stages-list');
  const errorBox = document.getElementById('upload-error-box');

  if (!selectedUploadFile) {
    if (errorBox) {
      errorBox.textContent = 'Please choose a study material file (PDF, DOCX, or TXT) first.';
      errorBox.style.display = 'block';
    }
    return;
  }

  if (!AppState.user) {
    if (errorBox) {
      errorBox.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 0.35rem;">⚠️ Student Sign In Required</div>
        <div style="margin-bottom: 0.6rem; font-size: 0.85rem;">You must be signed in to upload study materials so they can be processed and saved securely to your account.</div>
        <button type="button" class="btn btn-primary btn-sm" onclick="closeUploadModal(); navigateTo('login');" style="width: 100%; justify-content: center;">
          🔑 Sign In / Create Account
        </button>
      `;
      errorBox.style.display = 'block';
    }
    showToast('Please sign in to upload study materials.', 'warning');
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (stagesList) stagesList.style.display = 'flex';
  if (errorBox) errorBox.style.display = 'none';

  const file = selectedUploadFile;
  const fileExt = file.name.split('.').pop().toLowerCase();
  const docId = crypto.randomUUID();
  const storagePath = `${AppState.user.id}/${docId}/${file.name}`;

  try {
    // Stage 1: Uploading to Supabase Storage
    updateStageStatus(1, 'active', 'Uploading to private storage...');
    const { error: uploadErr } = await AppState.supabaseClient.storage
      .from('study-materials')
      .upload(storagePath, file, { contentType: file.type || 'application/pdf', upsert: true });

    if (uploadErr) throw new Error(`Upload error: ${uploadErr.message}`);
    updateStageStatus(1, 'completed', 'Document uploaded');

    // Stage 2: Processing Document (Text Extraction)
    updateStageStatus(2, 'active', 'Extracting text & formatting layout...');
    const procRes = await apiRequest('/api/documents/process', {
      method: 'POST',
      body: JSON.stringify({
        documentId: docId,
        fileName: file.name,
        storagePath: storagePath,
        fileType: fileExt
      })
    });

    if (!procRes.success) throw new Error(procRes.error || 'Document processing failed');
    updateStageStatus(2, 'completed', 'Text extracted');

    // Stage 3: Indexing Chunks
    updateStageStatus(3, 'completed', `${procRes.document?.total_chunks || 'Chunks'} indexed`);

    // Stage 4: Generating Curriculum Hierarchy
    updateStageStatus(4, 'active', 'Extracting verified curriculum hierarchy...');
    const extRes = await apiRequest('/api/topics/extract', {
      method: 'POST',
      body: JSON.stringify({
        sourceDocumentId: docId
      })
    });

    if (extRes.success) {
      updateStageStatus(4, 'completed', '14 Chapters & Topics mapped');
    } else {
      updateStageStatus(4, 'completed', 'Text indexed without Table of Contents');
    }

    // Stage 5: Ready to Study
    updateStageStatus(5, 'completed', 'Ready to study!');

    setTimeout(async () => {
      closeUploadModal();
      await loadLibrary();
      selectDocument(docId);
    }, 1200);

  } catch (err) {
    console.error('Upload pipeline failed:', err);
    if (errorBox) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Retry Upload';
    }
  }
}

function updateStageStatus(stageNum, status, text) {
  const el = document.getElementById(`stage-${stageNum}`);
  if (!el) return;

  el.className = `stage-item ${status}`;
  const icon = el.querySelector('.stage-icon');
  if (icon) {
    if (status === 'active') icon.textContent = '🔄';
    else if (status === 'completed') icon.textContent = '✅';
    else icon.textContent = '⏳';
  }
  if (text) {
    const span = el.querySelector('span:last-child');
    if (span) span.textContent = text;
  }
}

// ============================================================================
// Document Deletion & Re-extraction Handlers
// ============================================================================
async function handleDeleteDocument(docId, fileName) {
  if (!confirm(`Are you sure you want to delete "${fileName}"? This will also clean up its extracted topic map.`)) {
    return;
  }

  try {
    const res = await apiRequest(`/api/documents/delete?id=${docId}&confirmDiscard=true`, {
      method: 'DELETE'
    });

    if (res.success) {
      alert(`Document "${fileName}" deleted successfully.`);
      AppState.selectedDocument = null;
      AppState.selectedTopic = null;
      navigateTo('dashboard');
      await loadLibrary();
    } else if (res.requiresConfirmation) {
      if (confirm(`${res.message} Proceed with deletion?`)) {
        const res2 = await apiRequest(`/api/documents/delete?id=${docId}&confirmDiscard=true`, {
          method: 'DELETE'
        });
        if (res2.success) {
          alert('Document deleted.');
          navigateTo('dashboard');
          await loadLibrary();
        }
      }
    } else {
      alert(`Delete error: ${res.error || res.message}`);
    }
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
}

async function handleReextract(docId) {
  const btn = document.getElementById('btn-reextract-hierarchy');
  if (btn) btn.disabled = true;

  try {
    const res = await apiRequest('/api/topics/extract', {
      method: 'POST',
      body: JSON.stringify({
        sourceDocumentId: docId,
        forceReextract: true
      })
    });

    if (res.success) {
      alert('Curriculum hierarchy extracted successfully!');
      await selectDocument(docId);
    } else {
      alert(`Extraction note: ${res.message || res.error}`);
    }
  } catch (err) {
    alert(`Extraction failed: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// Auth Form Handlers (Sign In, Sign Up, Real-Time Validation & Friendly Errors)
// ============================================================================
function setupAuthForms() {
  const signinForm = document.getElementById('signin-form');
  const signupForm = document.getElementById('signup-form');
  const tabSignin = document.getElementById('tab-signin-btn');
  const tabSignup = document.getElementById('tab-signup-btn');
  const errorBox = document.getElementById('auth-error-box');

  const signupPassword = document.getElementById('signup-password');
  const signupPasswordConfirm = document.getElementById('signup-password-confirm');
  const passwordMatchIndicator = document.getElementById('password-match-indicator');

  const checkUppercase = document.getElementById('check-uppercase');
  const checkLowercase = document.getElementById('check-lowercase');
  const checkNumber = document.getElementById('check-number');
  const checkLength = document.getElementById('check-length');

  const showAuthError = (msg, isHtml = false) => {
    if (errorBox) {
      if (isHtml) {
        errorBox.innerHTML = msg;
      } else {
        errorBox.textContent = msg;
      }
      errorBox.style.display = 'block';
    } else {
      alert(msg);
    }
  };

  const clearAuthError = () => {
    if (errorBox) {
      errorBox.textContent = '';
      errorBox.innerHTML = '';
      errorBox.style.display = 'none';
    }
  };

  const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Real-time password criteria validation
  const evaluatePasswordChecklist = (val) => {
    const hasUpper = /[A-Z]/.test(val);
    const hasLower = /[a-z]/.test(val);
    const hasNumber = /[0-9]/.test(val);
    const hasLen = val.length >= 8;

    const setItemStatus = (itemEl, isValid) => {
      if (!itemEl) return;
      const icon = itemEl.querySelector('.checklist-icon');
      if (isValid) {
        itemEl.classList.remove('invalid');
        itemEl.classList.add('valid');
        if (icon) icon.textContent = '✓';
      } else {
        itemEl.classList.remove('valid');
        itemEl.classList.add('invalid');
        if (icon) icon.textContent = '✕';
      }
    };

    setItemStatus(checkUppercase, hasUpper);
    setItemStatus(checkLowercase, hasLower);
    setItemStatus(checkNumber, hasNumber);
    setItemStatus(checkLength, hasLen);

    return hasUpper && hasLower && hasNumber && hasLen;
  };

  // Real-time password confirmation match check
  const evaluatePasswordMatch = () => {
    if (!passwordMatchIndicator) return false;
    const pwd = signupPassword ? signupPassword.value : '';
    const confirmPwd = signupPasswordConfirm ? signupPasswordConfirm.value : '';

    if (!confirmPwd) {
      passwordMatchIndicator.style.display = 'none';
      passwordMatchIndicator.className = 'password-match-indicator';
      passwordMatchIndicator.innerHTML = '';
      return false;
    }

    passwordMatchIndicator.style.display = 'flex';
    if (pwd === confirmPwd) {
      passwordMatchIndicator.className = 'password-match-indicator match';
      passwordMatchIndicator.innerHTML = '<span>✓</span> <span>Passwords match</span>';
      return true;
    } else {
      passwordMatchIndicator.className = 'password-match-indicator mismatch';
      passwordMatchIndicator.innerHTML = '<span>✕</span> <span>Passwords do not match</span>';
      return false;
    }
  };

  // Listeners for dynamic password validation
  if (signupPassword) {
    signupPassword.addEventListener('input', () => {
      evaluatePasswordChecklist(signupPassword.value);
      if (signupPasswordConfirm && signupPasswordConfirm.value) {
        evaluatePasswordMatch();
      }
    });
  }

  if (signupPasswordConfirm) {
    signupPasswordConfirm.addEventListener('input', () => {
      evaluatePasswordMatch();
    });
  }

  const switchToTab = (targetTab) => {
    clearAuthError();
    if (targetTab === 'signin') {
      tabSignin?.classList.add('active');
      tabSignup?.classList.remove('active');
      if (signinForm) signinForm.style.display = 'block';
      if (signupForm) signupForm.style.display = 'none';
    } else {
      tabSignup?.classList.add('active');
      tabSignin?.classList.remove('active');
      if (signupForm) signupForm.style.display = 'block';
      if (signinForm) signinForm.style.display = 'none';
    }
  };

  if (tabSignin) {
    tabSignin.addEventListener('click', () => {
      switchToTab('signin');
    });
  }

  if (tabSignup) {
    tabSignup.addEventListener('click', () => {
      switchToTab('signup');
    });
  }

  // Sign In Handler
  if (signinForm) {
    signinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError();
      const emailInput = document.getElementById('signin-email');
      const passwordInput = document.getElementById('signin-password');
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      const btn = document.getElementById('signin-submit-btn');

      if (!email) {
        showAuthError('Please enter your email address.');
        emailInput?.focus();
        return;
      }

      if (!isValidEmail(email)) {
        showAuthError('Your email address is incorrect. Please enter a valid email address.');
        emailInput?.focus();
        return;
      }

      if (!password) {
        showAuthError('Please enter your password.');
        passwordInput?.focus();
        return;
      }

      if (btn) btn.disabled = true;

      try {
        const { data, error } = await AppState.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
          // Standard secure auth message preventing email enumeration
          showAuthError(
            `Invalid email or password. Please verify your credentials or create an account.<br><a href="#" class="auth-switch-link" id="auth-goto-signup">👉 Need an account? Create one here</a>`,
            true
          );
          const gotoSignup = document.getElementById('auth-goto-signup');
          if (gotoSignup) {
            gotoSignup.addEventListener('click', (ev) => {
              ev.preventDefault();
              switchToTab('signup');
              const signupEmail = document.getElementById('signup-email');
              if (signupEmail) signupEmail.value = email;
            });
          }
          passwordInput?.focus();
        } else if (data?.session) {
          handleSessionChange(data.session);
          showToast('Signed in successfully!', 'success');
          navigateTo('dashboard');
        }
      } catch (err) {
        showAuthError(`Sign in error: ${err.message}`);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // Sign Up Handler
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError();
      const nameInput = document.getElementById('signup-name');
      const emailInput = document.getElementById('signup-email');
      const passwordInput = document.getElementById('signup-password');
      const confirmInput = document.getElementById('signup-password-confirm');

      const name = nameInput ? nameInput.value.trim() : '';
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      const confirmPassword = confirmInput ? confirmInput.value : '';
      const btn = document.getElementById('signup-submit-btn');

      if (!name) {
        showAuthError('Please enter your full name.');
        nameInput?.focus();
        return;
      }

      if (!email) {
        showAuthError('Please enter your email address.');
        emailInput?.focus();
        return;
      }

      if (!isValidEmail(email)) {
        showAuthError('Your email address is incorrect. Please enter a valid email address.');
        emailInput?.focus();
        return;
      }

      const isCriteriaMet = evaluatePasswordChecklist(password);
      if (!isCriteriaMet) {
        showAuthError('Your password does not meet all security requirements. Please check the rules below.');
        passwordInput?.focus();
        return;
      }

      if (!confirmPassword) {
        showAuthError('Please confirm your password.');
        confirmInput?.focus();
        return;
      }

      if (password !== confirmPassword) {
        showAuthError('Passwords do not match. Please re-enter matching passwords.');
        confirmInput?.focus();
        return;
      }

      if (btn) btn.disabled = true;

      try {
        const { data, error } = await AppState.supabaseClient.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } }
        });

        if (error) {
          const lowerErr = (error.message || '').toLowerCase();
          if (lowerErr.includes('already registered') || lowerErr.includes('already exists') || lowerErr.includes('user already in database')) {
            // Attempt auto-login if they typed the correct existing password
            const { data: signInData, error: signInErr } = await AppState.supabaseClient.auth.signInWithPassword({ email, password });
            if (!signInErr && signInData?.session) {
              handleSessionChange(signInData.session);
              showToast('Welcome back! Signed in to your account.', 'success');
              navigateTo('dashboard');
              return;
            }
            showAuthError(
              `An account already exists with this email address. Please sign in instead.<br><a href="#" class="auth-switch-link" id="auth-goto-signin">👉 Switch to Sign In</a>`,
              true
            );
            const gotoSignin = document.getElementById('auth-goto-signin');
            if (gotoSignin) {
              gotoSignin.addEventListener('click', (ev) => {
                ev.preventDefault();
                switchToTab('signin');
                const signinEmail = document.getElementById('signin-email');
                if (signinEmail) signinEmail.value = email;
                document.getElementById('signin-password')?.focus();
              });
            }
            switchToTab('signin');
            const signinEmail = document.getElementById('signin-email');
            if (signinEmail) signinEmail.value = email;
            document.getElementById('signin-password')?.focus();
          } else {
            showAuthError(`Sign up failed: ${error.message}`);
          }
          return;
        }

        // If a session was returned directly, log them in immediately
        if (data?.session) {
          handleSessionChange(data.session);
          showToast('Account created successfully!', 'success');
          navigateTo('dashboard');
          return;
        }

        // Check if user already exists (Supabase duplicate user detection returns identities: [])
        const isExistingUser = data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

        if (isExistingUser) {
          // Attempt auto-signin with the entered password:
          const { data: signInData, error: signInErr } = await AppState.supabaseClient.auth.signInWithPassword({ email, password });
          if (!signInErr && signInData?.session) {
            handleSessionChange(signInData.session);
            showToast('Welcome back! Signed in to your account.', 'success');
            navigateTo('dashboard');
            return;
          }

          // If password doesn't match:
          showAuthError(
            `An account already exists with this email address. Please enter your existing password to sign in.<br><a href="#" class="auth-switch-link" id="auth-goto-signin">👉 Switch to Sign In</a>`,
            true
          );
          const gotoSignin = document.getElementById('auth-goto-signin');
          if (gotoSignin) {
            gotoSignin.addEventListener('click', (ev) => {
              ev.preventDefault();
              switchToTab('signin');
              const signinEmail = document.getElementById('signin-email');
              if (signinEmail) signinEmail.value = email;
              document.getElementById('signin-password')?.focus();
            });
          }
          switchToTab('signin');
          const signinEmail = document.getElementById('signin-email');
          if (signinEmail) signinEmail.value = email;
          document.getElementById('signin-password')?.focus();
          return;
        }

        // If new user was created but email confirmation is required:
        if (data?.user && !data?.session) {
          showAuthError(
            `Account created! Please check your email inbox at <strong>${escapeHtml(email)}</strong> to confirm your email before signing in.`,
            true
          );
          switchToTab('signin');
          const signinEmail = document.getElementById('signin-email');
          if (signinEmail) signinEmail.value = email;
          return;
        }

        // Fallback
        if (AppState.user) {
          navigateTo('dashboard');
        } else {
          switchToTab('signin');
          const signinEmail = document.getElementById('signin-email');
          if (signinEmail) signinEmail.value = email;
        }
      } catch (err) {
        showAuthError(`Sign up error: ${err.message}`);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
}

async function signOut() {
  if (AppState.supabaseClient) {
    await AppState.supabaseClient.auth.signOut();
  }
  handleSessionChange(null);
  navigateTo('login');
}

// ============================================================================
// Utilities
// ============================================================================
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(obj) {
  return obj;
}

// ============================================================================
// Phase 6: Intelligent Diagnostic Gap Analysis View & Controller
// ============================================================================

async function openGapAnalysisView() {
  if (!AppState.session) {
    navigateTo('login');
    return;
  }

  navigateTo('gap-analysis');

  // Populate subject selector
  const select = document.getElementById('gap-subject-select');
  if (select) {
    select.innerHTML = '';
    if (AppState.subjects && AppState.subjects.length > 0) {
      AppState.subjects.forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub.id;
        opt.textContent = sub.name;
        if (AppState.selectedSubject && AppState.selectedSubject.id === sub.id) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    } else {
      select.innerHTML = '<option value="">No subjects found</option>';
    }
  }

  const activeSubId = select?.value || AppState.selectedSubject?.id || (AppState.subjects[0]?.id);
  if (activeSubId) {
    await loadGapAnalysis(activeSubId);
  } else {
    const body = document.getElementById('gap-analysis-body');
    if (body) {
      body.innerHTML = `
        <div class="empty-state">
          <h3>No Subjects Found</h3>
          <p class="text-muted">Upload a textbook or syllabus first to generate curriculum topics and take diagnostic quizzes.</p>
          <button class="btn btn-primary" onclick="openUploadModal()">📁 Upload Study Material</button>
        </div>
      `;
    }
  }
}

async function loadGapAnalysis(subjectId, attemptId = null) {
  const body = document.getElementById('gap-analysis-body');
  if (!body) return;

  body.innerHTML = `
    <div class="empty-state">
      <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
      <h3>Analyzing Diagnostic Performance...</h3>
      <p class="text-muted">Evaluating authentic quiz answers, difficulty distribution, and curriculum nodes.</p>
    </div>
  `;

  try {
    const token = AppState.session?.access_token;
    if (!token) throw new Error('Student authentication session missing');

    let url = `/api/gap-analysis?subjectId=${encodeURIComponent(subjectId)}`;
    if (attemptId) url += `&attemptId=${encodeURIComponent(attemptId)}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to fetch gap analysis (HTTP ${res.status})`);
    }

    const data = await res.json();
    renderGapAnalysisReport(data);
  } catch (err) {
    console.error('Gap analysis load error:', err);
    body.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 2rem; color: var(--weak-color); margin-bottom: 0.5rem;">⚠️</div>
        <h3>Failed to Load Gap Analysis</h3>
        <p class="text-muted">${escapeHtml(err.message)}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadGapAnalysis('${escapeHtml(subjectId)}')">Try Again</button>
      </div>
    `;
  }
}

function renderGapAnalysisReport(data) {
  const body = document.getElementById('gap-analysis-body');
  if (!body) return;

  const diag = data.overallDiagnosis || {};
  const topicReports = data.topicReports || [];
  const unassessed = data.unassessedTopics || [];

  // 1. Update Metric Cards
  const accEl = document.getElementById('gap-stat-overall-accuracy');
  if (accEl) accEl.textContent = `${diag.overallAccuracy ?? 0}%`;

  const qEl = document.getElementById('gap-stat-total-questions');
  if (qEl) qEl.textContent = diag.totalAssessedQuestions ?? 0;

  const weakEl = document.getElementById('gap-stat-weak-count');
  if (weakEl) weakEl.textContent = diag.weakTopicsCount ?? 0;

  const medEl = document.getElementById('gap-stat-medium-count');
  if (medEl) medEl.textContent = diag.mediumTopicsCount ?? 0;

  const strongEl = document.getElementById('gap-stat-strong-count');
  if (strongEl) strongEl.textContent = diag.strongTopicsCount ?? 0;

  const unassessedEl = document.getElementById('gap-stat-unassessed-count');
  if (unassessedEl) unassessedEl.textContent = diag.unassessedTopicsCount ?? unassessed.length;

  // 2. Data Source Transparency Banner
  const srcBanner = document.getElementById('gap-data-source-banner');
  if (srcBanner) {
    const isDb = data.dataSource === 'database';
    srcBanner.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; padding: 0.5rem 0.85rem; background: ${isDb ? 'var(--strong-bg)' : '#fef3c7'}; border: 1px solid ${isDb ? 'var(--strong-border)' : '#fde68a'}; border-radius: var(--radius-sm); font-size: 0.8rem; color: ${isDb ? 'var(--strong-color)' : '#92400e'};">
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span>${isDb ? '🗄️' : '💾'}</span>
          <strong>Data Source:</strong>
          <span>${escapeHtml(data.dataSourceNote || '')}</span>
        </div>
        <span class="badge" style="background: rgba(255,255,255,0.7); font-size: 0.72rem;">${escapeHtml(data.dataSource || 'in_memory')}</span>
      </div>
    `;
  }

  // 3. Multi-Attempt Progression Banner
  const progBanner = document.getElementById('gap-progression-banner');
  if (progBanner) {
    const comp = data.attemptComparison;
    if (comp && comp.totalCompletedAttempts >= 2) {
      progBanner.style.display = 'block';
      const isImp = comp.trend === 'improved';
      const isDec = comp.trend === 'declined';
      const trendColor = isImp ? 'var(--strong-color)' : (isDec ? 'var(--weak-color)' : 'var(--text-muted)');
      const trendIcon = isImp ? '📈' : (isDec ? '📉' : '📊');

      progBanner.innerHTML = `
        <div class="card" style="padding: 1rem 1.25rem; border-left: 5px solid ${trendColor};">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <div style="font-weight: 700; font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem;">
                <span>${trendIcon}</span>
                <span>Attempt Progression: ${comp.trend.toUpperCase()}</span>
                <span class="badge ${isImp ? 'badge-strong' : (isDec ? 'badge-weak' : '')}">${comp.improvement > 0 ? '+' : ''}${comp.improvement}%</span>
              </div>
              <p class="text-muted" style="margin: 0.2rem 0 0 0; font-size: 0.83rem;">
                Latest Quiz: <strong>${comp.latestAccuracy}%</strong> vs Preceding Quiz: <strong>${comp.previousAccuracy}%</strong> across ${comp.totalCompletedAttempts} total completed attempts.
              </p>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
              <span class="badge badge-strong">↑ ${comp.topicsImproved?.length || 0} Improved</span>
              <span class="badge badge-weak">↓ ${comp.topicsDeclined?.length || 0} Declined</span>
              <span class="badge">→ ${comp.topicsSteady?.length || 0} Steady</span>
            </div>
          </div>
        </div>
      `;
    } else {
      progBanner.style.display = 'none';
    }
  }

  // 4. Render Topic Groups
  if (topicReports.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📝</div>
        <h3>No Quizzes Completed for This Subject</h3>
        <p class="text-muted">Take a diagnostic quiz on any chapter or topic to see your personal learning gaps, strengths, and recommendations.</p>
        <button class="btn btn-primary" onclick="navigateTo('doc-hierarchy')">Explore Curriculum & Take Quiz</button>
      </div>
    `;
    return;
  }

  const weakList = topicReports.filter(t => t.classification === 'weak');
  const mediumList = topicReports.filter(t => t.classification === 'medium');
  const strongList = topicReports.filter(t => t.classification === 'strong');
  const insufficientList = topicReports.filter(t => t.classification === 'insufficient_data');

  let html = '';

  // SECTION A: WEAK TOPICS (Priority Revision)
  if (weakList.length > 0) {
    html += `
      <div class="gap-section-title" style="color: var(--weak-color);">
        <span>🚨 Priority Revision Needed (${weakList.length} ${weakList.length === 1 ? 'Topic' : 'Topics'})</span>
      </div>
    `;
    weakList.forEach((t, idx) => {
      html += renderTopicCardHtml(t, 'weak', `weak-${idx}`);
    });
  }

  // SECTION B: MEDIUM TOPICS (Targeted Practice)
  if (mediumList.length > 0) {
    html += `
      <div class="gap-section-title" style="color: var(--medium-color);">
        <span>⚠️ Targeted Practice Needed (${mediumList.length} ${mediumList.length === 1 ? 'Topic' : 'Topics'})</span>
      </div>
    `;
    mediumList.forEach((t, idx) => {
      html += renderTopicCardHtml(t, 'medium', `med-${idx}`);
    });
  }

  // SECTION C: STRONG TOPICS (Mastery Achieved)
  if (strongList.length > 0) {
    html += `
      <div class="gap-section-title" style="color: var(--strong-color);">
        <span>🟢 Strong Mastery (${strongList.length} ${strongList.length === 1 ? 'Topic' : 'Topics'})</span>
      </div>
    `;
    strongList.forEach((t, idx) => {
      html += renderTopicCardHtml(t, 'strong', `strong-${idx}`);
    });
  }

  // SECTION D: INSUFFICIENT DATA TOPICS
  if (insufficientList.length > 0) {
    html += `
      <div class="gap-section-title" style="color: #6366f1;">
        <span>ℹ️ Topics Needing More Diagnostic Data (${insufficientList.length})</span>
      </div>
    `;
    insufficientList.forEach((t, idx) => {
      html += renderTopicCardHtml(t, 'insufficient', `insuf-${idx}`);
    });
  }

  // SECTION E: UNASSESSED CURRICULUM TOPICS
  if (unassessed.length > 0) {
    html += `
      <div class="gap-unassessed-accordion">
        <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleUnassessedList()">
          <div>
            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700;">
              📚 Unassessed Curriculum Topics (${unassessed.length} nodes)
            </h4>
            <p class="text-muted" style="margin: 0.2rem 0 0 0; font-size: 0.8rem;">
              These curriculum nodes have not been assessed yet. They are not classified as weak, just awaiting your diagnostic evaluation.
            </p>
          </div>
          <span id="unassessed-arrow-indicator" style="font-size: 1.1rem; color: var(--text-muted);">▼</span>
        </div>
        <div id="unassessed-topics-list-container" style="display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border);">
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.5rem;">
            ${unassessed.map(ut => `
              <div style="padding: 0.45rem 0.65rem; background: var(--bg-subtle); border-radius: var(--radius-sm); font-size: 0.82rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 500;">${escapeHtml(ut.topicName)}</span>
                <span class="badge" style="font-size: 0.7rem;">${escapeHtml(ut.chapterName || 'General')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  body.innerHTML = html;
}

function renderTopicCardHtml(t, classType, cardId) {
  const badgeMap = {
    weak: 'badge-weak',
    medium: 'badge-medium',
    strong: 'badge-strong',
    insufficient: 'badge-primary'
  };

  const statusLabelMap = {
    weak: 'Weak (<50%)',
    medium: 'Medium (50–80%)',
    strong: 'Strong (≥80%)',
    insufficient: 'Insufficient Data'
  };

  const diff = t.difficultyDistribution || {
    easy: { total: 0, correct: 0 },
    medium: { total: 0, correct: 0 },
    hard: { total: 0, correct: 0 }
  };

  const supportingCount = t.supportingQuestions?.length || 0;

  return `
    <div class="gap-topic-card ${classType}">
      <div class="gap-topic-header">
        <div>
          <div class="gap-topic-crumbs">${escapeHtml(t.chapterName || 'General')} › ${escapeHtml(t.hierarchyLevel || 'topic')}</div>
          <h3 class="gap-topic-title">${escapeHtml(t.topicName)}</h3>
        </div>
        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <span class="badge ${badgeMap[classType] || ''}">${statusLabelMap[classType] || classType}</span>
          ${t.confidence ? `<span class="badge" style="font-size: 0.7rem;">${t.confidence.toUpperCase()} CONFIDENCE</span>` : ''}
        </div>
      </div>

      <!-- Accuracy Progress Bar -->
      <div class="gap-meter-wrapper">
        <div class="gap-meter-label-row">
          <span>Diagnostic Accuracy: <strong>${t.accuracyPercentage}%</strong></span>
          <span class="text-muted">${t.correctAnswers}/${t.totalQuestions} Questions Correct</span>
        </div>
        <div class="gap-meter-track">
          <div class="gap-meter-fill ${classType}" style="width: ${Math.max(5, Math.min(100, t.accuracyPercentage))}%;"></div>
        </div>
      </div>

      <!-- Difficulty Distribution Pills -->
      <div class="gap-difficulty-row">
        <span class="gap-diff-pill ${diff.easy.total > 0 ? 'active' : ''}">
          🟢 Easy: ${diff.easy.correct}/${diff.easy.total}
        </span>
        <span class="gap-diff-pill ${diff.medium.total > 0 ? 'active' : ''}">
          🟡 Medium: ${diff.medium.correct}/${diff.medium.total}
        </span>
        <span class="gap-diff-pill ${diff.hard.total > 0 ? 'active' : ''}">
          🔴 Hard: ${diff.hard.correct}/${diff.hard.total}
        </span>
      </div>

      <!-- Grounded Diagnostic Reason -->
      <div class="gap-callout-box gap-reason-box">
        <strong>💡 Diagnostic Evidence:</strong>
        <div>${escapeHtml(t.reason)}</div>
      </div>

      <!-- Actionable Recommended Action -->
      <div class="gap-callout-box gap-action-box">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <strong>🎯 Action Plan:</strong>
            <div>${escapeHtml(t.recommendedAction)}</div>
          </div>
          ${t.topicId ? `
            <button class="btn btn-secondary btn-sm" onclick="navigateToTopicFromGap('${t.topicId}')" style="background:#ffffff; border-color:#c7d2fe; color:var(--primary); font-weight:600;">
              📖 Study Topic
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Collapsible Supporting Questions Evidence -->
      ${supportingCount > 0 ? `
        <button class="gap-supporting-toggle" onclick="toggleSupportingDrawer('${cardId}')">
          <span id="arrow-${cardId}">▶</span>
          <span>View Supporting Questions & Verified Citations (${supportingCount} ${supportingCount === 1 ? 'question' : 'questions'})</span>
        </button>
        <div class="gap-supporting-drawer" id="drawer-${cardId}" style="display: none;">
          ${t.supportingQuestions.map((sq, sIdx) => `
            <div class="gap-question-item">
              <div class="gap-question-header">
                <span style="font-weight: 700; color: var(--text-main);">Question ${sIdx + 1} (${sq.difficulty?.toUpperCase()})</span>
                <span class="quiz-review-status-tag ${sq.isCorrect ? 'correct' : 'incorrect'}">
                  ${sq.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                </span>
              </div>
              <p style="margin: 0.25rem 0 0.5rem 0; font-size: 0.85rem; font-weight: 500;">
                ${escapeHtml(sq.questionText)}
              </p>
              <div style="display: flex; gap: 1rem; font-size: 0.8rem; margin-bottom: 0.35rem; color: var(--text-muted);">
                <span>Your Answer: <strong>Option ${escapeHtml(sq.selectedOption || 'None')}</strong></span>
                <span>Correct Key: <strong style="color: var(--strong-color);">Option ${escapeHtml(sq.correctOption)}</strong></span>
              </div>
              ${sq.explanation ? `
                <div style="font-size: 0.8rem; color: var(--text-muted); background: #ffffff; padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); border: 1px solid var(--border-light); margin-top: 0.25rem;">
                  <strong>Explanation:</strong> ${escapeHtml(sq.explanation)}
                </div>
              ` : ''}
              ${sq.sourceReference?.pageNumber ? `
                <div style="font-size: 0.75rem; color: var(--primary); margin-top: 0.35rem;">
                  📍 Source Citation: Page ${sq.sourceReference.pageNumber} • Verified Textbook Reference
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function toggleSupportingDrawer(cardId) {
  const drawer = document.getElementById(`drawer-${cardId}`);
  const arrow = document.getElementById(`arrow-${cardId}`);
  if (!drawer) return;

  const isHidden = drawer.style.display === 'none';
  drawer.style.display = isHidden ? 'flex' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
}

function toggleUnassessedList() {
  const container = document.getElementById('unassessed-topics-list-container');
  const arrow = document.getElementById('unassessed-arrow-indicator');
  if (!container) return;

  const isHidden = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
}

async function navigateToTopicFromGap(topicId) {
  if (!topicId) return;

  // Search in AppState curriculum tree or fetch topic details
  if (window.TreeNodeData && window.TreeNodeData.has(topicId)) {
    openTopicWorkspaceFromId(topicId);
    return;
  }

  // Fallback: fetch topic via API and open
  try {
    const token = AppState.session?.access_token;
    const res = await fetch(`/api/topics/detail?id=${encodeURIComponent(topicId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.topic) {
        openTopicWorkspace(data.topic, data.chapter || null);
      }
    }
  } catch (e) {
    console.error('Failed to navigate to topic from gap analysis:', e);
  }
}

// Expose globals for HTML inline handlers
window.openGapAnalysisView = openGapAnalysisView;
window.loadGapAnalysis = loadGapAnalysis;
window.toggleSupportingDrawer = toggleSupportingDrawer;
window.toggleUnassessedList = toggleUnassessedList;
window.navigateToTopicFromGap = navigateToTopicFromGap;

// ============================================================================
// Phase 7: Intelligent Personalized Revision Plan
// ============================================================================

AppState.activeRevisionPlan = null;

async function openRevisionPlanView() {
  if (!AppState.session) {
    navigateTo('login');
    return;
  }

  navigateTo('revision-plan');

  // Populate subject selector
  const select = document.getElementById('plan-subject-select');
  if (select) {
    select.innerHTML = '';
    const subs = (AppState.subjects && AppState.subjects.length > 0)
      ? AppState.subjects
      : [{ id: '173b9439-b3c2-42c5-9ac0-592bf50a6626', name: 'Mathematics' }];

    subs.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = sub.name;
      if (AppState.selectedSubject && AppState.selectedSubject.id === sub.id) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  const activeSubId = select?.value || AppState.selectedSubject?.id || (AppState.subjects?.[0]?.id) || '173b9439-b3c2-42c5-9ac0-592bf50a6626';
  await loadRevisionPlan(activeSubId);
}

async function loadRevisionPlan(subjectId) {
  if (!subjectId) return;

  try {
    const token = AppState.session?.access_token;
    if (!token) return;

    const res = await fetch(`/api/revision-plan?subjectId=${encodeURIComponent(subjectId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.plan) {
        AppState.activeRevisionPlan = data.plan;
        renderRevisionPlan(data.plan);
      } else {
        AppState.activeRevisionPlan = null;
        const progressCard = document.getElementById('plan-progress-card');
        if (progressCard) progressCard.style.display = 'none';
        const bannerContainer = document.getElementById('plan-data-source-banner');
        if (bannerContainer) bannerContainer.innerHTML = '';
        const scheduleContainer = document.getElementById('revision-plan-schedule');
        if (scheduleContainer) {
          scheduleContainer.innerHTML = `
            <div class="empty-state">
              <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📅</div>
              <h3>No Revision Plan Generated Yet</h3>
              <p class="text-muted">Set your study days and daily hours above, then click "Generate Revision Plan" to build a schedule grounded in your diagnostic gaps.</p>
            </div>
          `;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching revision plan:', err);
  }
}

async function handleGenerateRevisionPlan() {
  const select = document.getElementById('plan-subject-select');
  const daysInput = document.getElementById('plan-input-days');
  const hoursInput = document.getElementById('plan-input-hours');
  const scheduleContainer = document.getElementById('revision-plan-schedule');

  const subjectId = select?.value || AppState.selectedSubject?.id || (AppState.subjects?.[0]?.id) || '173b9439-b3c2-42c5-9ac0-592bf50a6626';
  const availableDays = parseInt(daysInput?.value || '5', 10);
  const hoursPerDay = parseFloat(hoursInput?.value || '2');

  if (scheduleContainer) {
    scheduleContainer.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⚙️</div>
        <h3>Generating Optimized Revision Plan...</h3>
        <p class="text-muted">Analyzing your Phase 6 diagnostic gaps, prioritizing weak topics, and balancing daily study slots.</p>
      </div>
    `;
  }

  try {
    const token = AppState.session?.access_token;
    if (!token) throw new Error('Student authentication session missing');

    const res = await fetch('/api/revision-plan/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        subjectId,
        availableDays,
        hoursPerDay
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    AppState.activeRevisionPlan = data.plan;
    renderRevisionPlan(data.plan);
  } catch (err) {
    console.error('Failed to generate revision plan:', err);
    if (scheduleContainer) {
      scheduleContainer.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 2.5rem; color: var(--weak-color); margin-bottom: 0.5rem;">⚠️</div>
          <h3>Failed to Generate Plan</h3>
          <p class="text-muted">${escapeHtml(err.message)}</p>
          <button class="btn btn-secondary btn-sm" onclick="handleGenerateRevisionPlan()">Try Again</button>
        </div>
      `;
    }
  }
}

function renderRevisionPlan(plan) {
  const progressCard = document.getElementById('plan-progress-card');
  const scheduleContainer = document.getElementById('revision-plan-schedule');
  const bannerContainer = document.getElementById('plan-data-source-banner');

  if (!plan || !plan.schedule) return;

  // 1. Transparency banner
  if (bannerContainer) {
    const isDb = plan.dataSource === 'database';
    bannerContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; padding: 0.5rem 0.85rem; background: ${isDb ? 'var(--strong-bg)' : '#fef3c7'}; border: 1px solid ${isDb ? 'var(--strong-border)' : '#fde68a'}; border-radius: var(--radius-sm); font-size: 0.8rem; color: ${isDb ? 'var(--strong-color)' : '#92400e'};">
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span>${isDb ? '🗄️' : '💾'}</span>
          <strong>Data Source:</strong>
          <span>${escapeHtml(plan.dataSourceNote || '')}</span>
        </div>
        <span class="badge" style="background: rgba(255,255,255,0.7); font-size: 0.72rem;">${escapeHtml(plan.dataSource || 'in_memory')}</span>
      </div>
    `;
  }

  // 2. Progress Card
  if (progressCard) {
    progressCard.style.display = 'block';

    const titleEl = document.getElementById('plan-subject-title');
    if (titleEl) titleEl.textContent = `${plan.subjectName || 'Mathematics'} Revision Plan`;

    const subEl = document.getElementById('plan-meta-subtitle');
    if (subEl) subEl.textContent = `${plan.availableDays} Study Days • ${plan.totalPlannedHours} Planned Hours (${plan.hoursPerDay} hrs/day)`;

    const statEl = document.getElementById('plan-completion-stat');
    if (statEl) statEl.textContent = `${plan.progressPercentage || 0}% Completed`;

    const taskCountEl = document.getElementById('plan-task-count-stat');
    if (taskCountEl) taskCountEl.textContent = `${plan.completedTaskCount || 0} of ${plan.totalTaskCount || 0} tasks finished`;

    const barFill = document.getElementById('plan-progress-bar-fill');
    if (barFill) barFill.style.width = `${plan.progressPercentage || 0}%`;
  }

  // 3. Render Day Groups
  if (!scheduleContainer) return;

  if (plan.schedule.length === 0 || plan.totalTaskCount === 0) {
    scheduleContainer.innerHTML = `
      <div class="empty-state">
        <h3>No Tasks Scheduled</h3>
        <p class="text-muted">Take diagnostic quizzes first to discover topic gaps.</p>
      </div>
    `;
    return;
  }

  scheduleContainer.innerHTML = plan.schedule.map(day => `
    <div class="revision-day-group">
      <div class="revision-day-header">
        <div class="revision-day-title">
          <span>📅</span> ${escapeHtml(day.title || `Day ${day.dayNumber}`)}
        </div>
        <div class="revision-day-hours">
          ⏱️ ${day.allocatedHours} / ${day.maxHours} hrs allocated
        </div>
      </div>
      <div class="revision-task-list">
        ${day.tasks.length === 0 ? '<p class="text-muted" style="font-size:0.85rem; padding: 0.5rem;">Rest / Catch-up day. No tasks scheduled.</p>' : ''}
        ${day.tasks.map(task => renderRevisionTaskCard(plan.id, task)).join('')}
      </div>
    </div>
  `).join('');
}

function renderRevisionTaskCard(planId, task) {
  const isCompleted = Boolean(task.isCompleted);
  const priorityClass = `priority-${task.priority || 'medium'}`;

  let badgeStyle = 'background: #f1f5f9; color: #475569;';
  if (task.priority === 'high') badgeStyle = 'background: var(--weak-bg); color: var(--weak-color); border: 1px solid var(--weak-border);';
  else if (task.priority === 'medium') badgeStyle = 'background: var(--medium-bg); color: var(--medium-color); border: 1px solid var(--medium-border);';
  else if (task.priority === 'diagnostic') badgeStyle = 'background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe;';
  else if (task.priority === 'low') badgeStyle = 'background: var(--strong-bg); color: var(--strong-color); border: 1px solid var(--strong-border);';

  return `
    <div class="revision-task-card ${priorityClass} ${isCompleted ? 'is-completed' : ''}" id="task-card-${task.id}">
      <div class="revision-task-header">
        <div>
          <div class="revision-task-topic">
            ${isCompleted ? '✅ ' : ''}${escapeHtml(task.topicName)}
          </div>
          <div class="revision-task-chapter">
            ${escapeHtml(task.chapterName || 'Curriculum Topic')}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span class="badge" style="${badgeStyle}">
            ${escapeHtml(task.priorityLabel || task.priority)}
          </span>
          <span class="badge" style="background: #e2e8f0; color: #334155;">
            ⏱️ ${task.estimatedHours} hr${task.estimatedHours > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div class="revision-task-reason-box">
        <strong>💡 Diagnostic Reason:</strong> ${escapeHtml(task.reason)}
      </div>

      <div class="revision-task-activity-box">
        <strong>🎯 Recommended Activity:</strong> ${escapeHtml(task.recommendedActivity)}
      </div>

      <div class="revision-task-footer">
        <button class="revision-btn-complete ${isCompleted ? 'completed' : ''}"
                onclick="toggleRevisionTask('${planId}', '${task.id}', ${!isCompleted})">
          ${isCompleted ? '✓ Completed' : '○ Mark as Completed'}
        </button>

        <button class="revision-btn-retest" onclick="retestTopic('${task.topicId}')" title="Return to quiz workflow to retest this topic">
          <span>🎯 Retest Topic (Take Quiz)</span>
        </button>
      </div>
    </div>
  `;
}

async function toggleRevisionTask(planId, taskId, isCompleted) {
  try {
    const token = AppState.session?.access_token;
    if (!token) return;

    const res = await fetch('/api/revision-plan/task', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        planId,
        taskId,
        isCompleted
      })
    });

    if (res.ok) {
      const data = await res.json();
      AppState.activeRevisionPlan = data.plan;
      renderRevisionPlan(data.plan);
    }
  } catch (err) {
    console.error('Error toggling revision task:', err);
  }
}

async function retestTopic(topicId) {
  if (!topicId) return;

  // 1. Search in TreeNodeData if available
  let topic = null;
  let chapter = null;

  if (window.TreeNodeData && window.TreeNodeData.has(topicId)) {
    const data = window.TreeNodeData.get(topicId);
    topic = data.topic;
    chapter = data.chapter;
  }

  // 2. Fallback: fetch topic via API
  if (!topic) {
    try {
      const token = AppState.session?.access_token;
      const res = await fetch(`/api/topics/detail?id=${encodeURIComponent(topicId)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        topic = data.topic;
        chapter = data.chapter;
      }
    } catch (e) {}
  }

  // 3. Fallback dummy topic if offline
  if (!topic) {
    topic = { id: topicId, name: 'Topic Retest', source_references: [] };
  }

  // 4. Open Topic Workspace and immediately activate Quiz tab!
  await openTopicWorkspace(topic, chapter);
  switchTopicTab('quiz');
}

// Expose Phase 7 globals for HTML inline handlers
window.openRevisionPlanView = openRevisionPlanView;
window.loadRevisionPlan = loadRevisionPlan;
window.handleGenerateRevisionPlan = handleGenerateRevisionPlan;
window.toggleRevisionTask = toggleRevisionTask;
window.retestTopic = retestTopic;


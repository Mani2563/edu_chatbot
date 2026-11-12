/**
 * GapFinder AI — Vanilla JavaScript Application Controller
 * Handles Navigation, Auth, API Interactions, and View Rendering
 */

// Application State
const AppState = {
  currentView: 'dashboard',
  user: null,
  token: null,
  documents: [],
  topics: null,
  activeQuiz: null,
  gapReport: null,
  revisionPlan: null,
  progress: [],
  backendStatus: null
};

// Storage Keys
const STORAGE_TOKEN_KEY = 'gapfinder_auth_token';
const STORAGE_USER_KEY = 'gapfinder_user';

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNavigation();
  checkBackendHealth();
  setupEventListeners();
});

/**
 * Initialize Authentication from localStorage
 */
function initAuth() {
  const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
  const savedUser = localStorage.getItem(STORAGE_USER_KEY);

  if (savedToken && savedUser) {
    try {
      AppState.token = savedToken;
      AppState.user = JSON.parse(savedUser);
      updateUserDisplay();
    } catch {
      logout();
    }
  } else {
    updateUserDisplay();
  }
}

/**
 * Update User Display in Header
 */
function updateUserDisplay() {
  const userDisplay = document.getElementById('user-display');
  const authBtn = document.getElementById('auth-btn');

  if (AppState.user) {
    userDisplay.textContent = AppState.user.full_name || AppState.user.email || 'Student';
    userDisplay.style.background = '#eef2ff';
    userDisplay.style.color = '#4f46e5';
    authBtn.textContent = 'Logout';
  } else {
    userDisplay.textContent = 'Demo Mode (Guest)';
    userDisplay.style.background = '#f1f5f9';
    userDisplay.style.color = '#64748b';
    authBtn.textContent = 'Login';
  }
}

/**
 * Setup Navigation
 */
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-view');
      navigateTo(targetView);
    });
  });
}

/**
 * Navigate to a specific view
 */
function navigateTo(viewName) {
  AppState.currentView = viewName;

  // Update nav active classes
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.getAttribute('data-view') === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Toggle view panels
  const views = [
    'dashboard', 'upload', 'topics', 'quiz',
    'report', 'plan', 'progress', 'explain', 'login'
  ];

  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      el.style.display = (v === viewName) ? 'block' : 'none';
    }
  });

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Check backend health
 */
async function checkBackendHealth() {
  const indicator = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');

  try {
    const res = await fetch('/api/health');
    const data = await res.json();

    if (data.success) {
      indicator.className = 'status-indicator online';
      const groqState = data.services?.groqConfigured ? 'Groq Active' : 'Groq Pending Key';
      const supaState = data.services?.supabaseConfigured ? 'Supabase Active' : 'Local Storage Mode';
      text.textContent = `${data.message} • ${groqState} • ${supaState}`;
      AppState.backendStatus = data;
    } else {
      throw new Error(data.error || 'Backend responded with error');
    }
  } catch (err) {
    indicator.className = 'status-indicator offline';
    text.textContent = 'Backend unavailable. Ensure Vercel server is running.';
  }
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Auth button toggle
  const authBtn = document.getElementById('auth-btn');
  authBtn.addEventListener('click', () => {
    if (AppState.user) {
      logout();
    } else {
      navigateTo('login');
    }
  });

  // 1-Click Demo Login for Evaluator
  const demoLoginBtn = document.getElementById('demo-login-btn');
  if (demoLoginBtn) {
    demoLoginBtn.addEventListener('click', () => {
      handleDemoLogin();
    });
  }

  // Dashboard quick diagnostic button
  const startDiagBtn = document.getElementById('start-diagnosis-btn');
  if (startDiagBtn) {
    startDiagBtn.addEventListener('click', () => {
      navigateTo('quiz');
    });
  }
}

/**
 * Handle Demo Login
 */
function handleDemoLogin() {
  const demoUser = {
    id: 'demo-evaluator-001',
    email: 'evaluator@igebra.ai',
    full_name: 'Evaluator / Demo Student',
    isDemo: true
  };
  const demoToken = 'demo-token-evaluator-001';

  AppState.user = demoUser;
  AppState.token = demoToken;

  localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(demoUser));
  localStorage.setItem(STORAGE_TOKEN_KEY, demoToken);

  updateUserDisplay();
  navigateTo('dashboard');
  alert('Logged in as Evaluator / Demo Student successfully!');
}

/**
 * Logout
 */
function logout() {
  AppState.user = null;
  AppState.token = null;
  localStorage.removeItem(STORAGE_USER_KEY);
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  updateUserDisplay();
  navigateTo('dashboard');
}

/**
 * API Fetch Helper with Auth & Error Handling
 */
async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  if (AppState.token) {
    headers['Authorization'] = `Bearer ${AppState.token}`;
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({
    success: false,
    error: 'Invalid response from server'
  }));

  if (!response.ok && !data.error) {
    data.error = `HTTP Error ${response.status}`;
  }

  return data;
}

// Global scope attachment for inline handlers
window.navigateTo = navigateTo;
window.AppState = AppState;
window.apiRequest = apiRequest;


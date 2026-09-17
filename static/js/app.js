/**
 * Agentic RAG + Live Web Search — Frontend Application Engine
 * Supports multi-session management, mode toggling (Auto/Hybrid/Internal/Web),
 * live web citations, guardrail error handling, document uploads, and auth presets.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Application State
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'agentic_rag_sessions';
  const AUTH_STORAGE_KEY = 'agentic_rag_auth_token';

  let state = {
    searchMode: 'auto',         // 'auto' | 'hybrid' | 'internal' | 'web'
    isMock: false,
    authToken: localStorage.getItem(AUTH_STORAGE_KEY) || 'demo-team-admin-key-not-for-production',
    userProfile: {
      user_id: 'alice_admin',
      name: 'Alice (Admin)',
      role: 'admin'
    },
    sessions: [],
    activeSessionId: null,
    documents: [],
    pendingUploadFile: null,
    countdownTimerId: null
  };

  // ---------------------------------------------------------------------------
  // DOM Element References
  // ---------------------------------------------------------------------------
  const DOM = {
    sidebar: document.getElementById('sidebar'),
    toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),
    newChatBtn: document.getElementById('new-chat-btn'),
    chatsList: document.getElementById('chats-list'),
    docsCompactList: document.getElementById('docs-compact-list'),
    sidebarUploadBtn: document.getElementById('sidebar-upload-btn'),
    userProfileTrigger: document.getElementById('user-profile-trigger'),
    userAvatarInitials: document.getElementById('user-avatar-initials'),
    userDisplayName: document.getElementById('user-display-name'),
    userRoleTag: document.getElementById('user-role-tag'),

    activeChatTitle: document.getElementById('active-chat-title'),
    backendStatusDot: document.getElementById('backend-status-dot'),
    backendStatusText: document.getElementById('backend-status-text'),
    mockToggle: document.getElementById('mock-toggle'),
    modeTagDisplay: document.getElementById('mode-tag-display'),
    reindexBtn: document.getElementById('reindex-button'),
    reindexBtnText: document.getElementById('reindex-button-text'),

    chatViewport: document.getElementById('chat-viewport'),
    welcomeContainer: document.getElementById('welcome-container'),
    messagesStream: document.getElementById('messages-stream'),

    rateLimitBanner: document.getElementById('rate-limit-banner'),
    rateLimitMessage: document.getElementById('rate-limit-message'),
    countdownTimer: document.getElementById('countdown-timer'),
    guardrailBanner: document.getElementById('guardrail-alert-banner'),
    guardrailReason: document.getElementById('guardrail-violation-reason'),
    closeGuardrailBtn: document.getElementById('close-guardrail-btn'),

    chatInput: document.getElementById('chat-input'),
    webTogglePill: document.getElementById('web-toggle-pill'),
    composerAttachBtn: document.getElementById('composer-attach-btn'),
    sendBtn: document.getElementById('send-btn'),

    // Modals
    uploadModal: document.getElementById('upload-modal'),
    closeUploadModalBtn: document.getElementById('close-upload-modal-btn'),
    cancelUploadBtn: document.getElementById('cancel-upload-btn'),
    submitUploadBtn: document.getElementById('submit-upload-btn'),
    uploadDropzone: document.getElementById('upload-dropzone'),
    dropzoneFilename: document.getElementById('dropzone-filename'),
    dropzoneBrowseBtn: document.getElementById('dropzone-browse-btn'),
    uploadFileInput: document.getElementById('upload-file-input'),
    uploadReindexToggle: document.getElementById('upload-reindex-toggle'),
    uploadProgressWrap: document.getElementById('upload-progress-wrap'),
    uploadProgressBar: document.getElementById('upload-progress-bar'),

    authModal: document.getElementById('auth-modal'),
    closeAuthModalBtn: document.getElementById('close-auth-modal-btn'),
    cancelAuthBtn: document.getElementById('cancel-auth-btn'),
    saveAuthBtn: document.getElementById('save-auth-btn'),
    customTokenInput: document.getElementById('custom-token-input'),
    authPresetItems: document.querySelectorAll('.auth-preset-item'),

    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    openSettingsHdrBtn: document.getElementById('open-settings-hdr-btn'),
    sidebarSettingsBtn: document.getElementById('sidebar-settings-btn'),
    closeSettingsModalBtn: document.getElementById('close-settings-modal-btn'),
    cancelSettingsBtn: document.getElementById('cancel-settings-btn'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    userDisplayName: document.getElementById('user-display-name'),
    userDisplaySubtext: document.getElementById('user-display-subtext'),

    // Location Permission Pill
    locationPermBtn: document.getElementById('location-perm-btn'),
    locationPermText: document.getElementById('location-perm-text')
  };

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  function init() {
    loadSessionsFromStorage();
    setupEventListeners();
    checkHealth();
    fetchSystemConfig();
    fetchUserProfile();
    fetchDocuments();
    requestAutomaticPermissions();
    updateDynamicGreeting();

    if (state.sessions.length === 0) {
      createNewSession();
    } else {
      switchSession(state.sessions[0].id);
    }
  }

  function updateDynamicGreeting() {
    const heroGreeting = document.getElementById('hero-greeting');
    if (!heroGreeting) return;

    if (state.userProfile && state.userProfile.name && !state.userProfile.name.includes('Alice')) {
      const name = state.userProfile.name.split(' ')[0];
      heroGreeting.textContent = `Welcome, ${name}. How can I help you today?`;
    } else {
      heroGreeting.textContent = `How can I help you today?`;
    }
  }

  function requestAutomaticPermissions() {
    // 1. Automatic Geolocation Permission Request
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude.toFixed(2);
          const lon = pos.coords.longitude.toFixed(2);
          state.userLocation = `Lat ${lat}, Lon ${lon}`;
          console.log('Location permission granted automatically:', state.userLocation);
        },
        (err) => {
          console.warn('Geolocation permission not granted or error:', err);
        }
      );
    }

    // 2. Automatic Web Notification Permission Request
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('Notification permission status:', permission);
      }).catch(err => {
        console.warn('Notification permission error:', err);
      });
    }
  }

  async function fetchSystemConfig() {
    try {
      const resp = await fetch('/config');
      if (resp.ok) {
        const config = await resp.json();
        state.config = config;
        
        if (DOM.userDisplayName) DOM.userDisplayName.textContent = config.workspace_name || 'Nexus AI Workspace';
        if (DOM.userDisplaySubtext) {
          const provs = (config.active_providers || []).map(p => p.toUpperCase()).join(' → ');
          DOM.userDisplaySubtext.textContent = provs ? `Active: ${provs}` : 'Multi-API Fallback Engine';
        }

        const chainBox = document.querySelector('.settings-chain-box');
        if (chainBox && config.active_providers && config.active_providers.length > 0) {
          chainBox.innerHTML = config.active_providers.map((p, idx) => `
            <div class="chain-step ${idx === 0 ? 'active' : ''}">${idx + 1}. ${p.toUpperCase()}</div>
            ${idx < config.active_providers.length - 1 ? '<div class="chain-arrow">&rarr;</div>' : ''}
          `).join('');
        }
      }
    } catch (e) {
      console.warn('Failed to fetch system config:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Session & Local Storage Management
  // ---------------------------------------------------------------------------
  function loadSessionsFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state.sessions = JSON.parse(raw);
      }
    } catch (e) {
      console.error('Failed to load sessions from storage:', e);
      state.sessions = [];
    }
  }

  function saveSessionsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
    } catch (e) {
      console.error('Failed to save sessions to storage:', e);
    }
  }

  function createNewSession() {
    const session = {
      id: 'session_' + Date.now(),
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      messages: []
    };
    state.sessions.unshift(session);
    saveSessionsToStorage();
    switchSession(session.id);
  }

  function switchSession(sessionId) {
    state.activeSessionId = sessionId;
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;

    DOM.activeChatTitle.textContent = session.title;
    renderSidebarChats();
    renderMessagesStream(session.messages);
  }

  function deleteSession(sessionId, e) {
    if (e) e.stopPropagation();
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    saveSessionsToStorage();
    if (state.sessions.length === 0) {
      createNewSession();
    } else {
      switchSession(state.sessions[0].id);
    }
  }

  // ---------------------------------------------------------------------------
  // API Requests
  // ---------------------------------------------------------------------------
  function getAuthHeaders() {
    return {
      'Authorization': `Bearer ${state.authToken}`,
      'Content-Type': 'application/json'
    };
  }

  async function checkHealth() {
    try {
      const resp = await fetch('/health');
      if (resp.ok) {
        DOM.backendStatusDot.className = 'status-dot online';
        DOM.backendStatusText.textContent = 'Connected';
      } else {
        DOM.backendStatusDot.className = 'status-dot offline';
        DOM.backendStatusText.textContent = 'Degraded';
      }
    } catch (e) {
      DOM.backendStatusDot.className = 'status-dot offline';
      DOM.backendStatusText.textContent = 'Offline';
    }
  }

  async function fetchUserProfile() {
    try {
      const resp = await fetch('/auth/me', { headers: getAuthHeaders() });
      if (resp.ok) {
        const data = await resp.json();
        const role = (data.roles && data.roles[0]) || 'reader';
        const nameMap = {
          'alice_admin': 'Alice (Admin)',
          'bob_engineer': 'Bob (Operator)',
          'charlie_intern': 'Charlie (Reader)'
        };
        state.userProfile = {
          user_id: data.user_id,
          name: nameMap[data.user_id] || data.user_id,
          role: role
        };
        updateUserDisplay();
      }
    } catch (e) {
      console.warn('Auth check failed:', e);
    }
  }

  async function fetchDocuments() {
    try {
      const resp = await fetch('/documents', { headers: getAuthHeaders() });
      if (resp.ok) {
        const data = await resp.json();
        state.documents = data.documents || [];
        renderSidebarDocuments();
      }
    } catch (e) {
      console.warn('Failed to fetch document list:', e);
    }
  }

  async function sendQueryToAgent(userQuery) {
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session) return;

    let payloadQuery = userQuery;
    if (state.userLocation && userQuery.toLowerCase().includes('weather')) {
      payloadQuery = `${userQuery} (User Location: ${state.userLocation})`;
    }

    // Prepare multi-turn conversation history
    const history = session.messages.slice(-6).map(m => ({
      role: m.role,
      content: m.text
    }));

    const body = {
      query: payloadQuery,
      conversation_history: history,
      search_mode: state.searchMode
    };

    const url = `/query${state.isMock ? '?mock=true' : ''}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body)
    });

    if (response.status === 400) {
      const errData = await response.json();
      const detail = errData.detail || {};
      return {
        is_error: true,
        error_type: 'guardrail',
        answer: `🛡️ **Security Guardrail Intercepted Query**\n\n${detail.reason || 'Query rejected due to safety policy violation.'}`,
        sources: [],
        structured_sources: { internal: [], web: [] },
        validation: { is_grounded: false, confidence: 0, reasoning: detail.reason || 'Guardrail violation' }
      };
    } else if (response.status === 429) {
      const errData = await response.json();
      const msg = errData.message || 'Upstream TPM budget exhausted.';
      return {
        is_error: true,
        error_type: 'rate_limit',
        answer: `⏱️ **Upstream API Rate Limit Reached (Groq Free Tier)**\n\n${msg}\n\n*Tip: You can switch to **Offline Mock Mode** using the toggle at the top right to continue testing instantly without waiting!*`,
        sources: [],
        structured_sources: { internal: [], web: [] },
        validation: { is_grounded: false, confidence: 0, reasoning: 'Rate limit exceeded' }
      };
    } else if (!response.ok) {
      const errText = await response.text();
      return {
        is_error: true,
        error_type: 'server_error',
        answer: `⚠️ **Server Error (HTTP ${response.status})**\n\n${errText}`,
        sources: [],
        structured_sources: { internal: [], web: [] },
        validation: { is_grounded: false, confidence: 0, reasoning: 'HTTP Error' }
      };
    }

    return await response.json();
  }

  // ---------------------------------------------------------------------------
  // Message Handling & UI Rendering
  // ---------------------------------------------------------------------------
  async function handleSendMessage(customPrompt = null) {
    const promptText = (customPrompt || DOM.chatInput.value).trim();
    if (!promptText) return;

    // Clear input & update height
    if (!customPrompt) {
      DOM.chatInput.value = '';
      DOM.chatInput.style.height = 'auto';
      updateSendButtonState();
    }

    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session) return;

    // Set title on first message
    if (session.messages.length === 0) {
      session.title = promptText.length > 30 ? promptText.substring(0, 30) + '...' : promptText;
      DOM.activeChatTitle.textContent = session.title;
      renderSidebarChats();
    }

    // 1. Append User Message
    const userMsg = { role: 'user', text: promptText, timestamp: new Date().toISOString() };
    session.messages.push(userMsg);
    saveSessionsToStorage();
    renderMessagesStream(session.messages);

    // 2. Append Pending Assistant Message Shell
    const pendingId = 'msg_' + Date.now();
    renderPendingAssistantMessage(pendingId);

    try {
      // 3. Call Backend API
      const responseData = await sendQueryToAgent(promptText);

      // Remove pending shell
      const pendingEl = document.getElementById(pendingId);
      if (pendingEl) pendingEl.remove();

      // 4. Update Assistant Message in session state
      const assistantMsg = {
        role: 'assistant',
        text: responseData.answer,
        sources: responseData.sources || [],
        structuredSources: responseData.structured_sources || { internal: [], web: [] },
        validation: responseData.validation || {},
        searchMode: responseData.search_mode || state.searchMode,
        isError: responseData.is_error || false,
        timestamp: new Date().toISOString()
      };

      session.messages.push(assistantMsg);
      saveSessionsToStorage();
      renderMessagesStream(session.messages);

      // Trigger Web Notification when response is ready
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const cleanText = responseData.answer ? responseData.answer.replace(/[*#`_]/g, '').trim() : 'Response is ready!';
          new Notification('Nexus AI Response Ready', {
            body: cleanText.length > 120 ? cleanText.substring(0, 120) + '...' : cleanText
          });
        } catch (e) {
          console.warn('Failed to trigger web notification:', e);
        }
      }

    } catch (err) {
      console.error('Error executing query:', err);
      const pendingEl = document.getElementById(pendingId);
      if (pendingEl) pendingEl.remove();

      session.messages.push({
        role: 'assistant',
        text: `⚠️ **Connection Error**\n\nCould not reach the Agentic RAG API server. Please check your network connection.`,
        sources: [],
        structuredSources: { internal: [], web: [] },
        isError: true,
        timestamp: new Date().toISOString()
      });
      saveSessionsToStorage();
      renderMessagesStream(session.messages);
    }
  }


  function renderMessagesStream(messages) {
    if (!messages || messages.length === 0) {
      if (DOM.welcomeContainer) DOM.welcomeContainer.classList.remove('hidden');
      DOM.messagesStream.innerHTML = '';
      return;
    }

    if (DOM.welcomeContainer) DOM.welcomeContainer.classList.add('hidden');
    DOM.messagesStream.innerHTML = '';

    messages.forEach(msg => {
      if (msg.role === 'user') {
        const row = document.createElement('div');
        row.className = 'message-row user';
        row.innerHTML = `<div class="user-bubble">${escapeHtml(msg.text)}</div>`;
        DOM.messagesStream.appendChild(row);
      } else {
        const row = document.createElement('div');
        row.className = 'message-row assistant';

        const modeBadgeText = msg.searchMode === 'web' ? '🌐 Web Search' :
                             msg.searchMode === 'hybrid' ? '⚡ Hybrid RAG + Web' :
                             msg.searchMode === 'internal' ? '📚 Internal KB' : '✨ Auto Search';

        const sourcesHtml = buildSourcesHtml(msg.structuredSources, msg.sources);

        row.innerHTML = `
          <div class="assistant-bubble-container">
            <div class="assistant-avatar">AI</div>
            <div class="assistant-content-wrap">
              <div class="thought-pill">
                <span>${modeBadgeText}</span>
              </div>
              <div class="markdown-body">${formatMarkdown(msg.text)}</div>
              ${sourcesHtml}
            </div>
          </div>
        `;
        DOM.messagesStream.appendChild(row);
      }
    });

    scrollToBottom();
  }

  function renderPendingAssistantMessage(elementId) {
    if (DOM.welcomeContainer) DOM.welcomeContainer.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = elementId;
    row.innerHTML = `
      <div class="assistant-bubble-container">
        <div class="assistant-avatar">AI</div>
        <div class="assistant-content-wrap">
          <div class="thought-pill">
            <span class="pulse-spinner"></span>
            <span>Synthesizing answer & retrieving sources...</span>
          </div>
        </div>
      </div>
    `;
    DOM.messagesStream.appendChild(row);
    scrollToBottom();
  }

  function buildSourcesHtml(structuredSources, legacySources) {
    const internalList = (structuredSources && structuredSources.internal) || [];
    const webList = (structuredSources && structuredSources.web) || [];

    if (internalList.length === 0 && webList.length === 0 && (!legacySources || legacySources.length === 0)) {
      return '';
    }

    let pills = [];
    const seenDomains = new Set();

    // Internal document pills
    internalList.forEach(src => {
      pills.push(`
        <span class="source-badge internal" title="Internal document chunk">
          📄 ${escapeHtml(src.source)}
        </span>
      `);
    });

    // Web source pills - deduplicated by domain
    webList.forEach(w => {
      const domain = w.domain || 'web';
      if (!seenDomains.has(domain)) {
        seenDomains.add(domain);
        pills.push(`
          <a href="${escapeHtml(w.url)}" target="_blank" rel="noopener noreferrer" class="source-badge web" title="${escapeHtml(w.title)}">
            🌐 ${escapeHtml(domain)}
          </a>
        `);
      }
    });

    // Fallback legacy sources
    if (pills.length === 0 && legacySources) {
      legacySources.forEach(s => {
        pills.push(`<span class="source-badge internal">📄 ${escapeHtml(s)}</span>`);
      });
    }

    return `<div class="sources-tray">${pills.join('')}</div>`;
  }

  function renderSidebarChats() {
    DOM.chatsList.innerHTML = '';
    state.sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = `chat-item ${session.id === state.activeSessionId ? 'active' : ''}`;
      item.onclick = () => switchSession(session.id);

      item.innerHTML = `
        <span class="chat-item-title">${escapeHtml(session.title)}</span>
        <button class="chat-item-delete" title="Delete chat">&times;</button>
      `;

      item.querySelector('.chat-item-delete').onclick = (e) => deleteSession(session.id, e);
      DOM.chatsList.appendChild(item);
    });
  }

  function renderSidebarDocuments() {
    if (!state.documents || state.documents.length === 0) {
      DOM.docsCompactList.innerHTML = '<div class="doc-compact-item">No documents ingested</div>';
      return;
    }

    DOM.docsCompactList.innerHTML = '';
    state.documents.forEach(doc => {
      const item = document.createElement('div');
      item.className = 'doc-compact-item';
      item.innerHTML = `
        <span class="doc-compact-name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</span>
        <span class="doc-compact-badge">${doc.suffix.replace('.', '')}</span>
      `;
      DOM.docsCompactList.appendChild(item);
    });
  }

  function updateUserDisplay() {
    if (DOM.userAvatarInitials) DOM.userAvatarInitials.textContent = (state.userProfile.name || 'W').charAt(0).toUpperCase();
    if (DOM.userDisplayName) DOM.userDisplayName.textContent = state.userProfile.name || 'User Workspace';
    if (DOM.userRoleTag) {
      DOM.userRoleTag.textContent = state.userProfile.role;
      DOM.userRoleTag.className = `user-role-badge role-${state.userProfile.role}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Event Listeners & Interaction Handlers
  // ---------------------------------------------------------------------------
  function setupEventListeners() {
    // Sidebar toggle
    if (DOM.toggleSidebarBtn) {
      DOM.toggleSidebarBtn.addEventListener('click', () => {
        DOM.sidebar.classList.toggle('collapsed');
      });
    }

    // New Chat
    if (DOM.newChatBtn) DOM.newChatBtn.addEventListener('click', createNewSession);

    // Mode Selector Pills
    document.querySelectorAll('.mode-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.searchMode = btn.dataset.mode;
        updateWebTogglePillState();
      });
    });

    // Web Search Toggle Pill in Composer
    if (DOM.webTogglePill) {
      DOM.webTogglePill.addEventListener('click', () => {
        DOM.webTogglePill.classList.toggle('active');
        const isActive = DOM.webTogglePill.classList.contains('active');
        state.searchMode = isActive ? 'auto' : 'internal';
        
        // Update sidebar mode pill
        document.querySelectorAll('.mode-pill').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === state.searchMode);
        });
      });
    }

    // Location Permission Toggle Pill
    if (DOM.locationPermBtn) {
      DOM.locationPermBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser. Please type your location in your query.');
          return;
        }
        DOM.locationPermText.textContent = 'Locating...';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude.toFixed(2);
            const lon = pos.coords.longitude.toFixed(2);
            state.userLocation = `Lat ${lat}, Lon ${lon}`;
            DOM.locationPermBtn.classList.add('active');
            DOM.locationPermText.textContent = '📍 Enabled';
          },
          (err) => {
            console.warn('Geolocation error:', err);
            DOM.locationPermBtn.classList.remove('active');
            DOM.locationPermText.textContent = 'Location';
            alert('Location access was not granted. Please specify your city in your prompt (e.g. "What is the weather in Hyderabad?").');
          }
        );
      });
    }

    // Mock Mode Switch (Optional)
    if (DOM.mockToggle) {
      DOM.mockToggle.addEventListener('change', (e) => {
        state.isMock = e.target.checked;
        if (DOM.modeTagDisplay) DOM.modeTagDisplay.textContent = state.isMock ? 'Offline Mock' : 'Live Groq';
      });
    }


    // Reindex Trigger
    if (DOM.reindexBtn) DOM.reindexBtn.addEventListener('click', triggerReindex);

    // Textarea input resize & key events
    if (DOM.chatInput) {
      DOM.chatInput.addEventListener('input', () => {
        DOM.chatInput.style.height = 'auto';
        DOM.chatInput.style.height = Math.min(DOM.chatInput.scrollHeight, 180) + 'px';
        updateSendButtonState();
      });

      DOM.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      });
    }

    if (DOM.sendBtn) DOM.sendBtn.addEventListener('click', () => handleSendMessage());

    // Starter Suggestion Cards
    document.querySelectorAll('.suggestion-card').forEach(card => {
      card.addEventListener('click', () => {
        const query = card.dataset.query;
        const mode = card.dataset.mode || 'auto';
        if (mode) {
          state.searchMode = mode;
          document.querySelectorAll('.mode-pill').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
          });
        }
        handleSendMessage(query);
      });
    });

    // Keyboard Shortcuts (Ctrl+K / Cmd+K)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        createNewSession();
      }
    });

    // Settings Modal
    if (DOM.openSettingsHdrBtn) DOM.openSettingsHdrBtn.addEventListener('click', () => openSettingsModal());
    if (DOM.sidebarSettingsBtn) DOM.sidebarSettingsBtn.addEventListener('click', () => openSettingsModal());
    if (DOM.closeSettingsModalBtn) DOM.closeSettingsModalBtn.addEventListener('click', () => closeSettingsModal());
    if (DOM.cancelSettingsBtn) DOM.cancelSettingsBtn.addEventListener('click', () => closeSettingsModal());
    if (DOM.saveSettingsBtn) DOM.saveSettingsBtn.addEventListener('click', () => closeSettingsModal());

    // Modals
    if (DOM.sidebarUploadBtn) DOM.sidebarUploadBtn.addEventListener('click', () => openUploadModal());
    if (DOM.composerAttachBtn) DOM.composerAttachBtn.addEventListener('click', () => openUploadModal());
    if (DOM.closeUploadModalBtn) DOM.closeUploadModalBtn.addEventListener('click', () => closeUploadModal());
    if (DOM.cancelUploadBtn) DOM.cancelUploadBtn.addEventListener('click', () => closeUploadModal());

    if (DOM.userProfileTrigger) DOM.userProfileTrigger.addEventListener('click', () => openSettingsModal());
    if (DOM.closeAuthModalBtn) DOM.closeAuthModalBtn.addEventListener('click', () => closeAuthModal());
    if (DOM.cancelAuthBtn) DOM.cancelAuthBtn.addEventListener('click', () => closeAuthModal());

    setupUploadDropzone();
    setupAuthPresets();
  }

  function updateSendButtonState() {
    DOM.sendBtn.disabled = DOM.chatInput.value.trim().length === 0;
  }

  function updateWebTogglePillState() {
    DOM.webTogglePill.classList.toggle('active', state.searchMode !== 'internal');
  }

  function scrollToBottom() {
    DOM.chatViewport.scrollTop = DOM.chatViewport.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // Reindex & Upload Logic
  // ---------------------------------------------------------------------------
  async function triggerReindex() {
    DOM.reindexBtnText.textContent = 'Reindexing...';
    DOM.reindexBtn.disabled = true;

    try {
      const resp = await fetch('/reindex', {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (resp.ok) {
        const data = await resp.json();
        DOM.reindexBtnText.textContent = `Indexed ${data.chunks_indexed} chunks`;
        fetchDocuments();
      } else {
        const err = await resp.json();
        alert(`Reindex failed: ${err.detail || 'Permission denied'}`);
        DOM.reindexBtnText.textContent = 'Reindex';
      }
    } catch (e) {
      console.error(e);
      DOM.reindexBtnText.textContent = 'Reindex';
    } finally {
      setTimeout(() => {
        DOM.reindexBtnText.textContent = 'Reindex';
        DOM.reindexBtn.disabled = false;
      }, 3000);
    }
  }

  function setupUploadDropzone() {
    const dropzone = DOM.uploadDropzone;
    const fileInput = DOM.uploadFileInput;
    if (!dropzone || !fileInput) return;

    if (DOM.dropzoneBrowseBtn) {
      DOM.dropzoneBrowseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });
    }

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        setSelectedFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        setSelectedFile(fileInput.files[0]);
      }
    });

    if (DOM.submitUploadBtn) DOM.submitUploadBtn.addEventListener('click', handleFileUpload);
  }

  function setSelectedFile(file) {
    state.pendingUploadFile = file;
    if (DOM.dropzoneFilename) DOM.dropzoneFilename.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    if (DOM.submitUploadBtn) DOM.submitUploadBtn.disabled = false;
  }

  async function handleFileUpload() {
    if (!state.pendingUploadFile) return;

    // Read user selected search mode for this document
    const selectedModeRadio = document.querySelector('input[name="upload-mode"]:checked');
    if (selectedModeRadio) {
      state.searchMode = selectedModeRadio.value;
      // Synchronize UI search mode pills
      document.querySelectorAll('.mode-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === state.searchMode);
      });
      updateWebTogglePillState();
    }

    if (DOM.uploadProgressWrap) DOM.uploadProgressWrap.classList.remove('hidden');
    if (DOM.submitUploadBtn) DOM.submitUploadBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', state.pendingUploadFile);

    const shouldReindex = DOM.uploadReindexToggle ? DOM.uploadReindexToggle.checked : true;
    const reindexParam = `?reindex=${shouldReindex}`;

    try {
      const resp = await fetch(`/upload${reindexParam}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.authToken}`
        },
        body: formData
      });

      if (resp.ok) {
        const data = await resp.json();
        closeUploadModal();
        fetchDocuments();
        
        // Show clean assistant notification in chat
        const session = state.sessions.find(s => s.id === state.activeSessionId);
        if (session) {
          session.messages.push({
            role: 'assistant',
            text: `📄 **Document Attached & Ingested**: \`${data.filename}\` (${data.chunks_indexed} chunks indexed)\n\nSearch mode set to **${state.searchMode.toUpperCase()}**. You can now ask questions about this document!`,
            sources: [],
            structuredSources: { internal: [], web: [] },
            timestamp: new Date().toISOString()
          });
          saveSessionsToStorage();
          renderMessagesStream(session.messages);
        }
      } else {
        const err = await resp.json();
        alert(`Upload failed: ${err.detail || 'Error uploading document'}`);
      }
    } catch (e) {
      console.error(e);
      alert('Upload failed due to network error.');
    } finally {
      if (DOM.uploadProgressWrap) DOM.uploadProgressWrap.classList.add('hidden');
      if (DOM.submitUploadBtn) DOM.submitUploadBtn.disabled = false;
    }
  }


  function openUploadModal() {
    if (DOM.uploadModal) DOM.uploadModal.classList.remove('hidden');
  }
  function closeUploadModal() {
    if (DOM.uploadModal) DOM.uploadModal.classList.add('hidden');
    state.pendingUploadFile = null;
    if (DOM.dropzoneFilename) DOM.dropzoneFilename.textContent = 'No file selected';
    if (DOM.submitUploadBtn) DOM.submitUploadBtn.disabled = true;
  }

  // ---------------------------------------------------------------------------
  // Auth Modal Logic
  // ---------------------------------------------------------------------------
  function setupAuthPresets() {
    if (DOM.authPresetItems) {
      DOM.authPresetItems.forEach(item => {
        item.addEventListener('click', () => {
          DOM.authPresetItems.forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          state.authToken = item.dataset.key;
          if (DOM.customTokenInput) DOM.customTokenInput.value = '';
        });
      });
    }

    if (DOM.saveAuthBtn) {
      DOM.saveAuthBtn.addEventListener('click', () => {
        const customVal = DOM.customTokenInput ? DOM.customTokenInput.value.trim() : '';
        if (customVal) {
          state.authToken = customVal;
        }
        localStorage.setItem(AUTH_STORAGE_KEY, state.authToken);
        fetchUserProfile();
        closeAuthModal();
      });
    }
  }

  function openAuthModal() { if (DOM.authModal) DOM.authModal.classList.remove('hidden'); }
  function closeAuthModal() { if (DOM.authModal) DOM.authModal.classList.add('hidden'); }

  function openSettingsModal() { if (DOM.settingsModal) DOM.settingsModal.classList.remove('hidden'); }
  function closeSettingsModal() { if (DOM.settingsModal) DOM.settingsModal.classList.add('hidden'); }

  // ---------------------------------------------------------------------------
  // Banner Helpers
  // ---------------------------------------------------------------------------
  function showGuardrailAlert(type, reason) {
    DOM.guardrailReason.textContent = `${type}: ${reason}`;
    DOM.guardrailBanner.classList.remove('hidden');
  }

  function startRateLimitCountdown(seconds, msg) {
    DOM.rateLimitMessage.textContent = msg;
    DOM.rateLimitBanner.classList.remove('hidden');

    let remaining = seconds;
    DOM.countdownTimer.textContent = `${remaining}s`;

    if (state.countdownTimerId) clearInterval(state.countdownTimerId);

    state.countdownTimerId = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(state.countdownTimerId);
        DOM.rateLimitBanner.classList.add('hidden');
      } else {
        DOM.countdownTimer.textContent = `${remaining}s`;
      }
    }, 1000);
  }

  function hideBanners() {
    DOM.guardrailBanner.classList.add('hidden');
    DOM.rateLimitBanner.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Formatting Utilities
  // ---------------------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMarkdown(text) {
    if (!text) return '';
    // Strip trailing raw markdown URL badges before rendering
    text = text.replace(/(?:\[🌐\s*[^\]]+\]\([^\)]+\)\s*){2,}/g, '').trim();
    let html = escapeHtml(text);

    // Fenced Code Blocks ```lang \n code ```
    html = html.replace(/```([a-zA-Z0-9_\-\+]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const language = (lang || 'code').toUpperCase();
      const rawCode = code.trim();
      return `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <span class="code-lang-tag">${language}</span>
            <button class="copy-code-btn" data-code="${escapeHtml(rawCode)}" onclick="copyCodeToClipboard(this)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy</span>
            </button>
          </div>
          <pre><code>${rawCode}</code></pre>
        </div>
      `;
    });

    // Inline code `code`
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Markdown Links [title](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Bullet lists
    html = html.replace(/^\s*[\-\*]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Paragraph splits
    return html.split('\n\n').map(p => {
      if (p.startsWith('<div class="code-block-wrapper">') || p.startsWith('<ul>') || p.startsWith('<li>')) return p;
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  window.copyCodeToClipboard = function(btn) {
    const code = btn.getAttribute('data-code');
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      const span = btn.querySelector('span');
      if (span) {
        const orig = span.textContent;
        span.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          span.textContent = orig;
          btn.classList.remove('copied');
        }, 2000);
      }
    }).catch(err => {
      console.error('Failed to copy code:', err);
    });
  };

  // Initialize App on DOM Load
  document.addEventListener('DOMContentLoaded', init);
})();

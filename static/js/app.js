/**
 * Agentic RAG Pipeline — Modern Production Frontend Engine
 * Real features: Multi-session management, Knowledge Base document explorer,
 * search modes (Auto / Hybrid / Internal / Web), file ingestion, and 24/7 keep-alive.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Application State
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'agentic_rag_sessions_v2';
  const AUTH_STORAGE_KEY = 'agentic_rag_auth_token';

  let state = {
    searchMode: 'auto', // 'auto' | 'hybrid' | 'internal' | 'web'
    isMock: false,
    authToken: localStorage.getItem(AUTH_STORAGE_KEY) || 'demo-team-admin-key-not-for-production',
    sessions: [],
    activeSessionId: null,
    documents: [],
    pendingUploadFile: null,
    config: null,
    heartbeatTimer: null
  };

  // ---------------------------------------------------------------------------
  // DOM Elements (Safe Resolution)
  // ---------------------------------------------------------------------------
  const DOM = {
    sidebar: document.getElementById('sidebar'),
    toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),
    newChatBtn: document.getElementById('new-chat-btn'),
    chatsList: document.getElementById('chats-list'),
    docsCompactList: document.getElementById('docs-compact-list'),
    docCounter: document.getElementById('doc-counter'),
    sidebarUploadBtn: document.getElementById('sidebar-upload-btn'),
    reindexBtn: document.getElementById('reindex-button'),
    reindexBtnText: document.getElementById('reindex-button-text'),

    activeChatTitle: document.getElementById('active-chat-title'),
    backendStatusDot: document.getElementById('backend-status-dot'),
    backendStatusText: document.getElementById('backend-status-text'),
    providerChainText: document.getElementById('provider-chain-text'),
    modeTagDisplay: document.getElementById('mode-tag-display'),

    chatViewport: document.getElementById('chat-viewport'),
    welcomeContainer: document.getElementById('welcome-container'),
    messagesStream: document.getElementById('messages-stream'),

    rateLimitBanner: document.getElementById('rate-limit-banner'),
    rateLimitMessage: document.getElementById('rate-limit-message'),
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
    uploadProgressBar: document.getElementById('upload-progress-bar')
  };

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  function init() {
    loadSessionsFromStorage();
    setupEventListeners();
    checkHealth();
    fetchSystemConfig();
    fetchDocuments();
    startClientHeartbeat();

    if (state.sessions.length === 0) {
      createNewSession();
    } else {
      switchSession(state.sessions[0].id);
    }
  }

  // ---------------------------------------------------------------------------
  // 24/7 Client-Side Heartbeat (Keeps Render Server Active While Browser is Open)
  // ---------------------------------------------------------------------------
  function startClientHeartbeat() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    // Ping every 3 minutes so server never sleeps while user is on page
    state.heartbeatTimer = setInterval(() => {
      checkHealth();
    }, 180000);
  }

  // ---------------------------------------------------------------------------
  // Health & Config Calls
  // ---------------------------------------------------------------------------
  async function checkHealth() {
    try {
      const startMs = Date.now();
      const resp = await fetch('/health');
      const latencyMs = Date.now() - startMs;
      if (resp.ok) {
        if (DOM.backendStatusDot) DOM.backendStatusDot.className = 'status-dot online';
        if (DOM.backendStatusText) DOM.backendStatusText.textContent = `Connected (${latencyMs}ms)`;
      } else {
        if (DOM.backendStatusDot) DOM.backendStatusDot.className = 'status-dot offline';
        if (DOM.backendStatusText) DOM.backendStatusText.textContent = 'Degraded';
      }
    } catch (e) {
      if (DOM.backendStatusDot) DOM.backendStatusDot.className = 'status-dot offline';
      if (DOM.backendStatusText) DOM.backendStatusText.textContent = 'Reconnecting...';
    }
  }

  async function fetchSystemConfig() {
    try {
      const resp = await fetch('/config');
      if (resp.ok) {
        const config = await resp.json();
        state.config = config;
        if (DOM.providerChainText && config.active_providers && config.active_providers.length > 0) {
          DOM.providerChainText.textContent = config.active_providers.map(p => p.toUpperCase()).join(' → ');
        }
        if (DOM.modeTagDisplay) {
          DOM.modeTagDisplay.textContent = config.is_live_ready ? 'Live Groq / Gemini' : 'Local Fallback Engine';
        }
      }
    } catch (e) {
      console.warn('System config fetch non-critical warning:', e);
    }
  }

  async function fetchDocuments() {
    try {
      const resp = await fetch('/documents', {
        headers: getAuthHeaders()
      });
      if (resp.ok) {
        const data = await resp.json();
        state.documents = data.documents || [];
        renderSidebarDocuments();
      }
    } catch (e) {
      console.warn('Documents fetch warning:', e);
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

    if (DOM.activeChatTitle) DOM.activeChatTitle.textContent = session.title;
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
  // API Requests & Execution Loop
  // ---------------------------------------------------------------------------
  function getAuthHeaders() {
    return {
      'Authorization': `Bearer ${state.authToken}`,
      'Content-Type': 'application/json'
    };
  }

  async function sendQueryToAgent(userQuery) {
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session) return;

    // Multi-turn context: take last 6 messages
    const history = session.messages.slice(-6).map(m => ({
      role: m.role,
      content: m.text
    }));

    const body = {
      query: userQuery,
      conversation_history: history,
      search_mode: state.searchMode
    };

    const response = await fetch('/query', {
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
        validation: { is_grounded: false, confidence: 0, reasoning: detail.reason || 'Guardrail flagged' }
      };
    } else if (response.status === 429) {
      const errData = await response.json();
      return {
        is_error: true,
        error_type: 'rate_limit',
        answer: `⚠️ **Rate Limit Exceeded**\n\n${errData.message || 'Upstream provider capacity reached. Please wait a moment and retry.'}`,
        sources: [],
        structured_sources: { internal: [], web: [] }
      };
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errText}`);
    }

    return await response.json();
  }

  async function handleSendMessage(customPrompt) {
    const promptText = (customPrompt || (DOM.chatInput ? DOM.chatInput.value : '')).trim();
    if (!promptText) return;

    if (!customPrompt && DOM.chatInput) {
      DOM.chatInput.value = '';
      DOM.chatInput.style.height = 'auto';
      updateSendButtonState();
    }

    const session = state.sessions.find(s => s.id === state.activeSessionId);
    if (!session) return;

    // Auto-title session from first query
    if (session.messages.length === 0) {
      session.title = promptText.length > 28 ? promptText.substring(0, 28) + '...' : promptText;
      if (DOM.activeChatTitle) DOM.activeChatTitle.textContent = session.title;
      renderSidebarChats();
    }

    // 1. Append User Message
    const userMsg = { role: 'user', text: promptText, timestamp: new Date().toISOString() };
    session.messages.push(userMsg);
    saveSessionsToStorage();
    renderMessagesStream(session.messages);

    // 2. Append Pending Assistant Shell
    const pendingId = 'msg_' + Date.now();
    renderPendingAssistantMessage(pendingId);

    try {
      // 3. Query Backend
      const responseData = await sendQueryToAgent(promptText);

      // Remove pending animation
      const pendingEl = document.getElementById(pendingId);
      if (pendingEl) pendingEl.remove();

      // 4. Append Assistant Message
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

    } catch (err) {
      console.error('Query execution error:', err);
      const pendingEl = document.getElementById(pendingId);
      if (pendingEl) pendingEl.remove();

      session.messages.push({
        role: 'assistant',
        text: `⚠️ **Connection Error**\n\nCould not reach the RAG API server. The server may be warming up or reconnecting. Please retry in a few seconds.`,
        sources: [],
        structuredSources: { internal: [], web: [] },
        isError: true,
        timestamp: new Date().toISOString()
      });
      saveSessionsToStorage();
      renderMessagesStream(session.messages);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering Methods
  // ---------------------------------------------------------------------------
  function renderSidebarChats() {
    if (!DOM.chatsList) return;
    DOM.chatsList.innerHTML = '';
    state.sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = `chat-item ${session.id === state.activeSessionId ? 'active' : ''}`;
      item.onclick = () => switchSession(session.id);

      item.innerHTML = `
        <span class="chat-item-title">${escapeHtml(session.title)}</span>
        <button class="chat-item-delete" title="Delete conversation">&times;</button>
      `;

      const delBtn = item.querySelector('.chat-item-delete');
      if (delBtn) delBtn.onclick = (e) => deleteSession(session.id, e);
      DOM.chatsList.appendChild(item);
    });
  }

  function renderSidebarDocuments() {
    if (DOM.docCounter) {
      DOM.docCounter.textContent = `${state.documents.length} files`;
    }
    if (!DOM.docsCompactList) return;

    if (!state.documents || state.documents.length === 0) {
      DOM.docsCompactList.innerHTML = '<div class="doc-empty-state">No documents indexed. Click Upload to add.</div>';
      return;
    }

    DOM.docsCompactList.innerHTML = '';
    state.documents.forEach(doc => {
      const item = document.createElement('div');
      item.className = 'doc-compact-item';
      const cleanExt = (doc.suffix || '').replace('.', '').toUpperCase();
      const kbSize = doc.size_bytes ? `${(doc.size_bytes / 1024).toFixed(1)} KB` : '';

      item.innerHTML = `
        <div class="doc-item-main">
          <span class="doc-ext-badge ext-${cleanExt.toLowerCase()}">${cleanExt}</span>
          <span class="doc-compact-name" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</span>
        </div>
        <span class="doc-item-size">${kbSize}</span>
      `;

      // Clicking a document loads a quick prompt about it into the input
      item.onclick = () => {
        if (DOM.chatInput) {
          DOM.chatInput.value = `Explain the key points and details in ${doc.filename}.`;
          DOM.chatInput.focus();
          updateSendButtonState();
        }
      };

      DOM.docsCompactList.appendChild(item);
    });
  }

  function renderMessagesStream(messages) {
    if (!DOM.messagesStream) return;

    if (!messages || messages.length === 0) {
      if (DOM.welcomeContainer) DOM.welcomeContainer.classList.remove('hidden');
      DOM.messagesStream.innerHTML = '';
      return;
    }

    if (DOM.welcomeContainer) DOM.welcomeContainer.classList.add('hidden');
    DOM.messagesStream.innerHTML = '';

    messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        const row = document.createElement('div');
        row.className = 'message-row user';
        row.innerHTML = `
          <div class="user-bubble">
            <div class="bubble-text">${escapeHtml(msg.text)}</div>
          </div>
        `;
        DOM.messagesStream.appendChild(row);
      } else {
        const row = document.createElement('div');
        row.className = 'message-row assistant';

        const modeBadgeText = msg.searchMode === 'web' ? '🌐 Live Web Search' :
                             msg.searchMode === 'hybrid' ? '⚡ Hybrid RAG' :
                             msg.searchMode === 'internal' ? '📚 Knowledge Base Only' : '✨ Dynamic Agentic Search';

        const sourcesHtml = buildSourcesHtml(msg.structuredSources, msg.sources);
        const uniqueCopyId = `copy_msg_${idx}`;

        row.innerHTML = `
          <div class="assistant-bubble-container">
            <div class="assistant-avatar">AI</div>
            <div class="assistant-content-wrap">
              <div class="assistant-meta-bar">
                <span class="thought-pill">${modeBadgeText}</span>
                <button class="btn-copy-msg" data-text="${escapeHtml(msg.text)}" onclick="copyMessageText(this)" title="Copy entire response">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span>Copy</span>
                </button>
              </div>

              <div class="assistant-markdown-body">${formatMarkdown(msg.text)}</div>
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
    if (!DOM.messagesStream) return;
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = elementId;
    row.innerHTML = `
      <div class="assistant-bubble-container">
        <div class="assistant-avatar">AI</div>
        <div class="assistant-content-wrap">
          <div class="thought-pill running">
            <span class="pulse-spinner"></span>
            <span>Retrieving knowledge base evidence & synthesizing response...</span>
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
        <span class="source-badge internal" title="Internal knowledge base chunk">
          📄 ${escapeHtml(src.source)}
        </span>
      `);
    });

    // Web source pills
    webList.forEach(w => {
      const domain = w.domain || 'web';
      if (!seenDomains.has(domain)) {
        seenDomains.add(domain);
        pills.push(`
          <a href="${escapeHtml(w.url)}" target="_blank" rel="noopener noreferrer" class="source-badge web" title="${escapeHtml(w.title || domain)}">
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

    return `
      <div class="sources-tray">
        <span class="sources-label">Citations & Sources:</span>
        <div class="sources-list">${pills.join('')}</div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Reindex & Upload Logic (Real Backend Handlers)
  // ---------------------------------------------------------------------------
  async function triggerReindex() {
    if (DOM.reindexBtnText) DOM.reindexBtnText.textContent = 'Reindexing...';
    if (DOM.reindexBtn) DOM.reindexBtn.disabled = true;

    try {
      const resp = await fetch('/reindex', {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (resp.ok) {
        const data = await resp.json();
        if (DOM.reindexBtnText) DOM.reindexBtnText.textContent = `Indexed ${data.chunks_indexed} chunks!`;
        fetchDocuments();
      } else {
        const err = await resp.json();
        alert(`Reindex failed: ${err.detail || 'Permission denied'}`);
        if (DOM.reindexBtnText) DOM.reindexBtnText.textContent = 'Reindex KB';
      }
    } catch (e) {
      console.error(e);
      if (DOM.reindexBtnText) DOM.reindexBtnText.textContent = 'Reindex KB';
    } finally {
      setTimeout(() => {
        if (DOM.reindexBtnText) DOM.reindexBtnText.textContent = 'Reindex KB';
        if (DOM.reindexBtn) DOM.reindexBtn.disabled = false;
      }, 3500);
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

        const session = state.sessions.find(s => s.id === state.activeSessionId);
        if (session) {
          session.messages.push({
            role: 'assistant',
            text: `📄 **Document Ingested Successfully**\n\n- File: \`${data.filename}\`\n- Size: \`${(data.size_bytes / 1024).toFixed(1)} KB\`\n- Chunks Indexed: \`${data.chunks_indexed}\`\n\nThe vector knowledge base has been updated. You can now ask any question regarding this document!`,
            sources: [data.filename],
            structuredSources: { internal: [{ source: data.filename }], web: [] },
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
    if (DOM.uploadModal) {
      DOM.uploadModal.classList.remove('hidden');
      state.pendingUploadFile = null;
      if (DOM.dropzoneFilename) DOM.dropzoneFilename.textContent = 'No file selected';
      if (DOM.submitUploadBtn) DOM.submitUploadBtn.disabled = true;
    }
  }

  function closeUploadModal() {
    if (DOM.uploadModal) DOM.uploadModal.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Event Listeners & Interaction Handlers
  // ---------------------------------------------------------------------------
  function setupEventListeners() {
    // Sidebar toggle
    if (DOM.toggleSidebarBtn && DOM.sidebar) {
      DOM.toggleSidebarBtn.addEventListener('click', () => {
        DOM.sidebar.classList.toggle('collapsed');
      });
    }

    // New Chat
    if (DOM.newChatBtn) DOM.newChatBtn.addEventListener('click', createNewSession);

    // Search Mode Selector Buttons (Auto, Hybrid, Internal Only, Web Search)
    document.querySelectorAll('.mode-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.searchMode = btn.dataset.mode || 'auto';
        updateWebTogglePillState();
      });
    });

    // Web Search Toggle Pill in Composer
    if (DOM.webTogglePill) {
      DOM.webTogglePill.addEventListener('click', () => {
        DOM.webTogglePill.classList.toggle('active');
        const isActive = DOM.webTogglePill.classList.contains('active');
        state.searchMode = isActive ? 'auto' : 'internal';

        document.querySelectorAll('.mode-pill').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === state.searchMode);
        });
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

    // Suggestion Chips (Grounded in real documents)
    document.querySelectorAll('.suggestion-chip').forEach(card => {
      card.addEventListener('click', () => {
        const query = card.dataset.query;
        const mode = card.dataset.mode || 'auto';
        if (mode) {
          state.searchMode = mode;
          document.querySelectorAll('.mode-pill').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
          });
          updateWebTogglePillState();
        }
        handleSendMessage(query);
      });
    });

    // Keyboard Shortcuts (Ctrl+K)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        createNewSession();
      }
    });

    // Upload Modal Triggers
    if (DOM.sidebarUploadBtn) DOM.sidebarUploadBtn.addEventListener('click', openUploadModal);
    if (DOM.composerAttachBtn) DOM.composerAttachBtn.addEventListener('click', openUploadModal);
    if (DOM.closeUploadModalBtn) DOM.closeUploadModalBtn.addEventListener('click', closeUploadModal);
    if (DOM.cancelUploadBtn) DOM.cancelUploadBtn.addEventListener('click', closeUploadModal);

    // Guardrail Alert Close
    if (DOM.closeGuardrailBtn) {
      DOM.closeGuardrailBtn.addEventListener('click', () => {
        if (DOM.guardrailBanner) DOM.guardrailBanner.classList.add('hidden');
      });
    }

    setupUploadDropzone();
  }

  function updateSendButtonState() {
    if (!DOM.sendBtn || !DOM.chatInput) return;
    DOM.sendBtn.disabled = DOM.chatInput.value.trim().length === 0;
  }

  function updateWebTogglePillState() {
    if (!DOM.webTogglePill) return;
    DOM.webTogglePill.classList.toggle('active', state.searchMode !== 'internal');
  }

  function scrollToBottom() {
    if (DOM.chatViewport) {
      DOM.chatViewport.scrollTop = DOM.chatViewport.scrollHeight;
    }
  }

  // ---------------------------------------------------------------------------
  // Markdown & Utility Formatting
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
    text = text.replace(/(?:\[🌐\s*[^\]]+\]\([^\)]+\)\s*){2,}/g, '').trim();
    let html = escapeHtml(text);

    // Code Blocks
    html = html.replace(/```([a-zA-Z0-9_\-\+]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const language = (lang || 'code').toUpperCase();
      const rawCode = code.trim();
      return `
        <div class="code-block-card">
          <div class="code-block-header">
            <span class="code-lang-tag">${language}</span>
            <button class="copy-code-btn" data-code="${escapeHtml(rawCode)}" onclick="copyCodeToClipboard(this)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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

    // Inline Code
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Markdown Links
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.*$)/gim, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.*$)/gim, '<h2 class="md-h2">$1</h2>');

    // Bullet Lists
    html = html.replace(/^\s*[\-\*]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul class="md-list">$1</ul>');

    // Paragraph splits
    return html.split('\n\n').map(p => {
      if (p.startsWith('<div class="code-block-card">') || p.startsWith('<ul') || p.startsWith('<h2') || p.startsWith('<h3') || p.startsWith('<h4')) {
        return p;
      }
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
    }).catch(err => console.error('Copy error:', err));
  };

  window.copyMessageText = function(btn) {
    const text = btn.getAttribute('data-text');
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
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
    }).catch(err => console.error('Copy error:', err));
  };

  document.addEventListener('DOMContentLoaded', init);
})();

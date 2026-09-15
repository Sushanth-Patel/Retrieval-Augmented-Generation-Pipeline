/**
 * Agentic RAG Pipeline - Production Web Application Logic
 * Implements real-time rate limit cooldown countdown, RBAC identity management,
 * guardrail violation interception, and groundedness audit visualization.
 */

(function () {
  'use strict';

  // State
  const state = {
    activeToken: 'demo-team-admin-key-not-for-production',
    currentUser: 'alice_admin',
    currentRoles: ['admin', 'operator', 'reader'],
    isMockMode: false,
    isCooldownActive: false,
    cooldownInterval: null,
    cooldownRemaining: 0,
    cooldownTotal: 30,
    conversationHistory: []
  };

  // Pre-configured team tokens
  const TEAM_PRESETS = {
    'demo-team-admin-key-not-for-production': {
      userId: 'alice_admin',
      roles: ['admin', 'operator', 'reader'],
      label: 'admin'
    },
    'demo-team-engineer-key-not-for-production': {
      userId: 'bob_engineer',
      roles: ['operator', 'reader'],
      label: 'operator'
    },
    'demo-team-readonly-key-not-for-production': {
      userId: 'charlie_intern',
      roles: ['reader'],
      label: 'reader'
    }
  };

  // DOM Elements
  const el = {
    backendStatusPill: document.getElementById('backend-status-pill'),
    backendStatusDot: document.getElementById('backend-status-dot'),
    backendStatusText: document.getElementById('backend-status-text'),
    userIdentitySelect: document.getElementById('user-identity-select'),
    userRoleBadge: document.getElementById('user-role-badge'),
    mockToggle: document.getElementById('mock-toggle'),
    modeTagDisplay: document.getElementById('mode-tag-display'),
    reindexButton: document.getElementById('reindex-button'),
    reindexButtonText: document.getElementById('reindex-button-text'),
    reindexIcon: document.getElementById('reindex-icon'),
    customTokenModal: document.getElementById('custom-token-modal'),
    customTokenInput: document.getElementById('custom-token-input'),
    saveTokenBtn: document.getElementById('save-token-btn'),
    cancelTokenBtn: document.getElementById('cancel-token-btn'),
    rateLimitBanner: document.getElementById('rate-limit-banner'),
    rateLimitMessage: document.getElementById('rate-limit-message'),
    countdownTimer: document.getElementById('countdown-timer'),
    countdownProgressBar: document.getElementById('countdown-progress-bar'),
    guardrailAlertBanner: document.getElementById('guardrail-alert-banner'),
    guardrailViolationType: document.getElementById('guardrail-violation-type'),
    guardrailViolationReason: document.getElementById('guardrail-violation-reason'),
    closeGuardrailBtn: document.getElementById('close-guardrail-btn'),
    chatContainer: document.getElementById('chat-container'),
    messagesList: document.getElementById('messages-list'),
    welcomeCard: document.getElementById('welcome-card'),
    queryInput: document.getElementById('query-input'),
    sendButton: document.getElementById('send-button'),
    sendBtnText: document.getElementById('send-btn-text'),
    clearChatButton: document.getElementById('clear-chat-button'),
    identityFooterHint: document.getElementById('identity-footer-hint'),
    // Upload controls
    uploadButton: document.getElementById('upload-button'),
    uploadModal: document.getElementById('upload-modal'),
    uploadDropzone: document.getElementById('upload-dropzone'),
    uploadFileInput: document.getElementById('upload-file-input'),
    dropzoneBrowseBtn: document.getElementById('dropzone-browse-btn'),
    dropzoneFilename: document.getElementById('dropzone-filename'),
    uploadReindexToggle: document.getElementById('upload-reindex-toggle'),
    uploadProgressWrap: document.getElementById('upload-progress-wrap'),
    uploadProgressBar: document.getElementById('upload-progress-bar'),
    uploadProgressLabel: document.getElementById('upload-progress-label'),
    cancelUploadBtn: document.getElementById('cancel-upload-btn'),
    submitUploadBtn: document.getElementById('submit-upload-btn')
  };

  // --------------------------------------------------------------------------
  // Initialization & Backend Liveness
  // --------------------------------------------------------------------------
  async function init() {
    setupEventListeners();
    updateRoleUI();
    await checkHealth();
    await verifyAuthProfile();
  }

  async function checkHealth() {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        const data = await res.json();
        el.backendStatusDot.classList.add('online');
        el.backendStatusText.textContent = `API Ready (v${data.version})`;
      } else {
        el.backendStatusText.textContent = 'API Error';
      }
    } catch (e) {
      el.backendStatusText.textContent = 'Offline';
    }
  }

  // --------------------------------------------------------------------------
  // Identity & Role Management
  // --------------------------------------------------------------------------
  async function verifyAuthProfile() {
    try {
      const res = await fetch('/auth/me', {
        headers: {
          'Authorization': `Bearer ${state.activeToken}`
        }
      });
      if (res.ok) {
        const profile = await res.json();
        state.currentUser = profile.user_id;
        state.currentRoles = profile.roles || ['reader'];
        updateRoleUI();
      } else if (res.status === 401) {
        showToast('Unauthorized: Invalid or expired Bearer token.', 'error');
      }
    } catch (e) {
      console.warn('Auth verification skipped (fallback to local state):', e);
    }
  }

  function updateRoleUI() {
    const isReader = !state.currentRoles.includes('admin') && !state.currentRoles.includes('operator');
    const roleName = state.currentRoles.includes('admin') ? 'admin' : (state.currentRoles.includes('operator') ? 'operator' : 'reader');

    el.userRoleBadge.textContent = roleName;
    el.userRoleBadge.className = `role-badge role-${roleName}`;
    el.identityFooterHint.textContent = `Authenticated as: ${state.currentUser} (${roleName})`;

    // Configure Reindex Button permission state
    if (isReader) {
      el.reindexButton.disabled = true;
      el.reindexButton.title = 'Reindex requires operator or admin role (disabled for reader)';
      el.uploadButton.disabled = true;
      el.uploadButton.title = 'Upload requires operator or admin role (disabled for reader)';
    } else {
      el.reindexButton.disabled = false;
      el.reindexButton.title = 'Reindex knowledge base vector store';
      el.uploadButton.disabled = false;
      el.uploadButton.title = 'Upload a new document (.md, .txt, .json) into the knowledge base';
    }
  }

  function handleUserSelectChange(e) {
    const val = e.target.value;
    if (val === 'custom') {
      el.customTokenModal.classList.remove('hidden');
      el.customTokenInput.focus();
    } else if (TEAM_PRESETS[val]) {
      state.activeToken = val;
      state.currentUser = TEAM_PRESETS[val].userId;
      state.currentRoles = TEAM_PRESETS[val].roles;
      updateRoleUI();
      verifyAuthProfile();
    }
  }

  // --------------------------------------------------------------------------
  // Event Listeners Setup
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Identity selection
    el.userIdentitySelect.addEventListener('change', handleUserSelectChange);

    // Custom Token Modal actions
    el.cancelTokenBtn.addEventListener('click', () => {
      el.customTokenModal.classList.add('hidden');
      el.userIdentitySelect.value = state.activeToken;
    });

    el.saveTokenBtn.addEventListener('click', () => {
      const customKey = el.customTokenInput.value.trim();
      if (customKey) {
        state.activeToken = customKey;
        el.customTokenModal.classList.add('hidden');
        verifyAuthProfile();
      }
    });

    // Mock Mode Toggle
    el.mockToggle.addEventListener('change', (e) => {
      state.isMockMode = e.target.checked;
      el.modeTagDisplay.textContent = state.isMockMode ? 'Mock Local' : 'Live Groq';
      el.modeTagDisplay.style.color = state.isMockMode ? 'var(--accent-purple)' : 'var(--primary-color)';
    });

    // Reindex Button
    el.reindexButton.addEventListener('click', triggerReindex);

    // Guardrail Alert Close
    el.closeGuardrailBtn.addEventListener('click', () => {
      el.guardrailAlertBanner.classList.add('hidden');
    });

    // Chat Form Submit
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      handleSendQuery();
    });

    // Textarea Enter key handler
    el.queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendQuery();
      }
    });

    // Auto-expand textarea
    el.queryInput.addEventListener('input', () => {
      el.queryInput.style.height = 'auto';
      el.queryInput.style.height = `${Math.min(el.queryInput.scrollHeight, 150)}px`;
    });

    // Starter queries click
    document.querySelectorAll('.starter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const queryText = btn.getAttribute('data-query');
        if (queryText) {
          el.queryInput.value = queryText;
          handleSendQuery();
        }
      });
    });

    // Clear chat
    el.clearChatButton.addEventListener('click', () => {
      state.conversationHistory = [];
      el.messagesList.innerHTML = '';
      if (el.welcomeCard) {
        el.messagesList.appendChild(el.welcomeCard);
      }
    });

    // Upload button opens modal
    el.uploadButton.addEventListener('click', () => {
      if (!el.uploadButton.disabled) {
        el.uploadModal.classList.remove('hidden');
        state.pendingUploadFile = null;
        el.dropzoneFilename.textContent = 'No file selected';
        el.submitUploadBtn.disabled = true;
        el.uploadProgressWrap.classList.add('hidden');
      }
    });

    el.cancelUploadBtn.addEventListener('click', () => {
      el.uploadModal.classList.add('hidden');
      el.uploadFileInput.value = '';
    });

    // File browse button
    el.dropzoneBrowseBtn.addEventListener('click', () => el.uploadFileInput.click());

    // File selected via input
    el.uploadFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) selectUploadFile(file);
    });

    // Drag and drop on dropzone
    el.uploadDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.uploadDropzone.classList.add('dragover');
    });
    el.uploadDropzone.addEventListener('dragleave', () => {
      el.uploadDropzone.classList.remove('dragover');
    });
    el.uploadDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.uploadDropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) selectUploadFile(file);
    });

    // Submit upload
    el.submitUploadBtn.addEventListener('click', handleUploadDocument);

    // Click-outside-to-dismiss for upload modal (click on overlay backdrop, not the card)
    el.uploadModal.addEventListener('click', (e) => {
      if (e.target === el.uploadModal) {
        el.uploadModal.classList.add('hidden');
        el.uploadFileInput.value = '';
      }
    });

    // Escape key closes any open modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        el.uploadModal.classList.add('hidden');
        el.customTokenModal.classList.add('hidden');
        el.uploadFileInput.value = '';
      }
    });
  }

  // --------------------------------------------------------------------------
  // Rate Limit (429) Handling with Real-Time Countdown
  // --------------------------------------------------------------------------
  function triggerRateLimitCooldown(retryAfterSeconds, detailMessage) {
    state.isCooldownActive = true;
    state.cooldownTotal = Math.max(Math.ceil(retryAfterSeconds || 30), 5);
    state.cooldownRemaining = state.cooldownTotal;

    // Show banner and update text
    el.rateLimitBanner.classList.remove('hidden');
    el.rateLimitMessage.textContent = detailMessage || 
      'Another request is currently using the Groq free-tier 7,200 TPM ceiling. Pacing requests to preserve quota...';
    
    // Disable send button
    el.sendButton.disabled = true;
    el.queryInput.disabled = true;

    updateCooldownUI();

    if (state.cooldownInterval) {
      clearInterval(state.cooldownInterval);
    }

    state.cooldownInterval = setInterval(() => {
      state.cooldownRemaining -= 1;
      updateCooldownUI();

      if (state.cooldownRemaining <= 0) {
        clearInterval(state.cooldownInterval);
        state.isCooldownActive = false;
        el.rateLimitBanner.classList.add('hidden');
        el.sendButton.disabled = false;
        el.queryInput.disabled = false;
        el.queryInput.focus();
      }
    }, 1000);
  }

  function updateCooldownUI() {
    el.countdownTimer.textContent = `${state.cooldownRemaining}s`;
    const percentage = (state.cooldownRemaining / state.cooldownTotal) * 100;
    el.countdownProgressBar.style.width = `${percentage}%`;
  }

  // --------------------------------------------------------------------------
  // Send Query Flow
  // --------------------------------------------------------------------------
  async function handleSendQuery() {
    const query = el.queryInput.value.trim();
    if (!query || state.isCooldownActive) return;

    // Reset input
    el.queryInput.value = '';
    el.queryInput.style.height = 'auto';
    el.guardrailAlertBanner.classList.add('hidden');

    // Remove welcome card if still visible
    if (el.welcomeCard && el.welcomeCard.parentNode) {
      el.welcomeCard.parentNode.removeChild(el.welcomeCard);
    }

    // Append User Message Bubble
    appendUserMessage(query);

    // Append Shimmer Skeleton Loading Bubble
    const loadingId = 'loading-' + Date.now();
    appendLoadingShimmer(loadingId);
    scrollToBottom();

    // Set send button state
    el.sendButton.disabled = true;
    el.sendBtnText.textContent = 'Thinking...';

    const startTime = performance.now();
    const endpoint = state.isMockMode ? '/query?mock=true' : '/query';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.activeToken}`
        },
        body: JSON.stringify({
          query: query,
          conversation_history: state.conversationHistory
        })
      });

      const elapsedSec = ((performance.now() - startTime) / 1000).toFixed(2);
      removeLoadingShimmer(loadingId);

      // 1. Handle Rate Limit Exceeded (HTTP 429)
      if (response.status === 429) {
        const retryHeader = response.headers.get('Retry-After');
        let retrySeconds = retryHeader ? parseFloat(retryHeader) : 30;
        let detailMsg = '';
        try {
          const errData = await response.json();
          detailMsg = errData.message || errData.detail;
          if (errData.retry_after) retrySeconds = errData.retry_after;
        } catch (e) {}

        triggerRateLimitCooldown(retrySeconds, detailMsg);
        appendSystemNotice(
          'Rate Limit Reached (429)',
          `Query could not execute due to upstream rate limits. Retrying is enabled once the ${Math.ceil(retrySeconds)}s cooldown completes.`,
          'warning'
        );
        return;
      }

      // 2. Handle Guardrail Rejection (HTTP 400)
      if (response.status === 400) {
        const errData = await response.json();
        const detail = errData.detail || {};
        const violationType = detail.violation_type || 'SECURITY_POLICY_VIOLATION';
        const reason = detail.reason || detail.message || 'The query was intercepted by the security guardrail.';

        el.guardrailAlertBanner.classList.remove('hidden');
        el.guardrailViolationType.textContent = `Security Guardrail: ${violationType}`;
        el.guardrailViolationReason.textContent = reason;

        appendSystemNotice(
          `Guardrail Blocked: ${violationType}`,
          reason,
          'danger'
        );
        return;
      }

      // 3. Handle Unauthorized / Forbidden (HTTP 401 / 403)
      if (response.status === 401 || response.status === 403) {
        const errData = await response.json();
        const message = errData.detail || errData.message || 'Authorization failed.';
        appendSystemNotice(`HTTP ${response.status} Error`, message, 'danger');
        return;
      }

      // 4. Handle Service Outage (HTTP 502 / 503)
      if (response.status === 502 || response.status === 503) {
        const errData = await response.json();
        appendSystemNotice(
          `Service Unavailable (${response.status})`,
          errData.message || 'Upstream provider is temporarily down. Please try again shortly.',
          'warning'
        );
        return;
      }

      // 5. Handle Generic Server Error
      if (!response.ok) {
        appendSystemNotice(
          `Server Error (${response.status})`,
          'An unexpected server error occurred.',
          'danger'
        );
        return;
      }

      // 6. Success (200 OK)
      const data = await response.json();

      // Record in conversation history
      state.conversationHistory.push({ role: 'user', content: query });
      state.conversationHistory.push({ role: 'assistant', content: data.answer });

      appendAgentMessage(data, elapsedSec);

    } catch (err) {
      removeLoadingShimmer(loadingId);
      appendSystemNotice('Network Error', 'Unable to reach the Agentic RAG API server.', 'danger');
    } finally {
      if (!state.isCooldownActive) {
        el.sendButton.disabled = false;
      }
      el.sendBtnText.textContent = 'Send';
      scrollToBottom();
    }
  }

  // --------------------------------------------------------------------------
  // Reindex Knowledge Base Trigger
  // --------------------------------------------------------------------------
  async function triggerReindex() {
    if (el.reindexButton.disabled) return;

    el.reindexButton.disabled = true;
    el.reindexButtonText.textContent = 'Indexing...';
    el.reindexIcon.style.animation = 'spin 1s linear infinite';

    try {
      const res = await fetch('/reindex', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.activeToken}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        appendSystemNotice(
          'Reindex Complete',
          `Successfully re-chunked and indexed ${data.chunks_indexed} document chunks into ChromaDB vector store.`,
          'success'
        );
      } else if (res.status === 403) {
        const err = await res.json();
        appendSystemNotice('Permission Denied (403)', err.detail || 'Only operator or admin roles can trigger reindexing.', 'danger');
      } else {
        appendSystemNotice('Reindex Failed', 'Vector store rebuild returned an unexpected status code.', 'danger');
      }
    } catch (e) {
      appendSystemNotice('Reindex Network Error', 'Failed to connect to /reindex endpoint.', 'danger');
    } finally {
      el.reindexIcon.style.animation = 'none';
      el.reindexButtonText.textContent = 'Reindex DB';
      updateRoleUI();
    }
  }

  // --------------------------------------------------------------------------
  // Message Rendering Helpers
  // --------------------------------------------------------------------------
  function appendUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble user-message';
    bubble.innerHTML = `
      <div class="message-avatar user-avatar">${state.currentUser.substring(0, 2).toUpperCase()}</div>
      <div class="message-content">
        <p>${escapeHtml(text)}</p>
      </div>
    `;
    el.messagesList.appendChild(bubble);
  }

  function appendAgentMessage(data, elapsedSec) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble agent-message';

    const isGrounded = data.validation?.is_grounded !== false;
    const groundedScore = data.validation?.groundedness_score ?? 1.0;
    const retryCount = data.retry_count || 0;
    const engineName = state.isMockMode ? 'Mock Local' : 'Groq Qwen 2.5';

    // Format Markdown-like text into simple HTML safely
    const formattedAnswer = renderBasicMarkdown(data.answer);

    // Citations HTML
    let citationsHtml = '';
    if (data.sources && data.sources.length > 0) {
      const sourcesList = data.sources.map(s => `<div class="source-item">📄 ${escapeHtml(s)}</div>`).join('');
      citationsHtml = `
        <div class="citations-accordion">
          <button class="citations-toggle" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <span>Sources Cited (${data.sources.length})</span>
            <span>▾</span>
          </button>
          <div class="citations-content hidden">
            ${sourcesList}
          </div>
        </div>
      `;
    }

    bubble.innerHTML = `
      <div class="message-avatar agent-avatar">⚡</div>
      <div class="message-content">
        <div class="agent-meta-bar">
          <span class="engine-badge">${engineName}</span>
          <span class="latency-badge">⏱️ ${elapsedSec}s</span>
          <span class="retry-badge ${retryCount > 0 ? 'retried' : ''}">
            ${retryCount > 0 ? `Loop-back Retry #${retryCount}` : 'First-pass (0 retries)'}
          </span>
        </div>

        <div class="answer-body">
          ${formattedAnswer}
        </div>

        <div class="groundedness-pill ${isGrounded ? 'groundedness-pass' : 'groundedness-fail'}">
          ${isGrounded ? '✓ Grounded' : '⚠️ Potential Hallucination'} (Score: ${groundedScore})
        </div>

        ${citationsHtml}
      </div>
    `;

    el.messagesList.appendChild(bubble);
  }

  function appendSystemNotice(title, message, type = 'info') {
    const colors = {
      success: 'border: 1px solid rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); color: #6ee7b7;',
      warning: 'border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.08); color: #fde68a;',
      danger: 'border: 1px solid rgba(244, 63, 94, 0.4); background: rgba(244, 63, 94, 0.08); color: #fecdd3;',
      info: 'border: 1px solid var(--border-subtle); background: var(--bg-surface); color: var(--text-secondary);'
    };

    const card = document.createElement('div');
    card.className = 'message-bubble agent-message';
    card.style.maxWidth = '100%';
    card.innerHTML = `
      <div class="message-content" style="${colors[type] || colors.info}; border-radius: var(--radius-md); padding: 12px 16px; width: 100%;">
        <strong style="display: block; font-size: 0.85rem; margin-bottom: 2px;">${escapeHtml(title)}</strong>
        <p style="font-size: 0.8rem; margin: 0;">${escapeHtml(message)}</p>
      </div>
    `;
    el.messagesList.appendChild(card);
    scrollToBottom();
  }

  function appendLoadingShimmer(id) {
    const card = document.createElement('div');
    card.id = id;
    card.className = 'loading-card';
    card.innerHTML = `
      <div class="message-avatar agent-avatar">⚡</div>
      <div class="loading-content">
        <div class="shimmer-line"></div>
        <div class="shimmer-line"></div>
        <div class="shimmer-line"></div>
      </div>
    `;
    el.messagesList.appendChild(card);
  }

  function removeLoadingShimmer(id) {
    const shimmer = document.getElementById(id);
    if (shimmer && shimmer.parentNode) {
      shimmer.parentNode.removeChild(shimmer);
    }
  }

  function scrollToBottom() {
    el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderBasicMarkdown(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);
    
    // Bold: **text**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Inline code: `text`
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Paragraphs / newlines
    const paragraphs = escaped.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`);
    return paragraphs.join('');
  }

  function selectUploadFile(file) {
    const allowed = ['.md', '.txt', '.json', '.pdf', '.docx', '.xlsx', '.xls'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      el.dropzoneFilename.textContent = `❌ Invalid type: ${ext}. Accepted: .pdf, .docx, .xlsx, .md, .txt, .json`;
      el.submitUploadBtn.disabled = true;
      state.pendingUploadFile = null;
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      el.dropzoneFilename.textContent = `❌ File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`;
      el.submitUploadBtn.disabled = true;
      state.pendingUploadFile = null;
      return;
    }
    state.pendingUploadFile = file;
    el.dropzoneFilename.textContent = `✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    el.submitUploadBtn.disabled = false;
  }

  async function handleUploadDocument() {
    const file = state.pendingUploadFile;
    if (!file) return;

    const shouldReindex = el.uploadReindexToggle.checked;

    el.submitUploadBtn.disabled = true;
    el.cancelUploadBtn.disabled = true;
    el.uploadProgressWrap.classList.remove('hidden');
    el.uploadProgressBar.style.width = '30%';
    el.uploadProgressLabel.textContent = `Uploading ${file.name}...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const url = `/upload?reindex=${shouldReindex}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.activeToken}` },
        body: formData
      });

      el.uploadProgressBar.style.width = '100%';

      if (res.ok) {
        const data = await res.json();
        el.uploadProgressLabel.textContent = `✓ Uploaded: ${data.filename} (${data.size_bytes} bytes)`;
        const reindexNote = data.reindexed ? ` Re-indexed ${data.chunks_indexed} chunks immediately.` : ' Reindex skipped.';
        appendSystemNotice(
          `Document Uploaded: ${data.filename}`,
          `${data.size_bytes} bytes stored in data/sample_docs/.${reindexNote}`,
          'success'
        );
        setTimeout(() => { el.uploadModal.classList.add('hidden'); }, 1200);
      } else if (res.status === 403) {
        const err = await res.json();
        appendSystemNotice('Upload Permission Denied (403)', err.detail || 'Only operator or admin roles can upload.', 'danger');
        el.uploadModal.classList.add('hidden');
      } else if (res.status === 400) {
        const err = await res.json();
        appendSystemNotice('Upload Rejected', err.detail || 'File type not allowed.', 'danger');
        el.uploadModal.classList.add('hidden');
      } else if (res.status === 413) {
        appendSystemNotice('File Too Large', 'Maximum upload size is 10 MB.', 'danger');
        el.uploadModal.classList.add('hidden');
      } else {
        appendSystemNotice('Upload Failed', 'An unexpected server error occurred.', 'danger');
        el.uploadModal.classList.add('hidden');
      }
    } catch (err) {
      appendSystemNotice('Upload Network Error', 'Could not reach the /upload endpoint.', 'danger');
      el.uploadModal.classList.add('hidden');
    } finally {
      el.cancelUploadBtn.disabled = false;
      el.submitUploadBtn.disabled = false;
      el.uploadProgressWrap.classList.add('hidden');
      el.uploadProgressBar.style.width = '0%';
      el.uploadFileInput.value = '';
      state.pendingUploadFile = null;
    }
  }

  // Start app
  document.addEventListener('DOMContentLoaded', init);

})();

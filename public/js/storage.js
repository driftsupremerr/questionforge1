/**
 * QuestionForge - Storage & Data Management Service
 * Provides seamless client-side data management with REST API integration,
 * Google Cloud Storage sync, direct image uploads, and automatic fallback
 * to browser localStorage if offline.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StorageService = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEYS = {
    QUESTIONS: 'jee_questions_cache',
    ATTEMPTS: 'jee_quiz_attempts',
    API_KEY: 'jee_gemini_api_key',
    GCS_CONFIG: 'jee_gcs_config',
    SETTINGS: 'jee_app_settings'
  };

  const API_BASE = '/api';

  class StorageService {
    constructor() {
      this._serverOnline = null; // null: unknown, true: online, false: offline
      this._listeners = {};
      this._localQuestionsCache = [];
      this._initPromise = this.checkServerStatus();
    }

    /**
     * Subscribe to storage change events
     */
    on(event, callback) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(callback);
      return () => {
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
      };
    }

    _emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach(cb => {
          try { cb(data); } catch (e) { console.error('Storage event error:', e); }
        });
      }
    }

    /**
     * Check if the backend server is reachable
     */
    async checkServerStatus() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const res = await fetch(`${API_BASE}/health`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          this._serverOnline = (data.status === 'ok');
          return this._serverOnline;
        }
      } catch (e) {
        this._serverOnline = false;
      }
      this._serverOnline = false;
      return false;
    }

    isServerOnline() {
      return this._serverOnline === true;
    }

    /**
     * Get questions from server or localStorage fallback
     * @param {Object} filters { subject, chapter, difficulty, type, search, limit, offset }
     */
    async getQuestions(filters = {}) {
      if (this._serverOnline !== false) {
        try {
          const params = new URLSearchParams();
          if (filters.subject) params.append('subject', filters.subject);
          if (filters.chapter) params.append('chapter', filters.chapter);
          if (filters.difficulty) params.append('difficulty', filters.difficulty);
          if (filters.type) params.append('type', filters.type);
          if (filters.search) params.append('search', filters.search);
          if (filters.limit) params.append('limit', filters.limit);
          if (filters.offset) params.append('offset', filters.offset);

          const url = `${API_BASE}/questions${params.toString() ? '?' + params.toString() : ''}`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (res.ok) {
            const result = await res.json();
            this._serverOnline = true;
            if (result.data) {
              this._syncLocalCache(result.data, filters);
              return result.data;
            }
          }
        } catch (e) {
          console.warn('API fetch failed, falling back to localStorage cache:', e.message);
          this._serverOnline = false;
        }
      }

      return this._getLocalQuestions(filters);
    }

    /**
     * Get a single question by ID
     */
    async getQuestionById(id) {
      if (this._serverOnline !== false) {
        try {
          const res = await fetch(`${API_BASE}/questions/${encodeURIComponent(id)}`);
          if (res.ok) {
            const json = await res.json();
            return json.data;
          }
        } catch (e) {
          this._serverOnline = false;
        }
      }

      const all = this._getAllLocalQuestions();
      return all.find(q => String(q.id) === String(id)) || null;
    }

    /**
     * Add a single question or array of questions
     */
    async addQuestion(questionOrQuestions) {
      const isArray = Array.isArray(questionOrQuestions);
      const items = isArray ? questionOrQuestions : [questionOrQuestions];

      const prepared = items.map(q => ({
        id: q.id || `jee_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        subject: q.subject || 'Physics',
        chapter: q.chapter || 'General',
        difficulty: q.difficulty || 'JEE Main',
        type: q.type || 'single_choice',
        marks: q.marks || { correct: 4, incorrect: q.type === 'numerical' ? 0 : -1 },
        year: q.year || 'Practice Question',
        question: q.question || (q.image ? 'Refer to the question image.' : ''),
        image: q.image || q.imageUrl || null,
        solution_image: q.solution_image || q.solutionImageUrl || null,
        options: q.options || [],
        correct_answer: q.correct_answer,
        explanation: q.explanation || '',
        created_at: q.created_at || new Date().toISOString()
      }));

      // Try Server POST
      if (this._serverOnline !== false) {
        try {
          const res = await fetch(`${API_BASE}/questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(prepared)
          });
          if (res.ok) {
            const data = await res.json();
            this._serverOnline = true;
            this._saveLocalQuestions([...this._getAllLocalQuestions(), ...prepared]);
            this._emit('questions-updated', { action: 'add', items: prepared });
            return isArray ? data.data : data.data[0];
          }
        } catch (e) {
          console.warn('Server add failed, persisting locally:', e.message);
          this._serverOnline = false;
        }
      }

      // Offline fallback
      const current = this._getAllLocalQuestions();
      const updated = [...current, ...prepared];
      this._saveLocalQuestions(updated);
      this._emit('questions-updated', { action: 'add', items: prepared });
      return isArray ? prepared : prepared[0];
    }

    /**
     * Direct Image Question convenience method
     * Creates a question centered around an uploaded image
     */
    async addImageQuestion(data) {
      const questionPayload = {
        subject: data.subject || 'Physics',
        chapter: data.chapter || 'General',
        difficulty: data.difficulty || 'JEE Main',
        type: data.type || 'single_choice',
        question: data.question || 'Refer to the question image below.',
        image: data.image || data.imageUrl,
        solution_image: data.solution_image || data.solutionImageUrl,
        options: data.options || [
          { id: 'A', text: data.optionA || 'Option (A)' },
          { id: 'B', text: data.optionB || 'Option (B)' },
          { id: 'C', text: data.optionC || 'Option (C)' },
          { id: 'D', text: data.optionD || 'Option (D)' }
        ],
        correct_answer: data.correct_answer || data.correctAnswer || 'A',
        explanation: data.explanation || '',
        year: data.year || 'Image Question'
      };

      return await this.addQuestion(questionPayload);
    }

    /**
     * Upload an image to the server and/or Google Cloud Storage
     * @param {File|Blob|string} imageFileOrBase64
     * @param {string} [filename]
     */
    async uploadImage(imageFileOrBase64, filename) {
      let base64String = '';
      let mimeType = 'image/png';
      let name = filename || 'question_image.png';

      if (typeof imageFileOrBase64 === 'string') {
        base64String = imageFileOrBase64;
      } else if (imageFileOrBase64 instanceof Blob || (typeof File !== 'undefined' && imageFileOrBase64 instanceof File)) {
        name = imageFileOrBase64.name || name;
        mimeType = imageFileOrBase64.type || mimeType;
        base64String = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(imageFileOrBase64);
        });
      }

      // Try server upload endpoint
      if (this._serverOnline !== false) {
        try {
          const res = await fetch(`${API_BASE}/upload-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: base64String,
              mimeType,
              name
            })
          });

          if (res.ok) {
            const data = await res.json();
            return {
              success: true,
              url: data.url,
              gcsUrl: data.gcsUrl,
              filename: data.filename
            };
          }
        } catch (e) {
          console.warn('Server image upload failed, keeping as data URL:', e.message);
        }
      }

      // Offline fallback: return base64 data URL
      return {
        success: true,
        url: base64String,
        gcsUrl: null,
        filename: name,
        isDataUrl: true
      };
    }

    /**
     * Update an existing question
     */
    async updateQuestion(id, patch) {
      if (this._serverOnline !== false) {
        try {
          const res = await fetch(`${API_BASE}/questions/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
          });
          if (res.ok) {
            const data = await res.json();
            this._serverOnline = true;
            this._updateLocalQuestion(id, patch);
            this._emit('questions-updated', { action: 'update', id, patch });
            return data.data;
          }
        } catch (e) {
          this._serverOnline = false;
        }
      }

      const updated = this._updateLocalQuestion(id, patch);
      this._emit('questions-updated', { action: 'update', id, patch });
      return updated;
    }

    /**
     * Delete a question by ID
     */
    async deleteQuestion(id) {
      if (this._serverOnline !== false) {
        try {
          const res = await fetch(`${API_BASE}/questions/${encodeURIComponent(id)}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            this._serverOnline = true;
            this._deleteLocalQuestion(id);
            this._emit('questions-updated', { action: 'delete', id });
            return true;
          }
        } catch (e) {
          this._serverOnline = false;
        }
      }

      this._deleteLocalQuestion(id);
      this._emit('questions-updated', { action: 'delete', id });
      return true;
    }

    /**
     * Reset question store to initial sample questions
     */
    async resetQuestions() {
      if (this._serverOnline !== false) {
        try {
          const res = await fetch(`${API_BASE}/questions/reset`, { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            this._saveLocalQuestions(data.data);
            this._emit('questions-updated', { action: 'reset', count: data.count });
            return data.data;
          }
        } catch (e) {
          this._serverOnline = false;
        }
      }

      try {
        const res = await fetch('/data/sample-questions.json');
        if (res.ok) {
          const samples = await res.json();
          this._saveLocalQuestions(samples);
          this._emit('questions-updated', { action: 'reset', count: samples.length });
          return samples;
        }
      } catch (e) {
        console.error('Could not reset questions offline:', e);
      }
      return this._getAllLocalQuestions();
    }

    // ==========================================
    // Google Cloud Storage (GCS) Methods
    // ==========================================

    /**
     * Get GCS connection status from backend
     */
    async getGcsStatus() {
      try {
        const res = await fetch(`${API_BASE}/gcs/status`);
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {
        console.warn('GCS status check failed:', e.message);
      }
      return { configured: false, connected: false };
    }

    /**
     * Configure Google Cloud Storage bucket & credentials
     * @param {Object} config { bucket, projectId, credentials, token }
     */
    async configureGcs(config) {
      try {
        const res = await fetch(`${API_BASE}/gcs/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
        const data = await res.json();
        if (res.ok) {
          this._emit('gcs-updated', data);
          return data;
        } else {
          throw new Error(data.error || 'Failed to configure GCS');
        }
      } catch (e) {
        throw e;
      }
    }

    /**
     * Manually trigger sync with GCS
     */
    async syncWithGcs() {
      try {
        const res = await fetch(`${API_BASE}/gcs/sync`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          this._emit('gcs-synced', data);
          return data;
        } else {
          throw new Error(data.message || data.error || 'GCS sync failed');
        }
      } catch (e) {
        throw e;
      }
    }

    // ==========================================
    // Gemini API Key Management
    // ==========================================

    getApiKey() {
      try {
        return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
      } catch (e) {
        return '';
      }
    }

    setApiKey(key) {
      try {
        const trimmed = (key || '').trim();
        if (trimmed) {
          localStorage.setItem(STORAGE_KEYS.API_KEY, trimmed);
        } else {
          localStorage.removeItem(STORAGE_KEYS.API_KEY);
        }
        
        // Also persist to server if server is reachable
        if (this._serverOnline !== false) {
          fetch(`${API_BASE}/config/gemini-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: trimmed })
          }).catch(e => console.warn('Could not sync API key to server:', e.message));
        }

        this._emit('api-key-updated', { hasKey: Boolean(trimmed) });
        return true;
      } catch (e) {
        return false;
      }
    }

    hasApiKey() {
      return Boolean(this.getApiKey());
    }

    /**
     * Get server-side Gemini key status
     */
    async getServerApiKeyStatus() {
      try {
        const res = await fetch(`${API_BASE}/config/gemini-key`);
        if (res.ok) {
          return await res.json();
        }
      } catch (e) {}
      return { configured: this.hasApiKey() };
    }

    // ==========================================
    // LocalStorage Helper Methods for Questions
    // ==========================================

    _getAllLocalQuestions() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.QUESTIONS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }

    _saveLocalQuestions(questions) {
      try {
        localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questions));
      } catch (e) {
        console.error('Error saving questions to localStorage:', e);
      }
    }

    _syncLocalCache(serverQuestions, filters) {
      const hasFilter = filters && Object.keys(filters).some(k => filters[k] && filters[k] !== 'all');
      if (!hasFilter) {
        this._saveLocalQuestions(serverQuestions);
      }
    }

    _updateLocalQuestion(id, patch) {
      const all = this._getAllLocalQuestions();
      const index = all.findIndex(q => String(q.id) === String(id));
      if (index !== -1) {
        all[index] = { ...all[index], ...patch, id: all[index].id };
        this._saveLocalQuestions(all);
        return all[index];
      }
      return null;
    }

    _deleteLocalQuestion(id) {
      const all = this._getAllLocalQuestions();
      const filtered = all.filter(q => String(q.id) !== String(id));
      this._saveLocalQuestions(filtered);
    }

    _getLocalQuestions(filters = {}) {
      let list = this._getAllLocalQuestions();

      if (filters.subject && filters.subject !== 'all') {
        const sub = filters.subject.toLowerCase();
        list = list.filter(q => (q.subject || '').toLowerCase() === sub);
      }

      if (filters.chapter && filters.chapter !== 'all') {
        const chap = filters.chapter.toLowerCase();
        list = list.filter(q => (q.chapter || '').toLowerCase().includes(chap));
      }

      if (filters.difficulty && filters.difficulty !== 'all') {
        const diff = filters.difficulty.toLowerCase();
        list = list.filter(q => (q.difficulty || '').toLowerCase() === diff);
      }

      if (filters.type && filters.type !== 'all') {
        const typ = filters.type.toLowerCase();
        list = list.filter(q => (q.type || '').toLowerCase() === typ);
      }

      if (filters.search) {
        const search = filters.search.toLowerCase();
        list = list.filter(q =>
          (q.question || '').toLowerCase().includes(search) ||
          (q.chapter || '').toLowerCase().includes(search) ||
          (q.subject || '').toLowerCase().includes(search) ||
          (q.explanation || '').toLowerCase().includes(search)
        );
      }

      const offset = parseInt(filters.offset, 10) || 0;
      const limit = parseInt(filters.limit, 10);
      if (!isNaN(limit) && limit > 0) {
        return list.slice(offset, offset + limit);
      }

      return list;
    }

    // ==========================================
    // Gemini Scan Proxy & Fallback Call
    // ==========================================

    async scanDocument(options) {
      const apiKey = options.apiKey || this.getApiKey();

      // Call backend proxy /api/scan
      if (this._serverOnline !== false) {
        try {
          const res = await fetch(`${API_BASE}/scan`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey || ''
            },
            body: JSON.stringify({
              apiKey: apiKey,
              model: options.model || 'gemini-1.5-flash',
              prompt: options.prompt,
              mimeType: options.mimeType,
              base64Data: options.base64Data,
              contents: options.contents
            })
          });

          const data = await res.json();
          if (res.ok && data.success) {
            return data.result;
          } else {
            throw new Error(data.message || (data.details ? JSON.stringify(data.details) : 'Scan proxy request failed'));
          }
        } catch (err) {
          console.warn('Backend proxy scan failed, attempting direct Gemini API call:', err.message);
        }
      }

      // Fallback: direct browser fetch to Google Gemini API
      if (!apiKey) {
        throw new Error('No Gemini API key available. Please enter your API key in Cloud & AI Settings.');
      }

      const model = options.model || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

      const parts = [];
      if (options.base64Data && options.mimeType) {
        parts.push({
          inlineData: {
            mimeType: options.mimeType,
            data: options.base64Data
          }
        });
      }
      if (options.prompt) {
        parts.push({ text: options.prompt });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errorText}`);
      }

      return await res.json();
    }

    // ==========================================
    // Quiz Attempts & History
    // ==========================================

    saveAttempt(attempt) {
      try {
        const record = {
          id: attempt.id || `attempt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          date: attempt.date || new Date().toISOString(),
          mode: attempt.mode || 'exam',
          durationSeconds: attempt.durationSeconds || 0,
          totalQuestions: attempt.totalQuestions || 0,
          totalMarks: attempt.totalMarks || 0,
          maxMarks: attempt.maxMarks || 0,
          correctCount: attempt.correctCount || 0,
          incorrectCount: attempt.incorrectCount || 0,
          unattemptedCount: attempt.unattemptedCount || 0,
          accuracy: attempt.accuracy || 0,
          subjectBreakdown: attempt.subjectBreakdown || {},
          responses: attempt.responses || {}
        };

        const existing = this.getAttempts();
        existing.unshift(record);
        localStorage.setItem(STORAGE_KEYS.ATTEMPTS, JSON.stringify(existing));
        this._emit('attempt-saved', record);
        return record;
      } catch (e) {
        console.error('Error saving attempt:', e);
        return null;
      }
    }

    getAttempts() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ATTEMPTS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }

    getAttemptById(id) {
      const attempts = this.getAttempts();
      return attempts.find(a => String(a.id) === String(id)) || null;
    }

    clearHistory() {
      try {
        localStorage.removeItem(STORAGE_KEYS.ATTEMPTS);
        this._emit('history-cleared');
        return true;
      } catch (e) {
        return false;
      }
    }

    // ==========================================
    // Analytics & Performance Insights
    // ==========================================

    getAnalytics() {
      const attempts = this.getAttempts();
      if (!attempts || attempts.length === 0) {
        return {
          totalTests: 0,
          totalQuestionsAttempted: 0,
          totalCorrect: 0,
          totalIncorrect: 0,
          overallAccuracy: 0,
          totalTimeSpent: 0,
          subjectStats: {
            Physics: { attempted: 0, correct: 0, accuracy: 0 },
            Chemistry: { attempted: 0, correct: 0, accuracy: 0 },
            Mathematics: { attempted: 0, correct: 0, accuracy: 0 }
          },
          recentScores: []
        };
      }

      let totalAttempted = 0;
      let totalCorrect = 0;
      let totalIncorrect = 0;
      let totalTime = 0;

      const subjectStats = {
        Physics: { attempted: 0, correct: 0, accuracy: 0 },
        Chemistry: { attempted: 0, correct: 0, accuracy: 0 },
        Mathematics: { attempted: 0, correct: 0, accuracy: 0 }
      };

      attempts.forEach(att => {
        totalAttempted += (att.correctCount + att.incorrectCount);
        totalCorrect += att.correctCount;
        totalIncorrect += att.incorrectCount;
        totalTime += (att.durationSeconds || 0);

        if (att.subjectBreakdown) {
          for (const sub of ['Physics', 'Chemistry', 'Mathematics']) {
            if (att.subjectBreakdown[sub]) {
              const s = att.subjectBreakdown[sub];
              subjectStats[sub].attempted += (s.correct || 0) + (s.incorrect || 0);
              subjectStats[sub].correct += (s.correct || 0);
            }
          }
        }
      });

      const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
      for (const sub of Object.keys(subjectStats)) {
        const item = subjectStats[sub];
        item.accuracy = item.attempted > 0 ? Math.round((item.correct / item.attempted) * 100) : 0;
      }

      const recentScores = attempts.slice(0, 10).map(a => ({
        id: a.id,
        date: a.date,
        marks: a.totalMarks,
        maxMarks: a.maxMarks,
        accuracy: a.accuracy,
        mode: a.mode
      }));

      return {
        totalTests: attempts.length,
        totalQuestionsAttempted: totalAttempted,
        totalCorrect,
        totalIncorrect,
        overallAccuracy,
        totalTimeSpent: totalTime,
        subjectStats,
        recentScores
      };
    }

    // ==========================================
    // JSON Import & Export
    // ==========================================

    async exportQuestionsJSON() {
      const questions = await this.getQuestions();
      return JSON.stringify(questions, null, 2);
    }

    async importQuestionsJSON(jsonString) {
      try {
        const parsed = JSON.parse(jsonString);
        const questions = Array.isArray(parsed) ? parsed : (parsed.questions || [parsed]);
        return await this.addQuestion(questions);
      } catch (e) {
        throw new Error('Failed to parse questions JSON: ' + e.message);
      }
    }
  }

  const instance = new StorageService();
  return instance;
});

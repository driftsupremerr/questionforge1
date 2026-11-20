/**
 * =========================================================
 * QuestionForge - Main Application Controller
 * Handles Navigation, CBT Exam Flow, Practice Mode,
 * Document Scanner, Question Bank, Analytics, and KaTeX Math Rendering.
 * =========================================================
 */

const App = (function () {
  'use strict';

  // State
  let allQuestions = [];
  let currentMode = 'landing'; // 'landing' | 'simulator' | 'practice' | 'scanner' | 'image-upload' | 'bank' | 'analytics'
  let examConfig = {
    pattern: 'jee-main',
    durationMinutes: 180,
    subjectFilter: 'all'
  };

  let quizEngine = null;
  let activeExamReport = null;

  // Practice Mode State
  let practiceState = {
    filteredQuestions: [],
    currentIndex: 0,
    selectedOption: null,
    checked: false,
    showingSolution: false,
    showingHint: false
  };

  // Scanner Staging State
  let scannerState = {
    stagedQuestions: [],
    currentPdfDoc: null,
    currentPdfPage: 1,
    totalPdfPages: 1
  };

  // Bank Filter State
  let bankSubjectFilter = 'all';
  let bankSearchQuery = '';

  /**
   * Safe KaTeX Auto-Renderer for any DOM element
   */
  function renderMath(element) {
    if (!element) return;
    if (typeof renderMathInElement === 'function') {
      try {
        renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false }
          ],
          throwOnError: false,
          errorColor: '#dc2626'
        });
      } catch (err) {
        console.warn('KaTeX rendering error:', err);
      }
    }
  }

  /**
   * Helper to escape HTML safely
   */
  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Toast notification system
   */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-600 text-white',
      error: 'bg-rose-600 text-white',
      warning: 'bg-amber-600 text-white',
      info: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
    };
    const icons = {
      success: 'check-circle',
      error: 'alert-circle',
      warning: 'alert-triangle',
      info: 'info'
    };

    toast.className = `toast-msg flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold shadow-lg transition-all ${bgColors[type] || bgColors.info}`;
    toast.innerHTML = `
      <i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 shrink-0"></i>
      <span>${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  /**
   * Initialize Application
   */
  async function init() {
    // 1. Theme Initialization
    initTheme();

    // 2. Storage Service Event Listeners
    if (window.StorageService) {
      window.StorageService.on('questions-updated', () => {
        refreshQuestionsData();
      });
      window.StorageService.on('api-key-updated', (data) => {
        updateApiKeyStatusDot(data && !!data.apiKey);
      });
    }

    // 3. Quiz Engine Setup
    quizEngine = new QuizEngine({
      examType: examConfig.pattern,
      durationMinutes: examConfig.durationMinutes
    });

    quizEngine.on('tick', onQuizTick);
    quizEngine.on('questionChange', onQuizQuestionChange);
    quizEngine.on('paletteChange', onQuizPaletteChange);
    quizEngine.on('submit', onQuizSubmit);

    // 4. Load initial questions
    await refreshQuestionsData();

    // 5. Setup Scanner drag-and-drop & paste listeners
    initScannerListeners();

    // 6. Update API key status & GCS status
    checkApiKeyStatus();
    testGCSConnection(true);

    // 7. Render initial mode
    switchMode('landing');

    if (window.lucide) lucide.createIcons();
  }

  /**
   * Theme Management (Dark/Light)
   */
  function initTheme() {
    const savedTheme = localStorage.getItem('jee_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
      updateThemeIcon(true);
    } else {
      document.documentElement.classList.remove('dark');
      updateThemeIcon(false);
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('jee_theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
  }

  function updateThemeIcon(isDark) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
      if (window.lucide) lucide.createIcons({ root: icon.parentElement });
    }
  }

  function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) menu.classList.toggle('hidden');
  }

  /**
   * Refresh all questions from StorageService
   */
  async function refreshQuestionsData() {
    if (!window.StorageService) return;
    try {
      allQuestions = await window.StorageService.getQuestions();
      updateHeaderStats();
      if (currentMode === 'bank') renderBankView();
      if (currentMode === 'practice') populatePracticeFilterDropdowns();
    } catch (err) {
      console.error('Failed to load questions:', err);
    }
  }

  function updateHeaderStats() {
    const cntEl = document.getElementById('header-question-count');
    if (cntEl) cntEl.textContent = allQuestions.length;

    const examCntEl = document.getElementById('exam-available-q-count');
    if (examCntEl) {
      examCntEl.textContent = `${allQuestions.length} questions available in bank`;
    }

    const landingTotal = document.getElementById('landing-stat-total');
    if (landingTotal) landingTotal.textContent = `${allQuestions.length}+`;

    const bankTotal = document.getElementById('bank-stat-total');
    if (bankTotal) bankTotal.textContent = allQuestions.length;

    const phyCount = allQuestions.filter(q => (q.subject || '').toLowerCase() === 'physics').length;
    const chemCount = allQuestions.filter(q => (q.subject || '').toLowerCase() === 'chemistry').length;
    const mathCount = allQuestions.filter(q => (q.subject || '').toLowerCase() === 'mathematics').length;

    const lPhy = document.getElementById('landing-stat-phy');
    if (lPhy) lPhy.textContent = `${phyCount} Qs`;
    const lChem = document.getElementById('landing-stat-chem');
    if (lChem) lChem.textContent = `${chemCount} Qs`;
    const lMath = document.getElementById('landing-stat-math');
    if (lMath) lMath.textContent = `${mathCount} Qs`;

    const bPhy = document.getElementById('bank-stat-physics');
    if (bPhy) bPhy.textContent = phyCount;
    const bChem = document.getElementById('bank-stat-chemistry');
    if (bChem) bChem.textContent = chemCount;
    const bMath = document.getElementById('bank-stat-math');
    if (bMath) bMath.textContent = mathCount;
  }

  /**
   * Switch Active Application Mode
   */
  function switchMode(mode) {
    currentMode = mode;

    // Toggle navigation tab active classes
    const tabs = ['landing', 'simulator', 'practice', 'scanner', 'image-upload', 'bank', 'analytics'];
    tabs.forEach(t => {
      const btn = document.getElementById(`nav-btn-${t}`);
      const view = document.getElementById(`view-${t}`);
      if (btn) {
        if (t === mode) {
          if (t === 'landing') {
            btn.className = 'nav-tab active flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg transition-all text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400';
          } else {
            btn.className = 'nav-tab active flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg transition-all text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400';
          }
        } else {
          btn.className = 'nav-tab flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg transition-all text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800';
        }
      }
      if (view) {
        if (t === mode) {
          view.classList.remove('hidden');
        } else {
          view.classList.add('hidden');
        }
      }
    });

    // Check if active exam is running
    const examIndicator = document.getElementById('active-exam-indicator');
    if (quizEngine && quizEngine.status === 'running') {
      if (examIndicator) examIndicator.classList.remove('hidden');
    } else {
      if (examIndicator) examIndicator.classList.add('hidden');
    }

    // Trigger mode-specific views
    if (mode === 'practice') {
      initPracticeView();
    } else if (mode === 'bank') {
      renderBankView();
    } else if (mode === 'analytics') {
      renderAnalyticsView();
    } else if (mode === 'image-upload') {
      onDirectTypeChange();
    }

    if (window.lucide) lucide.createIcons();
  }

  // =========================================================
  // MODE 1: EXAM SIMULATOR
  // =========================================================

  function setExamPattern(pattern) {
    examConfig.pattern = pattern;
    const mainBtn = document.getElementById('opt-pattern-main');
    const advBtn = document.getElementById('opt-pattern-adv');

    if (pattern === 'jee-main') {
      mainBtn.className = 'exam-pattern-card active p-4 rounded-xl border-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/20 text-left transition-all';
      advBtn.className = 'exam-pattern-card p-4 rounded-xl border-2 border-slate-200 dark:border-slate-800 text-left hover:border-slate-300 dark:hover:border-slate-700 transition-all';
    } else {
      advBtn.className = 'exam-pattern-card active p-4 rounded-xl border-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/20 text-left transition-all';
      mainBtn.className = 'exam-pattern-card p-4 rounded-xl border-2 border-slate-200 dark:border-slate-800 text-left hover:border-slate-300 dark:hover:border-slate-700 transition-all';
    }
    if (window.lucide) lucide.createIcons();
  }

  function setExamDuration(minutes) {
    examConfig.durationMinutes = minutes;
    const durations = [180, 60, 30, 15];
    durations.forEach(d => {
      const btn = document.getElementById(`opt-dur-${d}`);
      if (btn) {
        if (d === minutes) {
          btn.className = 'dur-btn active py-2 rounded-lg border text-xs font-semibold text-center border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
        } else {
          btn.className = 'dur-btn py-2 rounded-lg border text-xs font-semibold text-center border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300';
        }
      }
    });
  }

  async function launchExam() {
    const subjFilter = document.getElementById('exam-subject-filter').value;
    examConfig.subjectFilter = subjFilter;

    // Filter questions
    let examQuestions = [...allQuestions];
    if (subjFilter !== 'all') {
      examQuestions = examQuestions.filter(q => (q.subject || '').toLowerCase() === subjFilter.toLowerCase());
    }

    if (examQuestions.length === 0) {
      showToast('No questions found for the selected subject. Seeding sample questions...', 'warning');
      if (window.StorageService) {
        examQuestions = await window.StorageService.resetQuestions();
        allQuestions = examQuestions;
      }
    }

    // Configure quiz engine
    quizEngine.options.examType = examConfig.pattern;
    quizEngine.options.durationMinutes = examConfig.durationMinutes;

    // Transition Screens: Setup -> Active CBT
    document.getElementById('exam-setup-container').classList.add('hidden');
    document.getElementById('exam-result-container').classList.add('hidden');
    document.getElementById('exam-active-container').classList.remove('hidden');

    const patternTitle = examConfig.pattern === 'jee-main' ? 'JEE (Main) Mock Test CBT' : 'JEE (Advanced) Mock Test CBT';
    document.getElementById('cbt-exam-name').textContent = patternTitle;

    // Start Exam
    quizEngine.startExam(examQuestions, examConfig.durationMinutes);
    showToast('Examination started! Timer is active.', 'info');
  }

  function onQuizTick(data) {
    const timerDisplay = document.getElementById('cbt-timer-display');
    if (timerDisplay) {
      timerDisplay.textContent = data.formatted;
      if (data.isDanger) {
        timerDisplay.classList.add('timer-danger');
      } else {
        timerDisplay.classList.remove('timer-danger');
      }
    }

    const navTimer = document.getElementById('nav-exam-timer');
    if (navTimer) navTimer.textContent = data.formatted;
  }

  function onQuizQuestionChange(data) {
    const { question, index, subject, totalInSubject, response } = data;
    if (!question) return;

    // Question number & badge
    document.getElementById('cbt-q-number').textContent = `Question No. ${index + 1} of ${totalInSubject}`;
    
    const typeLabel = question.type === 'multiple_choice' 
      ? 'Multiple Choice (One or More Correct)' 
      : (question.type === 'numerical' ? 'Numerical Answer' : 'Single Choice');
    document.getElementById('cbt-q-type-badge').textContent = typeLabel;

    // Marking
    const marking = question.marks || question.marking || { correct: 4, incorrect: -1 };
    document.getElementById('cbt-q-marks-pos').textContent = `+${marking.correct}.00`;
    document.getElementById('cbt-q-marks-neg').textContent = `${marking.incorrect}.00`;

    // Question Text with KaTeX
    const qStemEl = document.getElementById('cbt-question-text');
    qStemEl.innerHTML = escapeHtml(question.question || question.stem || '');
    renderMath(qStemEl);

    // Question Diagram Image (if any)
    const qImgBox = document.getElementById('cbt-question-image-box');
    const qImg = document.getElementById('cbt-question-img');
    const imgSrc = question.image || question.imageUrl || question.image_url;
    if (qImgBox && qImg) {
      if (imgSrc) {
        qImg.src = imgSrc;
        qImgBox.classList.remove('hidden');
      } else {
        qImgBox.classList.add('hidden');
      }
    }

    // Options Container
    const optsContainer = document.getElementById('cbt-options-container');
    optsContainer.innerHTML = '';

    if (question.type === 'numerical') {
      // Numerical Input Box
      const curVal = response && response.selectedOption !== null ? response.selectedOption : '';
      optsContainer.innerHTML = `
        <div class="space-y-3 max-w-sm">
          <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider">Enter Numerical Value</label>
          <div class="flex items-center gap-2">
            <input type="number" step="any" id="cbt-numerical-input" value="${escapeHtml(String(curVal))}"
              oninput="App.quizEngine.selectOption(this.value)"
              placeholder="e.g. 10 or 4.5"
              class="w-full px-4 py-3 text-lg font-mono font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <p class="text-[11px] text-slate-400">Tolerance accepted up to ±0.05. Press Save & Next when done.</p>
        </div>
      `;
    } else {
      // Single / Multiple Choice Options
      const letters = ['A', 'B', 'C', 'D'];
      const rawOptions = question.options || [];

      rawOptions.forEach((opt, optIdx) => {
        const optLetter = letters[optIdx] || String(optIdx + 1);
        const optText = typeof opt === 'object' && opt !== null ? (opt.text || '') : String(opt);

        // Check if selected
        let isSelected = false;
        if (response && response.selectedOption !== null && response.selectedOption !== undefined) {
          if (question.type === 'multiple_choice') {
            const arr = Array.isArray(response.selectedOption) ? response.selectedOption : [response.selectedOption];
            isSelected = arr.includes(optIdx) || arr.includes(optLetter);
          } else {
            isSelected = (response.selectedOption === optIdx || String(response.selectedOption).toUpperCase() === optLetter);
          }
        }

        const optBtn = document.createElement('div');
        optBtn.className = `option-item p-4 rounded-xl border cursor-pointer flex items-start gap-3.5 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all ${isSelected ? 'selected ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-800'}`;
        optBtn.onclick = () => {
          quizEngine.selectOption(optIdx);
        };

        const checkIcon = question.type === 'multiple_choice'
          ? (isSelected ? '<i data-lucide="check-square" class="w-5 h-5 text-blue-600"></i>' : '<i data-lucide="square" class="w-5 h-5 text-slate-400"></i>')
          : (isSelected ? '<i data-lucide="check-circle-2" class="w-5 h-5 text-blue-600"></i>' : '<i data-lucide="circle" class="w-5 h-5 text-slate-400"></i>');

        optBtn.innerHTML = `
          <div class="pt-0.5">${checkIcon}</div>
          <span class="font-bold text-xs px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">${optLetter}</span>
          <div class="flex-1 text-sm text-slate-800 dark:text-slate-200 font-normal leading-relaxed opt-math-text">
            ${escapeHtml(optText)}
          </div>
        `;

        optsContainer.appendChild(optBtn);
        renderMath(optBtn.querySelector('.opt-math-text'));
      });
    }

    if (window.lucide) lucide.createIcons({ root: optsContainer });
  }

  function onQuizPaletteChange(data) {
    const { summary, currentSubject, subjectQuestions, responses } = data;

    // 1. Update Palette Status Counters
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('stat-count-answered', summary.answered);
    setTxt('stat-count-not-answered', summary.notAnswered);
    setTxt('stat-count-review', summary.markedForReview);
    setTxt('stat-count-ans-review', summary.answeredAndMarked);
    setTxt('stat-count-not-visited', summary.notVisited);

    // 2. Render Subject Navigation Tabs in Header
    const tabsContainer = document.getElementById('cbt-subject-tabs');
    if (tabsContainer) {
      tabsContainer.innerHTML = '';
      const subjects = Object.keys(quizEngine.subjectQuestions).filter(s => (quizEngine.subjectQuestions[s] || []).length > 0);
      subjects.forEach(subj => {
        const isCurrent = (subj === currentSubject);
        const count = quizEngine.subjectQuestions[subj].length;
        const btn = document.createElement('button');
        btn.className = `px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${isCurrent ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`;
        btn.innerHTML = `<span>${subj}</span> <span class="opacity-75">(${count})</span>`;
        btn.onclick = () => quizEngine.setSubject(subj);
        tabsContainer.appendChild(btn);
      });
    }

    // 3. Subject title on palette
    const pSubjTitle = document.getElementById('palette-subject-title');
    if (pSubjTitle) pSubjTitle.textContent = currentSubject;

    // 4. Render Grid of Questions for current subject
    const paletteGrid = document.getElementById('cbt-palette-grid');
    if (paletteGrid) {
      paletteGrid.innerHTML = '';
      subjectQuestions.forEach((q, idx) => {
        const resp = responses[q.id] || { status: 'not-visited' };
        const btn = document.createElement('button');
        
        // CSS State Class Mapping
        let stateClass = 'cbt-not-visited';
        switch (resp.status) {
          case 'answered': stateClass = 'cbt-answered'; break;
          case 'not-answered': stateClass = 'cbt-not-answered'; break;
          case 'marked-for-review': stateClass = 'cbt-review'; break;
          case 'answered-and-marked': stateClass = 'cbt-ans-review'; break;
          case 'not-visited': default: stateClass = 'cbt-not-visited'; break;
        }

        const isCurrent = (idx === quizEngine.currentQuestionIndex);
        btn.className = `cbt-btn ${stateClass} ${isCurrent ? 'active ring-2 ring-blue-500 scale-105' : ''}`;
        btn.textContent = idx + 1;
        btn.onclick = () => quizEngine.goToQuestion(idx, currentSubject);
        paletteGrid.appendChild(btn);
      });
    }
  }

  function confirmSubmitExam() {
    const summary = quizEngine.getPaletteSummary();
    const box = document.getElementById('submit-summary-box');
    if (box) {
      box.innerHTML = `
        <div class="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
          <span class="flex items-center gap-1.5 text-emerald-600"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Answered:</span>
          <span class="font-bold">${summary.answered + summary.answeredAndMarked}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
          <span class="flex items-center gap-1.5 text-rose-600"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Not Answered:</span>
          <span class="font-bold">${summary.notAnswered}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
          <span class="flex items-center gap-1.5 text-purple-600"><span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Marked for Review:</span>
          <span class="font-bold">${summary.markedForReview}</span>
        </div>
        <div class="flex justify-between py-1">
          <span class="flex items-center gap-1.5 text-slate-500"><span class="w-2.5 h-2.5 rounded-full bg-slate-400"></span> Not Visited:</span>
          <span class="font-bold">${summary.notVisited}</span>
        </div>
      `;
    }
    document.getElementById('modal-submit-confirm').classList.remove('hidden');
  }

  function closeSubmitModal() {
    document.getElementById('modal-submit-confirm').classList.add('hidden');
  }

  function executeSubmitExam() {
    closeSubmitModal();
    quizEngine.submitExam();
  }

  async function onQuizSubmit(report) {
    activeExamReport = report;

    // Trigger celebration confetti
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }

    // Persist attempt in storage
    if (window.StorageService) {
      await window.StorageService.saveAttempt(report);
    }

    // Switch screens: Active CBT -> Result Scorecard
    document.getElementById('exam-active-container').classList.add('hidden');
    document.getElementById('exam-result-container').classList.remove('hidden');
    document.getElementById('active-exam-indicator').classList.add('hidden');

    renderExamScoreCard(report);
  }

  function renderExamScoreCard(report) {
    // Fill top metrics
    document.getElementById('res-total-score').textContent = `${report.totalScore} / ${report.maxPossibleScore}`;
    document.getElementById('res-accuracy').textContent = `${report.accuracy}%`;
    document.getElementById('res-time-taken').textContent = report.timeSpentFormatted;
    document.getElementById('res-cnt-total').textContent = report.counts.total;
    document.getElementById('res-cnt-correct').textContent = report.counts.correct;
    document.getElementById('res-cnt-incorrect').textContent = report.counts.incorrect;
    document.getElementById('res-cnt-unattempted').textContent = report.counts.unattempted;

    // Subject breakdown table
    const tableBody = document.getElementById('res-subject-table-body');
    if (tableBody) {
      tableBody.innerHTML = '';
      Object.keys(report.subjectBreakdown).forEach(subj => {
        const stat = report.subjectBreakdown[subj];
        if (stat.maxScore === 0) return;
        const row = document.createElement('tr');
        row.className = 'border-b border-slate-100 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300';
        row.innerHTML = `
          <td class="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100">${subj}</td>
          <td class="py-2.5 px-3 font-bold ${stat.score >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${stat.score} / ${stat.maxScore}</td>
          <td class="py-2.5 px-3 text-emerald-600 font-semibold">${stat.correct}</td>
          <td class="py-2.5 px-3 text-rose-600 font-semibold">${stat.incorrect}</td>
          <td class="py-2.5 px-3 text-slate-400 font-semibold">${stat.unattempted}</td>
          <td class="py-2.5 px-3 font-mono text-slate-500">${quizEngine.formatTime(stat.timeSpent)}</td>
        `;
        tableBody.appendChild(row);
      });
    }

    // Render questions list analysis
    filterResults('all');
  }

  function filterResults(filterType) {
    if (!activeExamReport) return;
    const btns = ['all', 'correct', 'incorrect', 'unattempted'];
    btns.forEach(b => {
      const el = document.getElementById(`res-filter-${b}`);
      if (el) {
        if (b === filterType) {
          el.className = 'px-2.5 py-1 rounded bg-white dark:bg-slate-700 shadow-xs text-blue-600 dark:text-blue-400 font-bold';
        } else {
          el.className = 'px-2.5 py-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-800';
        }
      }
    });

    const listEl = document.getElementById('res-questions-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const results = activeExamReport.questionResults.filter(q => {
      if (filterType === 'all') return true;
      return q.statusLabel === filterType;
    });

    if (results.length === 0) {
      listEl.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">No questions found under this filter.</p>`;
      return;
    }

    results.forEach((q, idx) => {
      const card = document.createElement('div');
      const borderColors = {
        correct: 'border-l-4 border-l-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20',
        incorrect: 'border-l-4 border-l-rose-500 bg-rose-50/20 dark:bg-rose-950/20',
        unattempted: 'border-l-4 border-l-slate-400 bg-slate-50/50 dark:bg-slate-800/30'
      };

      const statusBadges = {
        correct: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">+4 Correct</span>',
        incorrect: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300">-1 Incorrect</span>',
        unattempted: '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400">0 Skipped</span>'
      };

      card.className = `p-5 rounded-xl border border-slate-200 dark:border-slate-800 ${borderColors[q.statusLabel]} space-y-3`;
      
      const letters = ['A', 'B', 'C', 'D'];
      const formatAns = val => {
        if (val === null || val === undefined) return 'None';
        if (typeof val === 'number') return letters[val] || String(val);
        if (Array.isArray(val)) return val.map(v => typeof v === 'number' ? (letters[v] || v) : v).join(', ');
        return String(val);
      };

      card.innerHTML = `
        <div class="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-slate-700/60">
          <div class="flex items-center gap-2">
            <span class="font-bold text-xs text-slate-800 dark:text-slate-200">Q.${idx + 1} (${q.subject} - ${escapeHtml(q.topic)})</span>
            <span class="text-[10px] font-mono text-slate-400">⏱️ ${q.timeSpent}s</span>
          </div>
          <div>${statusBadges[q.statusLabel]}</div>
        </div>

        <div class="text-sm text-slate-800 dark:text-slate-100 leading-relaxed q-math-stem">
          ${escapeHtml(q.question)}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
          <div class="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <span class="text-slate-500 font-medium">Your Response:</span>
            <span class="font-bold ml-1 text-slate-900 dark:text-slate-100">${formatAns(q.userResponse)}</span>
          </div>
          <div class="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <span class="text-slate-500 font-medium">Correct Key:</span>
            <span class="font-bold ml-1 text-emerald-600 dark:text-emerald-400">${formatAns(q.correctAnswer)}</span>
          </div>
        </div>

        <div class="p-3.5 rounded-lg bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 space-y-1">
          <div class="font-bold text-blue-600 dark:text-blue-400 text-[11px] uppercase tracking-wider">Solution & Derivation:</div>
          <div class="leading-relaxed q-math-expl">
            ${escapeHtml(q.explanation || 'No step-by-step solution provided.')}
          </div>
        </div>
      `;

      listEl.appendChild(card);
      renderMath(card.querySelector('.q-math-stem'));
      renderMath(card.querySelector('.q-math-expl'));
    });
  }

  function resetToExamSetup() {
    document.getElementById('exam-result-container').classList.add('hidden');
    document.getElementById('exam-active-container').classList.add('hidden');
    document.getElementById('exam-setup-container').classList.remove('hidden');
  }

  function toggleMobilePalette() {
    const sidebar = document.getElementById('cbt-palette-sidebar');
    const txt = document.getElementById('txt-mobile-palette');
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle('mobile-collapsed');
    if (txt) {
      txt.textContent = isCollapsed ? 'Palette' : 'Close Palette';
    }
  }

  // =========================================================
  // MODE 2: PRACTICE & STUDY
  // =========================================================

  function launchSubjectPractice(subject) {
    const subjSelect = document.getElementById('practice-filter-subject');
    if (subjSelect) {
      subjSelect.value = subject;
    }
    const chapSelect = document.getElementById('practice-filter-chapter');
    if (chapSelect) {
      chapSelect.value = 'all';
    }
    const diffSelect = document.getElementById('practice-filter-difficulty');
    if (diffSelect) {
      diffSelect.value = 'all';
    }
    const typeSelect = document.getElementById('practice-filter-type');
    if (typeSelect) {
      typeSelect.value = 'all';
    }
    switchMode('practice');
  }

  function initPracticeView() {
    populatePracticeFilterDropdowns();
    applyPracticeFilters();
  }

  function populatePracticeFilterDropdowns() {
    const chapSelect = document.getElementById('practice-filter-chapter');
    if (!chapSelect) return;

    const subj = document.getElementById('practice-filter-subject').value;
    const chapters = new Set();
    allQuestions.forEach(q => {
      if (subj === 'all' || (q.subject || '').toLowerCase() === subj.toLowerCase()) {
        if (q.chapter) chapters.add(q.chapter);
      }
    });

    chapSelect.innerHTML = '<option value="all">All Chapters</option>';
    Array.from(chapters).sort().forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch;
      opt.textContent = ch;
      chapSelect.appendChild(opt);
    });
  }

  function onPracticeFilterChange() {
    applyPracticeFilters();
  }

  function resetPracticeFilters() {
    document.getElementById('practice-filter-subject').value = 'all';
    document.getElementById('practice-filter-chapter').value = 'all';
    document.getElementById('practice-filter-difficulty').value = 'all';
    document.getElementById('practice-filter-type').value = 'all';
    populatePracticeFilterDropdowns();
    applyPracticeFilters();
  }

  function applyPracticeFilters() {
    const subj = document.getElementById('practice-filter-subject').value;
    const chap = document.getElementById('practice-filter-chapter').value;
    const diff = document.getElementById('practice-filter-difficulty').value;
    const type = document.getElementById('practice-filter-type').value;

    practiceState.filteredQuestions = allQuestions.filter(q => {
      if (subj !== 'all' && (q.subject || '').toLowerCase() !== subj.toLowerCase()) return false;
      if (chap !== 'all' && (q.chapter || '').toLowerCase() !== chap.toLowerCase()) return false;
      if (diff !== 'all' && (q.difficulty || '').toLowerCase() !== diff.toLowerCase()) return false;
      if (type !== 'all' && (q.type || '').toLowerCase() !== type.toLowerCase()) return false;
      return true;
    });

    practiceState.currentIndex = 0;
    renderPracticeQuestion();
  }

  function renderPracticeQuestion() {
    const cardContainer = document.getElementById('practice-card-container');
    const emptyState = document.getElementById('prac-empty-state');
    const questions = practiceState.filteredQuestions;

    if (!questions || questions.length === 0) {
      if (cardContainer) cardContainer.classList.add('hidden');
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (cardContainer) cardContainer.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');

    const q = questions[practiceState.currentIndex];
    practiceState.selectedOption = null;
    practiceState.checked = false;
    practiceState.showingSolution = false;
    practiceState.showingHint = false;

    // Reset solution & hint boxes
    document.getElementById('prac-solution-box').classList.add('hidden');
    document.getElementById('prac-hint-box').classList.add('hidden');
    document.getElementById('prac-feedback-banner').classList.add('hidden');

    // Header Badges
    document.getElementById('prac-subject-badge').textContent = q.subject || 'Physics';
    document.getElementById('prac-chapter-badge').textContent = q.chapter || 'General';
    document.getElementById('prac-diff-badge').textContent = q.difficulty || 'JEE Main';
    document.getElementById('prac-year-badge').textContent = q.year || 'Practice Q';
    document.getElementById('prac-q-index').textContent = `Question ${practiceState.currentIndex + 1} of ${questions.length}`;

    // Question Text with KaTeX
    const qStemEl = document.getElementById('prac-question-text');
    qStemEl.innerHTML = escapeHtml(q.question || q.stem || '');
    renderMath(qStemEl);

    // Question Diagram Image (if any)
    const pracImgBox = document.getElementById('prac-question-image-box');
    const pracImg = document.getElementById('prac-question-img');
    const qImgSrc = q.image || q.imageUrl || q.image_url;
    if (pracImgBox && pracImg) {
      if (qImgSrc) {
        pracImg.src = qImgSrc;
        pracImgBox.classList.remove('hidden');
      } else {
        pracImgBox.classList.add('hidden');
      }
    }

    // Options Container
    const optsContainer = document.getElementById('prac-options-container');
    optsContainer.innerHTML = '';

    if (q.type === 'numerical') {
      optsContainer.innerHTML = `
        <div class="max-w-xs space-y-2">
          <label class="block text-xs font-bold text-slate-500">Your Answer:</label>
          <input type="number" step="any" id="prac-numerical-input" 
            oninput="App.onPracticeOptionSelect(this.value)"
            placeholder="e.g. 24 or 3.14" 
            class="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
      `;
    } else {
      const letters = ['A', 'B', 'C', 'D'];
      const rawOptions = q.options || [];

      rawOptions.forEach((opt, optIdx) => {
        const letter = letters[optIdx] || String(optIdx + 1);
        const text = typeof opt === 'object' && opt !== null ? (opt.text || '') : String(opt);

        const btn = document.createElement('div');
        btn.id = `prac-opt-${optIdx}`;
        btn.className = 'option-item p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 cursor-pointer flex items-start gap-3 transition-all';
        btn.onclick = () => onPracticeOptionSelect(optIdx);

        btn.innerHTML = `
          <span class="w-6 h-6 rounded-md bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-200">${letter}</span>
          <div class="flex-1 text-sm text-slate-800 dark:text-slate-200 leading-relaxed opt-text">${escapeHtml(text)}</div>
        `;
        optsContainer.appendChild(btn);
        renderMath(btn.querySelector('.opt-text'));
      });
    }

    // Prepare solution & hint contents
    const solEl = document.getElementById('prac-solution-content');
    solEl.innerHTML = escapeHtml(q.explanation || 'Step-by-step solution derivation will be shown here.');
    renderMath(solEl);

    // Solution Diagram Image (if any)
    const solImgBox = document.getElementById('prac-solution-image-box');
    const solImg = document.getElementById('prac-solution-img');
    const solImgSrc = q.solution_image || q.solutionImageUrl;
    if (solImgBox && solImg) {
      if (solImgSrc) {
        solImg.src = solImgSrc;
        solImgBox.classList.remove('hidden');
      } else {
        solImgBox.classList.add('hidden');
      }
    }

    const letters = ['A', 'B', 'C', 'D'];
    const corrStr = typeof q.correct_answer === 'number' 
      ? (letters[q.correct_answer] || q.correct_answer) 
      : (Array.isArray(q.correct_answer) ? q.correct_answer.join(', ') : (q.correct_answer || q.correctAnswer || ''));
    document.getElementById('prac-correct-key-label').textContent = `Correct Answer: ${corrStr}`;

    const hintEl = document.getElementById('prac-hint-content');
    hintEl.innerHTML = escapeHtml((q.hints && q.hints.length > 0) ? q.hints.join(' | ') : 'Remember standard formulas and conservation laws related to ' + (q.chapter || 'this topic') + '.');
    renderMath(hintEl);
  }

  function onPracticeOptionSelect(val) {
    const q = practiceState.filteredQuestions[practiceState.currentIndex];
    if (!q) return;

    if (q.type === 'multiple_choice') {
      let cur = Array.isArray(practiceState.selectedOption) ? [...practiceState.selectedOption] : [];
      const idx = Number(val);
      const pos = cur.indexOf(idx);
      if (pos > -1) cur.splice(pos, 1);
      else cur.push(idx);
      practiceState.selectedOption = cur.sort((a,b)=>a-b);
    } else {
      practiceState.selectedOption = val;
    }

    // Highlight selected options
    const rawOptions = q.options || [];
    rawOptions.forEach((_, optIdx) => {
      const btn = document.getElementById(`prac-opt-${optIdx}`);
      if (btn) {
        let isSel = false;
        if (q.type === 'multiple_choice') {
          isSel = (practiceState.selectedOption || []).includes(optIdx);
        } else {
          isSel = (practiceState.selectedOption === optIdx);
        }
        if (isSel) {
          btn.className = 'option-item p-4 rounded-xl border border-blue-500 bg-blue-50/70 dark:bg-blue-950/50 ring-2 ring-blue-500 cursor-pointer flex items-start gap-3 transition-all';
        } else {
          btn.className = 'option-item p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 cursor-pointer flex items-start gap-3 transition-all';
        }
      }
    });
  }

  function checkPracticeAnswer() {
    const q = practiceState.filteredQuestions[practiceState.currentIndex];
    if (!q) return;

    if (practiceState.selectedOption === null || practiceState.selectedOption === undefined) {
      showToast('Please select or enter an answer first.', 'warning');
      return;
    }

    const letters = ['A', 'B', 'C', 'D'];
    let isCorrect = false;

    if (q.type === 'single_choice') {
      const userIdx = Number(practiceState.selectedOption);
      let corrIdx = -1;
      const targetAns = q.correct_answer !== undefined ? q.correct_answer : q.correctAnswer;
      if (typeof targetAns === 'number') corrIdx = targetAns;
      else if (typeof targetAns === 'string') {
        const up = targetAns.trim().toUpperCase();
        corrIdx = letters.indexOf(up) > -1 ? letters.indexOf(up) : parseInt(up, 10);
      }
      isCorrect = (userIdx === corrIdx);
    } else if (q.type === 'multiple_choice') {
      const userArr = Array.isArray(practiceState.selectedOption) ? practiceState.selectedOption : [practiceState.selectedOption];
      const targetAns = q.correct_answer !== undefined ? q.correct_answer : q.correctAnswer;
      const toIndex = v => typeof v === 'number' ? v : (letters.indexOf(String(v).toUpperCase()) > -1 ? letters.indexOf(String(v).toUpperCase()) : parseInt(v, 10));
      const targetArr = (Array.isArray(targetAns) ? targetAns : [targetAns]).map(toIndex).sort();
      isCorrect = (userArr.length === targetArr.length && userArr.every((v, i) => v === targetArr[i]));
    } else if (q.type === 'numerical') {
      const userNum = parseFloat(String(practiceState.selectedOption).trim());
      const targetAns = q.correct_answer !== undefined ? q.correct_answer : q.correctAnswer;
      const corrNum = parseFloat(String(targetAns).trim());
      const tol = q.tolerance !== undefined ? q.tolerance : 0.05;
      isCorrect = Math.abs(userNum - corrNum) <= tol;
    }

    const feedbackBanner = document.getElementById('prac-feedback-banner');
    const feedbackText = document.getElementById('prac-feedback-text');

    feedbackBanner.classList.remove('hidden');
    if (isCorrect) {
      feedbackBanner.className = 'p-4 rounded-xl text-sm font-semibold flex items-center justify-between bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800';
      feedbackText.innerHTML = `
        <i data-lucide="check-circle" class="w-5 h-5 text-emerald-600"></i>
        <span>Correct! Excellent solution. (+4 Marks)</span>
      `;
      if (typeof confetti === 'function') {
        confetti({ particleCount: 30, spread: 60, origin: { y: 0.7 } });
      }
    } else {
      feedbackBanner.className = 'p-4 rounded-xl text-sm font-semibold flex items-center justify-between bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800';
      feedbackText.innerHTML = `
        <i data-lucide="x-circle" class="w-5 h-5 text-rose-600"></i>
        <span>Incorrect answer. Check the step-by-step solution below to learn the concept.</span>
      `;
      // Auto open solution on incorrect
      togglePracticeSolution(true);
    }

    if (window.lucide) lucide.createIcons({ root: feedbackBanner });
  }

  function togglePracticeSolution(forceShow = null) {
    const box = document.getElementById('prac-solution-box');
    const isHidden = box.classList.contains('hidden');
    const shouldShow = forceShow !== null ? forceShow : isHidden;
    if (shouldShow) {
      box.classList.remove('hidden');
      renderMath(box);
    } else {
      box.classList.add('hidden');
    }
  }

  function togglePracticeHint() {
    const box = document.getElementById('prac-hint-box');
    box.classList.toggle('hidden');
    renderMath(box);
  }

  function nextPracticeQuestion() {
    if (practiceState.currentIndex < practiceState.filteredQuestions.length - 1) {
      practiceState.currentIndex++;
      renderPracticeQuestion();
    } else {
      showToast('You reached the end of the filtered list.', 'info');
    }
  }

  function prevPracticeQuestion() {
    if (practiceState.currentIndex > 0) {
      practiceState.currentIndex--;
      renderPracticeQuestion();
    }
  }

  function randomPracticeQuestion() {
    const len = practiceState.filteredQuestions.length;
    if (len > 1) {
      let nextIdx = Math.floor(Math.random() * len);
      if (nextIdx === practiceState.currentIndex) nextIdx = (nextIdx + 1) % len;
      practiceState.currentIndex = nextIdx;
      renderPracticeQuestion();
    }
  }

  // =========================================================
  // MODE 3: DOCUMENT & IMAGE SCANNER
  // =========================================================

  function initScannerListeners() {
    const dropzone = document.getElementById('scanner-dropzone');
    const fileInput = document.getElementById('scanner-file-input');

    if (dropzone && fileInput) {
      ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('border-blue-500', 'bg-blue-50/20');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('border-blue-500', 'bg-blue-50/20');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          processScannedFile(files[0]);
        }
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          processScannedFile(e.target.files[0]);
        }
      });
    }

    // Global Screenshot Paste Event (Ctrl+V)
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData ? e.clipboardData.items : [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (currentMode === 'image-upload') {
            showToast('Question image pasted from clipboard!', 'success');
            setDirectImageFile(blob);
          } else {
            showToast('Image pasted from clipboard! Processing...', 'info');
            switchMode('scanner');
            processScannedFile(blob);
          }
          break;
        }
      }
    });

    // Setup direct image drag and drop
    const directDropzone = document.getElementById('direct-image-dropzone');
    if (directDropzone) {
      ['dragenter', 'dragover'].forEach(name => {
        directDropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          directDropzone.classList.add('border-emerald-500', 'bg-emerald-50/20');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        directDropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          directDropzone.classList.remove('border-emerald-500', 'bg-emerald-50/20');
        });
      });

      directDropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0 && files[0].type.startsWith('image/')) {
          setDirectImageFile(files[0]);
        }
      });
    }
  }

  function triggerClipboardPaste() {
    if (navigator.clipboard && navigator.clipboard.read) {
      navigator.clipboard.read().then(items => {
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            item.getType(imgType).then(blob => {
              showToast('Image pasted from clipboard!', 'info');
              processScannedFile(blob);
            });
            return;
          }
        }
        showToast('No image found in clipboard. Use Ctrl+V or upload a file.', 'warning');
      }).catch(() => {
        showToast('Clipboard access denied or unsupported. Please press Ctrl+V directly.', 'info');
      });
    } else {
      showToast('Press Ctrl+V anywhere to paste screenshot.', 'info');
    }
  }

  async function loadSamplePdfScan() {
    showToast('Loading sample JEE PDF paper for AI OCR test...', 'info');
    try {
      const res = await fetch('/sample-docs/jee-sample-test.pdf');
      if (!res.ok) throw new Error('Failed to load sample PDF');
      const blob = await res.blob();
      const file = new File([blob], 'jee-sample-test.pdf', { type: 'application/pdf' });
      processScannedFile(file);
    } catch (err) {
      showToast('Error loading sample PDF: ' + err.message, 'error');
    }
  }

  async function loadSampleImageScan() {
    showToast('Loading sample question image...', 'info');
    try {
      const apiKey = (window.JeeScanner && window.JeeScanner.getApiKey()) || (window.StorageService && window.StorageService.getApiKey()) || '';
      
      const res = await fetch('/sample-docs/sample-question-1.png');
      if (!res.ok) throw new Error('Failed to load sample image');
      const blob = await res.blob();
      const file = new File([blob], 'sample-question-1.png', { type: 'image/png' });

      if (!apiKey) {
        // Provide mock preview + simulated OCR extraction for instant testing
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.getElementById('scanner-image-preview');
          const canvas = document.getElementById('scanner-pdf-canvas');
          img.src = e.target.result;
          img.classList.remove('hidden');
          canvas.classList.add('hidden');
          document.getElementById('pdf-page-controls').classList.add('hidden');
        };
        reader.readAsDataURL(file);

        showToast('Simulating Multimodal OCR on sample image...', 'info');
        const simulatedQuestions = [
          {
            id: 'ocr_sample_01',
            subject: 'Physics',
            chapter: 'Mechanics & Simple Harmonic Motion',
            difficulty: 'JEE Advanced',
            type: 'single_choice',
            question: 'A uniform rod of length $L$ and mass $M$ is pivoted at one end. A small bead of mass $m$ is attached at a distance $x$ from the pivot. The time period of small oscillations about the horizontal axis through the pivot is $T = 2\\pi \\sqrt{\\frac{I}{mgx + \\frac{1}{2}MgL}}$. What value of $x$ minimizes the time period?',
            options: [
              { id: 'A', text: '$x = \\frac{L}{\\sqrt{3}}$' },
              { id: 'B', text: '$x = \\frac{L}{2}$' },
              { id: 'C', text: '$x = \\frac{L}{\\sqrt{6}}$' },
              { id: 'D', text: '$x = \\sqrt{\\frac{M}{3m}}L$' }
            ],
            correct_answer: 'D',
            explanation: 'The moment of inertia of the system about the pivot is:\n$$I = \\frac{1}{3}ML^2 + mx^2$$\nThe torque for small angular displacement $\\theta$ is:\n$$\\tau = -\\left(M g \\frac{L}{2} + m g x\\right)\\theta$$\nThe angular frequency is $\\omega^2 = \\frac{Mg\\frac{L}{2} + mgx}{\\frac{1}{3}ML^2 + mx^2}$. Minimizing $T$ corresponds to maximizing $\\omega^2$. Differentiating with respect to $x$ and setting to zero yields $x = \\sqrt{\\frac{M}{3m}}L$.'
          }
        ];

        document.getElementById('scanner-workbench').classList.remove('hidden');
        loadStagedQuestions(simulatedQuestions);
        showToast('Sample image loaded and parsed into verification workbench!', 'success');
        return;
      }

      processScannedFile(file);
    } catch (err) {
      showToast('Error loading sample image: ' + err.message, 'error');
    }
  }

  async function processScannedFile(file) {
    if (!file) return;

    // Show Progress Bar
    const progressContainer = document.getElementById('scanner-progress-container');
    const progressBar = document.getElementById('scanner-progress-bar');
    const progressStatus = document.getElementById('scanner-progress-status');
    const progressPercent = document.getElementById('scanner-progress-percent');
    const workbench = document.getElementById('scanner-workbench');

    progressContainer.classList.remove('hidden');
    workbench.classList.add('hidden');

    const updateProgress = (pct, status) => {
      progressBar.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}%`;
      progressStatus.textContent = status;
    };

    updateProgress(15, 'Reading file & loading PDF.js engine...');

    try {
      let parsedQuestions = [];
      const apiKey = (window.JeeScanner && window.JeeScanner.getApiKey()) || (window.StorageService && window.StorageService.getApiKey()) || '';

      // Preview setup
      const isPdf = file.type === 'application/pdf' || (file.name && file.name.endsWith('.pdf'));

      if (isPdf) {
        updateProgress(35, 'Rendering PDF pages with PDF.js...');
        if (window.PdfExtractor) {
          const pdfDoc = await window.PdfExtractor.load(file);
          scannerState.currentPdfDoc = pdfDoc;
          scannerState.totalPdfPages = pdfDoc.numPages;
          scannerState.currentPdfPage = 1;
          renderScannerPdfPage(1);
        }
      } else {
        // Image preview
        updateProgress(35, 'Generating image preview...');
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.getElementById('scanner-image-preview');
          const canvas = document.getElementById('scanner-pdf-canvas');
          img.src = e.target.result;
          img.classList.remove('hidden');
          canvas.classList.add('hidden');
          document.getElementById('pdf-page-controls').classList.add('hidden');
        };
        reader.readAsDataURL(file);
      }

      // Perform extraction
      updateProgress(60, apiKey ? 'Querying Gemini Multimodal AI OCR...' : 'Performing local pattern regex extraction...');

      if (window.JeeScanner || window.Scanner) {
        const scannerInstance = window.JeeScanner || window.Scanner;
        const scanRes = await scannerInstance.scanDocument(file, {
          apiKey: apiKey,
          onProgress: (p) => {
            const pct = p.percent || 75;
            updateProgress(Math.min(90, Math.max(20, pct)), p.message || p.status || 'Extracting questions...');
          }
        });

        if (scanRes && scanRes.success === false && (!scanRes.questions || scanRes.questions.length === 0)) {
          throw new Error(scanRes.error || 'Failed to extract questions from document');
        }

        parsedQuestions = Array.isArray(scanRes) ? scanRes : (scanRes.questions || []);
      } else {
        throw new Error('Scanner service not initialized');
      }

      updateProgress(100, `Found ${parsedQuestions.length} questions!`);

      setTimeout(() => {
        progressContainer.classList.add('hidden');
        workbench.classList.remove('hidden');
        loadStagedQuestions(parsedQuestions);
        showToast(`Extraction complete: ${parsedQuestions.length} questions ready for verification!`, 'success');
      }, 500);

    } catch (err) {
      console.error('Scan error:', err);
      progressContainer.classList.add('hidden');
      showToast('Scan error: ' + err.message, 'error');
    }
  }

  async function renderScannerPdfPage(pageNum) {
    if (!scannerState.currentPdfDoc) return;
    const canvas = document.getElementById('scanner-pdf-canvas');
    const img = document.getElementById('scanner-image-preview');
    const controls = document.getElementById('pdf-page-controls');
    const indicator = document.getElementById('pdf-page-indicator');

    canvas.classList.remove('hidden');
    img.classList.add('hidden');
    controls.classList.remove('hidden');
    indicator.textContent = `Page ${pageNum}/${scannerState.totalPdfPages}`;

    try {
      await scannerState.currentPdfDoc.renderPageToCanvas(pageNum, canvas, { scale: 1.2 });
    } catch (e) {
      console.warn('Canvas render error:', e);
    }
  }

  function scannerPdfPrevPage() {
    if (scannerState.currentPdfPage > 1) {
      scannerState.currentPdfPage--;
      renderScannerPdfPage(scannerState.currentPdfPage);
    }
  }

  function scannerPdfNextPage() {
    if (scannerState.currentPdfPage < scannerState.totalPdfPages) {
      scannerState.currentPdfPage++;
      renderScannerPdfPage(scannerState.currentPdfPage);
    }
  }

  function loadStagedQuestions(questions) {
    scannerState.stagedQuestions = questions.map((q, idx) => ({
      id: q.id || `scanned_${Date.now()}_${idx + 1}`,
      subject: q.subject || 'Physics',
      chapter: q.chapter || 'General',
      difficulty: q.difficulty || 'JEE Main',
      type: q.type || 'single_choice',
      question: q.question || q.stem || '',
      options: q.options || [],
      correct_answer: q.correct_answer !== undefined ? q.correct_answer : (q.correctAnswer !== undefined ? q.correctAnswer : 'A'),
      explanation: q.explanation || '',
      marks: q.marks || { correct: 4, incorrect: -1 }
    }));

    document.getElementById('staged-count').textContent = scannerState.stagedQuestions.length;
    renderStagedQuestionsList();
  }

  function renderStagedQuestionsList() {
    const container = document.getElementById('staged-questions-container');
    if (!container) return;
    container.innerHTML = '';

    if (scannerState.stagedQuestions.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">No staged questions. Scan a document above.</div>`;
      return;
    }

    scannerState.stagedQuestions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-4';
      
      const letters = ['A', 'B', 'C', 'D'];
      const rawOpts = q.options || [];

      let optionsInputs = '';
      if (q.type !== 'numerical') {
        optionsInputs = rawOpts.map((opt, oIdx) => {
          const l = letters[oIdx] || String(oIdx + 1);
          const val = typeof opt === 'object' && opt !== null ? (opt.text || '') : String(opt);
          return `
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs">${l}</span>
              <input type="text" value="${escapeHtml(val)}" 
                onchange="App.updateStagedOption(${idx}, ${oIdx}, this.value)"
                class="flex-1 px-2.5 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono">
            </div>
          `;
        }).join('');
      }

      card.innerHTML = `
        <div class="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">Question ${idx + 1}</span>
            <select onchange="App.updateStagedField(${idx}, 'subject', this.value)" class="text-xs font-bold rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5">
              <option value="Physics" ${q.subject === 'Physics' ? 'selected' : ''}>Physics</option>
              <option value="Chemistry" ${q.subject === 'Chemistry' ? 'selected' : ''}>Chemistry</option>
              <option value="Mathematics" ${q.subject === 'Mathematics' ? 'selected' : ''}>Mathematics</option>
            </select>
          </div>
          <div class="flex items-center gap-1.5">
            <button onclick="App.addSingleStagedQuestion(${idx})" class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add
            </button>
            <button onclick="App.discardStagedQuestion(${idx})" class="p-1 rounded text-slate-400 hover:text-rose-500">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <div>
          <label class="block text-[11px] font-bold text-slate-400 mb-1">Question LaTeX Stem:</label>
          <textarea rows="2" onchange="App.updateStagedField(${idx}, 'question', this.value)" class="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono">${escapeHtml(q.question)}</textarea>
          <div class="mt-1 p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 text-xs font-medium staged-stem-preview">
            ${escapeHtml(q.question)}
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="block text-[11px] font-bold text-slate-400">Options & Answer:</label>
          ${optionsInputs}
          <div class="flex items-center gap-2 pt-1 text-xs">
            <span class="font-bold text-slate-500">Correct Key:</span>
            <input type="text" value="${escapeHtml(String(q.correct_answer))}" 
              onchange="App.updateStagedField(${idx}, 'correct_answer', this.value)"
              class="w-20 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-emerald-600">
          </div>
        </div>

        <div>
          <label class="block text-[11px] font-bold text-slate-400 mb-1">Step-by-Step Explanation:</label>
          <textarea rows="2" onchange="App.updateStagedField(${idx}, 'explanation', this.value)" class="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono">${escapeHtml(q.explanation)}</textarea>
        </div>
      `;

      container.appendChild(card);
      renderMath(card.querySelector('.staged-stem-preview'));
    });

    if (window.lucide) lucide.createIcons({ root: container });
  }

  function updateStagedField(idx, field, value) {
    if (scannerState.stagedQuestions[idx]) {
      scannerState.stagedQuestions[idx][field] = value;
    }
  }

  function updateStagedOption(qIdx, optIdx, val) {
    const q = scannerState.stagedQuestions[qIdx];
    if (q && q.options && q.options[optIdx]) {
      if (typeof q.options[optIdx] === 'object') {
        q.options[optIdx].text = val;
      } else {
        q.options[optIdx] = val;
      }
    }
  }

  function discardStagedQuestion(idx) {
    scannerState.stagedQuestions.splice(idx, 1);
    document.getElementById('staged-count').textContent = scannerState.stagedQuestions.length;
    renderStagedQuestionsList();
  }

  function clearStagedQuestions() {
    scannerState.stagedQuestions = [];
    document.getElementById('staged-count').textContent = 0;
    document.getElementById('scanner-workbench').classList.add('hidden');
    showToast('Staged questions discarded.', 'info');
  }

  async function addSingleStagedQuestion(idx) {
    const q = scannerState.stagedQuestions[idx];
    if (!q || !window.StorageService) return;

    try {
      await window.StorageService.addQuestion(q);
      showToast(`Question ${idx + 1} added to Question Bank!`, 'success');
      discardStagedQuestion(idx);
    } catch (err) {
      showToast('Error adding question: ' + err.message, 'error');
    }
  }

  async function addAllStagedQuestions() {
    const list = scannerState.stagedQuestions;
    if (list.length === 0 || !window.StorageService) return;

    try {
      await window.StorageService.addQuestion(list);
      showToast(`Successfully added all ${list.length} questions to Question Bank!`, 'success');
      clearStagedQuestions();
      refreshQuestionsData();
    } catch (err) {
      showToast('Error adding questions: ' + err.message, 'error');
    }
  }

  // =========================================================
  // MODE 4: QUESTION BANK & MANAGER
  // =========================================================

  function renderBankView() {
    updateHeaderStats();
    const listEl = document.getElementById('bank-questions-list');
    if (!listEl) return;

    let filtered = [...allQuestions];
    if (bankSubjectFilter !== 'all') {
      filtered = filtered.filter(q => (q.subject || '').toLowerCase() === bankSubjectFilter.toLowerCase());
    }
    if (bankSearchQuery.trim()) {
      const qry = bankSearchQuery.toLowerCase();
      filtered = filtered.filter(q => 
        (q.question || '').toLowerCase().includes(qry) ||
        (q.chapter || '').toLowerCase().includes(qry) ||
        (q.subject || '').toLowerCase().includes(qry)
      );
    }

    listEl.innerHTML = '';

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <i data-lucide="database" class="w-10 h-10 text-slate-300 mx-auto mb-2"></i>
          <p class="text-sm font-bold text-slate-600 dark:text-slate-300">No questions found</p>
          <p class="text-xs text-slate-400 mt-1">Try changing filters, adding a question manually, or seeding sample questions.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ root: listEl });
      return;
    }

    filtered.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3';
      
      const subjectColors = {
        Physics: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        Chemistry: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        Mathematics: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
      };

      card.innerHTML = `
        <div class="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-0.5 rounded text-xs font-bold ${subjectColors[q.subject] || 'bg-slate-100 text-slate-700'}">${q.subject}</span>
            <span class="px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">${escapeHtml(q.chapter || 'General')}</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50">${q.difficulty || 'JEE Main'}</span>
            <span class="text-[10px] text-slate-400">${q.year || ''}</span>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="App.openEditQuestionModal('${q.id}')" class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Edit Question">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="App.deleteQuestion('${q.id}')" class="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30" title="Delete Question">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <div class="text-sm font-normal text-slate-800 dark:text-slate-100 leading-relaxed bank-q-stem">
          ${escapeHtml(q.question || q.stem || '')}
        </div>

        ${(q.image || q.imageUrl || q.image_url) ? `
          <div class="pt-1">
            <div class="inline-flex items-center gap-2 p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" onclick="App.openImageLightbox('${q.image || q.imageUrl || q.image_url}')">
              <img src="${q.image || q.imageUrl || q.image_url}" class="w-12 h-10 object-contain rounded bg-white shadow-2xs" alt="Diagram Thumbnail">
              <span class="text-xs text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1">
                <i data-lucide="zoom-in" class="w-3.5 h-3.5"></i> View Diagram
              </span>
            </div>
          </div>
        ` : ''}

        <div class="pt-2 flex items-center justify-between text-xs text-slate-500">
          <span>Type: <strong class="text-slate-700 dark:text-slate-300">${q.type || 'single_choice'}</strong></span>
          <span class="text-emerald-600 font-bold">Key: ${escapeHtml(String(q.correct_answer !== undefined ? q.correct_answer : (q.correctAnswer || '')))}</span>
        </div>
      `;

      listEl.appendChild(card);
      renderMath(card.querySelector('.bank-q-stem'));
    });

    if (window.lucide) lucide.createIcons({ root: listEl });
  }

  function onBankSearch() {
    bankSearchQuery = document.getElementById('bank-search-input').value;
    renderBankView();
  }

  function filterBankBySubject(subject) {
    bankSubjectFilter = subject;
    const pills = ['all', 'phy', 'chem', 'math'];
    const map = { all: 'all', phy: 'Physics', chem: 'Chemistry', math: 'Mathematics' };

    pills.forEach(p => {
      const el = document.getElementById(`bank-pill-${p}`);
      if (el) {
        if (map[p].toLowerCase() === subject.toLowerCase()) {
          el.className = 'bank-pill active px-3 py-1 rounded-full font-semibold bg-blue-600 text-white';
        } else {
          el.className = 'bank-pill px-3 py-1 rounded-full font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200';
        }
      }
    });

    renderBankView();
  }

  async function loadSampleQuestions() {
    if (!window.StorageService) return;
    try {
      showToast('Seeding 20 authentic JEE sample questions...', 'info');
      await window.StorageService.resetQuestions();
      await refreshQuestionsData();
      showToast('Sample questions loaded successfully!', 'success');
    } catch (err) {
      showToast('Error resetting questions: ' + err.message, 'error');
    }
  }

  function exportQuestionsJSON() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(allQuestions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `jee-questions-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Question bank exported to JSON!', 'success');
  }

  function importQuestionsJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        const items = Array.isArray(parsed) ? parsed : (parsed.questions || [parsed]);
        if (window.StorageService) {
          await window.StorageService.addQuestion(items);
          await refreshQuestionsData();
          showToast(`Successfully imported ${items.length} questions!`, 'success');
        }
      } catch (err) {
        showToast('Invalid JSON file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  async function deleteQuestion(id) {
    if (!confirm('Are you sure you want to delete this question?')) return;
    if (window.StorageService) {
      try {
        await window.StorageService.deleteQuestion(id);
        await refreshQuestionsData();
        showToast('Question deleted.', 'info');
      } catch (err) {
        showToast('Delete error: ' + err.message, 'error');
      }
    }
  }

  // Question Modal (Add / Edit) with Live KaTeX Preview
  function openAddQuestionModal() {
    document.getElementById('modal-q-title').textContent = 'Add New JEE Question';
    document.getElementById('edit-q-id').value = '';
    document.getElementById('edit-q-subject').value = 'Physics';
    document.getElementById('edit-q-chapter').value = '';
    document.getElementById('edit-q-difficulty').value = 'JEE Main';
    document.getElementById('edit-q-type').value = 'single_choice';
    document.getElementById('edit-q-text').value = '';
    document.getElementById('edit-opt-0').value = '';
    document.getElementById('edit-opt-1').value = '';
    document.getElementById('edit-opt-2').value = '';
    document.getElementById('edit-opt-3').value = '';
    document.getElementById('edit-q-correct').value = 'A';
    document.getElementById('edit-q-expl').value = '';

    onModalTypeChange();
    updateLivePreview();
    document.getElementById('modal-edit-question').classList.remove('hidden');
  }

  function openEditQuestionModal(id) {
    const q = allQuestions.find(item => String(item.id) === String(id));
    if (!q) return;

    document.getElementById('modal-q-title').textContent = 'Edit JEE Question';
    document.getElementById('edit-q-id').value = q.id;
    document.getElementById('edit-q-subject').value = q.subject || 'Physics';
    document.getElementById('edit-q-chapter').value = q.chapter || '';
    document.getElementById('edit-q-difficulty').value = q.difficulty || 'JEE Main';
    document.getElementById('edit-q-type').value = q.type || 'single_choice';
    document.getElementById('edit-q-text').value = q.question || q.stem || '';

    const opts = q.options || [];
    const getOpt = i => opts[i] ? (typeof opts[i] === 'object' ? opts[i].text : opts[i]) : '';
    document.getElementById('edit-opt-0').value = getOpt(0);
    document.getElementById('edit-opt-1').value = getOpt(1);
    document.getElementById('edit-opt-2').value = getOpt(2);
    document.getElementById('edit-opt-3').value = getOpt(3);

    const corr = q.correct_answer !== undefined ? q.correct_answer : (q.correctAnswer || '');
    document.getElementById('edit-q-correct').value = Array.isArray(corr) ? corr.join(',') : String(corr);
    document.getElementById('edit-q-expl').value = q.explanation || '';

    onModalTypeChange();
    updateLivePreview();
    document.getElementById('modal-edit-question').classList.remove('hidden');
  }

  function closeQuestionModal() {
    document.getElementById('modal-edit-question').classList.add('hidden');
  }

  function onModalTypeChange() {
    const type = document.getElementById('edit-q-type').value;
    const mcqOpts = document.getElementById('edit-mcq-options');
    if (type === 'numerical') {
      mcqOpts.classList.add('hidden');
    } else {
      mcqOpts.classList.remove('hidden');
    }
    updateLivePreview();
  }

  function updateLivePreview() {
    const qText = document.getElementById('edit-q-text').value;
    const type = document.getElementById('edit-q-type').value;
    const expl = document.getElementById('edit-q-expl').value;

    const prevQ = document.getElementById('preview-q-text');
    prevQ.innerHTML = escapeHtml(qText || '(Question text preview)');
    renderMath(prevQ);

    const prevOpts = document.getElementById('preview-q-options');
    prevOpts.innerHTML = '';

    if (type !== 'numerical') {
      const letters = ['A', 'B', 'C', 'D'];
      letters.forEach((l, i) => {
        const val = document.getElementById(`edit-opt-${i}`).value;
        if (val) {
          const row = document.createElement('div');
          row.className = 'p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2';
          row.innerHTML = `<span class="font-bold text-slate-500">${l}.</span> <span class="prev-math">${escapeHtml(val)}</span>`;
          prevOpts.appendChild(row);
          renderMath(row.querySelector('.prev-math'));
        }
      });
    }

    const prevExpl = document.getElementById('preview-q-expl');
    prevExpl.innerHTML = `<strong>Solution Preview:</strong><div class="mt-1">${escapeHtml(expl || 'No explanation.')}</div>`;
    renderMath(prevExpl);
  }

  async function saveQuestionFromModal() {
    const id = document.getElementById('edit-q-id').value;
    const subject = document.getElementById('edit-q-subject').value;
    const chapter = document.getElementById('edit-q-chapter').value;
    const difficulty = document.getElementById('edit-q-difficulty').value;
    const type = document.getElementById('edit-q-type').value;
    const question = document.getElementById('edit-q-text').value.trim();
    const expl = document.getElementById('edit-q-expl').value.trim();
    const correctRaw = document.getElementById('edit-q-correct').value.trim();

    if (!question) {
      showToast('Question text cannot be empty.', 'warning');
      return;
    }

    const options = (type === 'numerical') ? [] : [
      { id: 'A', text: document.getElementById('edit-opt-0').value.trim() },
      { id: 'B', text: document.getElementById('edit-opt-1').value.trim() },
      { id: 'C', text: document.getElementById('edit-opt-2').value.trim() },
      { id: 'D', text: document.getElementById('edit-opt-3').value.trim() }
    ];

    let correct_answer = correctRaw;
    if (type === 'multiple_choice' && correctRaw.includes(',')) {
      correct_answer = correctRaw.split(',').map(s => s.trim().toUpperCase());
    }

    const payload = {
      subject,
      chapter: chapter || 'General',
      difficulty,
      type,
      question,
      options,
      correct_answer,
      explanation: expl,
      marks: { correct: 4, incorrect: type === 'numerical' ? 0 : -1 }
    };

    try {
      if (id) {
        await window.StorageService.updateQuestion(id, payload);
        showToast('Question updated successfully!', 'success');
      } else {
        await window.StorageService.addQuestion(payload);
        showToast('Question created successfully!', 'success');
      }
      closeQuestionModal();
      await refreshQuestionsData();
    } catch (err) {
      showToast('Save error: ' + err.message, 'error');
    }
  }

  // =========================================================
  // MODE 5: ANALYTICS & PERFORMANCE
  // =========================================================

  async function renderAnalyticsView() {
    if (!window.StorageService) return;
    try {
      const analytics = await window.StorageService.getAnalytics();
      const attempts = await window.StorageService.getAttempts();

      document.getElementById('ana-tests-count').textContent = analytics.testsCount;
      document.getElementById('ana-avg-score').textContent = `${analytics.averageScore}%`;
      document.getElementById('ana-accuracy').textContent = `${analytics.overallAccuracy}%`;

      const hours = Math.floor(analytics.totalTimeSeconds / 3600);
      const mins = Math.floor((analytics.totalTimeSeconds % 3600) / 60);
      document.getElementById('ana-total-time').textContent = `${hours}h ${mins}m`;

      // Subject stats
      const sb = analytics.subjectBreakdown || {};
      const updateSubj = (name, prefix) => {
        const s = sb[name] || { accuracy: 0, attempted: 0, correct: 0 };
        const accEl = document.getElementById(`ana-${prefix}-acc`);
        const barEl = document.getElementById(`ana-${prefix}-bar`);
        const attEl = document.getElementById(`ana-${prefix}-att`);
        const corEl = document.getElementById(`ana-${prefix}-cor`);

        if (accEl) accEl.textContent = `${s.accuracy}%`;
        if (barEl) barEl.style.width = `${s.accuracy}%`;
        if (attEl) attEl.textContent = s.attempted;
        if (corEl) corEl.textContent = `${s.accuracy}% (${s.correct} correct)`;
      };

      updateSubj('Physics', 'phy');
      updateSubj('Chemistry', 'chem');
      updateSubj('Mathematics', 'math');

      // Attempts history table
      const tbody = document.getElementById('ana-history-table-body');
      if (tbody) {
        tbody.innerHTML = '';
        if (attempts.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400 text-xs">No exam attempts recorded yet. Take a test in the Simulator!</td></tr>`;
        } else {
          attempts.slice(-10).reverse().forEach(att => {
            const row = document.createElement('tr');
            row.className = 'border-b border-slate-100 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300';
            const dateStr = att.date ? new Date(att.date).toLocaleDateString() + ' ' + new Date(att.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Recent';
            row.innerHTML = `
              <td class="py-2.5 px-3 font-mono text-[11px]">${dateStr}</td>
              <td class="py-2.5 px-3 font-bold uppercase">${att.examType || 'JEE Main'}</td>
              <td class="py-2.5 px-3 font-bold text-blue-600">${att.totalScore} / ${att.maxPossibleScore}</td>
              <td class="py-2.5 px-3">${att.percentage}%</td>
              <td class="py-2.5 px-3 text-emerald-600 font-semibold">${att.accuracy}%</td>
              <td class="py-2.5 px-3 font-mono text-slate-500">${att.timeSpentFormatted || '00:00'}</td>
            `;
            tbody.appendChild(row);
          });
        }
      }

    } catch (err) {
      console.error('Analytics render error:', err);
    }
  }

  // =========================================================
  // GEMINI API KEY MODAL & SETTINGS
  // =========================================================

  function openApiKeyModal() {
    const key = (window.JeeScanner && window.JeeScanner.getApiKey()) || (window.StorageService && window.StorageService.getApiKey()) || '';
    document.getElementById('input-gemini-key').value = key;
    document.getElementById('modal-apikey').classList.remove('hidden');
  }

  function closeApiKeyModal() {
    document.getElementById('modal-apikey').classList.add('hidden');
  }

  function saveApiKey() {
    const key = document.getElementById('input-gemini-key').value.trim();
    if (window.JeeScanner) window.JeeScanner.setApiKey(key);
    if (window.StorageService) window.StorageService.setApiKey(key);
    updateApiKeyStatusDot(!!key);
    closeApiKeyModal();
    showToast(key ? 'Gemini API key saved!' : 'API key cleared.', 'success');
  }

  async function testApiKeyConnection() {
    const key = document.getElementById('input-gemini-key').value.trim();
    if (!key) {
      showToast('Please enter an API key to test.', 'warning');
      return;
    }
    const btn = document.getElementById('btn-test-key');
    btn.textContent = 'Testing...';

    if (window.JeeScanner) {
      const res = await window.JeeScanner.testApiKey(key);
      btn.textContent = 'Test Connection';
      if (res.success) {
        showToast('Gemini connection verified successfully!', 'success');
      } else {
        showToast('Connection failed: ' + res.message, 'error');
      }
    }
  }

  function checkApiKeyStatus() {
    const hasKey = (window.JeeScanner && window.JeeScanner.hasApiKey()) || (window.StorageService && !!window.StorageService.getApiKey());
    updateApiKeyStatusDot(hasKey);
  }

  function updateApiKeyStatusDot(hasKey) {
    const dot = document.getElementById('api-key-status-dot');
    const badge = document.getElementById('scanner-api-badge');
    if (dot) {
      if (hasKey) {
        dot.className = 'absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
      } else {
        dot.className = 'absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-slate-400';
      }
    }
    if (badge) {
      badge.textContent = hasKey ? 'Gemini AI Active' : 'Configure Gemini Key';
    }
  }

  // =========================================================
  // DIRECT IMAGE QUESTION WORKFLOW (NO AI SCAN NEEDED)
  // =========================================================

  let directImageState = {
    file: null,
    dataUrl: null,
    solutionFile: null,
    solutionDataUrl: null,
    selectedSingleAnswer: 'A',
    selectedMultiAnswers: ['A']
  };

  function handleDirectImageSelect(event) {
    const file = event.target.files ? event.target.files[0] : null;
    if (!file) return;
    setDirectImageFile(file);
  }

  function setDirectImageFile(file) {
    directImageState.file = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      directImageState.dataUrl = e.target.result;
      const preview = document.getElementById('direct-image-preview');
      const prompt = document.getElementById('direct-image-prompt');
      const actions = document.getElementById('direct-image-actions');
      if (preview && prompt) {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        prompt.classList.add('hidden');
        if (actions) actions.classList.remove('hidden');
      }
    };
    reader.readAsDataURL(file);
  }

  function clearDirectImage() {
    directImageState.file = null;
    directImageState.dataUrl = null;
    const preview = document.getElementById('direct-image-preview');
    const prompt = document.getElementById('direct-image-prompt');
    const actions = document.getElementById('direct-image-actions');
    const fileInput = document.getElementById('direct-image-input');
    if (fileInput) fileInput.value = '';
    if (preview) {
      preview.src = '';
      preview.classList.add('hidden');
    }
    if (prompt) prompt.classList.remove('hidden');
    if (actions) actions.classList.add('hidden');
  }

  function handleDirectSolutionImageSelect(event) {
    const file = event.target.files ? event.target.files[0] : null;
    if (!file) return;
    directImageState.solutionFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      directImageState.solutionDataUrl = e.target.result;
      const preview = document.getElementById('direct-sol-image-preview');
      const prompt = document.getElementById('direct-sol-prompt');
      if (preview && prompt) {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        prompt.innerHTML = '<span class="text-emerald-600 font-medium flex items-center gap-1"><i data-lucide="check" class="w-3.5 h-3.5"></i> Solution diagram attached</span>';
        if (window.lucide) lucide.createIcons({ root: prompt });
      }
    };
    reader.readAsDataURL(file);
  }

  function onDirectTypeChange() {
    const type = document.getElementById('direct-q-type') ? document.getElementById('direct-q-type').value : 'single_choice';
    const singleBox = document.getElementById('direct-ans-single');
    const multiBox = document.getElementById('direct-ans-multi');
    const numBox = document.getElementById('direct-ans-num');

    if (!singleBox || !multiBox || !numBox) return;

    if (type === 'single_choice') {
      singleBox.classList.remove('hidden');
      multiBox.classList.add('hidden');
      numBox.classList.add('hidden');
    } else if (type === 'multiple_choice') {
      singleBox.classList.add('hidden');
      multiBox.classList.remove('hidden');
      numBox.classList.add('hidden');
    } else if (type === 'numerical') {
      singleBox.classList.add('hidden');
      multiBox.classList.add('hidden');
      numBox.classList.remove('hidden');
    }
  }

  function setDirectSingleAnswer(key) {
    directImageState.selectedSingleAnswer = key;
    ['A', 'B', 'C', 'D'].forEach(k => {
      const btn = document.getElementById(`btn-direct-ans-${k}`);
      if (btn) {
        if (k === key) {
          btn.className = 'direct-opt-btn active py-2 rounded-lg border text-xs font-bold text-center border-blue-600 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300';
        } else {
          btn.className = 'direct-opt-btn py-2 rounded-lg border text-xs font-bold text-center border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300';
        }
      }
    });
  }

  function toggleDirectMultiAnswer(key) {
    const arr = directImageState.selectedMultiAnswers;
    const idx = arr.indexOf(key);
    if (idx > -1) {
      if (arr.length > 1) arr.splice(idx, 1);
    } else {
      arr.push(key);
    }
    arr.sort();

    ['A', 'B', 'C', 'D'].forEach(k => {
      const btn = document.getElementById(`btn-direct-multi-${k}`);
      if (btn) {
        if (arr.includes(k)) {
          btn.className = 'direct-multi-btn active py-2 rounded-lg border text-xs font-bold text-center border-purple-600 bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300';
        } else {
          btn.className = 'direct-multi-btn py-2 rounded-lg border text-xs font-bold text-center border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300';
        }
      }
    });
  }

  function resetDirectImageForm() {
    clearDirectImage();
    directImageState.solutionFile = null;
    directImageState.solutionDataUrl = null;
    const solPrev = document.getElementById('direct-sol-image-preview');
    if (solPrev) {
      solPrev.src = '';
      solPrev.classList.add('hidden');
    }
    const solPrompt = document.getElementById('direct-sol-prompt');
    if (solPrompt) {
      solPrompt.innerHTML = '<i data-lucide="image-plus" class="w-4 h-4 text-slate-400"></i><span>Attach solution diagram (optional)</span>';
      if (window.lucide) lucide.createIcons({ root: solPrompt });
    }
    const chEl = document.getElementById('direct-q-chapter');
    if (chEl) chEl.value = '';
    const capEl = document.getElementById('direct-q-caption');
    if (capEl) capEl.value = '';
    const explEl = document.getElementById('direct-q-expl');
    if (explEl) explEl.value = '';
    const numEl = document.getElementById('direct-numerical-ans');
    if (numEl) numEl.value = '';
    setDirectSingleAnswer('A');
    directImageState.selectedMultiAnswers = ['A'];
    toggleDirectMultiAnswer('A');
  }

  async function saveDirectImageQuestion() {
    if (!directImageState.dataUrl && !directImageState.file) {
      showToast('Please attach or paste a question image first.', 'warning');
      return;
    }

    const subject = document.getElementById('direct-q-subject').value;
    const chapter = document.getElementById('direct-q-chapter').value.trim() || 'General';
    const difficulty = document.getElementById('direct-q-difficulty').value;
    const type = document.getElementById('direct-q-type').value;
    const caption = document.getElementById('direct-q-caption').value.trim();
    const explanation = document.getElementById('direct-q-expl').value.trim();

    let correctAnswer = 'A';
    if (type === 'single_choice') {
      correctAnswer = directImageState.selectedSingleAnswer;
    } else if (type === 'multiple_choice') {
      correctAnswer = directImageState.selectedMultiAnswers;
    } else if (type === 'numerical') {
      const numVal = document.getElementById('direct-numerical-ans').value.trim();
      if (!numVal) {
        showToast('Please enter the numerical answer key.', 'warning');
        return;
      }
      correctAnswer = numVal;
    }

    showToast('Saving question image to Question Bank...', 'info');

    try {
      let finalImageUrl = directImageState.dataUrl;
      let finalSolutionImageUrl = directImageState.solutionDataUrl || null;

      // Try uploading image to backend /api/upload-image
      if (window.StorageService && typeof window.StorageService.uploadImage === 'function') {
        try {
          const uploadRes = await window.StorageService.uploadImage(directImageState.file || directImageState.dataUrl, `qimg_${Date.now()}.png`);
          if (uploadRes && uploadRes.url) {
            finalImageUrl = uploadRes.url;
          }
        } catch (uErr) {
          console.warn('Backend upload failed, using inline base64 image:', uErr);
        }

        if (directImageState.solutionDataUrl) {
          try {
            const solRes = await window.StorageService.uploadImage(directImageState.solutionFile || directImageState.solutionDataUrl, `sol_${Date.now()}.png`);
            if (solRes && solRes.url) {
              finalSolutionImageUrl = solRes.url;
            }
          } catch (sErr) {
            console.warn('Solution image upload failed, using inline base64:', sErr);
          }
        }
      }

      const questionText = caption || 'Refer to the question diagram shown below:';
      const questionPayload = {
        subject,
        chapter,
        difficulty,
        type,
        question: questionText,
        image: finalImageUrl,
        imageUrl: finalImageUrl,
        solution_image: finalSolutionImageUrl,
        solutionImageUrl: finalSolutionImageUrl,
        options: type === 'numerical' ? [] : [
          { id: 'A', text: 'Option A (as in diagram)' },
          { id: 'B', text: 'Option B (as in diagram)' },
          { id: 'C', text: 'Option C (as in diagram)' },
          { id: 'D', text: 'Option D (as in diagram)' }
        ],
        correct_answer: correctAnswer,
        explanation: explanation || 'Refer to the question diagram and step-by-step solution.',
        marks: { correct: 4, incorrect: type === 'numerical' ? 0 : -1 }
      };

      if (window.StorageService) {
        await window.StorageService.addQuestion(questionPayload);
      }

      showToast('Image question saved directly to Question Bank!', 'success');
      resetDirectImageForm();
      await refreshQuestionsData();

      // Switch to bank to show newly added question
      setTimeout(() => {
        switchMode('bank');
      }, 600);

    } catch (err) {
      console.error('Error saving image question:', err);
      showToast('Failed to save question: ' + err.message, 'error');
    }
  }

  // Lightbox handlers
  function openImageLightbox(src) {
    if (!src) return;
    const modal = document.getElementById('modal-image-lightbox');
    const img = document.getElementById('lightbox-image-src');
    if (modal && img) {
      img.src = src;
      modal.classList.remove('hidden');
    }
  }

  function closeImageLightbox() {
    const modal = document.getElementById('modal-image-lightbox');
    if (modal) modal.classList.add('hidden');
  }

  // Cloud & AI Settings Handlers
  function openCloudSettingsModal() {
    const key = (window.JeeScanner && window.JeeScanner.getApiKey()) || (window.StorageService && window.StorageService.getApiKey()) || '';
    const keyInput = document.getElementById('input-gemini-key');
    if (keyInput) keyInput.value = key;
    
    // Check GCS status
    testGCSConnection(true);

    document.getElementById('modal-apikey').classList.remove('hidden');
  }

  function switchCloudTab(tab) {
    const gemTabBtn = document.getElementById('tab-btn-gemini');
    const gcsTabBtn = document.getElementById('tab-btn-gcs');
    const gemPanel = document.getElementById('tab-panel-gemini');
    const gcsPanel = document.getElementById('tab-panel-gcs');

    if (!gemTabBtn || !gcsTabBtn || !gemPanel || !gcsPanel) return;

    if (tab === 'gemini') {
      gemTabBtn.className = 'flex-1 py-1.5 rounded-lg bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs flex items-center justify-center gap-1.5 transition-all';
      gcsTabBtn.className = 'flex-1 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center gap-1.5 transition-all';
      gemPanel.classList.remove('hidden');
      gcsPanel.classList.add('hidden');
    } else {
      gcsTabBtn.className = 'flex-1 py-1.5 rounded-lg bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs flex items-center justify-center gap-1.5 transition-all';
      gemTabBtn.className = 'flex-1 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center gap-1.5 transition-all';
      gcsPanel.classList.remove('hidden');
      gemPanel.classList.add('hidden');
    }
    if (window.lucide) lucide.createIcons();
  }

  function toggleApiKeyVisibility() {
    const input = document.getElementById('input-gemini-key');
    const icon = document.getElementById('icon-toggle-key');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
      input.type = 'password';
      if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide) lucide.createIcons({ root: input.parentElement });
  }

  async function saveGCSConfig() {
    const bucket = document.getElementById('gcs-bucket-name').value.trim();
    const projectId = document.getElementById('gcs-project-id').value.trim();
    const credsJson = document.getElementById('gcs-credentials-json').value.trim();

    if (!bucket) {
      showToast('Please enter a GCS bucket name.', 'warning');
      return;
    }

    let credentials = null;
    if (credsJson) {
      try {
        credentials = JSON.parse(credsJson);
      } catch (e) {
        showToast('Invalid Service Account JSON format: ' + e.message, 'error');
        return;
      }
    }

    try {
      showToast('Saving Google Cloud Storage configuration...', 'info');
      if (window.StorageService && typeof window.StorageService.configureGcs === 'function') {
        const res = await window.StorageService.configureGcs({
          bucket,
          projectId,
          credentials
        });
        showToast('Google Cloud Storage configuration saved!', 'success');
        testGCSConnection(false);
      }
    } catch (err) {
      showToast('GCS Error: ' + err.message, 'error');
    }
  }

  async function testGCSConnection(silent = false) {
    if (!window.StorageService || typeof window.StorageService.getGcsStatus !== 'function') return;
    try {
      const status = await window.StorageService.getGcsStatus();
      const indicator = document.getElementById('gcs-status-indicator');
      const text = document.getElementById('gcs-status-text');
      const cloudDot = document.getElementById('cloud-status-dot');

      if (status && status.configured) {
        if (indicator) indicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
        if (text) text.textContent = `Connected: gs://${status.bucket || ''}`;
        if (cloudDot) cloudDot.className = 'absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500';
        if (!silent) showToast(`GCS connected to gs://${status.bucket}!`, 'success');
      } else {
        if (indicator) indicator.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
        if (text) text.textContent = 'GCS Not Configured (using local storage)';
        if (cloudDot) cloudDot.className = 'absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-slate-400';
        if (!silent) showToast('GCS is not yet configured. Local file storage active.', 'info');
      }
    } catch (e) {
      if (!silent) showToast('Could not query GCS status: ' + e.message, 'error');
    }
  }

  async function syncWithGCS() {
    const btn = document.getElementById('btn-gcs-sync');
    if (btn) btn.innerHTML = '<div class="spinner w-3 h-3 border-2 mr-1"></div> Syncing...';
    try {
      if (window.StorageService && typeof window.StorageService.syncWithGcs === 'function') {
        const res = await window.StorageService.syncWithGcs();
        showToast('Google Cloud Storage sync complete!', 'success');
        await refreshQuestionsData();
      }
    } catch (e) {
      showToast('Sync failed: ' + e.message, 'error');
    } finally {
      if (btn) btn.innerHTML = '<i data-lucide="refresh-cw" class="w-3 h-3"></i> Sync Now';
      if (window.lucide) lucide.createIcons();
    }
  }

  // Public Interface
  return {
    init,
    switchMode,
    toggleTheme,
    toggleMobileMenu,
    toggleMobilePalette,
    launchSubjectPractice,
    renderMath,
    showToast,
    get quizEngine() { return quizEngine; },

    // Exam Simulator
    setExamPattern,
    setExamDuration,
    launchExam,
    confirmSubmitExam,
    closeSubmitModal,
    executeSubmitExam,
    filterResults,
    resetToExamSetup,

    // Practice
    onPracticeFilterChange,
    onPracticeOptionSelect,
    checkPracticeAnswer,
    togglePracticeSolution,
    togglePracticeHint,
    nextPracticeQuestion,
    prevPracticeQuestion,
    randomPracticeQuestion,
    resetPracticeFilters,

    // Scanner
    triggerClipboardPaste,
    loadSamplePdfScan,
    loadSampleImageScan,
    scannerPdfPrevPage,
    scannerPdfNextPage,
    updateStagedField,
    updateStagedOption,
    discardStagedQuestion,
    clearStagedQuestions,
    addSingleStagedQuestion,
    addAllStagedQuestions,

    // Question Bank
    onBankSearch,
    filterBankBySubject,
    loadSampleQuestions,
    exportQuestionsJSON,
    importQuestionsJSON,
    deleteQuestion,
    openAddQuestionModal,
    openEditQuestionModal,
    closeQuestionModal,
    onModalTypeChange,
    updateLivePreview,
    saveQuestionFromModal,

    // API Key & Cloud
    openApiKeyModal,
    closeApiKeyModal,
    saveApiKey,
    testApiKeyConnection,
    openCloudSettingsModal,
    switchCloudTab,
    toggleApiKeyVisibility,
    saveGCSConfig,
    testGCSConnection,
    syncWithGCS,

    // Direct Image Question
    handleDirectImageSelect,
    handleDirectSolutionImageSelect,
    clearDirectImage,
    onDirectTypeChange,
    setDirectSingleAnswer,
    toggleDirectMultiAnswer,
    resetDirectImageForm,
    saveDirectImageQuestion,

    // Lightbox
    openImageLightbox,
    closeImageLightbox
  };
})();

// Attach globally and initialize on DOM ready
window.App = App;
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

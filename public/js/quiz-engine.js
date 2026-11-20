/**
 * =========================================================
 * QuestionForge - Quiz Engine
 * Authentic JEE Main & Advanced Computer-Based Test (CBT) Engine
 * =========================================================
 */

class QuizEngine {
  constructor(options = {}) {
    this.options = Object.assign({
      examType: 'jee-main', // 'jee-main' | 'jee-advanced' | 'custom'
      durationMinutes: 180,
      subjects: ['Physics', 'Chemistry', 'Mathematics'],
      autoSaveInterval: 5000,
      marking: {
        single_choice: { correct: 4, incorrect: -1, skipped: 0 },
        multiple_choice: { correct: 4, incorrect: -2, skipped: 0 },
        numerical: { correct: 4, incorrect: 0, skipped: 0 }
      }
    }, options);

    this.allQuestions = [];
    this.subjectQuestions = {
      Physics: [],
      Chemistry: [],
      Mathematics: []
    };

    this.currentSubject = 'Physics';
    this.currentQuestionIndex = 0; // index within currentSubject
    this.responses = {}; // questionId -> response object
    this.status = 'idle'; // 'idle' | 'running' | 'paused' | 'submitted'
    this.remainingSeconds = this.options.durationMinutes * 60;
    this.totalDurationSeconds = this.remainingSeconds;
    this.timerId = null;
    this.lastTickTime = null;

    // Listeners
    this.listeners = {
      tick: [],
      questionChange: [],
      paletteChange: [],
      submit: []
    };
  }

  // Event Subscription
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  /**
   * Helper to normalize question properties across formats (camelCase vs snake_case, option objects vs strings)
   */
  static normalizeQuestion(q, idx = 0) {
    if (!q) return null;
    const copy = { ...q };

    if (!copy.id) {
      copy.id = `q_${(copy.subject || 'gen').toLowerCase()}_${idx + 1}`;
    }

    // Normalize marking / marks
    if (!copy.marking && copy.marks) {
      copy.marking = copy.marks;
    }

    // Normalize correctAnswer / correct_answer
    if (copy.correctAnswer === undefined && copy.correct_answer !== undefined) {
      copy.correctAnswer = copy.correct_answer;
    }

    // Normalize options if they are objects { id: 'A', text: '...' }
    if (Array.isArray(copy.options)) {
      copy.normalizedOptions = copy.options.map(opt => {
        if (typeof opt === 'object' && opt !== null) {
          return { id: opt.id || '', text: opt.text || '' };
        }
        return { id: '', text: String(opt) };
      });
    } else {
      copy.normalizedOptions = [];
    }

    return copy;
  }

  /**
   * Initialize a new exam with given questions and duration
   */
  startExam(questions, customDurationMinutes = null) {
    this.stopTimer();

    if (customDurationMinutes) {
      this.options.durationMinutes = customDurationMinutes;
    }
    this.remainingSeconds = this.options.durationMinutes * 60;
    this.totalDurationSeconds = this.remainingSeconds;

    this.allQuestions = (questions || []).map((q, idx) => QuizEngine.normalizeQuestion(q, idx));
    this.subjectQuestions = {
      Physics: [],
      Chemistry: [],
      Mathematics: []
    };

    // Partition questions by subject
    this.allQuestions.forEach((q) => {
      const subj = q.subject || 'Physics';
      if (!this.subjectQuestions[subj]) {
        this.subjectQuestions[subj] = [];
      }
      this.subjectQuestions[subj].push(q);
    });

    // Default to first subject that has questions
    const availableSubjects = Object.keys(this.subjectQuestions).filter(s => this.subjectQuestions[s].length > 0);
    this.currentSubject = availableSubjects.length > 0 ? availableSubjects[0] : 'Physics';
    this.currentQuestionIndex = 0;

    // Initialize responses map
    this.responses = {};
    this.allQuestions.forEach(q => {
      this.responses[q.id] = {
        questionId: q.id,
        subject: q.subject || 'Physics',
        status: 'not-visited', // 'not-visited', 'not-answered', 'answered', 'marked-for-review', 'answered-and-marked'
        selectedOption: null, // index or array or string
        timeSpent: 0,
        visited: false
      };
    });

    // Mark the very first active question as visited / not-answered
    const firstQ = this.getCurrentQuestion();
    if (firstQ) {
      this.responses[firstQ.id].status = 'not-answered';
      this.responses[firstQ.id].visited = true;
    }

    this.status = 'running';
    this.lastTickTime = Date.now();
    this.startTimer();

    this.emitChange();
  }

  startTimer() {
    this.timerId = setInterval(() => {
      if (this.status !== 'running') return;

      const now = Date.now();
      const deltaSec = Math.floor((now - this.lastTickTime) / 1000);
      if (deltaSec >= 1) {
        this.remainingSeconds = Math.max(0, this.remainingSeconds - deltaSec);
        this.lastTickTime = now;

        // Track time spent on current active question
        const currentQ = this.getCurrentQuestion();
        if (currentQ && this.responses[currentQ.id]) {
          this.responses[currentQ.id].timeSpent += deltaSec;
        }

        this.emit('tick', {
          remainingSeconds: this.remainingSeconds,
          formatted: this.formatTime(this.remainingSeconds),
          isDanger: this.remainingSeconds <= 300 // under 5 mins
        });

        if (this.remainingSeconds <= 0) {
          this.autoSubmit();
        }
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  formatTime(totalSec) {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  getCurrentQuestion() {
    const questions = this.subjectQuestions[this.currentSubject] || [];
    return questions[this.currentQuestionIndex] || null;
  }

  getCurrentResponse() {
    const q = this.getCurrentQuestion();
    return q ? (this.responses[q.id] || null) : null;
  }

  setSubject(subject) {
    if (this.subjectQuestions[subject] && this.subjectQuestions[subject].length > 0) {
      this.currentSubject = subject;
      this.currentQuestionIndex = 0;
      this.ensureCurrentQuestionVisited();
      this.emitChange();
    }
  }

  goToQuestion(index, subject = null) {
    if (subject && this.subjectQuestions[subject]) {
      this.currentSubject = subject;
    }
    const questions = this.subjectQuestions[this.currentSubject] || [];
    if (index >= 0 && index < questions.length) {
      this.currentQuestionIndex = index;
      this.ensureCurrentQuestionVisited();
      this.emitChange();
    }
  }

  ensureCurrentQuestionVisited() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const resp = this.responses[q.id];
    if (resp && resp.status === 'not-visited') {
      resp.status = 'not-answered';
      resp.visited = true;
    }
  }

  /**
   * Action: Set the user's selected answer without advancing
   */
  selectOption(optionValue) {
    const q = this.getCurrentQuestion();
    if (!q || this.status !== 'running') return;
    const resp = this.responses[q.id];

    if (q.type === 'multiple_choice') {
      let current = Array.isArray(resp.selectedOption) ? [...resp.selectedOption] : [];
      const optIdx = Number(optionValue);
      const existsIdx = current.indexOf(optIdx);
      if (existsIdx > -1) {
        current.splice(existsIdx, 1);
      } else {
        current.push(optIdx);
      }
      resp.selectedOption = current.length > 0 ? current.sort((a,b)=>a-b) : null;
    } else {
      resp.selectedOption = optionValue;
    }

    this.emitChange();
  }

  /**
   * Action: Save & Next (Green)
   */
  saveAndNext() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const resp = this.responses[q.id];

    const hasAnswer = this.hasResponse(resp);
    if (hasAnswer) {
      resp.status = 'answered';
    } else {
      resp.status = 'not-answered';
    }

    this.nextQuestion();
  }

  /**
   * Action: Save & Mark for Review (Purple with Green badge)
   */
  saveAndMarkForReview() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const resp = this.responses[q.id];

    const hasAnswer = this.hasResponse(resp);
    if (hasAnswer) {
      resp.status = 'answered-and-marked';
    } else {
      resp.status = 'marked-for-review';
    }

    this.nextQuestion();
  }

  /**
   * Action: Mark for Review & Next (Purple)
   */
  markForReviewAndNext() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const resp = this.responses[q.id];

    const hasAnswer = this.hasResponse(resp);
    if (hasAnswer) {
      resp.status = 'answered-and-marked';
    } else {
      resp.status = 'marked-for-review';
    }

    this.nextQuestion();
  }

  /**
   * Action: Clear Response
   */
  clearResponse() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    const resp = this.responses[q.id];
    resp.selectedOption = null;

    if (resp.status === 'answered') {
      resp.status = 'not-answered';
    } else if (resp.status === 'answered-and-marked') {
      resp.status = 'marked-for-review';
    }

    this.emitChange();
  }

  nextQuestion() {
    const questions = this.subjectQuestions[this.currentSubject] || [];
    if (this.currentQuestionIndex < questions.length - 1) {
      this.currentQuestionIndex++;
      this.ensureCurrentQuestionVisited();
      this.emitChange();
    } else {
      // Check if there is a next subject
      const subjects = Object.keys(this.subjectQuestions).filter(s => this.subjectQuestions[s].length > 0);
      const curSubjIdx = subjects.indexOf(this.currentSubject);
      if (curSubjIdx < subjects.length - 1) {
        this.currentSubject = subjects[curSubjIdx + 1];
        this.currentQuestionIndex = 0;
        this.ensureCurrentQuestionVisited();
        this.emitChange();
      } else {
        // We're at the very last question of the exam
        this.emitChange();
      }
    }
  }

  prevQuestion() {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
      this.ensureCurrentQuestionVisited();
      this.emitChange();
    } else {
      // Check if there is a previous subject
      const subjects = Object.keys(this.subjectQuestions).filter(s => this.subjectQuestions[s].length > 0);
      const curSubjIdx = subjects.indexOf(this.currentSubject);
      if (curSubjIdx > 0) {
        this.currentSubject = subjects[curSubjIdx - 1];
        this.currentQuestionIndex = this.subjectQuestions[this.currentSubject].length - 1;
        this.ensureCurrentQuestionVisited();
        this.emitChange();
      }
    }
  }

  hasResponse(resp) {
    if (!resp || resp.selectedOption === null || resp.selectedOption === undefined) return false;
    if (Array.isArray(resp.selectedOption)) return resp.selectedOption.length > 0;
    if (typeof resp.selectedOption === 'string') return resp.selectedOption.trim().length > 0;
    return true;
  }

  /**
   * Get Palette Summary Counts
   */
  getPaletteSummary() {
    const summary = {
      answered: 0,
      notAnswered: 0,
      markedForReview: 0,
      answeredAndMarked: 0,
      notVisited: 0,
      total: this.allQuestions.length
    };

    Object.values(this.responses).forEach(resp => {
      switch (resp.status) {
        case 'answered':
          summary.answered++;
          break;
        case 'not-answered':
          summary.notAnswered++;
          break;
        case 'marked-for-review':
          summary.markedForReview++;
          break;
        case 'answered-and-marked':
          summary.answeredAndMarked++;
          break;
        case 'not-visited':
        default:
          summary.notVisited++;
          break;
      }
    });

    return summary;
  }

  emitChange() {
    const q = this.getCurrentQuestion();
    const resp = this.getCurrentResponse();
    const summary = this.getPaletteSummary();

    this.emit('questionChange', {
      question: q,
      index: this.currentQuestionIndex,
      subject: this.currentSubject,
      totalInSubject: (this.subjectQuestions[this.currentSubject] || []).length,
      response: resp
    });

    this.emit('paletteChange', {
      summary: summary,
      currentSubject: this.currentSubject,
      subjectQuestions: this.subjectQuestions[this.currentSubject] || [],
      responses: this.responses
    });
  }

  autoSubmit() {
    this.stopTimer();
    this.submitExam(true);
  }

  /**
   * Evaluate the complete test and produce a rich score card report
   */
  submitExam(isAuto = false) {
    this.stopTimer();
    this.status = 'submitted';

    const timeSpentTotal = this.totalDurationSeconds - this.remainingSeconds;

    let totalScore = 0;
    let maxPossibleScore = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unattemptedCount = 0;

    const subjectStats = {
      Physics: { score: 0, maxScore: 0, correct: 0, incorrect: 0, unattempted: 0, timeSpent: 0 },
      Chemistry: { score: 0, maxScore: 0, correct: 0, incorrect: 0, unattempted: 0, timeSpent: 0 },
      Mathematics: { score: 0, maxScore: 0, correct: 0, incorrect: 0, unattempted: 0, timeSpent: 0 }
    };

    const topicStats = {};

    const questionResults = this.allQuestions.map(q => {
      const resp = this.responses[q.id] || {};
      const subj = q.subject || 'Physics';
      const topic = q.topic || q.chapter || 'General';
      const qType = q.type || 'single_choice';
      const marking = (q.marking) || this.options.marking[qType] || { correct: 4, incorrect: -1, skipped: 0 };

      if (!subjectStats[subj]) {
        subjectStats[subj] = { score: 0, maxScore: 0, correct: 0, incorrect: 0, unattempted: 0, timeSpent: 0 };
      }
      if (!topicStats[topic]) {
        topicStats[topic] = { subject: subj, total: 0, correct: 0, incorrect: 0 };
      }

      subjectStats[subj].timeSpent += (resp.timeSpent || 0);
      topicStats[topic].total++;
      maxPossibleScore += marking.correct;
      subjectStats[subj].maxScore += marking.correct;

      // Authentic JEE CBT Rule:
      // Questions Answered AND Answered-and-Marked-for-Review ARE evaluated.
      // Marked-for-Review without answer is NOT evaluated.
      const isEvaluated = (resp.status === 'answered' || resp.status === 'answered-and-marked') && this.hasResponse(resp);

      let isCorrect = false;
      let scoreAwarded = 0;
      let statusLabel = 'unattempted';

      if (isEvaluated) {
        if (qType === 'single_choice') {
          // Compare answer (can be index 0..3 or letters 'A'..'D')
          const letters = ['A', 'B', 'C', 'D'];
          const userVal = resp.selectedOption;
          const userIdx = typeof userVal === 'number' ? userVal : (letters.indexOf(String(userVal).toUpperCase()) > -1 ? letters.indexOf(String(userVal).toUpperCase()) : parseInt(userVal, 10));
          
          let correctIdx = -1;
          if (typeof q.correctAnswer === 'number') {
            correctIdx = q.correctAnswer;
          } else if (typeof q.correctAnswer === 'string') {
            const up = q.correctAnswer.trim().toUpperCase();
            correctIdx = letters.indexOf(up) > -1 ? letters.indexOf(up) : parseInt(up, 10);
          }
          isCorrect = (userIdx === correctIdx);
        } else if (qType === 'multiple_choice') {
          const letters = ['A', 'B', 'C', 'D'];
          const toIndex = v => typeof v === 'number' ? v : (letters.indexOf(String(v).toUpperCase()) > -1 ? letters.indexOf(String(v).toUpperCase()) : parseInt(v, 10));

          const userRaw = Array.isArray(resp.selectedOption) ? resp.selectedOption : [resp.selectedOption];
          const userIndices = userRaw.map(toIndex).filter(v => !isNaN(v)).sort((a,b)=>a-b);

          const correctRaw = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
          const correctIndices = correctRaw.map(toIndex).filter(v => !isNaN(v)).sort((a,b)=>a-b);

          isCorrect = (userIndices.length === correctIndices.length && userIndices.every((v, i) => v === correctIndices[i]));
        } else if (qType === 'numerical') {
          const userNum = parseFloat(String(resp.selectedOption).trim());
          const correctNum = parseFloat(String(q.correctAnswer).trim());
          const tolerance = q.tolerance !== undefined ? q.tolerance : 0.05;
          if (!isNaN(userNum) && !isNaN(correctNum)) {
            isCorrect = Math.abs(userNum - correctNum) <= tolerance;
          } else {
            isCorrect = String(resp.selectedOption).trim().toLowerCase() === String(q.correctAnswer).trim().toLowerCase();
          }
        }

        if (isCorrect) {
          scoreAwarded = marking.correct;
          correctCount++;
          subjectStats[subj].correct++;
          topicStats[topic].correct++;
          statusLabel = 'correct';
        } else {
          scoreAwarded = marking.incorrect;
          incorrectCount++;
          subjectStats[subj].incorrect++;
          topicStats[topic].incorrect++;
          statusLabel = 'incorrect';
        }
      } else {
        scoreAwarded = marking.skipped || 0;
        unattemptedCount++;
        subjectStats[subj].unattempted++;
        statusLabel = 'unattempted';
      }

      totalScore += scoreAwarded;
      subjectStats[subj].score += scoreAwarded;

      return {
        id: q.id,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        hints: q.hints || [],
        subject: subj,
        chapter: q.chapter,
        topic: topic,
        type: qType,
        userResponse: resp.selectedOption,
        timeSpent: resp.timeSpent || 0,
        isCorrect: isCorrect,
        statusLabel: statusLabel,
        scoreAwarded: scoreAwarded,
        paletteStatus: resp.status
      };
    });

    const attemptedCount = correctCount + incorrectCount;
    const accuracy = attemptedCount > 0 ? Math.round((correctCount / attemptedCount) * 100) : 0;
    const percentage = maxPossibleScore > 0 ? Math.round((totalScore / maxPossibleScore) * 100) : 0;

    const report = {
      examType: this.options.examType,
      date: new Date().toISOString(),
      isAutoSubmitted: isAuto,
      totalScore: totalScore,
      maxPossibleScore: maxPossibleScore,
      percentage: percentage,
      accuracy: accuracy,
      timeSpentSeconds: timeSpentTotal,
      timeSpentFormatted: this.formatTime(timeSpentTotal),
      counts: {
        total: this.allQuestions.length,
        attempted: attemptedCount,
        correct: correctCount,
        incorrect: incorrectCount,
        unattempted: unattemptedCount
      },
      subjectBreakdown: subjectStats,
      topicBreakdown: topicStats,
      questionResults: questionResults
    };

    this.emit('submit', report);
    return report;
  }
}

// Attach globally (Browser & Node.js CommonJS compatible)
if (typeof window !== 'undefined') {
  window.QuizEngine = QuizEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuizEngine;
}

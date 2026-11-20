/**
 * JEE Preparation Platform - Scanner Module
 * Multimodal Gemini AI OCR & Document Parser, Local Regex Fallback,
 * and Interactive Review & Edit Staging Workbench for JEE Questions.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./pdf-extractor'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./pdf-extractor'));
  } else {
    root.JeeScanner = factory(root.PdfExtractor);
    // Alias for convenience
    root.Scanner = root.JeeScanner;
  }
})(typeof self !== 'undefined' ? self : this, function (PdfExtractor) {
  'use strict';

  // Configuration constants
  const GEMINI_STORAGE_KEYS = ['jee_gemini_api_key', 'gemini_api_key'];
  const GEMINI_MODEL_DEFAULT = 'gemini-1.5-flash';
  const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

  /**
   * System Prompt engineered specifically for JEE Main & Advanced question papers.
   */
  const JEE_EXTRACTION_SYSTEM_PROMPT = `You are an expert Indian Joint Entrance Examination (JEE Main & Advanced) OCR and academic parsing specialist.
Your task is to analyze the provided document or image containing JEE questions and extract ALL questions accurately with strict adherence to standard JEE formats.

CRITICAL INSTRUCTIONS FOR EXTRACTION:
1. MATHEMATICAL FORMULAS & LATEX:
   - All mathematical expressions, chemical equations, physical formulas, symbols, and variables MUST be enclosed in LaTeX formatting using single dollar signs for inline math (e.g. $E = mc^2$, $\\int_{0}^{1} x^2 dx$, $\\vec{F} = m\\vec{a}$, $\\frac{hc}{\\lambda}$) and double dollar signs for block display math ($$...$$).
   - Chemistry: preserve formulas like $\\mathrm{KMnO_4}$, $\\mathrm{CH_3COOH}$, $\\Delta H^{\\circ}$, $\\rightleftharpoons$, orbital notation $1s^2 2s^2 2p^6$.
   - Physics: preserve vector notation $\\vec{v}$, units, subscripts like $V_{\\text{rms}}$, superscripts, Greek letters ($\\alpha, \\beta, \\theta, \\lambda, \\omega, \\varepsilon_0, \\mu_0$).
   - Matrices and determinants: use $\\begin{pmatrix}...\\end{pmatrix}$ or $\\begin{vmatrix}...\\end{vmatrix}$.

2. QUESTION TYPES:
   - 'single_choice': Multiple Choice with exactly one correct option (A, B, C, or D). Marking: +4, -1.
   - 'multiple_choice': Multiple Choice with one or more correct options (e.g., A and C). Marking: +4, -2 (or partial).
   - 'numerical': Integer or decimal answer question without options. Marking: +4, 0.

3. SUBJECT & TOPIC CLASSIFICATION:
   - Identify subject accurately: 'Physics', 'Chemistry', or 'Mathematics'.
   - Identify chapter/topic (e.g. 'Electrostatics', 'Rotational Dynamics', 'Chemical Kinetics', 'Thermodynamics', 'Definite Integrals', 'Coordinate Geometry', etc.).
   - Estimate difficulty: 'Easy', 'Medium', or 'Hard' (JEE Advanced standard).

4. OPTIONS & ANSWERS:
   - For single_choice and multiple_choice: extract each option text cleanly into an array of objects: [{"id": "A", "text": "..."}, {"id": "B", "text": "..."}, ...].
   - If the answer key is given in the document (at the end or next to the question), extract it. If not explicitly provided, solve and infer the scientifically correct answer.
   - For single_choice: "correctAnswer": "B"
   - For multiple_choice: "correctAnswer": ["A", "C"]
   - For numerical: "correctAnswer": "12.5" or "4"

5. STEP-BY-STEP EXPLANATION:
   - Provide a rigorous, step-by-step mathematical and conceptual explanation/derivation with relevant formulas.

6. DIAGRAMS:
   - If a question includes or refers to a diagram/figure, set "hasDiagram": true and provide a helpful description of the diagram in "diagramDescription".

OUTPUT FORMAT:
Respond with ONLY a valid JSON array of question objects adhering strictly to this schema:
[
  {
    "id": "q_1",
    "subject": "Physics" | "Chemistry" | "Mathematics",
    "chapter": "Topic Name",
    "difficulty": "Easy" | "Medium" | "Hard",
    "type": "single_choice" | "multiple_choice" | "numerical",
    "stem": "Question stem with $LaTeX$...",
    "hasDiagram": false,
    "diagramDescription": "",
    "options": [
      { "id": "A", "text": "Option A text with $LaTeX$" },
      { "id": "B", "text": "Option B text with $LaTeX$" },
      { "id": "C", "text": "Option C text with $LaTeX$" },
      { "id": "D", "text": "Option D text with $LaTeX$" }
    ],
    "correctAnswer": "A",
    "explanation": "Detailed step-by-step solution with $LaTeX$...",
    "markingScheme": { "positive": 4, "negative": 1 }
  }
]
Do not wrap in markdown codeblocks if possible, or use standard \`\`\`json ... \`\`\`. Output valid JSON only.`;

  /**
   * Helper to get stored Gemini API key (syncs with StorageService if available)
   */
  function getApiKey() {
    if (typeof window !== 'undefined' && window.StorageService && typeof window.StorageService.getApiKey === 'function') {
      const k = window.StorageService.getApiKey();
      if (k) return k;
    }
    if (typeof localStorage !== 'undefined') {
      for (const keyName of GEMINI_STORAGE_KEYS) {
        const val = localStorage.getItem(keyName);
        if (val) return val.trim();
      }
    }
    return '';
  }

  function setApiKey(key) {
    const trimmed = (key || '').trim();
    if (typeof window !== 'undefined' && window.StorageService && typeof window.StorageService.setApiKey === 'function') {
      window.StorageService.setApiKey(trimmed);
    }
    if (typeof localStorage !== 'undefined') {
      for (const keyName of GEMINI_STORAGE_KEYS) {
        if (trimmed) {
          localStorage.setItem(keyName, trimmed);
        } else {
          localStorage.removeItem(keyName);
        }
      }
    }
    return true;
  }

  function hasApiKey() {
    return !!getApiKey();
  }

  /**
   * Test a Gemini API key with a small ping prompt
   */
  async function testApiKey(key) {
    const apiKey = (key || getApiKey()).trim();
    if (!apiKey) {
      return { success: false, message: 'API key is empty.' };
    }

    try {
      const url = `${GEMINI_API_ENDPOINT}/${GEMINI_MODEL_DEFAULT}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [{ text: 'Respond with the single word "OK" if connection is successful.' }]
          }
        ]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || `HTTP error ${response.status}: ${response.statusText}`;
        return { success: false, message: errMsg };
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { success: true, message: 'Gemini API connection verified!', responseText: text.trim() };
    } catch (err) {
      return { success: false, message: err.message || 'Network connection failed.' };
    }
  }

  /**
   * Safe JSON parser that strips markdown code fences and handles whitespace/trailing commas
   */
  function parseJsonFromGeminiResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return [];
    }

    let cleaned = rawText.trim();

    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
      cleaned = cleaned.replace(/\s*```$/, '');
      cleaned = cleaned.trim();
    }

    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (typeof parsed === 'object' && parsed !== null) {
        if (Array.isArray(parsed.questions)) {
          return parsed.questions;
        }
        return [parsed];
      }
      return [];
    } catch (e) {
      console.warn('Standard JSON.parse failed on Gemini response, attempting cleanup...', e);
      const sanitized = cleaned
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u0000-\u001F]+/g, ' ');

      try {
        const retryParsed = JSON.parse(sanitized);
        return Array.isArray(retryParsed) ? retryParsed : [retryParsed];
      } catch (err2) {
        console.error('Failed to parse JSON even after sanitation:', err2);
        throw new Error('Gemini returned invalid JSON: ' + e.message);
      }
    }
  }

  /**
   * Normalize and validate a parsed question object to match standard schema.
   * Ensures compatibility with both scanner.js and storage.js/server.js formats!
   */
  function normalizeQuestion(rawQ, index = 0) {
    const id = rawQ.id || `jee_${Date.now()}_${index + 1}_${Math.random().toString(36).substring(2, 6)}`;
    
    // Normalize subject
    let subject = 'Physics';
    const rawSub = String(rawQ.subject || '').toLowerCase();
    if (rawSub.includes('chem')) {
      subject = 'Chemistry';
    } else if (rawSub.includes('math')) {
      subject = 'Mathematics';
    } else if (rawSub.includes('phys')) {
      subject = 'Physics';
    }

    // Normalize type
    let type = 'single_choice';
    const rawType = String(rawQ.type || '').toLowerCase();
    if (rawType.includes('multi') || rawType.includes('multiple')) {
      type = 'multiple_choice';
    } else if (rawType.includes('num') || rawType.includes('int') || rawType.includes('decimal')) {
      type = 'numerical';
    }

    // Normalize options
    let options = [];
    if (type !== 'numerical' && Array.isArray(rawQ.options)) {
      options = rawQ.options.map((opt, optIdx) => {
        if (typeof opt === 'string') {
          const letter = String.fromCharCode(65 + optIdx);
          const cleanText = opt.replace(/^(?:[1-4A-D][\.\)]|\([1-4A-D]\))\s*/i, '').trim();
          return { id: letter, text: cleanText || opt };
        }
        let optId = String(opt.id || opt.key || String.fromCharCode(65 + optIdx)).toUpperCase();
        if (optId === '1') optId = 'A';
        else if (optId === '2') optId = 'B';
        else if (optId === '3') optId = 'C';
        else if (optId === '4') optId = 'D';

        return {
          id: optId,
          text: String(opt.text || opt.value || '').trim()
        };
      });
    }

    // Default marking scheme
    let markingScheme = rawQ.markingScheme || rawQ.marks;
    if (!markingScheme || typeof markingScheme !== 'object') {
      if (type === 'single_choice') {
        markingScheme = { positive: 4, negative: 1, correct: 4, incorrect: -1 };
      } else if (type === 'multiple_choice') {
        markingScheme = { positive: 4, negative: 2, correct: 4, incorrect: -2 };
      } else {
        markingScheme = { positive: 4, negative: 0, correct: 4, incorrect: 0 };
      }
    } else {
      markingScheme = {
        positive: markingScheme.positive !== undefined ? markingScheme.positive : (markingScheme.correct || 4),
        negative: markingScheme.negative !== undefined ? markingScheme.negative : (markingScheme.incorrect !== undefined ? Math.abs(markingScheme.incorrect) : 1),
        correct: markingScheme.correct !== undefined ? markingScheme.correct : (markingScheme.positive || 4),
        incorrect: markingScheme.incorrect !== undefined ? markingScheme.incorrect : -(markingScheme.negative || 1)
      };
    }

    // Normalize correctAnswer
    let correctAnswer = rawQ.correctAnswer !== undefined ? rawQ.correctAnswer : rawQ.correct_answer;
    if (correctAnswer === undefined || correctAnswer === null) {
      correctAnswer = type === 'numerical' ? '0' : 'A';
    } else if (Array.isArray(correctAnswer)) {
      correctAnswer = correctAnswer.map(a => {
        const up = String(a).toUpperCase();
        if (up === '1') return 'A';
        if (up === '2') return 'B';
        if (up === '3') return 'C';
        if (up === '4') return 'D';
        return up;
      });
    } else {
      correctAnswer = String(correctAnswer).trim();
      if (type === 'single_choice') {
        const up = correctAnswer.toUpperCase();
        if (up === '1') correctAnswer = 'A';
        else if (up === '2') correctAnswer = 'B';
        else if (up === '3') correctAnswer = 'C';
        else if (up === '4') correctAnswer = 'D';
        else correctAnswer = up;
      }
    }

    const stemText = String(rawQ.stem || rawQ.question || '').trim();

    return {
      id,
      subject,
      chapter: rawQ.chapter || rawQ.topic || 'General',
      difficulty: ['Easy', 'Medium', 'Hard', 'JEE Main', 'JEE Advanced'].includes(rawQ.difficulty) ? rawQ.difficulty : 'Medium',
      type,
      stem: stemText,
      question: stemText,
      hasDiagram: !!rawQ.hasDiagram,
      diagramDescription: rawQ.diagramDescription || '',
      options,
      correctAnswer,
      correct_answer: correctAnswer,
      explanation: String(rawQ.explanation || rawQ.solution || '').trim(),
      markingScheme,
      marks: { correct: markingScheme.correct, incorrect: markingScheme.incorrect },
      year: rawQ.year || 'Practice Question',
      image: rawQ.image || null,
      source: rawQ.source || 'Scanned Document',
      createdAt: rawQ.createdAt || rawQ.created_at || new Date().toISOString()
    };
  }

  /**
   * Call Gemini Multimodal API with inlineData (base64 image or PDF)
   */
  async function callGeminiMultimodal({ apiKey, mimeType, base64Data, prompt, model = GEMINI_MODEL_DEFAULT }) {
    const key = (apiKey || getApiKey()).trim();

    if (key) {
      try {
        const endpoint = `${GEMINI_API_ENDPOINT}/${model}:generateContent?key=${key}`;
        const parts = [];
        if (base64Data && mimeType) {
          parts.push({
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          });
        }
        parts.push({ text: prompt || JEE_EXTRACTION_SYSTEM_PROMPT });

        const payload = {
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          const candidate = data?.candidates?.[0];
          if (candidate?.content?.parts) {
            const outputText = candidate.content.parts.map(p => p.text || '').join('\n');
            const parsedQuestions = parseJsonFromGeminiResponse(outputText);
            return parsedQuestions.map((q, idx) => normalizeQuestion(q, idx));
          }
        } else {
          console.warn('Direct Gemini API returned non-OK status:', response.status);
        }
      } catch (directErr) {
        console.warn('Direct Gemini API request failed, attempting backend proxy:', directErr.message);
      }
    }

    // Backend proxy fallback
    try {
      const proxyRes = await fetch('/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key || ''
        },
        body: JSON.stringify({
          apiKey: key,
          model,
          prompt: prompt || JEE_EXTRACTION_SYSTEM_PROMPT,
          mimeType,
          base64Data
        })
      });

      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        const rawResult = proxyData.result;
        const candidate = rawResult?.candidates?.[0];
        if (candidate?.content?.parts) {
          const outputText = candidate.content.parts.map(p => p.text || '').join('\n');
          const parsedQuestions = parseJsonFromGeminiResponse(outputText);
          return parsedQuestions.map((q, idx) => normalizeQuestion(q, idx));
        }
      }
    } catch (proxyErr) {
      console.warn('Backend proxy /api/scan also failed:', proxyErr.message);
    }

    if (!key) {
      throw new Error('No Gemini API key configured. Please enter your API key in Scanner settings or use local PDF/text extraction.');
    }

    throw new Error('Could not connect to Gemini Multimodal API. Please verify your internet connection and API key.');
  }

  /**
   * Subject classifier keywords for local pattern matching
   */
  const SUBJECT_KEYWORDS = {
    Chemistry: [
      'acid', 'base', 'molarity', 'molality', 'mole', 'orbital', 'hybridization',
      'oxidation', 'reduction', 'equilibrium', 'le chatelier', 'ph', 'buffer',
      'solubility', 'galvanic', 'nernst', 'kinetics', 'activation energy', 'rate law',
      'coordination', 'ligand', 'alkane', 'alkene', 'alkyne', 'benzene', 'aromatic',
      'carbocation', 'sn1', 'sn2', 'electrophilic', 'nucleophilic', 'alcohol', 'phenol',
      'ether', 'aldehyde', 'ketone', 'carboxylic', 'amine', 'diazotization', 'polymer',
      'amino acid', 'carbohydrate', 'periodic table', 'electronegativity', 'p-block',
      'd-block', 'f-block', 'kmno4', 'k2cr2o7', 'enthalpy', 'entropy', 'gibbs'
    ],
    Mathematics: [
      'integral', 'derivative', 'differentiability', 'continuity', 'limit', 'function',
      'matrix', 'matrices', 'determinant', 'quadratic', 'complex number', 'binomial',
      'permutation', 'combination', 'probability', 'bayes', 'straight line', 'circle',
      'parabola', 'ellipse', 'hyperbola', 'tangent', 'normal', 'maxima', 'minima',
      'area under curve', 'differential equation', 'vector', 'dot product', 'cross product',
      'plane', 'trigonometry', 'inverse trigonometric', 'domain', 'range', 'series',
      'progression', 'ap', 'gp', 'standard deviation', 'variance'
    ],
    Physics: [
      'electrostatic', 'potential', 'capacitance', 'capacitor', 'charge', 'coulomb',
      'electric field', 'velocity', 'acceleration', 'momentum', 'friction', 'projectile', 'force',
      'torque', 'moment of inertia', 'angular', 'gravitation', 'orbit', 'escape velocity',
      'shm', 'oscillation', 'pendulum', 'wave', 'doppler', 'string', 'sound',
      'thermodynamics', 'carnot', 'heat engine', 'isothermal', 'adiabatic',
      'current', 'resistor', 'kirchhoff', 'magnetic field', 'biot-savart', 'ampere',
      'lorentz', 'faraday', 'lenz', 'induction', 'ac circuit', 'resonance', 'optics',
      'lens', 'mirror', 'refraction', 'interference', 'diffraction', 'slit', 'polarization',
      'photoelectric', 'work function', 'de broglie', 'bohr', 'hydrogen atom', 'radioactivity',
      'half-life', 'nucleus', 'semiconductor', 'diode', 'transistor', 'logic gate'
    ]
  };

  /**
   * Guess subject based on text content
   */
  function detectSubjectFromText(text) {
    const lower = text.toLowerCase();
    const scores = { Physics: 0, Chemistry: 0, Mathematics: 0 };

    for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
      for (const kw of keywords) {
        const regex = new RegExp(`\\b${kw}\\b`, 'gi');
        const matches = lower.match(regex);
        if (matches) {
          scores[subject] += matches.length;
        }
      }
    }

    let topSubject = 'Physics';
    let maxScore = scores.Physics;

    if (scores.Chemistry > maxScore) {
      topSubject = 'Chemistry';
      maxScore = scores.Chemistry;
    }
    if (scores.Mathematics > maxScore) {
      topSubject = 'Mathematics';
      maxScore = scores.Mathematics;
    }

    return topSubject;
  }

  /**
   * Guess chapter/topic from text header or questions
   */
  function detectChapterFromText(text) {
    const lower = text.toLowerCase();
    if (lower.includes('electrostatic') || lower.includes('capacitance') || lower.includes('potential')) {
      return 'Electrostatic Potential and Capacitance';
    }
    if (lower.includes('current electricity') || lower.includes('resistor') || lower.includes('kirchhoff')) {
      return 'Current Electricity';
    }
    if (lower.includes('rotational') || lower.includes('moment of inertia')) {
      return 'Rotational Dynamics';
    }
    if (lower.includes('thermodynamics') || lower.includes('carnot')) {
      return 'Thermodynamics';
    }
    if (lower.includes('equilibrium')) {
      return 'Chemical Equilibrium';
    }
    if (lower.includes('integral') || lower.includes('calculus')) {
      return 'Definite Integrals';
    }
    return 'General JEE Questions';
  }

  /**
   * Local Text / Regex Fallback Extractor:
   * Parses raw question text extracted from text-based PDFs or pasted text when no API key is available.
   * Enhanced for Indian JEE Main & Advanced formats (including Answer Key & Solutions appendices!).
   */
  function scanLocalRegex(rawText) {
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      return [];
    }

    // Clean up escaped brackets and spaced numbers common in PDF text extractions
    let cleanText = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')');

    // Merge spaced digits before punctuation (e.g. "1 4 ." -> "14.", "2 0 2 6" -> "2026")
    cleanText = cleanText.replace(/(\b\d)\s+(\d\b)/g, '$1$2');
    cleanText = cleanText.replace(/(\b\d)\s+(\d\b)/g, '$1$2');

    // 1. Check for separate Answer Key & Solutions sections (e.g. at the end of PYQ papers)
    const ansKeyIdx = cleanText.search(/(?:ANSWER\s*KEY|Answer\s*Key)/i);
    const solIdx = cleanText.search(/(?:HINTS\s*&\s*SOLUTIONS|SOLUTIONS\b|Solutions\b)/i);

    let questionsBody = cleanText;
    let answerKeyBody = '';
    let solutionsBody = '';

    if (ansKeyIdx !== -1) {
      questionsBody = cleanText.substring(0, ansKeyIdx);
      if (solIdx !== -1 && solIdx > ansKeyIdx) {
        answerKeyBody = cleanText.substring(ansKeyIdx, solIdx);
        solutionsBody = cleanText.substring(solIdx);
      } else {
        answerKeyBody = cleanText.substring(ansKeyIdx);
      }
    } else if (solIdx !== -1) {
      questionsBody = cleanText.substring(0, solIdx);
      solutionsBody = cleanText.substring(solIdx);
    }

    // Parse Answer Key Map (e.g. 1. (3), 2. (1), 7. (12))
    const answerKeyMap = new Map();
    if (answerKeyBody) {
      const akRegex = /(\d+)\s*[\.\:]\s*(?:\(?\s*([A-Za-z0-9\.\-]+)\s*\)?)/g;
      let akMatch;
      while ((akMatch = akRegex.exec(answerKeyBody)) !== null) {
        const qNum = parseInt(akMatch[1], 10);
        let val = akMatch[2].trim().toUpperCase();
        if (val === '1') val = 'A';
        else if (val === '2') val = 'B';
        else if (val === '3') val = 'C';
        else if (val === '4') val = 'D';
        answerKeyMap.set(qNum, val);
      }
    }

    // Parse Solutions Map (e.g. 1. (3) When 3 nC is at infinity...)
    const solutionsMap = new Map();
    if (solutionsBody) {
      const solBlockRegex = /(?:^|\n)\s*(\d+)\s*[\.\:]\s*(?:\(?\s*[A-Za-z0-9\.\-]+\s*\)?\s*)?([\s\S]*?)(?=(?:\n\s*\d+\s*[\.\:]|$))/g;
      let solMatch;
      while ((solMatch = solBlockRegex.exec(solutionsBody)) !== null) {
        const qNum = parseInt(solMatch[1], 10);
        const solContent = solMatch[2].trim();
        if (qNum > 0 && qNum <= 500) {
          solutionsMap.set(qNum, solContent);
        }
      }
    }

    // Default chapter & subject detected from the document
    const docChapter = detectChapterFromText(cleanText);
    const docSubject = detectSubjectFromText(cleanText);

    // 2. Matches question starts like:
    // Q1., Q.1, Q 1:, Question 1:, 1., (1), [Q.1] at line start or after space break
    const questionSplitRegex = /(?:^|\n|\s{2,})(?:Q(?:uestion)?\.?\s*(\d+)[\.:\)]|\b(\d+)\s*\.\s+|\[Q?\.?\s*(\d+)\])/gmi;

    const matches = [];
    let match;
    while ((match = questionSplitRegex.exec(questionsBody)) !== null) {
      const qNum = match[1] || match[2] || match[3];
      matches.push({
        number: parseInt(qNum, 10),
        index: match.index,
        headerLength: match[0].length
      });
    }

    if (matches.length === 0) {
      const parsedSingle = parseSingleQuestionBlock(questionsBody, 1, answerKeyMap, solutionsMap, docChapter, docSubject);
      return parsedSingle ? [parsedSingle] : [];
    }

    const questions = [];
    for (let i = 0; i < matches.length; i++) {
      const startIdx = matches[i].index + matches[i].headerLength;
      const endIdx = (i + 1 < matches.length) ? matches[i + 1].index : questionsBody.length;
      const block = questionsBody.substring(startIdx, endIdx).trim();

      const qNumber = matches[i].number || (i + 1);
      const parsed = parseSingleQuestionBlock(block, qNumber, answerKeyMap, solutionsMap, docChapter, docSubject);
      if (parsed) {
        questions.push(parsed);
      }
    }

    return questions;
  }

  /**
   * Parse an individual question block looking for stem, options (A-D or 1-4), answer, explanation
   */
  function parseSingleQuestionBlock(block, index, answerKeyMap = null, solutionsMap = null, defaultChapter = 'General', defaultSubject = 'Physics') {
    if (!block || block.trim().length < 5) return null;

    let stem = block;
    let explanation = '';
    let correctAnswer = null;
    let options = [];
    let questionType = 'single_choice';

    // 1. Check for Solution / Explanation within block
    const solMatch = stem.match(/(?:Solution|Explanation|Hint)[\s\:\.\-]+([\s\S]*)$/i);
    if (solMatch) {
      explanation = solMatch[1].trim();
      stem = stem.substring(0, solMatch.index).trim();
    }

    // 2. Check for Answer Key within block
    const ansMatch = stem.match(/(?:Ans(?:wer)?|Correct Option|Key)[\s\:\.\-]+(?:\(?([A-Da-d1-4])\)?|([0-9\.\-]+))/i);
    if (ansMatch) {
      if (ansMatch[1]) {
        let a = ansMatch[1].toUpperCase();
        if (a === '1') a = 'A';
        else if (a === '2') a = 'B';
        else if (a === '3') a = 'C';
        else if (a === '4') a = 'D';
        correctAnswer = a;
      } else if (ansMatch[2]) {
        correctAnswer = ansMatch[2].trim();
      }
      stem = stem.substring(0, ansMatch.index).trim();
    }

    // Check external Answer Key & Solutions maps if available
    if (!correctAnswer && answerKeyMap && answerKeyMap.has(index)) {
      correctAnswer = answerKeyMap.get(index);
    }
    if (!explanation && solutionsMap && solutionsMap.has(index)) {
      explanation = solutionsMap.get(index);
    }

    // 3. Extract Options: look for (A), (B), (C), (D) OR (1), (2), (3), (4) OR A. B. C. D.
    const optRegex = /(?:(?:\(([1-4A-Da-d])\))|(?:\b([1-4A-Da-d])[\.\)]))\s+/g;
    const optPositions = [];
    let optMatch;

    while ((optMatch = optRegex.exec(stem)) !== null) {
      let optKey = (optMatch[1] || optMatch[2]).toUpperCase();
      if (optKey === '1') optKey = 'A';
      else if (optKey === '2') optKey = 'B';
      else if (optKey === '3') optKey = 'C';
      else if (optKey === '4') optKey = 'D';

      optPositions.push({
        key: optKey,
        index: optMatch.index,
        length: optMatch[0].length
      });
    }

    if (optPositions.length >= 2) {
      const firstOpt = optPositions[0];
      const stemText = stem.substring(0, firstOpt.index).trim();

      const extractedOptions = [];
      for (let j = 0; j < optPositions.length; j++) {
        const current = optPositions[j];
        const next = optPositions[j + 1];
        const optText = stem.substring(
          current.index + current.length,
          next ? next.index : stem.length
        ).trim();

        extractedOptions.push({
          id: current.key,
          text: optText
        });
      }

      stem = stemText;
      options = extractedOptions;
      questionType = 'single_choice';
    } else {
      if (correctAnswer && !isNaN(parseFloat(correctAnswer)) && !/[A-D]/i.test(correctAnswer)) {
        questionType = 'numerical';
      }
    }

    if (!correctAnswer) {
      correctAnswer = questionType === 'numerical' ? '0' : 'A';
    }

    stem = sanitizeLatexInText(stem);
    options = options.map(opt => ({
      id: opt.id,
      text: sanitizeLatexInText(opt.text)
    }));
    explanation = sanitizeLatexInText(explanation);

    const subject = detectSubjectFromText(stem + ' ' + explanation) || defaultSubject;

    return normalizeQuestion({
      id: `jee_regex_${Date.now()}_${index}`,
      subject,
      chapter: defaultChapter || 'Extracted Section',
      difficulty: 'Medium',
      type: questionType,
      stem,
      options,
      correctAnswer,
      explanation,
      source: 'Local Regex Parser'
    }, index);
  }

  /**
   * Lightweight LaTeX sanitizer to wrap unwrapped math symbols with dollar signs
   */
  function sanitizeLatexInText(text) {
    if (!text || typeof text !== 'string') return '';
    if ((text.match(/\$/g) || []).length >= 2) {
      return text;
    }

    let result = text;
    result = result.replace(/(?<!\$)\\frac\{[^{}]+\}\{[^{}]+\}(?!\$)/g, '$$$&$$');
    result = result.replace(/(?<!\$)\\int[\w\^_\{\}\\]+(?!\$)/g, '$$$&$$');
    result = result.replace(/(?<!\$)\\sqrt\{[^{}]+\}(?!\$)/g, '$$$&$$');
    return result;
  }

  /**
   * Unified Scanner File Entrypoint:
   * Handles PDF or Image file, with Gemini AI OCR or local fallback.
   */
  async function scanDocument(fileOrSource, options = {}) {
    const onProgress = options.onProgress || (() => {});
    const apiKey = (options.apiKey || getApiKey()).trim();
    const forceLocal = !!options.forceLocal;

    onProgress({ stage: 'init', message: 'Analyzing file type...' });

    // Handle string inputs (pasted text)
    if (typeof fileOrSource === 'string' && !fileOrSource.startsWith('data:')) {
      onProgress({ stage: 'parsing', message: 'Parsing text with local JEE extractor...' });
      const questions = scanLocalRegex(fileOrSource);
      return {
        method: 'local_regex',
        success: true,
        questions,
        total: questions.length
      };
    }

    let mimeType = '';
    let isPdf = false;
    let fileName = '';

    if (fileOrSource && typeof fileOrSource === 'object') {
      mimeType = fileOrSource.type || '';
      fileName = fileOrSource.name || '';
      if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        isPdf = true;
      }
    } else if (typeof fileOrSource === 'string' && fileOrSource.startsWith('data:')) {
      mimeType = fileOrSource.split(';')[0].replace('data:', '');
      isPdf = mimeType === 'application/pdf';
    }

    // 1. Process PDF Document
    if (isPdf) {
      onProgress({ stage: 'pdf_loading', message: 'Loading PDF document...' });

      if (apiKey && !forceLocal) {
        try {
          onProgress({ stage: 'gemini_ocr', message: 'Converting PDF for Gemini Multimodal AI Analysis...' });
          
          let base64Data = '';
          if (fileOrSource instanceof Blob) {
            const buffer = await fileOrSource.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            base64Data = btoa(binary);
          } else if (typeof fileOrSource === 'string' && fileOrSource.startsWith('data:')) {
            base64Data = fileOrSource.split(',')[1];
          }

          if (base64Data) {
            onProgress({ stage: 'gemini_query', message: 'Extracting JEE questions with Gemini AI...' });
            const questions = await callGeminiMultimodal({
              apiKey,
              mimeType: 'application/pdf',
              base64Data,
              prompt: JEE_EXTRACTION_SYSTEM_PROMPT
            });

            onProgress({ stage: 'complete', message: `Successfully extracted ${questions.length} questions!` });
            return {
              method: 'gemini_multimodal_pdf',
              success: true,
              questions,
              total: questions.length
            };
          }
        } catch (geminiErr) {
          console.warn('Gemini PDF OCR encountered an error, falling back to PDF.js text extraction:', geminiErr);
          onProgress({ stage: 'fallback', message: `Notice: ${geminiErr.message}. Falling back to local PDF extractor...` });
        }
      }

      // PDF Fallback: Extract text using PDF.js and run regex extractor
      onProgress({ stage: 'pdf_text_extraction', message: 'Extracting text layer using PDF.js...' });
      if (!PdfExtractor) {
        throw new Error('PdfExtractor module is not loaded.');
      }

      const extractedText = await PdfExtractor.extractText(fileOrSource, (p) => {
        onProgress({ stage: 'pdf_rendering', message: `Reading page ${p.current} of ${p.total}...`, percent: p.percent });
      });

      onProgress({ stage: 'regex_parsing', message: 'Parsing extracted text into JEE question formats...' });
      const questions = scanLocalRegex(extractedText);

      onProgress({ stage: 'complete', message: `Extracted ${questions.length} questions using PDF.js text parsing.` });
      return {
        method: 'pdfjs_regex',
        success: true,
        questions,
        total: questions.length,
        extractedText
      };
    }

    // 2. Process Image (JPEG, PNG, WebP)
    const isImage = mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName);
    if (isImage) {
      if (!apiKey && !forceLocal) {
        return {
          method: 'image_requires_key',
          success: false,
          questions: [],
          total: 0,
          error: 'Image OCR requires a Google Gemini API key. Please enter your API key or test with sample questions.'
        };
      }

      onProgress({ stage: 'image_reading', message: 'Reading image base64 data...' });
      let base64Data = '';
      let effectiveMime = mimeType || 'image/jpeg';

      if (fileOrSource instanceof Blob) {
        const fileObj = await PdfExtractor.fileToBase64(fileOrSource);
        base64Data = fileObj.base64;
        effectiveMime = fileObj.mimeType || effectiveMime;
      } else if (typeof fileOrSource === 'string' && fileOrSource.startsWith('data:')) {
        const parts = fileOrSource.split(',');
        effectiveMime = parts[0].split(';')[0].replace('data:', '');
        base64Data = parts[1];
      }

      onProgress({ stage: 'gemini_image_ocr', message: 'Running Gemini Multimodal OCR on question image...' });
      const questions = await callGeminiMultimodal({
        apiKey,
        mimeType: effectiveMime,
        base64Data,
        prompt: JEE_EXTRACTION_SYSTEM_PROMPT
      });

      onProgress({ stage: 'complete', message: `Successfully extracted ${questions.length} questions from image!` });
      return {
        method: 'gemini_multimodal_image',
        success: true,
        questions,
        total: questions.length
      };
    }

    // Fallback: try reading as plain text
    try {
      onProgress({ stage: 'text_fallback', message: 'Reading as text...' });
      let textContent = '';
      if (fileOrSource instanceof Blob) {
        textContent = await fileOrSource.text();
      } else {
        textContent = String(fileOrSource);
      }
      const questions = scanLocalRegex(textContent);
      return {
        method: 'plain_text_regex',
        success: true,
        questions,
        total: questions.length
      };
    } catch (e) {
      throw new Error('Unsupported file format for JEE Scanner. Please provide a PDF or Image (PNG/JPEG).');
    }
  }

  /**
   * Helper to render math in an element using KaTeX (if window.katex is loaded)
   */
  function renderMath(element) {
    if (!element) return;
    if (typeof window !== 'undefined' && window.renderMathInElement) {
      try {
        window.renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      } catch (err) {
        console.warn('KaTeX render error:', err);
      }
    }
  }

  /**
   * Interactive Review & Edit Staging Workbench
   */
  class ReviewWorkbench {
    constructor(containerElement, options = {}) {
      this.container = containerElement;
      this.options = options;
      this.questions = [];
      this.selectedQuestionIds = new Set();
      this.filePreview = options.filePreview || null;
      this.onSave = options.onSave || null;
      this.onClose = options.onClose || null;
    }

    loadQuestions(questions, filePreview = null) {
      this.questions = (questions || []).map((q, idx) => normalizeQuestion(q, idx));
      this.selectedQuestionIds = new Set(this.questions.map(q => q.id));
      if (filePreview) {
        this.filePreview = filePreview;
      }
      this.render();
    }

    getSelectedQuestions() {
      return this.questions.filter(q => this.selectedQuestionIds.has(q.id));
    }

    toggleSelectAll(select) {
      if (select) {
        this.questions.forEach(q => this.selectedQuestionIds.add(q.id));
      } else {
        this.selectedQuestionIds.clear();
      }
      this.render();
    }

    addBlankQuestion() {
      const newQ = normalizeQuestion({
        id: `jee_manual_${Date.now()}`,
        subject: 'Physics',
        chapter: 'New Chapter',
        difficulty: 'Medium',
        type: 'single_choice',
        stem: 'Enter question text with $LaTeX$ formulas...',
        options: [
          { id: 'A', text: 'Option A' },
          { id: 'B', text: 'Option B' },
          { id: 'C', text: 'Option C' },
          { id: 'D', text: 'Option D' }
        ],
        correctAnswer: 'A',
        explanation: 'Step-by-step solution derivation...'
      }, this.questions.length);

      this.questions.unshift(newQ);
      this.selectedQuestionIds.add(newQ.id);
      this.render();
    }

    deleteQuestion(id) {
      this.questions = this.questions.filter(q => q.id !== id);
      this.selectedQuestionIds.delete(id);
      this.render();
    }

    /**
     * Commit selected questions to Question Bank via StorageService
     */
    async commitToQuestionBank() {
      const selected = this.getSelectedQuestions();
      if (selected.length === 0) {
        alert('Please select at least one question to add to the Question Bank.');
        return { success: false, count: 0 };
      }

      let savedCount = 0;
      let error = null;

      try {
        if (typeof window !== 'undefined' && window.StorageService) {
          if (typeof window.StorageService.addQuestion === 'function') {
            await window.StorageService.addQuestion(selected);
            savedCount = selected.length;
          } else if (typeof window.StorageService.saveQuestionsBatch === 'function') {
            await window.StorageService.saveQuestionsBatch(selected);
            savedCount = selected.length;
          } else if (typeof window.StorageService.saveQuestion === 'function') {
            for (const q of selected) {
              await window.StorageService.saveQuestion(q);
              savedCount++;
            }
          }
        } else if (typeof window !== 'undefined' && window.storage) {
          if (typeof window.storage.addQuestion === 'function') {
            await window.storage.addQuestion(selected);
            savedCount = selected.length;
          }
        } else {
          const existingStr = localStorage.getItem('jee_questions_cache') || localStorage.getItem('jee_questions_bank') || '[]';
          const existing = JSON.parse(existingStr);
          const combined = [...existing, ...selected];
          localStorage.setItem('jee_questions_cache', JSON.stringify(combined));
          savedCount = selected.length;
        }

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('jee:questions-added', {
            detail: { questions: selected, count: savedCount }
          }));
        }

        if (typeof this.onSave === 'function') {
          this.onSave(selected);
        }

        return { success: true, count: savedCount };
      } catch (err) {
        console.error('Error saving questions to bank:', err);
        return { success: false, count: savedCount, error: err.message };
      }
    }

    render() {
      if (!this.container) return;

      const totalCount = this.questions.length;
      const selectedCount = this.selectedQuestionIds.size;
      const allSelected = totalCount > 0 && selectedCount === totalCount;

      this.container.innerHTML = `
        <div class="review-workbench flex flex-col h-full bg-slate-900 text-slate-100 rounded-xl overflow-hidden border border-slate-700/80 shadow-2xl">
          <!-- Top Action Bar -->
          <div class="flex flex-wrap items-center justify-between px-6 py-4 bg-slate-800/90 border-b border-slate-700 backdrop-blur-sm gap-4">
            <div class="flex items-center space-x-3">
              <span class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/30">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
              </span>
              <div>
                <h3 class="text-base font-bold text-white tracking-wide">Review & Stage Scanned Questions</h3>
                <p class="text-xs text-slate-400">${totalCount} question(s) parsed • ${selectedCount} selected for Question Bank</p>
              </div>
            </div>

            <div class="flex items-center space-x-3">
              <label class="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer select-none px-2 py-1.5 rounded hover:bg-slate-700/60 transition">
                <input type="checkbox" id="wb-select-all" ${allSelected ? 'checked' : ''} class="w-4 h-4 rounded text-indigo-600 bg-slate-700 border-slate-600 focus:ring-indigo-500">
                <span>Select All (${totalCount})</span>
              </label>

              <button type="button" id="wb-add-blank-btn" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition flex items-center space-x-1 border border-slate-600">
                <span>+ Add Manual Question</span>
              </button>

              <button type="button" id="wb-commit-btn" class="px-4 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/30 transition flex items-center space-x-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                <span>Add Selected (${selectedCount}) to Bank</span>
              </button>

              ${this.onClose ? `
                <button type="button" id="wb-close-btn" class="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/60 transition" title="Close">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              ` : ''}
            </div>
          </div>

          <!-- Main Split Container -->
          <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
            <!-- Left: Scanned Document Viewer (if preview available) -->
            ${this.filePreview ? `
              <div class="lg:col-span-5 border-r border-slate-700/80 bg-slate-950/60 flex flex-col overflow-hidden">
                <div class="px-4 py-2 bg-slate-800/60 border-b border-slate-700/60 flex items-center justify-between text-xs text-slate-300">
                  <span class="font-medium flex items-center space-x-1.5">
                    <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                    <span>Original Document Reference</span>
                  </span>
                  <span class="text-slate-500 font-mono text-[11px]">${this.filePreview.name || 'Uploaded File'}</span>
                </div>
                <div class="flex-1 overflow-auto p-4 flex items-center justify-center" id="wb-doc-preview-wrapper">
                  ${this.filePreview.dataUrl ? `
                    <img src="${this.filePreview.dataUrl}" alt="Scanned document" class="max-w-full h-auto rounded border border-slate-700 shadow-md">
                  ` : `
                    <div class="text-center text-slate-500 text-xs py-12">
                      <p>Document preview active</p>
                    </div>
                  `}
                </div>
              </div>
            ` : ''}

            <!-- Right: Questions Review Cards List -->
            <div class="${this.filePreview ? 'lg:col-span-7' : 'lg:col-span-12'} flex-1 overflow-y-auto p-6 space-y-6">
              ${totalCount === 0 ? `
                <div class="text-center py-16 px-4">
                  <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  </div>
                  <h4 class="text-slate-300 font-semibold mb-1">No questions found in this scan</h4>
                  <p class="text-slate-500 text-xs max-w-sm mx-auto mb-4">You can click "+ Add Manual Question" to draft a question manually or try scanning with a clear image/PDF.</p>
                </div>
              ` : ''}

              <!-- Question Cards -->
              ${this.questions.map((q, idx) => this.renderQuestionCard(q, idx)).join('')}
            </div>
          </div>
        </div>
      `;

      this.bindEvents();
      renderMath(this.container);
    }

    renderQuestionCard(q, idx) {
      const isSelected = this.selectedQuestionIds.has(q.id);
      const subjectColors = {
        Physics: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        Chemistry: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        Mathematics: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      };
      const badgeClass = subjectColors[q.subject] || subjectColors.Physics;

      return `
        <div class="question-edit-card rounded-xl border ${isSelected ? 'border-indigo-500/60 bg-slate-800/80 shadow-indigo-950/20' : 'border-slate-700/60 bg-slate-800/40 opacity-75'} p-5 transition shadow-lg relative" data-qid="${q.id}">
          <!-- Card Header -->
          <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-700/60 gap-3">
            <div class="flex items-center space-x-3">
              <input type="checkbox" class="wb-q-select w-4 h-4 rounded text-indigo-600 bg-slate-700 border-slate-600 focus:ring-indigo-500" data-qid="${q.id}" ${isSelected ? 'checked' : ''}>
              <span class="font-bold text-sm text-white">Q${idx + 1}</span>
              <span class="text-xs px-2.5 py-0.5 rounded-full border font-medium ${badgeClass}">
                ${q.subject}
              </span>
              <span class="text-xs px-2 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono">
                ${q.type === 'single_choice' ? 'MCQ Single' : (q.type === 'multiple_choice' ? 'MCQ Multi' : 'Numerical')}
              </span>
              <span class="text-xs px-2 py-0.5 rounded bg-slate-700/40 text-slate-400">
                ${q.difficulty}
              </span>
            </div>

            <div class="flex items-center space-x-2">
              <button type="button" class="wb-q-del-btn p-1.5 text-slate-400 hover:text-red-400 rounded hover:bg-slate-700/60 transition" data-qid="${q.id}" title="Delete Question">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            </div>
          </div>

          <!-- Metadata Selectors (Subject, Chapter, Difficulty, Type) -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
            <div>
              <label class="block text-slate-400 mb-1">Subject</label>
              <select class="wb-q-subject w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500" data-qid="${q.id}">
                <option value="Physics" ${q.subject === 'Physics' ? 'selected' : ''}>Physics</option>
                <option value="Chemistry" ${q.subject === 'Chemistry' ? 'selected' : ''}>Chemistry</option>
                <option value="Mathematics" ${q.subject === 'Mathematics' ? 'selected' : ''}>Mathematics</option>
              </select>
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Chapter / Topic</label>
              <input type="text" class="wb-q-chapter w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500" value="${escapeHtml(q.chapter || '')}" data-qid="${q.id}" placeholder="e.g. Thermodynamics">
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Difficulty</label>
              <select class="wb-q-difficulty w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500" data-qid="${q.id}">
                <option value="Easy" ${q.difficulty === 'Easy' ? 'selected' : ''}>Easy</option>
                <option value="Medium" ${q.difficulty === 'Medium' ? 'selected' : ''}>Medium</option>
                <option value="Hard" ${q.difficulty === 'Hard' ? 'selected' : ''}>Hard (Adv)</option>
              </select>
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Question Type</label>
              <select class="wb-q-type w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500" data-qid="${q.id}">
                <option value="single_choice" ${q.type === 'single_choice' ? 'selected' : ''}>Single Choice (+4/-1)</option>
                <option value="multiple_choice" ${q.type === 'multiple_choice' ? 'selected' : ''}>Multiple Choice (+4/-2)</option>
                <option value="numerical" ${q.type === 'numerical' ? 'selected' : ''}>Numerical (+4/0)</option>
              </select>
            </div>
          </div>

          <!-- Question Stem (Textarea + Live KaTeX Math Preview) -->
          <div class="mb-4">
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs font-semibold text-slate-300">Question Stem (LaTeX: $...$)</label>
              <button type="button" class="wb-toggle-preview-btn text-[11px] text-indigo-400 hover:text-indigo-300 font-medium" data-target="stem-preview-${q.id}">
                Refresh Math Preview
              </button>
            </div>
            <textarea class="wb-q-stem w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-indigo-500 min-h-[70px]" data-qid="${q.id}" rows="3">${escapeHtml(q.stem || q.question || '')}</textarea>
            <!-- Math Preview Box -->
            <div id="stem-preview-${q.id}" class="wb-math-preview mt-2 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-slate-200 text-sm">
              ${escapeHtml(q.stem || q.question || '')}
            </div>
          </div>

          <!-- Diagram Notice if present -->
          ${q.hasDiagram ? `
            <div class="mb-4 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start space-x-2">
              <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              <div>
                <span class="font-semibold">Figure/Diagram Detected:</span>
                <span class="text-slate-300">${escapeHtml(q.diagramDescription || 'Reference figure in scanned document')}</span>
              </div>
            </div>
          ` : ''}

          <!-- Options or Numerical Answer -->
          ${q.type === 'numerical' ? `
            <div class="mb-4 p-3 rounded-lg bg-slate-900/80 border border-slate-700/80">
              <label class="block text-xs font-semibold text-slate-300 mb-1">Correct Numerical Answer</label>
              <input type="text" class="wb-q-num-ans w-48 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-emerald-400 font-mono font-bold text-sm focus:outline-none focus:border-emerald-500" value="${escapeHtml(String(q.correctAnswer || q.correct_answer || '0'))}" data-qid="${q.id}" placeholder="e.g. 4.5">
            </div>
          ` : `
            <div class="mb-4 space-y-2">
              <label class="block text-xs font-semibold text-slate-300">
                Options & Correct Answer (${q.type === 'multiple_choice' ? 'Check all correct' : 'Select one correct'})
              </label>
              <div class="space-y-2">
                ${(q.options || []).map((opt, optIndex) => {
                  const isChecked = Array.isArray(q.correctAnswer)
                    ? q.correctAnswer.includes(opt.id)
                    : (q.correctAnswer === opt.id || q.correct_answer === opt.id);
                  return `
                    <div class="flex items-center space-x-2 p-2 rounded-lg ${isChecked ? 'bg-emerald-950/40 border border-emerald-600/40' : 'bg-slate-900/60 border border-slate-700/60'}">
                      <label class="flex items-center space-x-1 cursor-pointer flex-shrink-0">
                        <input type="${q.type === 'multiple_choice' ? 'checkbox' : 'radio'}" name="ans-${q.id}" value="${opt.id}" class="wb-q-opt-check w-4 h-4 text-emerald-500 bg-slate-800 border-slate-600 focus:ring-emerald-500" data-qid="${q.id}" ${isChecked ? 'checked' : ''}>
                        <span class="font-bold text-xs ${isChecked ? 'text-emerald-400' : 'text-slate-400'} px-1">(${opt.id})</span>
                      </label>
                      <input type="text" class="wb-q-opt-text flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500" data-qid="${q.id}" data-opt-id="${opt.id}" value="${escapeHtml(opt.text || '')}">
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `}

          <!-- Explanation / Solution -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs font-semibold text-slate-300">Step-by-Step Solution / Explanation ($LaTeX$)</label>
              <button type="button" class="wb-toggle-preview-btn text-[11px] text-indigo-400 hover:text-indigo-300 font-medium" data-target="exp-preview-${q.id}">
                Refresh Solution Preview
              </button>
            </div>
            <textarea class="wb-q-explanation w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 text-xs font-mono focus:outline-none focus:border-indigo-500 min-h-[60px]" data-qid="${q.id}" rows="2">${escapeHtml(q.explanation || '')}</textarea>
            <div id="exp-preview-${q.id}" class="wb-math-preview mt-2 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-slate-300 text-xs">
              ${escapeHtml(q.explanation || '')}
            </div>
          </div>
        </div>
      `;
    }

    bindEvents() {
      const selectAllEl = this.container.querySelector('#wb-select-all');
      if (selectAllEl) {
        selectAllEl.addEventListener('change', (e) => {
          this.toggleSelectAll(e.target.checked);
        });
      }

      const addBlankBtn = this.container.querySelector('#wb-add-blank-btn');
      if (addBlankBtn) {
        addBlankBtn.addEventListener('click', () => this.addBlankQuestion());
      }

      const commitBtn = this.container.querySelector('#wb-commit-btn');
      if (commitBtn) {
        commitBtn.addEventListener('click', async () => {
          commitBtn.disabled = true;
          commitBtn.innerHTML = `<span>Saving...</span>`;
          const res = await this.commitToQuestionBank();
          if (res.success) {
            commitBtn.innerHTML = `<span>✓ Added ${res.count} Questions!</span>`;
            setTimeout(() => {
              if (this.onClose) this.onClose();
            }, 1200);
          } else {
            commitBtn.disabled = false;
            commitBtn.innerHTML = `<span>Retry Adding (${this.selectedQuestionIds.size})</span>`;
          }
        });
      }

      const closeBtn = this.container.querySelector('#wb-close-btn');
      if (closeBtn && this.onClose) {
        closeBtn.addEventListener('click', () => this.onClose());
      }

      this.container.querySelectorAll('.wb-q-select').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const qid = e.target.getAttribute('data-qid');
          if (e.target.checked) {
            this.selectedQuestionIds.add(qid);
          } else {
            this.selectedQuestionIds.delete(qid);
          }
          this.updateCardSelectionStyle(qid, e.target.checked);
          this.updateHeaderCounts();
        });
      });

      this.container.querySelectorAll('.wb-q-del-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const qid = btn.getAttribute('data-qid');
          this.deleteQuestion(qid);
        });
      });

      this.container.querySelectorAll('.wb-q-subject').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const q = this.getQuestion(e.target.dataset.qid);
          if (q) q.subject = e.target.value;
        });
      });

      this.container.querySelectorAll('.wb-q-chapter').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const q = this.getQuestion(e.target.dataset.qid);
          if (q) q.chapter = e.target.value;
        });
      });

      this.container.querySelectorAll('.wb-q-difficulty').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const q = this.getQuestion(e.target.dataset.qid);
          if (q) q.difficulty = e.target.value;
        });
      });

      this.container.querySelectorAll('.wb-q-type').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const q = this.getQuestion(e.target.dataset.qid);
          if (q) {
            q.type = e.target.value;
            this.render();
          }
        });
      });

      this.container.querySelectorAll('.wb-q-stem').forEach(ta => {
        ta.addEventListener('input', (e) => {
          const qid = e.target.dataset.qid;
          const q = this.getQuestion(qid);
          if (q) {
            q.stem = e.target.value;
            q.question = e.target.value;
          }
          const previewEl = this.container.querySelector(`#stem-preview-${qid}`);
          if (previewEl) {
            previewEl.textContent = e.target.value;
            renderMath(previewEl);
          }
        });
      });

      this.container.querySelectorAll('.wb-q-explanation').forEach(ta => {
        ta.addEventListener('input', (e) => {
          const qid = e.target.dataset.qid;
          const q = this.getQuestion(qid);
          if (q) q.explanation = e.target.value;
          const previewEl = this.container.querySelector(`#exp-preview-${qid}`);
          if (previewEl) {
            previewEl.textContent = e.target.value;
            renderMath(previewEl);
          }
        });
      });

      this.container.querySelectorAll('.wb-q-opt-text').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const qid = e.target.dataset.qid;
          const optId = e.target.dataset.optId;
          const q = this.getQuestion(qid);
          if (q && q.options) {
            const opt = q.options.find(o => o.id === optId);
            if (opt) opt.text = e.target.value;
          }
        });
      });

      this.container.querySelectorAll('.wb-q-opt-check').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const qid = e.target.dataset.qid;
          const q = this.getQuestion(qid);
          if (!q) return;

          if (q.type === 'multiple_choice') {
            const allChecked = Array.from(this.container.querySelectorAll(`input[name="ans-${qid}"]:checked`))
              .map(i => i.value);
            q.correctAnswer = allChecked;
            q.correct_answer = allChecked;
          } else {
            q.correctAnswer = e.target.value;
            q.correct_answer = e.target.value;
          }
          this.render();
        });
      });

      this.container.querySelectorAll('.wb-q-num-ans').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const q = this.getQuestion(e.target.dataset.qid);
          if (q) {
            q.correctAnswer = e.target.value;
            q.correct_answer = e.target.value;
          }
        });
      });

      this.container.querySelectorAll('.wb-toggle-preview-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = btn.getAttribute('data-target');
          const previewEl = this.container.querySelector(`#${targetId}`);
          if (previewEl) {
            renderMath(previewEl);
          }
        });
      });
    }

    getQuestion(id) {
      return this.questions.find(q => q.id === id);
    }

    updateCardSelectionStyle(qid, isSelected) {
      const card = this.container.querySelector(`.question-edit-card[data-qid="${qid}"]`);
      if (card) {
        if (isSelected) {
          card.classList.add('border-indigo-500/60', 'bg-slate-800/80');
          card.classList.remove('opacity-75');
        } else {
          card.classList.remove('border-indigo-500/60', 'bg-slate-800/80');
          card.classList.add('opacity-75');
        }
      }
    }

    updateHeaderCounts() {
      const totalCount = this.questions.length;
      const selectedCount = this.selectedQuestionIds.size;
      const commitBtn = this.container.querySelector('#wb-commit-btn span');
      if (commitBtn) {
        commitBtn.textContent = `Add Selected (${selectedCount}) to Bank`;
      }
      const selectAllEl = this.container.querySelector('#wb-select-all');
      if (selectAllEl) {
        selectAllEl.checked = totalCount > 0 && selectedCount === totalCount;
      }
    }
  }

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function openReviewModal({ questions, filePreview, onSave }) {
    if (typeof document === 'undefined') return null;

    const existing = document.getElementById('jee-scanner-review-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'jee-scanner-review-modal-overlay';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-md animate-fade-in';

    const modalBox = document.createElement('div');
    modalBox.className = 'relative w-full max-w-6xl h-[90vh] flex flex-col';
    overlay.appendChild(modalBox);
    document.body.appendChild(overlay);

    const workbench = new ReviewWorkbench(modalBox, {
      filePreview,
      onSave: (saved) => {
        overlay.remove();
        if (typeof onSave === 'function') onSave(saved);
      },
      onClose: () => {
        overlay.remove();
      }
    });

    workbench.loadQuestions(questions, filePreview);
    return workbench;
  }

  // Public API
  return {
    scanDocument,
    scanLocalRegex,
    callGeminiMultimodal,
    normalizeQuestion,
    detectSubjectFromText,
    detectChapterFromText,
    getApiKey,
    setApiKey,
    hasApiKey,
    testApiKey,
    renderMath,
    ReviewWorkbench,
    openReviewModal,
    JEE_EXTRACTION_SYSTEM_PROMPT,
    GEMINI_MODEL_DEFAULT
  };
});

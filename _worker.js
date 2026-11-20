/**
 * Cloudflare Worker / Pages Advanced Mode Fetch Handler
 * Powers QuestionForge API on Cloudflare Edge Runtime
 * Zero dependencies - uses Web Standard APIs (fetch, Request, Response, crypto, URL)
 */

// Embedded Seed Questions (JEE Main & Advanced)
const SEED_QUESTIONS = [
  {
    "id": "jee_phy_001",
    "subject": "Physics",
    "chapter": "Rotational Motion",
    "difficulty": "JEE Advanced",
    "type": "single_choice",
    "marks": { "correct": 4, "incorrect": -1 },
    "year": "JEE Advanced 2022",
    "question": "A uniform solid cylinder of mass $M$ and radius $R$ is placed on a rough horizontal surface with coefficient of friction $\\mu$. A horizontal force $F$ is applied at the top edge of the cylinder at a height $2R$ from the surface. What is the maximum value of $F$ such that the cylinder rolls without slipping?",
    "options": [
      { "id": "A", "text": "$\\frac{3}{2}\\mu M g$" },
      { "id": "B", "text": "$3\\mu M g$" },
      { "id": "C", "text": "$\\frac{1}{3}\\mu M g$" },
      { "id": "D", "text": "$2\\mu M g$" }
    ],
    "correct_answer": "B",
    "explanation": "Let the acceleration of the center of mass be $a$ and angular acceleration be $\\alpha$. For pure rolling without slipping: $a = R\\alpha$.\n\nLinear equation of motion:\n$$F + f = Ma$$\n\nTorque equation about the center of mass (taking clockwise as positive):\n$$F \\cdot R - f \\cdot R = I\\alpha$$\n\nFor a solid cylinder, $I = \\frac{1}{2}MR^2$. Therefore:\n$$F - f = \\frac{1}{2}MR\\alpha = \\frac{1}{2}Ma$$\n\nSubtracting the two equations:\n$$2f = \\frac{1}{2}Ma \\implies a = \\frac{4f}{M}$$\n\nSubstituting $a$ back into $F + f = Ma$:\n$$F + f = M \\left(\\frac{4f}{M}\\right) = 4f \\implies F = 3f$$\n\nFor rolling without slipping, static friction must satisfy $f \\le f_{\\max} = \\mu Mg$. Therefore:\n$$F = 3f \\le 3\\mu Mg$$\nHence, the maximum horizontal force is $F_{\\max} = 3\\mu Mg$."
  },
  {
    "id": "jee_phy_002",
    "subject": "Physics",
    "chapter": "Electrostatics",
    "difficulty": "JEE Main",
    "type": "single_choice",
    "marks": { "correct": 4, "incorrect": -1 },
    "year": "JEE Main 2023",
    "question": "A parallel plate capacitor with plate area $A$ and separation $d$ is charged to a potential difference $V_0$ and then disconnected from the battery. A dielectric slab of dielectric constant $K = 4$ and thickness $t = \\frac{d}{2}$ is inserted between the plates. The new potential difference across the capacitor is:",
    "options": [
      { "id": "A", "text": "$\\frac{5}{8}V_0$" },
      { "id": "B", "text": "$\\frac{3}{4}V_0$" },
      { "id": "C", "text": "$\\frac{1}{2}V_0$" },
      { "id": "D", "text": "$\\frac{7}{8}V_0$" }
    ],
    "correct_answer": "A",
    "explanation": "Since the capacitor is disconnected from the battery, the charge $Q = C_0 V_0$ remains constant, where $C_0 = \\frac{\\varepsilon_0 A}{d}$.\n\nThe initial electric field in air is $E_0 = \\frac{V_0}{d}$.\nWhen the dielectric of thickness $t = \\frac{d}{2}$ and constant $K$ is introduced:\n- The electric field inside the dielectric is $E = \\frac{E_0}{K} = \\frac{E_0}{4}$.\n- The electric field in the remaining air gap of thickness $(d - t) = \\frac{d}{2}$ is $E_0$.\n\nThe new potential difference $V$ across the plates is:\n$$V = E_0(d - t) + \\frac{E_0}{K}t = E_0 \\left(\\frac{d}{2}\\right) + \\frac{E_0}{4} \\left(\\frac{d}{2}\\right) = E_0 d \\left(\\frac{1}{2} + \\frac{1}{8}\\right) = V_0 \\left(\\frac{5}{8}\\right)$$\nTherefore, the new potential difference is $\\frac{5}{8}V_0$."
  },
  {
    "id": "jee_phy_003",
    "subject": "Physics",
    "chapter": "Modern Physics",
    "difficulty": "JEE Main",
    "type": "single_choice",
    "marks": { "correct": 4, "incorrect": -1 },
    "year": "JEE Main 2024",
    "question": "In a photoelectric experiment, when light of frequency $\\nu$ is incident on a metal surface, the stopping potential is $V_1$. When light of frequency $2\\nu$ is incident on the same metal surface, the stopping potential becomes $V_2$. If the threshold frequency of the metal is $\\nu_0$, which of the following relations is correct?",
    "options": [
      { "id": "A", "text": "$V_2 - 2V_1 = \\frac{h\\nu_0}{e}$" },
      { "id": "B", "text": "$V_2 - V_1 = \\frac{h\\nu}{e}$" },
      { "id": "C", "text": "$2V_2 - V_1 = \\frac{h\\nu}{2e}$" },
      { "id": "D", "text": "$V_2 + V_1 = \\frac{3h\\nu}{e}$" }
    ],
    "correct_answer": "B",
    "explanation": "According to Einstein's photoelectric equation:\n$$e V_s = h\\nu - \\phi$$\n\nFor the two cases:\n1) $e V_1 = h\\nu - h\\nu_0$\n2) $e V_2 = h(2\\nu) - h\\nu_0 = 2h\\nu - h\\nu_0$\n\nSubtracting equation (1) from equation (2):\n$$e(V_2 - V_1) = (2h\\nu - h\\nu_0) - (h\\nu - h\\nu_0) = h\\nu$$\n$$\\implies V_2 - V_1 = \\frac{h\\nu}{e}$$\nAlso note that $V_2 - 2V_1 = \\frac{h\\nu_0}{e}$, making option B the direct relationship."
  },
  {
    "id": "jee_phy_004",
    "subject": "Physics",
    "chapter": "Wave Optics",
    "difficulty": "JEE Advanced",
    "type": "multiple_choice",
    "marks": { "correct": 4, "incorrect": -2 },
    "year": "JEE Advanced 2021",
    "question": "In a Young's double slit experiment with slit separation $d = 1\\text{ mm}$ and screen distance $D = 1\\text{ m}$, monochromatic light of wavelength $\\lambda = 600\\text{ nm}$ is used. A thin transparent glass sheet of refractive index $\\mu = 1.5$ and thickness $t = 6\\,\\mu\\text{m}$ is introduced in front of one of the slits. Which of the following statements is/are correct?",
    "options": [
      { "id": "A", "text": "The entire fringe pattern shifts by a distance of $3\\text{ mm}$." },
      { "id": "B", "text": "The central maximum shifts towards the slit covered with the glass sheet." },
      { "id": "C", "text": "The fringe width $\\beta$ changes due to the presence of the glass sheet." },
      { "id": "D", "text": "The optical path difference introduced by the sheet is $3\\,\\mu\\text{m}$." }
    ],
    "correct_answer": ["A", "B", "D"],
    "explanation": "When a thin sheet of thickness $t$ and refractive index $\\mu$ is placed in front of one slit:\n1. Additional optical path introduced: $\\Delta x = (\\mu - 1)t = (1.5 - 1)(6\\times 10^{-6}\\text{ m}) = 0.5 \\times 6\\times 10^{-6}\\text{ m} = 3\\,\\mu\\text{m}$. Thus statement (D) is correct.\n2. The fringe shift on screen is given by:\n$$\\Delta y = \\frac{D}{d}(\\mu - 1)t = \\frac{1}{10^{-3}} \\times (3\\times 10^{-6}\\text{ m}) = 3\\times 10^{-3}\\text{ m} = 3\\text{ mm}$$.\nThus statement (A) is correct.\n3. The pattern always shifts towards the slit that has the glass sheet because the extra optical path must be compensated by an equal geometric path from the other slit. Thus statement (B) is correct.\n4. The fringe width $\\beta = \\frac{\\lambda D}{d}$ depends only on $\\lambda, D, d$ and remains unaffected by introducing the plate. Thus statement (C) is incorrect."
  },
  {
    "id": "jee_phy_005",
    "subject": "Physics",
    "chapter": "Electromagnetic Induction",
    "difficulty": "JEE Advanced",
    "type": "numerical",
    "marks": { "correct": 4, "incorrect": 0 },
    "year": "JEE Advanced 2023",
    "question": "A conducting rod of length $L = 2\\text{ m}$ rotates with a constant angular velocity $\\omega = 10\\text{ rad/s}$ in a plane perpendicular to a uniform magnetic field $B = 0.5\\text{ T}$. The axis of rotation passes through one end of the rod. The magnitude of the induced electromotive force (EMF) between the two ends of the rod (in Volts) is:",
    "correct_answer": 10,
    "tolerance": 0.1,
    "explanation": "Consider a small element of the rod of length $dr$ at a distance $r$ from the axis of rotation.\nThe linear velocity of this element is $v = \\omega r$.\nThe induced EMF in this small element is:\n$$d\\mathcal{E} = B v dr = B (\\omega r) dr$$\nIntegrating from $r = 0$ to $r = L$:\n$$\\mathcal{E} = \\int_0^L B \\omega r dr = \\frac{1}{2} B \\omega L^2$$\nSubstituting the given values:\n$$\\mathcal{E} = \\frac{1}{2} \\times 0.5 \\times 10 \\times (2)^2 = \\frac{1}{2} \\times 0.5 \\times 10 \\times 4 = 10\\text{ V}$$\nTherefore, the induced EMF is $10\\text{ V}$."
  },
  {
    "id": "jee_chem_001",
    "subject": "Chemistry",
    "chapter": "Chemical Kinetics",
    "difficulty": "JEE Main",
    "type": "single_choice",
    "marks": { "correct": 4, "incorrect": -1 },
    "year": "JEE Main 2023",
    "question": "A first-order reaction $A \\rightarrow B$ has a rate constant $k = 6.93 \\times 10^{-3}\\text{ s}^{-1}$. The time required for the concentration of reactant $A$ to decrease from its initial value to $12.5\\%$ of its initial value is: (Take $\\ln 2 = 0.693$)",
    "options": [
      { "id": "A", "text": "$200\\text{ s}$" },
      { "id": "B", "text": "$300\\text{ s}$" },
      { "id": "C", "text": "$100\\text{ s}$" },
      { "id": "D", "text": "$400\\text{ s}$" }
    ],
    "correct_answer": "B",
    "explanation": "For a first order reaction, the half-life $t_{1/2}$ is:\n$$t_{1/2} = \\frac{\\ln 2}{k} = \\frac{0.693}{6.93 \\times 10^{-3}} = 100\\text{ s}$$\n\nThe fraction remaining is $12.5\\% = \\frac{12.5}{100} = \\frac{1}{8} = \\left(\\frac{1}{2}\\right)^3$.\nThis corresponds to exactly 3 half-lives:\n$$t = 3 \\times t_{1/2} = 3 \\times 100\\text{ s} = 300\\text{ s}$$\nTherefore, the required time is $300\\text{ s}$."
  },
  {
    "id": "jee_chem_002",
    "subject": "Chemistry",
    "chapter": "Electrochemistry",
    "difficulty": "JEE Main",
    "type": "single_choice",
    "marks": { "correct": 4, "incorrect": -1 },
    "year": "JEE Main 2024",
    "question": "For the galvanic cell $\\text{Zn}(s) | \\text{Zn}^{2+}(0.01\\text{ M}) \\,||\\, \\text{Cu}^{2+}(0.1\\text{ M}) | \\text{Cu}(s)$, given standard reduction potentials $E^\\circ_{\\text{Zn}^{2+}/\\text{Zn}} = -0.76\\text{ V}$ and $E^\\circ_{\\text{Cu}^{2+}/\\text{Cu}} = +0.34\\text{ V}$. Taking $\\frac{2.303 RT}{F} = 0.059\\text{ V}$ at $298\\text{ K}$, the cell electromotive force $E_{\\text{cell}}$ is:",
    "options": [
      { "id": "A", "text": "$1.100\\text{ V}$" },
      { "id": "B", "text": "$1.1295\\text{ V}$" },
      { "id": "C", "text": "$1.0705\\text{ V}$" },
      { "id": "D", "text": "$1.159\\text{ V}$" }
    ],
    "correct_answer": "B",
    "explanation": "Standard cell potential:\n$$E^\\circ_{\\text{cell}} = E^\\circ_{\\text{cathode}} - E^\\circ_{\\text{anode}} = 0.34 - (-0.76) = 1.10\\text{ V}$$\n\nThe cell reaction is:\n$$\\text{Zn}(s) + \\text{Cu}^{2+}(aq) \\rightleftharpoons \\text{Zn}^{2+}(aq) + \\text{Cu}(s) \\quad (n = 2)$$\n\nReaction quotient $Q = \\frac{[\\text{Zn}^{2+}]}{[\\text{Cu}^{2+}]} = \\frac{0.01}{0.1} = 0.1 = 10^{-1}$.\n\nApplying Nernst Equation:\n$$E_{\\text{cell}} = E^\\circ_{\\text{cell}} - \\frac{0.059}{n}\\log_{10} Q$$\n$$E_{\\text{cell}} = 1.10 - \\frac{0.059}{2}\\log_{10}(10^{-1}) = 1.10 + \\frac{0.059}{2}(1) = 1.10 + 0.0295 = 1.1295\\text{ V}$$\nThus, $E_{\\text{cell}} = 1.1295\\text{ V}$."
  },
  {
    "id": "jee_math_001",
    "subject": "Mathematics",
    "chapter": "Definite Integration",
    "difficulty": "JEE Advanced",
    "type": "single_choice",
    "marks": { "correct": 4, "incorrect": -1 },
    "year": "JEE Advanced 2022",
    "question": "The value of the definite integral $I = \\int_{0}^{\\pi} \\frac{x \\sin x}{1 + \\cos^2 x} dx$ is equal to:",
    "options": [
      { "id": "A", "text": "$\\frac{\\pi^2}{4}$" },
      { "id": "B", "text": "$\\frac{\\pi^2}{2}$" },
      { "id": "C", "text": "$\\pi^2$" },
      { "id": "D", "text": "$\\frac{\\pi}{4}$" }
    ],
    "correct_answer": "A",
    "explanation": "Using King's property $\\int_a^b f(x) dx = \\int_a^b f(a + b - x) dx$:\n$$I = \\int_0^{\\pi} \\frac{(\\pi - x) \\sin(\\pi - x)}{1 + \\cos^2(\\pi - x)} dx = \\int_0^{\\pi} \\frac{(\\pi - x) \\sin x}{1 + \\cos^2 x} dx$$\n\nAdding the two expressions for $I$:\n$$2I = \\int_0^{\\pi} \\frac{\\pi \\sin x}{1 + \\cos^2 x} dx = \\pi \\int_0^{\\pi} \\frac{\\sin x}{1 + \\cos^2 x} dx$$\n\nLet $u = \\cos x$, then $du = -\\sin x dx$.\nWhen $x = 0$, $u = 1$; when $x = \\pi$, $u = -1$.\n$$2I = \\pi \\int_{1}^{-1} \\frac{-du}{1 + u^2} = \\pi \\int_{-1}^{1} \\frac{du}{1 + u^2} = \\pi \\left[ \\tan^{-1} u \\right]_{-1}^1$$\n$$2I = \\pi \\left( \\frac{\\pi}{4} - \\left(-\\frac{\\pi}{4}\\right) \\right) = \\pi \\left(\\frac{\\pi}{2}\\right) = \\frac{\\pi^2}{2}$$\n$$\\implies I = \\frac{\\pi^2}{4}$$\nThus, the answer is $\\frac{\\pi^2}{4}$."
  },
  {
    "id": "jee_math_002",
    "subject": "Mathematics",
    "chapter": "Differential Equations",
    "difficulty": "JEE Main",
    "type": "single_choice",
    "marks": { "correct": 4, "incorrect": -1 },
    "year": "JEE Main 2024",
    "question": "The integrating factor of the first-order linear differential equation $\\left(1 + x^2\\right)\\frac{dy}{dx} + 2xy = \\sqrt{x^2 + 4}$ is:",
    "options": [
      { "id": "A", "text": "$e^{\\tan^{-1} x}$" },
      { "id": "B", "text": "$1 + x^2$" },
      { "id": "C", "text": "$\\frac{1}{1 + x^2}$" },
      { "id": "D", "text": "$\\ln(1 + x^2)$" }
    ],
    "correct_answer": "B",
    "explanation": "Divide the entire differential equation by $\\left(1 + x^2\\right)$ to write it in standard form $\\frac{dy}{dx} + P(x)y = Q(x)$:\n$$\\frac{dy}{dx} + \\left(\\frac{2x}{1 + x^2}\\right)y = \\frac{\\sqrt{x^2 + 4}}{1 + x^2}$$\n\nHere $P(x) = \\frac{2x}{1 + x^2}$.\nThe integrating factor (I.F.) is given by:\n$$\\text{I.F.} = e^{\\int P(x)dx} = e^{\\int \\frac{2x}{1 + x^2}dx} = e^{\\ln(1 + x^2)} = 1 + x^2$$\nTherefore, the integrating factor is $1 + x^2$."
  }
];

// In-memory cache for Worker edge instance
let questionsCache = null;
let savedGeminiKey = null;

// CORS Headers helper
function corsHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    ...extra
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(extraHeaders)
  });
}

// Load questions from KV or fallback to seed
async function getQuestionsFromStore(env) {
  if (env && env.JEE_QUESTIONS_KV) {
    try {
      const kvData = await env.JEE_QUESTIONS_KV.get('questions', 'json');
      if (kvData && Array.isArray(kvData) && kvData.length > 0) {
        return kvData;
      }
    } catch (e) {
      console.warn('KV read failed:', e);
    }
  }
  if (!questionsCache) {
    questionsCache = [...SEED_QUESTIONS];
  }
  return questionsCache;
}

// Save questions to KV and edge cache
async function saveQuestionsToStore(env, questions) {
  questionsCache = questions;
  if (env && env.JEE_QUESTIONS_KV) {
    try {
      await env.JEE_QUESTIONS_KV.put('questions', JSON.stringify(questions));
      return true;
    } catch (e) {
      console.error('KV write failed:', e);
    }
  }
  return true;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // 1. CORS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 2. Handle API endpoints (/api/*)
    if (pathname.startsWith('/api/')) {

      // GET /api/health
      if (pathname === '/api/health' && method === 'GET') {
        const questions = await getQuestionsFromStore(env);
        const apiKey = (env && env.GEMINI_API_KEY) || savedGeminiKey;
        return jsonResponse({
          status: 'ok',
          service: 'QuestionForge Edge Server',
          version: '2.0.0-cf',
          edge: true,
          timestamp: new Date().toISOString(),
          questionCount: questions.length,
          features: {
            kvBound: Boolean(env && env.JEE_QUESTIONS_KV),
            geminiConfigured: Boolean(apiKey)
          }
        });
      }

      // GET /api/config/gemini-key
      if (pathname === '/api/config/gemini-key' && method === 'GET') {
        const key = (env && env.GEMINI_API_KEY) || savedGeminiKey || '';
        return jsonResponse({
          configured: Boolean(key),
          maskedKey: key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : null
        });
      }

      // POST /api/config/gemini-key
      if (pathname === '/api/config/gemini-key' && method === 'POST') {
        try {
          const body = await request.json();
          savedGeminiKey = (body.apiKey || '').trim();
          if (env && env.JEE_QUESTIONS_KV) {
            await env.JEE_QUESTIONS_KV.put('gemini_api_key', savedGeminiKey);
          }
          return jsonResponse({
            success: true,
            message: 'Gemini API key configured for Cloudflare Edge session',
            configured: Boolean(savedGeminiKey),
            maskedKey: savedGeminiKey ? `${savedGeminiKey.substring(0, 6)}...${savedGeminiKey.substring(savedGeminiKey.length - 4)}` : null
          });
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 400);
        }
      }

      // POST /api/upload-image
      if (pathname === '/api/upload-image' && method === 'POST') {
        try {
          const body = await request.json();
          let base64Data = body.image || body.base64 || body.data;
          let mimeType = body.mimeType || 'image/png';
          let name = body.name || 'image.png';

          if (!base64Data) {
            return jsonResponse({ success: false, error: 'No image data provided' }, 400);
          }

          const filename = `qimg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;
          const dataUrl = base64Data.startsWith('data:') ? base64Data : `data:${mimeType};base64,${base64Data}`;

          // If Cloudflare KV is bound, store image under /uploads/<filename>
          if (env && env.JEE_QUESTIONS_KV) {
            await env.JEE_QUESTIONS_KV.put(`upload:${filename}`, dataUrl);
          }

          return jsonResponse({
            success: true,
            url: dataUrl,
            filename,
            mimeType,
            gcsUrl: null
          }, 201);
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 400);
        }
      }

      // GET /api/gcs/status
      if (pathname === '/api/gcs/status' && method === 'GET') {
        return jsonResponse({
          configured: false,
          bucket: null,
          projectId: null,
          clientEmail: null,
          connected: false,
          lastSynced: null,
          note: 'Cloudflare Edge mode utilizes Cloudflare KV/R2 or browser localStorage'
        });
      }

      // POST /api/scan (Multimodal Gemini Proxy)
      if (pathname === '/api/scan' && method === 'POST') {
        try {
          const body = await request.json();
          const apiKey = request.headers.get('x-goog-api-key') ||
                         (request.headers.get('authorization') ? request.headers.get('authorization').replace(/^Bearer\s+/i, '') : null) ||
                         body.apiKey ||
                         savedGeminiKey ||
                         (env && env.GEMINI_API_KEY);

          if (!apiKey) {
            return jsonResponse({
              success: false,
              error: 'NO_API_KEY',
              message: 'No Google Gemini API key provided. Set GEMINI_API_KEY environment variable or configure in Cloud Settings.'
            }, 400);
          }

          const model = body.model || 'gemini-1.5-flash';
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

          let geminiPayload;
          if (body.contents) {
            geminiPayload = {
              contents: body.contents,
              generationConfig: body.generationConfig || {
                temperature: 0.1,
                topP: 0.95,
                responseMimeType: 'application/json'
              }
            };
          } else {
            const parts = [];
            if (body.base64Data && body.mimeType) {
              parts.push({
                inlineData: {
                  mimeType: body.mimeType,
                  data: body.base64Data
                }
              });
            }
            if (body.prompt) {
              parts.push({ text: body.prompt });
            }
            geminiPayload = {
              contents: [{ parts }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json'
              }
            };
          }

          const geminiRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
          });

          const geminiData = await geminiRes.json();
          if (geminiRes.ok) {
            return jsonResponse({ success: true, result: geminiData });
          } else {
            return jsonResponse({ success: false, error: 'GEMINI_API_ERROR', details: geminiData }, geminiRes.status);
          }
        } catch (e) {
          return jsonResponse({ success: false, error: 'SCAN_PROXY_ERROR', message: e.message }, 500);
        }
      }

      // GET /api/questions
      if (pathname === '/api/questions' && method === 'GET') {
        const questions = await getQuestionsFromStore(env);
        const searchParams = url.searchParams;

        let filtered = [...questions];

        if (searchParams.get('subject') && searchParams.get('subject') !== 'all') {
          const sub = searchParams.get('subject').toLowerCase();
          filtered = filtered.filter(q => (q.subject || '').toLowerCase() === sub);
        }
        if (searchParams.get('chapter') && searchParams.get('chapter') !== 'all') {
          const chap = searchParams.get('chapter').toLowerCase();
          filtered = filtered.filter(q => (q.chapter || '').toLowerCase().includes(chap));
        }
        if (searchParams.get('difficulty') && searchParams.get('difficulty') !== 'all') {
          const diff = searchParams.get('difficulty').toLowerCase();
          filtered = filtered.filter(q => (q.difficulty || '').toLowerCase() === diff);
        }
        if (searchParams.get('type') && searchParams.get('type') !== 'all') {
          const typ = searchParams.get('type').toLowerCase();
          filtered = filtered.filter(q => (q.type || '').toLowerCase() === typ);
        }
        if (searchParams.get('search')) {
          const s = searchParams.get('search').toLowerCase();
          filtered = filtered.filter(q =>
            (q.question || '').toLowerCase().includes(s) ||
            (q.chapter || '').toLowerCase().includes(s) ||
            (q.subject || '').toLowerCase().includes(s) ||
            (q.explanation || '').toLowerCase().includes(s)
          );
        }

        const total = questions.length;
        const count = filtered.length;
        const offset = parseInt(searchParams.get('offset'), 10) || 0;
        const limit = parseInt(searchParams.get('limit'), 10);
        const data = (!isNaN(limit) && limit > 0) ? filtered.slice(offset, offset + limit) : filtered;

        return jsonResponse({
          success: true,
          count,
          total,
          offset,
          limit: limit || count,
          data
        });
      }

      // GET /api/questions/:id
      const idMatch = pathname.match(/^\/api\/questions\/([a-zA-Z0-9_\-]+)$/);
      if (idMatch && method === 'GET') {
        const id = idMatch[1];
        const questions = await getQuestionsFromStore(env);
        const question = questions.find(q => String(q.id) === id);
        if (question) {
          return jsonResponse({ success: true, data: question });
        }
        return jsonResponse({ success: false, error: 'Question not found', id }, 404);
      }

      // POST /api/questions
      if (pathname === '/api/questions' && method === 'POST') {
        try {
          const body = await request.json();
          const incoming = Array.isArray(body) ? body : (body.questions ? body.questions : [body]);
          const questions = await getQuestionsFromStore(env);
          const added = [];

          for (const item of incoming) {
            if (!item.question && !item.image) continue;
            const newQ = {
              id: item.id || `jee_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              subject: item.subject || 'Physics',
              chapter: item.chapter || 'General',
              difficulty: item.difficulty || 'JEE Main',
              type: item.type || 'single_choice',
              marks: item.marks || { correct: 4, incorrect: item.type === 'numerical' ? 0 : -1 },
              year: item.year || 'Practice Question',
              question: item.question || (item.image ? 'Refer to the question image.' : ''),
              image: item.image || item.imageUrl || null,
              solution_image: item.solution_image || item.solutionImageUrl || null,
              options: item.options || [],
              correct_answer: item.correct_answer,
              explanation: item.explanation || '',
              created_at: item.created_at || new Date().toISOString()
            };
            questions.push(newQ);
            added.push(newQ);
          }

          await saveQuestionsToStore(env, questions);
          return jsonResponse({
            success: true,
            added: added.length,
            total: questions.length,
            data: added
          }, 201);
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 400);
        }
      }

      // PUT /api/questions/:id
      if (idMatch && method === 'PUT') {
        try {
          const id = idMatch[1];
          const body = await request.json();
          const questions = await getQuestionsFromStore(env);
          const idx = questions.findIndex(q => String(q.id) === id);

          if (idx === -1) {
            return jsonResponse({ success: false, error: 'Question not found', id }, 404);
          }

          questions[idx] = {
            ...questions[idx],
            ...body,
            id: questions[idx].id,
            updated_at: new Date().toISOString()
          };

          await saveQuestionsToStore(env, questions);
          return jsonResponse({ success: true, data: questions[idx] });
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 400);
        }
      }

      // DELETE /api/questions/:id
      if (idMatch && method === 'DELETE') {
        const id = idMatch[1];
        const questions = await getQuestionsFromStore(env);
        const filtered = questions.filter(q => String(q.id) !== id);

        if (filtered.length === questions.length) {
          return jsonResponse({ success: false, error: 'Question not found', id }, 404);
        }

        await saveQuestionsToStore(env, filtered);
        return jsonResponse({ success: true, message: 'Question deleted', id, remaining: filtered.length });
      }

      // POST /api/questions/reset
      if (pathname === '/api/questions/reset' && method === 'POST') {
        await saveQuestionsToStore(env, [...SEED_QUESTIONS]);
        return jsonResponse({
          success: true,
          message: 'Question bank reset to default sample questions',
          count: SEED_QUESTIONS.length,
          data: SEED_QUESTIONS
        });
      }

      return jsonResponse({ success: false, error: 'Endpoint not found', endpoint: pathname }, 404);
    }

    // 3. Fallback to Cloudflare Pages static assets
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('QuestionForge Cloudflare Edge Worker active.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

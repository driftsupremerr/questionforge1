/**
 * QuestionForge Server - Standalone Native Node.js Server
 * Zero dependencies - runs out of the box with `agy-node server.js`
 * Features:
 *  - Static file server (public/ and sample-docs/)
 *  - Full REST API for JEE Questions Bank (/api/questions)
 *  - Multimodal Gemini AI Proxy (/api/scan)
 *  - Direct Image Upload (/api/upload-image)
 *  - Google Cloud Storage (GCS) Integration & Sync (/api/gcs/*)
 *  - Persistent Gemini API Key Configuration (/api/config/gemini-key)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SAMPLE_DOCS_DIR = path.join(ROOT_DIR, 'sample-docs');

const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const SAMPLE_QUESTIONS_FILE = path.join(DATA_DIR, 'sample-questions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Cached Google OAuth2 access token for GCS
let gcsTokenCache = {
  token: null,
  expiresAt: 0
};

// Ensure directories exist
function initDirectories() {
  [DATA_DIR, PUBLIC_DIR, UPLOADS_DIR, SAMPLE_DOCS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Config Store Management
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading config.json:', e);
  }
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    gcs: {
      configured: false,
      bucket: '',
      projectId: '',
      clientEmail: '',
      privateKey: '',
      lastSynced: null
    }
  };
}

function writeConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error writing config.json:', e);
    return false;
  }
}

// Initialize Question Store
function initQuestionStore() {
  initDirectories();

  if (!fs.existsSync(QUESTIONS_FILE)) {
    if (fs.existsSync(SAMPLE_QUESTIONS_FILE)) {
      console.log('Initializing questions.json from sample-questions.json...');
      fs.copyFileSync(SAMPLE_QUESTIONS_FILE, QUESTIONS_FILE);
    } else {
      console.log('Initializing empty questions.json...');
      fs.writeFileSync(QUESTIONS_FILE, '[]', 'utf8');
    }
  } else {
    try {
      const content = fs.readFileSync(QUESTIONS_FILE, 'utf8').trim();
      if (!content || content === '[]') {
        if (fs.existsSync(SAMPLE_QUESTIONS_FILE)) {
          fs.copyFileSync(SAMPLE_QUESTIONS_FILE, QUESTIONS_FILE);
        }
      }
    } catch (e) {
      console.error('Error validating questions.json:', e);
    }
  }
}

// Read questions from disk
function readQuestions() {
  try {
    if (!fs.existsSync(QUESTIONS_FILE)) {
      initQuestionStore();
    }
    const raw = fs.readFileSync(QUESTIONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading questions:', err);
    return [];
  }
}

// Write questions to disk atomically
function writeQuestions(questions) {
  try {
    const tempFile = `${QUESTIONS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(questions, null, 2), 'utf8');
    fs.renameSync(tempFile, QUESTIONS_FILE);

    // If GCS is configured, trigger background sync
    const config = readConfig();
    if (config.gcs && config.gcs.configured && config.gcs.bucket) {
      syncLocalQuestionsToGcs().catch(err => {
        console.warn('Background GCS sync warning:', err.message);
      });
    }
    return true;
  } catch (err) {
    console.error('Error saving questions:', err);
    return false;
  }
}

// Helper: base64url encoding for JWT
function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Google Cloud Storage Auth: Generate OAuth2 token from Service Account credentials
async function getGcsAccessToken(gcsConfig) {
  // If manual token provided and still fresh
  if (gcsConfig.token) {
    return gcsConfig.token;
  }

  // Check cached token
  const now = Math.floor(Date.now() / 1000);
  if (gcsTokenCache.token && gcsTokenCache.expiresAt > now + 300) {
    return gcsTokenCache.token;
  }

  if (!gcsConfig.clientEmail || !gcsConfig.privateKey) {
    throw new Error('GCS authentication requires clientEmail and privateKey (Service Account credentials)');
  }

  // Format private key (handle raw newlines or escaped \n)
  let privateKey = gcsConfig.privateKey;
  if (!privateKey.includes('\n') && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: gcsConfig.clientEmail,
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaims = base64url(JSON.stringify(claims));
  const signInput = `${encodedHeader}.${encodedClaims}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signInput}.${signature}`;

  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
    const tokenReq = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            gcsTokenCache = {
              token: parsed.access_token,
              expiresAt: now + (parsed.expires_in || 3600)
            };
            resolve(parsed.access_token);
          } else {
            reject(new Error(parsed.error_description || parsed.error || 'Failed to obtain GCS access token'));
          }
        } catch (e) {
          reject(new Error('Invalid token response from Google OAuth2: ' + data));
        }
      });
    });

    tokenReq.on('error', err => reject(err));
    tokenReq.write(postData);
    tokenReq.end();
  });
}

// Upload buffer/string to Google Cloud Storage
async function uploadToGcs(bucket, objectName, content, contentType, token) {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const parsed = new URL(apiUrl);
    const bodyBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');

    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': bodyBuf.length
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              success: true,
              object: json.name,
              bucket: json.bucket,
              mediaLink: json.mediaLink,
              selfLink: json.selfLink,
              publicUrl: `https://storage.googleapis.com/${bucket}/${encodeURIComponent(objectName)}`
            });
          } else {
            reject(new Error(json.error ? json.error.message : `GCS upload failed: HTTP ${res.statusCode}`));
          }
        } catch (e) {
          resolve({ success: res.statusCode < 300, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

// Check GCS bucket access
async function testGcsConnection(gcsConfig) {
  const token = await getGcsAccessToken(gcsConfig);
  return new Promise((resolve, reject) => {
    const apiUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(gcsConfig.bucket)}`;
    const parsed = new URL(apiUrl);

    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              connected: true,
              bucketName: json.name,
              location: json.location,
              storageClass: json.storageClass
            });
          } else {
            reject(new Error(json.error ? json.error.message : `GCS returned status ${res.statusCode}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Sync local questions.json to GCS
async function syncLocalQuestionsToGcs() {
  const config = readConfig();
  if (!config.gcs || !config.gcs.configured || !config.gcs.bucket) {
    return { success: false, message: 'GCS is not configured' };
  }

  const token = await getGcsAccessToken(config.gcs);
  const questions = readQuestions();
  const payload = JSON.stringify(questions, null, 2);

  const result = await uploadToGcs(config.gcs.bucket, 'questions.json', payload, 'application/json', token);

  config.gcs.lastSynced = new Date().toISOString();
  writeConfig(config);

  return {
    success: true,
    bucket: config.gcs.bucket,
    object: 'questions.json',
    syncedAt: config.gcs.lastSynced,
    questionCount: questions.length,
    publicUrl: result.publicUrl
  };
}

// Helper: send JSON response with CORS headers
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(payload);
}

// Helper: parse JSON body (supports up to 50MB for scanned base64 PDF/images)
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    const maxLimit = 50 * 1024 * 1024; // 50 MB
    let receivedBytes = 0;

    req.on('data', chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxLimit) {
        reject(new Error('Payload too large (exceeds 50MB)'));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const json = JSON.parse(body);
        resolve(json);
      } catch (err) {
        reject(new Error('Invalid JSON format: ' + err.message));
      }
    });

    req.on('error', err => reject(err));
  });
}

// Serve static files
function serveStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  
  // Decide base directory
  let filePath;
  if (relativePath.startsWith('/sample-docs/')) {
    const sub = relativePath.replace('/sample-docs/', '');
    filePath = path.join(SAMPLE_DOCS_DIR, sub);
  } else {
    filePath = path.join(PUBLIC_DIR, relativePath);
  }

  // Security check: ensure path is within allowed directory
  const resolved = path.resolve(filePath);
  const isInsidePublic = resolved.startsWith(path.resolve(PUBLIC_DIR));
  const isInsideSampleDocs = resolved.startsWith(path.resolve(SAMPLE_DOCS_DIR));

  if (!isInsidePublic && !isInsideSampleDocs) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Access denied');
    return;
  }

  fs.stat(resolved, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(`<!DOCTYPE html>
<html>
<head><title>404 Not Found</title><style>body{font-family:sans-serif;padding:40px;text-align:center;}</style></head>
<body>
  <h1>404 - Not Found</h1>
  <p>The requested file <code>${pathname}</code> was not found on this server.</p>
  <p><a href="/">Return to QuestionForge</a></p>
</body>
</html>`);
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, must-revalidate'
    });

    const stream = fs.createReadStream(resolved);
    stream.pipe(res);
  });
}

// Handle Gemini Proxy Multimodal Scan
async function handleScanProxy(req, res, body) {
  const config = readConfig();
  const apiKey = req.headers['x-goog-api-key'] ||
                 (req.headers['authorization'] ? req.headers['authorization'].replace(/^Bearer\s+/i, '') : null) ||
                 body.apiKey ||
                 config.geminiApiKey ||
                 process.env.GEMINI_API_KEY;

  if (!apiKey) {
    sendJson(res, 400, {
      success: false,
      error: 'NO_API_KEY',
      message: 'No Google Gemini API key provided. Supply via x-goog-api-key header, body.apiKey, or configure in Cloud Settings.'
    });
    return;
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
      parts.push({
        text: body.prompt
      });
    }
    geminiPayload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    };
  }

  const postData = JSON.stringify(geminiPayload);

  try {
    const parsedUrl = new URL(apiUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const proxyReq = https.request(options, proxyRes => {
      let rawData = '';
      proxyRes.on('data', chunk => { rawData += chunk; });
      proxyRes.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
            sendJson(res, 200, {
              success: true,
              result: parsed
            });
          } else {
            sendJson(res, proxyRes.statusCode, {
              success: false,
              error: 'GEMINI_API_ERROR',
              details: parsed
            });
          }
        } catch (e) {
          sendJson(res, 500, {
            success: false,
            error: 'INVALID_UPSTREAM_RESPONSE',
            raw: rawData
          });
        }
      });
    });

    proxyReq.on('error', err => {
      console.error('Gemini proxy error:', err);
      sendJson(res, 502, {
        success: false,
        error: 'UPSTREAM_CONNECTION_FAILED',
        message: err.message
      });
    });

    proxyReq.write(postData);
    proxyReq.end();
  } catch (err) {
    sendJson(res, 500, {
      success: false,
      error: 'PROXY_HANDLER_ERROR',
      message: err.message
    });
  }
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // API Router
  if (pathname.startsWith('/api/')) {
    // GET /api/health
    if (pathname === '/api/health' && method === 'GET') {
      const questions = readQuestions();
      const config = readConfig();
      sendJson(res, 200, {
        status: 'ok',
        service: 'QuestionForge Server',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        questionCount: questions.length,
        features: {
          gcsConfigured: Boolean(config.gcs && config.gcs.configured),
          geminiConfigured: Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY)
        }
      });
      return;
    }

    // ==========================================
    // Gemini API Key Configuration Endpoints
    // ==========================================

    // GET /api/config/gemini-key
    if (pathname === '/api/config/gemini-key' && method === 'GET') {
      const config = readConfig();
      const key = config.geminiApiKey || process.env.GEMINI_API_KEY || '';
      sendJson(res, 200, {
        configured: Boolean(key),
        maskedKey: key ? `${key.substring(0, 6)}...${key.substring(key.length - 4)}` : null
      });
      return;
    }

    // POST /api/config/gemini-key
    if (pathname === '/api/config/gemini-key' && method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        const apiKey = (body.apiKey || '').trim();
        const config = readConfig();
        config.geminiApiKey = apiKey;
        writeConfig(config);

        sendJson(res, 200, {
          success: true,
          message: 'Gemini API key saved successfully',
          configured: Boolean(apiKey),
          maskedKey: apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : null
        });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // ==========================================
    // Direct Image Upload Endpoint
    // ==========================================

    // POST /api/upload-image
    if (pathname === '/api/upload-image' && method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        let base64Data = body.image || body.base64 || body.data;
        let mimeType = body.mimeType || 'image/png';
        let originalName = body.name || 'image.png';

        if (!base64Data) {
          sendJson(res, 400, { success: false, error: 'No image data provided in body (expected image, base64, or data)' });
          return;
        }

        // Handle data URL header: data:image/png;base64,...
        const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64Data = match[2];
        }

        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length === 0) {
          sendJson(res, 400, { success: false, error: 'Decoded image data is empty' });
          return;
        }

        // Determine extension
        let ext = '.png';
        if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
        else if (mimeType.includes('webp')) ext = '.webp';
        else if (mimeType.includes('gif')) ext = '.gif';
        else if (mimeType.includes('svg')) ext = '.svg';

        const filename = `qimg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
        const filePath = path.join(UPLOADS_DIR, filename);

        // Write locally to public/uploads/
        fs.writeFileSync(filePath, buffer);

        const localUrl = `/uploads/${filename}`;
        let gcsUrl = null;

        // If GCS configured, also upload to Google Cloud Storage bucket
        const config = readConfig();
        if (config.gcs && config.gcs.configured && config.gcs.bucket) {
          try {
            const token = await getGcsAccessToken(config.gcs);
            const gcsRes = await uploadToGcs(config.gcs.bucket, `uploads/${filename}`, buffer, mimeType, token);
            gcsUrl = gcsRes.publicUrl;
          } catch (gcsErr) {
            console.warn('GCS upload warning for image:', gcsErr.message);
          }
        }

        sendJson(res, 201, {
          success: true,
          url: localUrl,
          filename,
          mimeType,
          size: buffer.length,
          gcsUrl
        });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // ==========================================
    // Google Cloud Storage (GCS) Endpoints
    // ==========================================

    // GET /api/gcs/status
    if (pathname === '/api/gcs/status' && method === 'GET') {
      const config = readConfig();
      const gcs = config.gcs || {};
      
      let connectionStatus = false;
      let connectionError = null;

      if (gcs.configured && gcs.bucket) {
        try {
          const testRes = await testGcsConnection(gcs);
          connectionStatus = testRes.connected;
        } catch (e) {
          connectionStatus = false;
          connectionError = e.message;
        }
      }

      sendJson(res, 200, {
        configured: Boolean(gcs.configured),
        bucket: gcs.bucket || null,
        projectId: gcs.projectId || null,
        clientEmail: gcs.clientEmail ? `${gcs.clientEmail.substring(0, 5)}...${gcs.clientEmail.substring(gcs.clientEmail.indexOf('@'))}` : null,
        connected: connectionStatus,
        lastSynced: gcs.lastSynced || null,
        error: connectionError
      });
      return;
    }

    // POST /api/gcs/config
    if (pathname === '/api/gcs/config' && method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        const config = readConfig();

        // Support service account JSON credentials
        let credentials = body.credentials;
        if (typeof credentials === 'string') {
          try { credentials = JSON.parse(credentials); } catch (e) {}
        }

        const bucket = (body.bucket || '').trim();
        const projectId = (body.projectId || (credentials && credentials.project_id) || '').trim();
        const clientEmail = (credentials && credentials.client_email) || body.clientEmail || '';
        const privateKey = (credentials && credentials.private_key) || body.privateKey || '';
        const token = body.token || '';

        if (!bucket) {
          sendJson(res, 400, { success: false, error: 'Bucket name is required' });
          return;
        }

        config.gcs = {
          configured: true,
          bucket,
          projectId,
          clientEmail,
          privateKey,
          token,
          lastSynced: config.gcs ? config.gcs.lastSynced : null
        };

        // Invalidate token cache on credential change
        gcsTokenCache = { token: null, expiresAt: 0 };

        // Test connection
        let testResult = { connected: false };
        try {
          testResult = await testGcsConnection(config.gcs);
        } catch (testErr) {
          console.warn('GCS connection test note:', testErr.message);
        }

        writeConfig(config);

        sendJson(res, 200, {
          success: true,
          message: 'Google Cloud Storage configuration saved',
          bucket,
          connected: testResult.connected,
          details: testResult
        });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // POST /api/gcs/sync
    if (pathname === '/api/gcs/sync' && method === 'POST') {
      try {
        const syncRes = await syncLocalQuestionsToGcs();
        if (syncRes.success) {
          sendJson(res, 200, syncRes);
        } else {
          sendJson(res, 400, syncRes);
        }
      } catch (err) {
        sendJson(res, 500, { success: false, error: err.message });
      }
      return;
    }

    // ==========================================
    // Question Bank Endpoints
    // ==========================================

    // GET /api/questions
    if (pathname === '/api/questions' && method === 'GET') {
      const questions = readQuestions();
      const query = parsedUrl.query;

      let filtered = [...questions];

      // Filter by subject
      if (query.subject && query.subject !== 'all') {
        const sub = query.subject.toLowerCase();
        filtered = filtered.filter(q => (q.subject || '').toLowerCase() === sub);
      }

      // Filter by chapter
      if (query.chapter && query.chapter !== 'all') {
        const chap = query.chapter.toLowerCase();
        filtered = filtered.filter(q => (q.chapter || '').toLowerCase().includes(chap));
      }

      // Filter by difficulty
      if (query.difficulty && query.difficulty !== 'all') {
        const diff = query.difficulty.toLowerCase();
        filtered = filtered.filter(q => (q.difficulty || '').toLowerCase() === diff);
      }

      // Filter by type
      if (query.type && query.type !== 'all') {
        const typ = query.type.toLowerCase();
        filtered = filtered.filter(q => (q.type || '').toLowerCase() === typ);
      }

      // Text search in question, chapter, subject, explanation
      if (query.search) {
        const search = query.search.toLowerCase();
        filtered = filtered.filter(q => 
          (q.question || '').toLowerCase().includes(search) ||
          (q.chapter || '').toLowerCase().includes(search) ||
          (q.subject || '').toLowerCase().includes(search) ||
          (q.explanation || '').toLowerCase().includes(search)
        );
      }

      const total = questions.length;
      const count = filtered.length;

      // Pagination
      const offset = parseInt(query.offset, 10) || 0;
      const limit = parseInt(query.limit, 10);
      const data = (!isNaN(limit) && limit > 0) ? filtered.slice(offset, offset + limit) : filtered;

      sendJson(res, 200, {
        success: true,
        count,
        total,
        offset,
        limit: limit || count,
        data
      });
      return;
    }

    // GET /api/questions/:id
    const singleMatch = pathname.match(/^\/api\/questions\/([a-zA-Z0-9_\-]+)$/);
    if (singleMatch && method === 'GET') {
      const id = singleMatch[1];
      const questions = readQuestions();
      const question = questions.find(q => String(q.id) === id);

      if (question) {
        sendJson(res, 200, { success: true, data: question });
      } else {
        sendJson(res, 404, { success: false, error: 'Question not found', id });
      }
      return;
    }

    // POST /api/questions (Create one or batch questions)
    if (pathname === '/api/questions' && method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        const incoming = Array.isArray(body) ? body : (body.questions ? body.questions : [body]);

        if (incoming.length === 0) {
          sendJson(res, 400, { success: false, error: 'No question data provided' });
          return;
        }

        const questions = readQuestions();
        const added = [];

        for (const item of incoming) {
          // Allow question item if it has an image or question text
          if (!item.question && !item.image) {
            continue; // Skip completely empty entries
          }
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

        writeQuestions(questions);
        sendJson(res, 201, {
          success: true,
          added: added.length,
          total: questions.length,
          data: added
        });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // PUT /api/questions/:id (Update question)
    if (singleMatch && method === 'PUT') {
      try {
        const id = singleMatch[1];
        const body = await parseRequestBody(req);
        const questions = readQuestions();
        const index = questions.findIndex(q => String(q.id) === id);

        if (index === -1) {
          sendJson(res, 404, { success: false, error: 'Question not found to update', id });
          return;
        }

        // Merge fields
        questions[index] = {
          ...questions[index],
          ...body,
          id: questions[index].id, // preserve ID
          updated_at: new Date().toISOString()
        };

        writeQuestions(questions);
        sendJson(res, 200, {
          success: true,
          data: questions[index]
        });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // DELETE /api/questions/:id (Delete question)
    if (singleMatch && method === 'DELETE') {
      const id = singleMatch[1];
      const questions = readQuestions();
      const initialLen = questions.length;
      const filtered = questions.filter(q => String(q.id) !== id);

      if (filtered.length === initialLen) {
        sendJson(res, 404, { success: false, error: 'Question not found', id });
        return;
      }

      writeQuestions(filtered);
      sendJson(res, 200, {
        success: true,
        message: 'Question deleted successfully',
        id,
        remaining: filtered.length
      });
      return;
    }

    // POST /api/questions/reset (Reset to sample questions)
    if (pathname === '/api/questions/reset' && method === 'POST') {
      try {
        if (fs.existsSync(SAMPLE_QUESTIONS_FILE)) {
          fs.copyFileSync(SAMPLE_QUESTIONS_FILE, QUESTIONS_FILE);
          const fresh = readQuestions();
          writeQuestions(fresh); // Also syncs to GCS if configured
          sendJson(res, 200, {
            success: true,
            message: 'Question bank reset to default sample questions',
            count: fresh.length,
            data: fresh
          });
        } else {
          sendJson(res, 500, { success: false, error: 'sample-questions.json not found' });
        }
      } catch (err) {
        sendJson(res, 500, { success: false, error: err.message });
      }
      return;
    }

    // POST /api/scan (Multimodal Gemini proxy)
    if (pathname === '/api/scan' && method === 'POST') {
      try {
        const body = await parseRequestBody(req);
        await handleScanProxy(req, res, body);
      } catch (err) {
        sendJson(res, 400, { success: false, error: err.message });
      }
      return;
    }

    // Unknown API endpoint
    sendJson(res, 404, { success: false, error: 'API endpoint not found', endpoint: pathname });
    return;
  }

  // Static File Serving
  serveStaticFile(req, res, pathname);
});

// Initialize directories and question store on start
initDirectories();
initQuestionStore();

// Start Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 QuestionForge Server running at http://localhost:${PORT}`);
  console.log(`📁 Serving static files from: ${PUBLIC_DIR}`);
  console.log(`🖼️  Direct Image Uploads: ${UPLOADS_DIR}`);
  console.log(`☁️  Google Cloud Storage API: http://localhost:${PORT}/api/gcs/status`);
  console.log(`📊 Questions API: http://localhost:${PORT}/api/questions`);
  console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  server.close(() => process.exit(0));
});

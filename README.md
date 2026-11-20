# ⚡ QuestionForge

> **Forge Your JEE Success with AI Precision & Real CBT Power.**  
> A production-grade, zero-dependency JEE Main & Advanced examination and practice platform featuring an authentic NTA Computer Based Test (CBT) simulator, Multimodal Document OCR, live KaTeX mathematical typesetting, and 1-click Cloudflare Edge deployment.

---

## 🌟 Key Features

### 1. 🎯 Authentic NTA CBT Exam Simulator
- **Real Exam Environment**: Identical layout and behavior to the official JEE Main & Advanced testing interfaces.
- **5-State Question Palette**:
  - 🟢 **Answered**: Question answered and saved.
  - 🔴 **Not Answered**: Visited but left unanswered.
  - 🟣 **Marked for Review**: Marked for later inspection without answering.
  - 🟣🟢 **Answered & Marked for Review**: Marked for review with an answered response (evaluated under official NTA rules).
  - ⚪ **Not Visited**: Unseen questions.
- **Exam Timers & Section Tabs**: Switch between Physics, Chemistry, and Mathematics seamlessly with live countdown alerts and auto-save.
- **Official Scoring Rules**: Full evaluation for Single Choice (+4, -1), Multi-Correct (+4, -2 with partial marking), and Numerical Value types (with decimal tolerance).
- **Comprehensive Scorecards**: Detailed question-wise breakdown, time spent analytics, and step-by-step KaTeX solutions.

### 2. 🤖 Multimodal AI Document Scanner (PDF & Images)
- **Gemini AI Multimodal OCR**: Direct extraction from question paper PDFs, photos, and screenshots preserving rich LaTeX equations (e.g. `$\int$`, `$\frac{d}{dx}$`, `$\vec{E}$`).
- **Client-Side PDF.js Integration**: Extract multi-page tests with automated two-column de-interleaving.
- **Local Regex Fallback**: Offline extraction for structured text and question patterns without requiring an API key.
- **Interactive Review Workbench**: Side-by-side split screen to inspect scanned document previews against parsed questions, edit text, verify options, and batch-commit to the Question Bank with 1-click.

### 3. 🖼️ Direct Visual Question Uploader (No Scanning Required)
- **Zero-Friction Question Creation**: Paste screenshots directly from your clipboard (`Ctrl+V`) or drag and drop diagrams.
- **1-Click Option Picker**: Select the correct answer (A, B, C, D) directly without re-typing choices when they are already part of the diagram.
- **Interactive Lightbox Modal**: High-resolution zoom inspection for complex circuit diagrams, coordinate geometry graphs, and chemical reaction mechanisms.

### 4. 📚 Topic-Wise Practice & Derivations
- **Instant Solution Toggles**: Practice question-by-question with immediate answer validation and detailed step-by-step KaTeX mathematical derivations.
- **Topic & Difficulty Filters**: Filter by Subject (Physics, Chemistry, Mathematics), Chapter, Difficulty (JEE Main vs. JEE Advanced), and Question Type.

### 5. 🗄️ Question Bank & Cloud Storage Sync
- **Local Native Database**: Zero-dependency JSON storage (`data/questions.json`) pre-seeded with authentic JEE Main & Advanced questions.
- **Google Cloud Storage (GCS)**: Built-in native Service Account JWT authentication and synchronization to `gs://<bucket>/questions.json`.
- **Cloudflare Edge KV / R2**: Cloudflare Worker integration for low-latency worldwide distribution.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technologies | Highlights |
| :--- | :--- | :--- |
| **Frontend** | Vanilla JS, Tailwind CSS (CDN), Lucide Icons | Responsive, glassmorphism UI, light/dark mode, mobile palette drawer |
| **Math Engine** | KaTeX (CDN) | Real-time mathematical and chemical equation rendering ($...$ and $$...$$) |
| **PDF Processing**| PDF.js (CDN) | Client-side page rendering and multi-column text extraction |
| **Backend** | Native Node.js (`http`, `https`, `crypto`, `fs`) | **Zero external dependencies** — runs out of the box with `node` or `agy-node` |
| **Edge Runtime** | Cloudflare Pages / Workers (`_worker.js`) | Web Fetch API edge router, 300+ global CDN nodes |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js (v18.0.0 or higher) or Antigravity `agy-node`.

### 1. Clone & Enter Project Directory
```bash
git clone https://github.com/<your-username>/questionforge.git
cd questionforge
```

### 2. Start the Server
No `npm install` needed! Run directly using native Node.js:
```bash
npm start
# or: node server.js
```

### 3. Open in Browser
Visit **[http://localhost:3000](http://localhost:3000)** in your web browser.

---

## ☁️ Deploy to Cloudflare Pages (1-Click)

QuestionForge is engineered for native deployment on Cloudflare Pages and the Cloudflare Workers Edge Network.

### Method A: Wrangler CLI (Fastest)
```bash
# 1. Login to Cloudflare
npx wrangler login

# 2. Deploy the public directory
npm run deploy

# 3. (Optional) Set your Gemini AI API Key as a secret
npx wrangler pages secret put GEMINI_API_KEY --project-name=questionforge
```

### Method B: Drag & Drop via Cloudflare Dashboard
1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Pages** → **Upload assets**.
2. Set project name to `questionforge`.
3. Drag and drop the `public/` directory into the upload zone.
4. Click **Deploy site** — live immediately at `https://questionforge.pages.dev`!

### Method C: GitHub Continuous Deployment (CI/CD)
1. Push your repository to GitHub.
2. In Cloudflare Dashboard, select **Connect to Git** and choose your repository.
3. Build Settings:
   - **Framework preset**: `None`
   - **Build command**: *(leave empty)*
   - **Build output directory**: `public`
4. Click **Save and Deploy**. Cloudflare will automatically build and deploy every commit!

*For detailed instructions on Cloudflare KV bindings and custom domains, see [deploy-cloudflare.md](file:///deploy-cloudflare.md).*

---

## 📡 REST API Reference

The server exposes clean REST endpoints accessible via both the local Node.js server and Cloudflare Edge Workers:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check, service status, and active question count |
| `GET` | `/api/questions` | Query questions (`?subject=`, `?chapter=`, `?difficulty=`, `?type=`, `?search=`, `?limit=`) |
| `GET` | `/api/questions/:id` | Fetch a single question by ID |
| `POST` | `/api/questions` | Add a single question or array of scanned questions |
| `PUT` | `/api/questions/:id` | Update an existing question |
| `DELETE` | `/api/questions/:id` | Delete a question |
| `POST` | `/api/questions/reset` | Reset question store to original sample questions |
| `POST` | `/api/upload-image` | Upload question/solution diagram (`/uploads/qimg_...png`) |
| `POST` | `/api/scan` | Multimodal Gemini OCR proxy for PDFs and images |
| `GET` | `/api/config/gemini-key` | Retrieve masked Gemini API key status |
| `POST` | `/api/config/gemini-key` | Persist Gemini API key |
| `GET` | `/api/gcs/status` | Google Cloud Storage connection and sync status |
| `POST` | `/api/gcs/config` | Configure GCS bucket & service account credentials |
| `POST` | `/api/gcs/sync` | Synchronize questions between local store and GCS |

---

## 📂 Project Structure

```text
questionforge/
├── server.js               # Standalone native Node.js HTTP server (zero dependencies)
├── _worker.js              # Cloudflare Pages / Workers Edge API router
├── wrangler.toml           # Cloudflare Pages configuration
├── package.json            # Project manifest & deployment scripts
├── deploy-cloudflare.md    # Step-by-step Cloudflare deployment documentation
├── .gitignore              # Production git exclusions
├── data/
│   ├── sample-questions.json # Authentic JEE Main & Advanced seed questions
│   ├── questions.json        # Active question database
│   └── config.json           # Local config (API keys & cloud settings)
├── functions/api/
│   └── [[path]].js         # Cloudflare Pages Functions adapter
└── public/
    ├── index.html          # Single-page application shell & Landing Page
    ├── _worker.js          # Cloudflare Pages build bundle edge worker
    ├── css/
    │   └── style.css       # Custom styles, NTA CBT palette, glassmorphism
    ├── js/
    │   ├── app.js          # Master controller & UI coordinator
    │   ├── quiz-engine.js  # Stateful CBT exam simulation & scoring engine
    │   ├── scanner.js      # Multimodal Gemini OCR & Regex document parser
    │   ├── pdf-extractor.js# PDF.js visual canvas & reading-order text extraction
    │   └── storage.js      # Unified storage client (REST API + localStorage fallback)
    └── uploads/            # Direct uploaded question and diagram images
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

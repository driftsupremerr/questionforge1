# Cloudflare Deployment Guide — QuestionForge

Deploy the **QuestionForge** application to **Cloudflare Pages** and **Cloudflare Workers Edge Network** with global low latency, free automatic SSL/TLS, and zero server maintenance.

---

## 🚀 Deployment Options Overview

| Method | Best For | Complexity | Setup Time |
| :--- | :--- | :--- | :--- |
| **Option 1: Wrangler CLI** | Developers with terminal access | Quick & scriptable | ~1 minute |
| **Option 2: Cloudflare Dashboard** | Drag & drop folder upload | No CLI needed | ~2 minutes |
| **Option 3: GitHub / GitLab CI/CD** | Automatic deploys on `git push` | Production teams | ~3 minutes |

---

## 🛠️ Option 1: Deploy with Wrangler CLI (Recommended)

Wrangler is Cloudflare's official command-line interface.

### Step 1: Open Terminal in Project Directory
```bash
cd C:/Users/drift/.gemini/antigravity/scratch/jee-prep-app
```

### Step 2: Authenticate with Cloudflare
If you haven't logged in to Cloudflare on this machine:
```bash
npx wrangler login
```
*(This opens a browser tab to authorize Wrangler with your Cloudflare account).*

### Step 3: Deploy to Cloudflare Pages
Deploy the `public/` directory with edge function routing:
```bash
npx wrangler pages deploy public --project-name=questionforge
```

### Step 4: Add Gemini AI API Key (Secret)
To securely provide your Google Gemini API key to the Edge Worker scan proxy:
```bash
npx wrangler pages secret put GEMINI_API_KEY --project-name=questionforge
```
*(Paste your API key when prompted).*

You will receive an instant live URL:
```text
✨ Success! Uploaded files to Cloudflare Pages
🌎 Deployment complete! Take a peek over at https://questionforge.pages.dev
```

---

## 🖱️ Option 2: Drag & Drop via Cloudflare Dashboard (No CLI Needed)

If you prefer using the web interface without installing npm packages:

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left navigation, click **Workers & Pages** → **Create application** → Select **Pages** tab.
3. Click **Upload assets**.
4. Set **Project name** to `questionforge`.
5. Drag and drop the `public` directory from `C:/Users/drift/.gemini/antigravity/scratch/jee-prep-app/public` into the dropzone.
6. Click **Deploy site**.
7. Once deployed, navigate to **Settings** → **Environment variables** → Click **Add variable**:
   - Variable name: `GEMINI_API_KEY`
   - Value: *(your Google Gemini API key)*
   - Encrypt / Secret: Enabled.
8. Click **Save**.

Your platform is live at `https://questionforge.pages.dev`!

---

## 🔄 Option 3: Connect to GitHub / GitLab (Continuous Deployment)

For continuous deployment whenever you commit changes:

1. Push your project to a GitHub or GitLab repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of QuestionForge platform"
   git branch -M main
   git remote add origin https://github.com/<your-username>/questionforge.git
   git push -u origin main
   ```
2. In the Cloudflare Dashboard, go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Select your repository `questionforge`.
4. Configure Build settings:
   - **Framework preset**: `None`
   - **Build command**: *(Leave empty — zero build required)*
   - **Build output directory**: `public`
   - **Root directory**: `/`
5. Under **Environment variables (advanced)**, add:
   - `GEMINI_API_KEY`: *(your Gemini API key)*
6. Click **Save and Deploy**.

Cloudflare will build and deploy on every push, and create instant preview links for Pull Requests.

---

## ⚡ (Optional) Enable Cloudflare KV for Distributed Question Persistence

By default, the application runs with seed questions and browser `localStorage` caching. To synchronize question edits across all edge instances globally:

### Step 1: Create a KV Namespace
```bash
npx wrangler kv namespace create JEE_QUESTIONS_KV
```

Output:
```toml
[[kv_namespaces]]
binding = "JEE_QUESTIONS_KV"
id = "a1b2c3d4e5f67890abcdef1234567890"
```

### Step 2: Bind KV in Cloudflare Dashboard
1. Go to your Pages project in Cloudflare Dashboard.
2. Select **Settings** → **Functions** → **KV namespace bindings**.
3. Click **Add binding**:
   - Variable name: `JEE_QUESTIONS_KV`
   - KV namespace: select the namespace created above.
4. Redeploy or trigger a new build.

---

## 🌐 Custom Domain & HTTPS Setup

1. In Cloudflare Pages project, click **Custom domains**.
2. Click **Set up a custom domain**.
3. Enter your domain name (e.g., `jee.yourdomain.com` or `exam.study.in`).
4. Cloudflare automatically generates and provisions an SSL/TLS certificate with zero configuration.

---

## 🧪 Post-Deployment Verification Checklist

Once deployed, verify your edge endpoints:

1. **Health Check**:
   ```bash
   curl https://<your-project>.pages.dev/api/health
   ```
   *Expected response:* `{"status":"ok","service":"JEE Prep App (Cloudflare Edge)","edge":true,...}`

2. **Questions API**:
   ```bash
   curl https://<your-project>.pages.dev/api/questions?subject=Physics
   ```
   *Expected response:* Seed JEE questions returned with KaTeX math.

3. **CBT Exam Simulator**:
   Open `https://<your-project>.pages.dev` in your browser. Verify:
   - Exam Simulator timer starts and palette updates.
   - Practice Mode displays KaTeX step-by-step derivations.
   - Direct Image Question upload works.
   - Document Scanner processes PDFs and screenshots.

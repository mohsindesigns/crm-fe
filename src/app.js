const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const uploadRoutes = require('./routes/upload');

const app = express();

app.use(helmet({
  // Files are fetched by browsers from different origins
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
}));

const maxSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10);
app.use(fileUpload({
  limits: { fileSize: maxSizeMB * 1024 * 1024 },
  abortOnLimit: true,
  limitHandler: (req, res) =>
    res.status(413).json({ error: `File exceeds ${maxSizeMB} MB limit` }),
  createParentPath: true,
  useTempFiles: false,
  // Do NOT use safeFileNames/preserveExtension — the route generates a UUID filename anyway,
  // and preserveExtension:true only keeps 3 chars which corrupts 4-char extensions like .jpeg → j.peg
}));

// Serve uploaded files publicly
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/files', express.static(UPLOAD_DIR, {
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    /**
     * HTML is served as a download, never rendered.
     *
     * express.static would otherwise return it as text/html inline, and any
     * script inside an uploaded page would then execute on THIS origin — a
     * stored-XSS / phishing vector where anyone who can upload a file can host
     * an executable page on your domain. Forcing the download keeps the file
     * useful (that's what you do with an HTML deliverable anyway) while making
     * it inert in the browser.
     */
    if (/\.(html?|xhtml)$/i.test(filePath)) {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  },
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/upload', uploadRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[media error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;

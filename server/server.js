const express = require('express');
// Load environment variables from .env when present
require('dotenv').config();
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
// Optional sharp for image resizing (thumbnails)
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('sharp not available; thumbnail generation disabled');
}
// Optional Redis session store
const REDIS_URL = process.env.REDIS_URL || '';
let redisClient = null;
let useRedis = false;
if (REDIS_URL) {
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: REDIS_URL });
    // kick off connect but don't block startup; handle errors gracefully
    redisClient.connect().then(() => { useRedis = true; console.log('Connected to Redis for session store'); }).catch((e) => {
      console.error('Redis connection failed, falling back to in-memory sessions', e);
      useRedis = false;
      redisClient = null;
    });
  } catch (e) {
    console.error('Failed to initialize redis client, falling back to in-memory sessions', e);
    redisClient = null;
  }
}

const app = express();

// Request logging
if (process.env.NODE_ENV !== 'test') app.use(morgan(process.env.LOG_FORMAT || 'combined'));

// Validate critical env vars early
function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}
// Require admin credentials in production
if (process.env.NODE_ENV === 'production') {
  requireEnv('ADMIN_USER');
  requireEnv('ADMIN_PASS');
}
const PORT = process.env.PORT || 5000;
// Server-side passcode (protects admin landing page)
const PASSCODE = process.env.PASSCODE || 'Gksbh0310<3';

const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(publicDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Storage backend selection: local (default) or s3
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND || 'local').toLowerCase();
const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL || '';
let s3Client = null;
let usingS3 = false;
if (STORAGE_BACKEND === 's3') {
  if (!S3_BUCKET) console.warn('STORAGE_BACKEND=s3 but S3_BUCKET is not set; falling back to local storage');
  else {
    try {
      const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
      s3Client = new S3Client({ region: S3_REGION });
      // retain constructors on client for later use via require when needed
      usingS3 = true;
    } catch (e) {
      console.error('Failed to initialize S3 client, falling back to local storage', e);
      s3Client = null;
      usingS3 = false;
    }
  }
}

// Enable CORS and allow Authorization header + credentials so browser admin UI can send Basic auth
const corsOptions = { origin: true, credentials: true, allowedHeaders: ['Content-Type', 'Authorization'] };
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
// Serve the admin page via the protected `/admin` endpoint (for direct server-side access),
// but allow the static `/admin.html` to be served so client-side JS can apply stored credentials
// and call protected APIs without causing the browser's Basic-auth prompt on navigation.
// Serve the admin page without server-side Basic auth prompt
app.get('/admin', (req, res) => {
  const publicAdmin = path.join(publicDir, 'admin.html');
  const rootAdmin = path.join(__dirname, '..', 'admin.html');
  let fileToSend = null;
  if (fs.existsSync(publicAdmin)) fileToSend = publicAdmin;
  else if (fs.existsSync(rootAdmin)) fileToSend = rootAdmin;
  if (!fileToSend) return res.status(404).send('Admin page not found');
  res.sendFile(fileToSend);
});

// Helper: parse cookies from header
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function requirePasscode(req, res, next) {
  // Check cookie 'pass_verified' equals base64(PASSCODE)
  const cookies = parseCookies(req.headers.cookie || '');
  const expected = Buffer.from(PASSCODE).toString('base64');
  if (cookies.pass_verified === expected) return next();
  // Also allow if Authorization Basic matches admin credentials
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const b64 = auth.split(' ')[1] || '';
    const decoded = Buffer.from(b64, 'base64').toString();
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);
    if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  }
  return res.status(401).json({ error: 'Passcode required' });
}

// Accept a POST to validate a passcode server-side and set a cookie
app.post('/api/passcode', express.json(), (req, res) => {
  const pass = (req.body && req.body.passcode) ? String(req.body.passcode) : '';
  if (!pass) return res.status(400).json({ error: 'Missing passcode' });
  if (pass === PASSCODE) {
    const val = Buffer.from(PASSCODE).toString('base64');
    // Set a HttpOnly cookie so client cannot read it (server will validate)
    res.cookie('pass_verified', val, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid passcode' });
});

app.post('/api/passcode/logout', (req, res) => {
  res.clearCookie('pass_verified');
  res.json({ ok: true });
});

// Health endpoint
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Serve the admin landing page but protect it with the server-side passcode
// Serve the admin landing page publicly (no passcode prompt)
app.get(['/adminmain', '/adminmain.html'], (req, res) => {
  const adminMain = path.join(publicDir, 'adminmain.html');
  if (!fs.existsSync(adminMain)) return res.status(404).send('Admin main page not found');
  res.sendFile(adminMain);
});

// Protect the static `admin.html` so it is not publicly accessible without credentials.
// Serve it only via the protected route so admin actions remain gated server-side.
// Serve the static `admin.html` publicly (no server-side prompt)
app.get(['/admin.html'], (req, res) => {
  const adminFile = path.join(publicDir, 'admin.html');
  if (!fs.existsSync(adminFile)) return res.status(404).send('Admin page not found');
  res.sendFile(adminFile);
});

// static middleware will be registered after API routes (below)

// Basic HTTP auth for admin actions. Configure via environment variables:
// ADMIN_USER and ADMIN_PASS can be set in the environment to override defaults.
// WARNING: The defaults below are a universal admin credential for convenience
// during local testing and development. Do NOT rely on these defaults in
// production — configure `ADMIN_USER` and `ADMIN_PASS` in your environment
// or secrets manager.
//
// Location: server/server.js — this block defines the `ADMIN_USER` / `ADMIN_PASS` defaults.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'PleaseChangeMe!2026';

// Simple in-memory session store for admin login tokens.
// Token -> expiry(ms since epoch)
const sessions = new Map();
const SESSION_TTL = Number(process.env.SESSION_TTL_MS) || (24 * 60 * 60 * 1000); // 1 day

async function sessionSet(token) {
  if (useRedis && redisClient) {
    try {
      await redisClient.set(`session:${token}`, '1', { EX: Math.floor(SESSION_TTL / 1000) });
      return;
    } catch (e) { console.error('Redis sessionSet error', e); }
  }
  sessions.set(token, Date.now() + SESSION_TTL);
}

async function sessionExists(token) {
  if (!token) return false;
  if (useRedis && redisClient) {
    try {
      const ex = await redisClient.exists(`session:${token}`);
      return ex === 1;
    } catch (e) { console.error('Redis sessionExists error', e); }
  }
  const exp = sessions.get(token);
  return Boolean(exp && exp > Date.now());
}

async function sessionDelete(token) {
  if (!token) return;
  if (useRedis && redisClient) {
    try { await redisClient.del(`session:${token}`); return; } catch (e) { console.error('Redis sessionDelete error', e); }
  }
  sessions.delete(token);
}

// periodic cleanup only for in-memory store
function cleanExpiredSessions() {
  if (useRedis) return;
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp <= now) sessions.delete(t);
}
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

async function requireAdmin(req, res, next) {
  // First, accept session cookie `admin_token` if present
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.admin_token;
  if (token) {
    try {
      const ok = await sessionExists(token);
      if (ok) {
        // refresh TTL in the store
        await sessionSet(token);
        return next();
      }
    } catch (e) {
      console.error('sessionExists check failed', e);
    }
  }
  // Fallback to Basic auth for tooling compatibility
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    const b64 = auth.split(' ')[1] || '';
    const decoded = Buffer.from(b64, 'base64').toString();
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);
    if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  }
  return res.status(401).send('Authentication required');
}

// Login endpoint: accepts JSON { user, pass } and sets an HttpOnly session cookie on success
app.post('/api/login', express.json(), (req, res) => {
  const user = (req.body && req.body.user) ? String(req.body.user) : '';
  const pass = (req.body && req.body.pass) ? String(req.body.pass) : '';
  // Debug: log incoming login attempts (avoid logging the password)
  try { console.log('login attempt:', { user, origin: req.headers.origin || req.headers.host || '', ip: req.ip || req.connection?.remoteAddress || '' }); } catch(e) {}
  if (!user || !pass) return res.status(400).json({ error: 'Missing credentials' });
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    // store session (redis or in-memory)
    sessionSet(token).then(() => {}).catch(()=>{});
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax', secure: (process.env.COOKIE_SECURE === 'true'), maxAge: SESSION_TTL });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.admin_token;
  if (token) sessionDelete(token).then(()=>{}).catch(()=>{});
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

// Whoami: returns the logged-in admin user if session cookie valid
app.get('/api/whoami', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.admin_token;
  if (token) {
    sessionExists(token).then(ok => {
      if (ok) return res.json({ user: ADMIN_USER });
      return res.status(401).json({ error: 'Not authenticated' });
    }).catch(() => res.status(401).json({ error: 'Not authenticated' }));
    return;
  }
  return res.status(401).json({ error: 'Not authenticated' });
});

// Multer storage: when using S3 we write to a temp dir then upload to S3, otherwise save to public/uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const target = (req.query.target || req.body?.target || '').toString().replace(/[^a-z0-9\-\_]/gi, '');
    const base = (STORAGE_BACKEND === 'local') ? uploadsDir : path.join(__dirname, '..', 'tmp');
    const dest = target && STORAGE_BACKEND === 'local' ? path.join(base, target) : base;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-z0-9.\-\_]/gi, '_');
    cb(null, safe);
  }
});
// Allow larger uploads if needed. Current limit: 50MB per file.
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit per file

// Booking form handler: accept form data and optional attachment, send email via nodemailer
const bookingUpload = multer({ dest: path.join(__dirname, '..', 'tmp') });
app.post('/api/book', bookingUpload.single('attachment'), async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name || '(no name)';
    const email = body.email || '(no email)';
    const date = body.date || '';
    const time = body.time || '';
    const age = body.age || '';
    const allergies = body.allergies || '';
    const placement = body.placement || '';
    const size = body['size-tatto'] || '';
    const design = body.design || '';
    const message = body.message || '';

    // Configure transporter via env vars. If SMTP not configured, simulate success in dev.
    const SMTP_HOST = process.env.SMTP_HOST || '';
    const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
    const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
    const SMTP_USER = process.env.SMTP_USER || '';
    const SMTP_PASS = process.env.SMTP_PASS || '';

    // Require SMTP configuration; do not simulate or fall back — fail hard if missing.
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.error('SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in environment.');
      return res.status(500).json({ error: 'SMTP not configured' });
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const toAddr = process.env.BOOKING_TO || 'meao.ink@gmail.com';
    const fromAddr = process.env.SMTP_FROM || (SMTP_USER || 'no-reply@example.com');

    const text = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Date: ${date}`,
      `Time: ${time}`,
      `Age: ${age}`,
      `Allergies: ${allergies}`,
      `Placement: ${placement}`,
      `Size: ${size}`,
      `Design: ${design}`,
      `Message: ${message}`
    ].join('\n\n');

    const mailOptions = {
      from: `Website <${fromAddr}>`,
      to: toAddr,
      subject: `New booking request from ${name}`,
      text
    };

    if (req.file) {
      mailOptions.attachments = [{ filename: req.file.originalname || req.file.filename, path: req.file.path }];
    }

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('booking send info', info);
      try {
        const preview = nodemailer.getTestMessageUrl && nodemailer.getTestMessageUrl(info);
        if (preview) console.log('Preview URL:', preview);
      } catch (e) {}
    } catch (sendErr) {
      console.error('booking send error (SMTP failed)', sendErr);
      return res.status(500).json({ error: 'Failed to send booking' });
    }

    // cleanup temp file
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('booking send error', e);
    return res.status(500).json({ error: 'Failed to send booking' });
  }
});

// Allow up to 100 files per upload request
app.post('/api/upload', requireAdmin, upload.array('images', 100), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const target = (req.query.target || req.body?.target || '').toString().replace(/[^a-z0-9\-\_]/gi, '');
  const uploaded = [];
  try {
    for (const f of req.files) {
      const filename = path.basename(f.path);
      if (usingS3 && s3Client && S3_BUCKET) {
        // upload file to S3 and then remove local temp
        const key = (target ? (target + '/') : '') + filename;
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const stream = fs.createReadStream(f.path);
        try {
          await s3Client.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: stream }));
        } catch (e) {
          console.error('S3 upload error for', f.path, e);
          // if upload fails, continue to next file
          continue;
        }
        // build public URL
        const url = S3_PUBLIC_URL ? (S3_PUBLIC_URL.replace(/\/$/, '') + '/' + key) : `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
        uploaded.push({ url, name: f.originalname, key });
        // remove temp file
        fs.unlink(f.path, () => {});
      } else {
            const base = '/uploads' + (target ? ('/' + target) : '');
            const item = { url: base + '/' + filename, name: f.originalname };
            // Generate thumbnails and medium size images when sharp is available
            if (sharp) {
              try {
                const dir = path.dirname(f.path);
                const ext = path.extname(filename).toLowerCase();
                const baseName = path.basename(filename, ext);
                const thumbName = baseName + '-thumb.jpg';
                const medName = baseName + '-med.jpg';
                const thumbPath = path.join(dir, thumbName);
                const medPath = path.join(dir, medName);
                // 400x300 thumbnail (cover to fill box)
                await sharp(f.path)
                  .rotate()
                  .resize(400, 300, { fit: 'cover' })
                  .jpeg({ quality: 80 })
                  .toFile(thumbPath);
                // medium width (max 1200px) keep aspect ratio
                await sharp(f.path)
                  .rotate()
                  .resize({ width: 1200, withoutEnlargement: true })
                  .jpeg({ quality: 86 })
                  .toFile(medPath);
                item.thumb = base + '/' + thumbName;
                item.medium = base + '/' + medName;
              } catch (e) {
                console.error('thumbnail generation failed for', f.path, e);
              }
            }
            uploaded.push(item);
      }
    }
    return res.json({ uploaded });
  } catch (e) {
    console.error('upload handler error', e);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// Multer error handler: return JSON on common upload errors
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Delete an uploaded image (protected)
app.delete('/api/images/:name', requireAdmin, async (req, res) => {
  try {
    const name = path.basename(req.params.name);
    if (!name) return res.status(400).json({ error: 'Missing filename' });
    const target = (req.query.target || '').toString().replace(/[^a-z0-9\-\_]/gi, '');
    if (usingS3 && s3Client && S3_BUCKET) {
      const key = (target ? (target + '/') : '') + name;
      try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return res.json({ deleted: name });
      } catch (e) {
        console.error('S3 delete error', e);
        return res.status(500).json({ error: 'Failed to delete file' });
      }
    }
    const baseDir = target ? path.resolve(uploadsDir, target) : path.resolve(uploadsDir);
    const uploadsResolved = baseDir + path.sep;
    const filePath = path.resolve(baseDir, name);
    if (!filePath.startsWith(uploadsResolved)) return res.status(400).json({ error: 'Invalid filename' });
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) return res.status(404).json({ error: 'File not found' });
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) return res.status(500).json({ error: 'Failed to delete file' });
        return res.json({ deleted: name });
      });
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/images', (req, res) => {
  // Return image files sorted by modification time (oldest first) so gallery populates left-to-right
  const target = (req.query.target || '').toString().replace(/[^a-z0-9\-\_]/gi, '');
  if (usingS3 && s3Client && S3_BUCKET) {
    // list objects from S3 under optional prefix
    (async () => {
      try {
        const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
        const prefix = target ? (target + '/') : '';
        const out = await s3Client.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }));
        let contents = out && out.Contents ? out.Contents : [];
        // Exclude generated thumbnails/medium files from S3 listing
        contents = contents.filter(c => { const bn = path.basename(c.Key || ''); return !/-(thumb|med)\.jpg$/i.test(bn); });
        // map to { url, name } sorted by LastModified
        const items = contents.map(c => ({ key: c.Key, name: path.basename(c.Key), mtime: c.LastModified ? c.LastModified.getTime() : 0 }));
        items.sort((a, b) => a.mtime - b.mtime);
        const images = items.map(i => {
          const url = S3_PUBLIC_URL ? (S3_PUBLIC_URL.replace(/\/$/, '') + '/' + i.key) : `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${i.key}`;
          return { url, name: i.name };
        });
        res.json(images);
      } catch (e) {
        console.error('S3 list error', e);
        res.json([]);
      }
    })();
    return;
  }
  const listDir = target ? path.join(uploadsDir, target) : uploadsDir;
  fs.readdir(listDir, async (err, files) => {
    if (err) return res.json([]);
    try {
      const stats = await Promise.all(files.map(async (f) => {
        try {
          const st = await fs.promises.stat(path.join(listDir, f));
          return st.isFile() ? { file: f, mtime: st.mtimeMs } : null;
        } catch (e) { return null; }
      }));
      let filtered = stats.filter(Boolean);
      // Exclude generated thumbnails and medium images from the main listing
      filtered = filtered.filter(s => !/-(thumb|med)\.jpg$/i.test(s.file));
      filtered.sort((a, b) => a.mtime - b.mtime);
      const base = '/uploads' + (target ? ('/' + target) : '');
      const images = filtered.map(s => {
        const url = base + '/' + s.file;
        const ext = path.extname(s.file);
        const nameOnly = path.basename(s.file, ext);
        const thumbName = nameOnly + '-thumb.jpg';
        const medName = nameOnly + '-med.jpg';
        const thumbPath = path.join(listDir, thumbName);
        const medPath = path.join(listDir, medName);
        const out = { url, name: s.file };
        try {
          if (fs.existsSync(thumbPath)) out.thumb = base + '/' + thumbName;
          if (fs.existsSync(medPath)) out.medium = base + '/' + medName;
        } catch (e) { /* ignore */ }
        return out;
      });
      res.json(images);
    } catch (e) {
      return res.json([]);
    }
  });
});

// Booked dates storage (admin-managed)
const BOOKED_FILE = path.join(__dirname, '..', 'data', 'booked-dates.json');
if (!fs.existsSync(path.dirname(BOOKED_FILE))) fs.mkdirSync(path.dirname(BOOKED_FILE), { recursive: true });

function readBookedDates() {
  try {
    if (!fs.existsSync(BOOKED_FILE)) return [];
    const raw = fs.readFileSync(BOOKED_FILE, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(d => String(d));
  } catch (e) { return []; }
}

function writeBookedDates(arr) {
  try {
    const dedup = Array.from(new Set((arr || []).map(d => String(d))));
    fs.writeFileSync(BOOKED_FILE, JSON.stringify(dedup, null, 2), 'utf8');
    return dedup;
  } catch (e) { throw e; }
}

// Get booked dates (public)
app.get('/api/booked-dates', (req, res) => {
  try {
    const dates = readBookedDates();
    return res.json({ dates });
  } catch (e) { return res.status(500).json({ error: 'Failed to read booked dates' }); }
});

// Update booked dates (admin only)
// Accept JSON: { action: 'add'|'remove'|'set', dates: ['YYYY-MM-DD', ...] }
app.post('/api/booked-dates', requireAdmin, express.json(), (req, res) => {
  try {
    const body = req.body || {};
    const action = (body.action || 'set');
    const dates = Array.isArray(body.dates) ? body.dates.map(String) : [];
    const existing = readBookedDates();
    let out = existing.slice();
    if (action === 'set') {
      out = dates;
    } else if (action === 'add') {
      out = Array.from(new Set(existing.concat(dates)));
    } else if (action === 'remove') {
      const rem = new Set(dates);
      out = existing.filter(d => !rem.has(d));
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const saved = writeBookedDates(out);
    return res.json({ dates: saved });
  } catch (e) {
    console.error('booked-dates error', e);
    return res.status(500).json({ error: 'Failed to update booked dates' });
  }
});

// Serve static files (do this after registering API routes so /api/* is handled first)
app.use(express.static(publicDir));

// Bind to all interfaces so IPv4 (127.0.0.1) and IPv6 (::1) clients can connect.
app.get('/', (req,res)=>res.redirect('/adminmain'));
app.listen(PORT, '0.0.0.0', () => console.log(`Upload server running on http://localhost:${PORT}`));

// ============================================================
//  Asset Console Enterprise Edition v3.4 – server.js
//  Express + better-sqlite3 (sync) + multer + sharp
// ============================================================
const express  = require('express');
const Database = require('better-sqlite3');
const multer   = require('multer');
const sharp    = require('sharp');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const QRCode   = require('qrcode');
const crypto   = require('crypto');

const app  = express();
const PORT = 8080;

// ── Directories ────────────────────────────────────────────
const PUBLIC_DIR  = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── CORS (Cross-Origin Resource Sharing) ────────────────────
// Fully supports Cloudflare Pages, Cloudflare Tunnels, custom domains, and mobile browsers
const corsOptions = {
  origin: (origin, callback) => {
    // Allow any origin to enable seamless cross-domain requests between Cloudflare and backend
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Range'],
  exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Range']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

// ── Multer (memory storage – sharp processes before disk write) ────
const uploadStorage = multer.memoryStorage();

const uploadMulter = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 30 * 1024 * 1024, // accept up to 30 MB raw file (mobile cameras capture high resolution)
    files: 10                   // accept up to 10 photos per upload
  },
  fileFilter: (_req, file, cb) => {
    // Check mimetype and file extension for maximum mobile camera compatibility
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isImageMime = mime.startsWith('image/') || mime === 'application/octet-stream' || mime === 'binary/octet-stream';
    const isImageExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.bmp', '.jfif', '.avif'].includes(ext);

    if (isImageMime || isImageExt || !ext) {
      cb(null, true);
    } else {
      cb(null, false); // Gracefully reject non-images without unhandled Multer crash
    }
  }
});

// Middleware wrapper to handle any MulterError or unexpected field gracefully as JSON
const uploadMiddleware = (req, res, next) => {
  uploadMulter.any()(req, res, (err) => {
    if (err) {
      console.warn('⚠️ Multer upload error caught:', err.message);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: 'ขนาดไฟล์ภาพเกินขีดจำกัด (สูงสุด 30MB)' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ success: false, message: 'จำนวนไฟล์เกินกำหนด (สูงสุด 10 ไฟล์ต่อครั้ง)' });
        }
        return res.status(400).json({ success: false, message: `ข้อผิดพลาดในการอัปโหลด: ${err.message}` });
      }
      return res.status(400).json({ success: false, message: err.message || 'เกิดข้อผิดพลาดในการรับไฟล์' });
    }
    next();
  });
};

// ── Image process helper (sharp with safe fallback) ─────────────────
// Automatically resizes width to max 800px, EXIF auto-rotate, JPEG quality 80.
// If compression library fails for ANY reason, fallback immediately saves raw buffer
// to uploads directory to guarantee 100% data preservation and zero upload loss.
async function processAndSaveImage(buffer, originalName) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const rawExt = (path.extname(originalName || '').toLowerCase() || '').replace(/[^a-z0-9.]/gi, '');
  const ext = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(rawExt) ? rawExt : '.jpg';
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const baseName = `asset-${Date.now()}-${randomSuffix}.jpg`;
  const destPath = path.join(UPLOADS_DIR, baseName);

  try {
    if (!sharp) {
      throw new Error('Sharp library not available');
    }
    await sharp(buffer)
      .rotate() // auto-rotate based on EXIF orientation (crucial for mobile cameras)
      .resize({ width: 800, withoutEnlargement: true }) // max width 800px
      .toFormat('jpeg', { quality: 80, progressive: true })
      .toFile(destPath);

    return `uploads/${baseName}`;
  } catch (err) {
    console.warn('⚠️ Image compression warning (fallback to raw file):', err.message);
    const fallbackName = `asset-${Date.now()}-${randomSuffix}${ext}`;
    const fallbackPath = path.join(UPLOADS_DIR, fallbackName);
    await fs.promises.writeFile(fallbackPath, buffer);
    return `uploads/${fallbackName}`;
  }
}

// ── SQLite DB (better-sqlite3 – synchronous) ───────────────
const DB_PATH = path.join(__dirname, 'assets.db');
let db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
console.log('✅ SQLite DB opened:', DB_PATH);

// Sync helpers wrapped as Promises so all route async/await stays unchanged
const dbRun = (sql, params = []) => {
  const info = db.prepare(sql).run(params);
  return Promise.resolve({ lastID: info.lastInsertRowid, changes: info.changes });
};
const dbGet = (sql, params = []) => Promise.resolve(db.prepare(sql).get(params));
const dbAll = (sql, params = []) => Promise.resolve(db.prepare(sql).all(params));

// ── Create tables ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,
    name       TEXT    NOT NULL DEFAULT '',
    role       TEXT    NOT NULL DEFAULT 'viewer',
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS assets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code      TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL DEFAULT '',
    serial_number   TEXT    NOT NULL DEFAULT '',
    category        TEXT    NOT NULL DEFAULT '',
    department      TEXT    NOT NULL DEFAULT '',
    holder          TEXT    NOT NULL DEFAULT '',
    received_date   TEXT    NOT NULL DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'active',
    notes           TEXT    NOT NULL DEFAULT '',
    photos          TEXT    NOT NULL DEFAULT '[]',
    image           TEXT    DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS borrows (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id     INTEGER NOT NULL,
    asset_code   TEXT    NOT NULL,
    borrower     TEXT    NOT NULL,
    department   TEXT    NOT NULL DEFAULT '',
    borrow_date  TEXT    NOT NULL,
    due_date     TEXT    NOT NULL DEFAULT '',
    return_date  TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'borrowed',
    notes        TEXT    NOT NULL DEFAULT '',
    created_by   TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS maintenance (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id     INTEGER NOT NULL,
    asset_code   TEXT    NOT NULL,
    type         TEXT    NOT NULL DEFAULT 'repair',
    description  TEXT    NOT NULL DEFAULT '',
    technician   TEXT    NOT NULL DEFAULT '',
    cost         REAL    NOT NULL DEFAULT 0,
    start_date   TEXT    NOT NULL,
    end_date     TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'pending',
    notes        TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    username   TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    role       TEXT    NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT    NOT NULL,
    provider_id TEXT    NOT NULL,
    email       TEXT    NOT NULL DEFAULT '',
    display_name TEXT   NOT NULL DEFAULT '',
    linked_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(provider, provider_id)
  );

  CREATE TABLE IF NOT EXISTS audits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_code    TEXT    NOT NULL UNIQUE,
    title         TEXT    NOT NULL,
    department    TEXT    NOT NULL DEFAULT '',
    auditor       TEXT    NOT NULL DEFAULT '',
    audit_date    TEXT    NOT NULL DEFAULT '',
    total_items   INTEGER NOT NULL DEFAULT 0,
    scanned_items INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'in_progress',
    notes         TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS audit_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id   INTEGER NOT NULL,
    asset_code TEXT    NOT NULL,
    scanned_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    scanned_by TEXT    NOT NULL DEFAULT '',
    UNIQUE(audit_id, asset_code)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT    NOT NULL,
    entity_type TEXT    NOT NULL DEFAULT '',
    entity_id   TEXT    NOT NULL DEFAULT '',
    details     TEXT    NOT NULL DEFAULT '',
    user_name   TEXT    NOT NULL DEFAULT '',
    user_id     INTEGER NOT NULL DEFAULT 0,
    ip_address  TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// Seed default users for testing RBAC
// admin: admin1234
const adminHash = crypto.createHash('sha256').update('admin1234').digest('hex');
db.prepare(`INSERT OR IGNORE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)`)
  .run(['admin', adminHash, 'ผู้ดูแลระบบ', 'admin']);

// Audy: Phatsanai04 (admin)
const audyHash = crypto.createHash('sha256').update('Phatsanai04').digest('hex');
db.prepare(`INSERT OR IGNORE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)`)
  .run(['Audy', audyHash, 'Audy', 'admin']);

// editor: editor1234 (editor)
const editorHash = crypto.createHash('sha256').update('editor1234').digest('hex');
db.prepare(`INSERT OR IGNORE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)`)
  .run(['editor', editorHash, 'ผู้แก้ไขข้อมูล (Editor)', 'editor']);

// viewer: viewer1234 (viewer)
const viewerHash = crypto.createHash('sha256').update('viewer1234').digest('hex');
db.prepare(`INSERT OR IGNORE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)`)
  .run(['viewer', viewerHash, 'ผู้เข้าชม (Viewer)', 'viewer']);

// ── SQLite Schema Migration: Ensure 'image' column exists in assets ──────
try {
  const colInfo = db.pragma('table_info(assets)');
  if (!colInfo.some(c => c.name === 'image')) {
    db.exec("ALTER TABLE assets ADD COLUMN image TEXT DEFAULT ''");
    console.log('✅ SQLite: Added image column to assets table');
  }
} catch (e) {
  console.warn('DB Migration warning:', e.message);
}

// ── Asset & Photo Helpers ────────────────────────────────────
function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

async function normalizePhotosInput(photos, image) {
  let list = [];
  if (Array.isArray(photos)) {
    list = [...photos];
  } else if (typeof photos === 'string' && photos.trim()) {
    try {
      const parsed = JSON.parse(photos);
      if (Array.isArray(parsed)) list = parsed;
      else list = [photos.trim()];
    } catch {
      list = [photos.trim()];
    }
  }
  if (typeof image === 'string' && image.trim() && !list.includes(image.trim())) {
    list.unshift(image.trim());
  }

  const result = [];
  for (let item of list) {
    if (typeof item !== 'string' || !item.trim()) continue;
    item = item.trim();

    // Check if item is a base64 string (prevent SQLite database bloat and performance degradation)
    if (item.startsWith('data:image/')) {
      try {
        const matches = item.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const savedPath = await processAndSaveImage(buffer, `upload.${ext}`);
          result.push(savedPath);
          continue;
        }
      } catch (err) {
        console.warn('⚠️ Failed to decode base64 image data:', err.message);
      }
    }

    // Strip leading slash if /uploads/... -> uploads/... for consistent relative storage
    if (item.startsWith('/uploads/')) {
      item = item.substring(1);
    }
    result.push(item);
  }
  return result;
}

function formatAssetOutput(asset) {
  if (!asset) return null;
  const parsedPhotos = safeParseJSON(asset.photos, []);
  const photos = Array.isArray(parsedPhotos) && parsedPhotos.length > 0
    ? parsedPhotos
    : (asset.image ? [asset.image] : []);
  const image = asset.image || (photos.length > 0 ? photos[0] : '');
  return {
    ...asset,
    image,
    photos
  };
}

// ── Audit Logging Helper ────────────────────────────────────
function logAudit(action, entityType = '', entityId = '', details = '', req = null, actorName = '') {
  try {
    let uName = actorName;
    let uId = 0;
    let ip = '';
    if (req) {
      ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
      if (req.user) {
        uName = uName || req.user.name || req.user.username;
        uId = req.user.id || req.user.user_id || 0;
      } else if (req.body && req.body.operator) {
        uName = uName || req.body.operator;
      }
    }
    uName = uName || 'System';
    const detailText = typeof details === 'object' ? JSON.stringify(details) : String(details || '');
    db.prepare(`
      INSERT INTO audit_logs (action, entity_type, entity_id, details, user_name, user_id, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(action, entityType, String(entityId || ''), detailText, uName, uId, ip);
  } catch (err) {
    console.warn('⚠️ logAudit warning:', err.message);
  }
}


// ── Auth helpers ────────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function authenticate(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token || '';
  if (!token) {
    res.status(401).json({ success: false, message: 'ไม่มี Token กรุณาเข้าสู่ระบบ' });
    return null;
  }
  try {
    const sess = await dbGet('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!sess || sess.expires_at < Date.now()) {
      if (sess) await dbRun('DELETE FROM sessions WHERE token = ?', [token]);
      res.status(401).json({ success: false, message: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่' });
      return null;
    }
    return sess;
  } catch(e) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดด้าน Auth' });
    return null;
  }
}

// ============================================================
//  AUTH ROUTES
// ============================================================

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });

    const hash = crypto.createHash('sha256').update(String(password)).digest('hex');
    const user = await dbGet('SELECT * FROM users WHERE username = ? AND password = ?', [String(username), hash]);
    if (!user)
      return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const token     = generateToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await dbRun('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    await dbRun('INSERT INTO sessions (token,user_id,username,name,role,expires_at) VALUES (?,?,?,?,?,?)',
      [token, user.id, user.username, user.name, user.role, expiresAt]);

    return res.json({ success: true, token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (err) {
    console.error('/api/login error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

// POST /api/logout
app.post('/api/logout', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token) await dbRun('DELETE FROM sessions WHERE token = ?', [token]).catch(() => {});
  return res.json({ success: true, message: 'ออกจากระบบแล้ว' });
});

// GET /api/me & /api/auth/me
app.get(['/api/me', '/api/auth/me'], async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  return res.json({ success: true, user: { id: sess.user_id, username: sess.username, name: sess.name, role: sess.role } });
});

// ============================================================
//  ASSETS ROUTES
// ============================================================

// GET /api/assets
app.get('/api/assets', async (req, res) => {
  try {
    const { search = '', status = '', category = '', page = 1, limit = 50 } = req.query;
    let where  = [];
    let params = [];

    if (search) {
      where.push('(asset_code LIKE ? OR name LIKE ? OR serial_number LIKE ? OR holder LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }
    if (status)   { where.push('status = ?');   params.push(status); }
    if (category) { where.push('category = ?'); params.push(category); }

    const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset   = (parseInt(page) - 1) * parseInt(limit);

    const countRow = await dbGet(`SELECT COUNT(*) as cnt FROM assets ${whereStr}`, params);
    const total    = countRow ? countRow.cnt : 0;
    const assets   = await dbAll(`SELECT * FROM assets ${whereStr} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]);

    const result = assets.map(formatAssetOutput);
    return res.json({ success: true, data: result, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('/api/assets GET error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/assets/check-existing  ← ต้องอยู่ก่อน /:id
app.post('/api/assets/check-existing', async (req, res) => {
  try {
    const { codes } = req.body;
    if (!Array.isArray(codes) || codes.length === 0)
      return res.json({ success: true, existing: [] });

    const placeholders = codes.map(() => '?').join(',');
    const rows = await dbAll(`SELECT asset_code FROM assets WHERE asset_code IN (${placeholders})`, codes);
    const existing = rows.map(r => r.asset_code);
    return res.json({ success: true, existing });
  } catch (err) {
    console.error('/api/assets/check-existing error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// GET /api/assets/available-codes?prefix=A&start=1&count=20  ← ต้องอยู่ก่อน /:id
// ข้ามรหัสที่ถูกลงทะเบียนแล้ว และรันลำดับถัดไปเติมจนครบจำนวนที่ต้องการเป๊ะๆ
app.get('/api/assets/available-codes', async (req, res) => {
  try {
    let prefix = String(req.query.prefix || 'A').toUpperCase().trim();
    if (!prefix || prefix.length !== 1 || prefix < 'A' || prefix > 'Z') prefix = 'A';
    let currentNum = parseInt(req.query.start) || 1;
    if (currentNum < 1) currentNum = 1;
    if (currentNum > 999) currentNum = 1;
    const targetCount = Math.min(Math.max(parseInt(req.query.count) || 20, 1), 26000);

    const rows = await dbAll('SELECT asset_code FROM assets');
    const existingSet = new Set(rows.map(r => String(r.asset_code || '').trim().toUpperCase()));

    let currentPrefixCode = prefix.charCodeAt(0);
    const codes = [];
    const skipped = [];
    let iterations = 0;
    const maxIterations = 26000;

    // วนลูปจนกว่าจะได้รหัสพอดีตามจำนวน targetCount
    // ข้ามรหัสที่มีในระบบแล้ว โดยวิ่งต่อไปเรื่อยๆ จนครบตามจำนวนเป๊ะๆ
    while (codes.length < targetCount && iterations < maxIterations) {
      iterations++;
      if (currentNum > 999) {
        currentNum = 1;
        currentPrefixCode++;
        if (currentPrefixCode > 90) {
          currentPrefixCode = 65; // Rollover กลับมา A หากจำเป็น
        }
      }
      const p = String.fromCharCode(currentPrefixCode);
      const code = `${p}${String(currentNum).padStart(3, '0')}`;
      if (existingSet.has(code.toUpperCase())) {
        if (!skipped.includes(code)) skipped.push(code);
      } else {
        codes.push(code);
      }
      currentNum++;
    }

    return res.json({ success: true, codes, skipped, total: codes.length, requested: targetCount });
  } catch (err) {
    console.error('/api/assets/available-codes error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงรหัส' });
  }
});

// GET /api/assets/:id  (by asset_code or numeric id) ← ต้องอยู่หลัง specific routes
app.get('/api/assets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let asset;
    if (/^\d+$/.test(id)) {
      asset = await dbGet('SELECT * FROM assets WHERE id = ?', [parseInt(id)]);
    }
    if (!asset) {
      asset = await dbGet('SELECT * FROM assets WHERE asset_code = ?', [id]);
    }
    if (!asset) return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สินนี้' });
    return res.json({ success: true, data: formatAssetOutput(asset) });
  } catch (err) {
    console.error('/api/assets/:id GET error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// POST /api/assets (register new) — เปิดให้ทุกคนลงทะเบียนได้ ไม่ต้อง login
app.post('/api/assets', async (req, res) => {
  try {
    const { asset_code, name, serial_number, category, department, holder, received_date, status, notes, photos, image } = req.body;
    if (!asset_code)
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสทรัพย์สิน' });

    const existing = await dbGet('SELECT id FROM assets WHERE asset_code = ?', [asset_code]);
    if (existing)
      return res.status(409).json({ success: false, message: `รหัส ${asset_code} ถูกลงทะเบียนในระบบแล้ว` });

    // Normalize photos & image (handles raw path strings, arrays, and safely decodes base64 without bloating DB)
    const processedPhotos = await normalizePhotosInput(photos, image);
    const photosJson = JSON.stringify(processedPhotos);
    const primaryImage = processedPhotos.length > 0 ? processedPhotos[0] : (typeof image === 'string' ? image.trim() : '');

    const result = await dbRun(
      `INSERT INTO assets (asset_code,name,serial_number,category,department,holder,received_date,status,notes,photos,image,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`,
      [asset_code, name||'', serial_number||'', category||'', department||'', holder||'', received_date||'', status||'active', notes||'', photosJson, primaryImage]
    );
    const newAsset = await dbGet('SELECT * FROM assets WHERE id = ?', [result.lastID]);
    return res.status(201).json({ success: true, data: formatAssetOutput(newAsset) });
  } catch (err) {
    console.error('/api/assets POST error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// PUT /api/assets/:id (update) — ต้องเป็น admin หรือ editor เท่านั้น
app.put('/api/assets/:id', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role))
    return res.status(403).json({ success: false, message: 'ต้องเป็น Admin หรือ Editor เท่านั้นจึงจะแก้ไขข้อมูลได้' });
  try {
    const { id } = req.params;
    let asset;
    if (/^\d+$/.test(id)) asset = await dbGet('SELECT * FROM assets WHERE id = ?', [parseInt(id)]);
    if (!asset) asset = await dbGet('SELECT * FROM assets WHERE asset_code = ?', [id]);
    if (!asset) return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สินนี้' });

    const { name, serial_number, category, department, holder, received_date, status, notes, photos, image } = req.body;
    let photosJson = asset.photos;
    let primaryImage = asset.image || '';

    if (photos !== undefined || image !== undefined) {
      const processedPhotos = await normalizePhotosInput(
        photos !== undefined ? photos : safeParseJSON(asset.photos, []),
        image !== undefined ? image : asset.image
      );
      photosJson = JSON.stringify(processedPhotos);
      primaryImage = processedPhotos.length > 0 ? processedPhotos[0] : (image || '');
    }

    await dbRun(
      `UPDATE assets SET name=?,serial_number=?,category=?,department=?,holder=?,received_date=?,status=?,notes=?,photos=?,image=?,updated_at=datetime('now','localtime') WHERE id=?`,
      [
        name          !== undefined ? name          : asset.name,
        serial_number !== undefined ? serial_number : asset.serial_number,
        category      !== undefined ? category      : asset.category,
        department    !== undefined ? department    : asset.department,
        holder        !== undefined ? holder        : asset.holder,
        received_date !== undefined ? received_date : asset.received_date,
        status        !== undefined ? status        : asset.status,
        notes         !== undefined ? notes         : asset.notes,
        photosJson,
        primaryImage,
        asset.id
      ]
    );
    const updated = await dbGet('SELECT * FROM assets WHERE id = ?', [asset.id]);
    return res.json({ success: true, data: formatAssetOutput(updated) });
  } catch (err) {
    console.error('/api/assets/:id PUT error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

// DELETE /api/assets/:id (admin only)
app.delete('/api/assets/:id', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ลบข้อมูล (เฉพาะ Admin เท่านั้น)' });
  try {
    const { id } = req.params;
    let asset = /^\d+$/.test(id)
      ? await dbGet('SELECT * FROM assets WHERE id = ?', [parseInt(id)])
      : await dbGet('SELECT * FROM assets WHERE asset_code = ?', [id]);
    if (!asset) return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สินนี้ในระบบ' });

    // Cascade delete related records
    await dbRun('DELETE FROM borrows WHERE asset_id = ? OR asset_code = ?', [asset.id, asset.asset_code]);
    await dbRun('DELETE FROM maintenance WHERE asset_id = ? OR asset_code = ?', [asset.id, asset.asset_code]);
    await dbRun('DELETE FROM audit_items WHERE asset_code = ?', [asset.asset_code]);
    await dbRun('DELETE FROM assets WHERE id = ?', [asset.id]);

    return res.json({ success: true, message: `ลบทรัพย์สิน "${asset.asset_code}" เรียบร้อยแล้ว`, id: asset.id, asset_code: asset.asset_code });
  } catch (err) {
    console.error('DELETE /api/assets/:id error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการลบข้อมูล: ' + err.message });
  }
});

// ============================================================
//  FILE UPLOAD (เปิดให้อัปโหลดรูปภาพทรัพย์สินตอนลงทะเบียนได้)
// ============================================================
app.post('/api/upload', uploadMiddleware, async (req, res) => {
  try {
    const rawFiles = req.files || (req.file ? [req.file] : []);
    if (!rawFiles || rawFiles.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีไฟล์รูปภาพที่ถูกเลือก หรือรูปแบบไฟล์ไม่รองรับ (รองรับ JPG, PNG, WEBP)' });
    }

    const savedPaths = [];
    for (const f of rawFiles) {
      if (!f.buffer || f.buffer.length === 0) continue;
      const savedPath = await processAndSaveImage(f.buffer, f.originalname);
      savedPaths.push(savedPath);
    }

    if (savedPaths.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถประมวลผลไฟล์ภาพที่ส่งมาได้' });
    }

    console.log(`✅ Uploaded & compressed ${savedPaths.length} image(s):`, savedPaths);
    return res.json({
      success: true,
      urls: savedPaths,
      paths: savedPaths,
      files: savedPaths
    });
  } catch (err) {
    console.error('/api/upload error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดขณะอัปโหลด: ' + err.message });
  }
});

// ============================================================
//  BORROWS
// ============================================================
app.get('/api/borrows', async (req, res) => {
  try {
    const { status = '', asset_code = '' } = req.query;
    let where = []; let params = [];
    if (status)     { where.push('b.status = ?');     params.push(status); }
    if (asset_code) { where.push('b.asset_code = ?'); params.push(asset_code); }
    const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await dbAll(`SELECT b.*, a.name as asset_name FROM borrows b LEFT JOIN assets a ON a.id = b.asset_id ${whereStr} ORDER BY b.id DESC`, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/borrows', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ (ต้องเป็น Admin หรือ Editor)' });
  }
  try {
    const { asset_code, borrower, department, borrow_date, due_date, notes } = req.body;
    if (!asset_code || !borrower)
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสอุปกรณ์และชื่อผู้ยืม' });
    const asset = await dbGet('SELECT * FROM assets WHERE asset_code = ?', [asset_code]);
    if (!asset) return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สินนี้' });
    if (asset.status === 'borrowed')
      return res.status(409).json({ success: false, message: 'อุปกรณ์นี้ถูกยืมไปแล้ว' });

    const result = await dbRun(
      `INSERT INTO borrows (asset_id,asset_code,borrower,department,borrow_date,due_date,notes,created_by) VALUES (?,?,?,?,?,?,?,?)`,
      [asset.id, asset_code, borrower, department||'', borrow_date||new Date().toISOString().slice(0,10), due_date||'', notes||'', sess.name]
    );
    await dbRun(`UPDATE assets SET status='borrowed', holder=?, updated_at=datetime('now','localtime') WHERE id=?`, [borrower, asset.id]);
    const newBorrow = await dbGet('SELECT * FROM borrows WHERE id=?', [result.lastID]);
    return res.status(201).json({ success: true, data: newBorrow });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

app.put('/api/borrows/:id/return', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ (ต้องเป็น Admin หรือ Editor)' });
  }
  try {
    const borrow = await dbGet('SELECT * FROM borrows WHERE id=?', [parseInt(req.params.id)]);
    if (!borrow) return res.status(404).json({ success: false, message: 'ไม่พบรายการยืมนี้' });
    const returnDate = req.body.return_date || new Date().toISOString().slice(0,10);
    await dbRun(`UPDATE borrows SET status='returned', return_date=? WHERE id=?`, [returnDate, borrow.id]);
    await dbRun(`UPDATE assets SET status='active', updated_at=datetime('now','localtime') WHERE id=?`, [borrow.asset_id]);
    return res.json({ success: true, message: 'บันทึกการคืนอุปกรณ์แล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ขยายเวลายืม +7 วัน
app.put('/api/borrows/:id/extend', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ (ต้องเป็น Admin หรือ Editor)' });
  }
  try {
    const borrow = await dbGet('SELECT * FROM borrows WHERE id=?', [parseInt(req.params.id)]);
    if (!borrow) return res.status(404).json({ success: false, message: 'ไม่พบรายการยืมนี้' });
    
    let baseDate = new Date();
    if (borrow.due_date) {
      const parsed = new Date(borrow.due_date);
      if (!isNaN(parsed.getTime())) baseDate = parsed;
    }
    baseDate.setDate(baseDate.getDate() + 7);
    const newDueDate = baseDate.toISOString().slice(0, 10);
    
    await dbRun(`UPDATE borrows SET due_date=? WHERE id=?`, [newDueDate, borrow.id]);
    return res.json({ success: true, message: `ขยายกำหนดคืนเป็น ${newDueDate} เรียบร้อยแล้ว`, due_date: newDueDate });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ลบรายการยืม (admin only)
app.delete('/api/borrows/:id', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ลบรายการ (เฉพาะ Admin เท่านั้น)' });
  }
  try {
    const borrow = await dbGet('SELECT * FROM borrows WHERE id=?', [parseInt(req.params.id)]);
    if (!borrow) return res.status(404).json({ success: false, message: 'ไม่พบรายการยืมนี้' });
    await dbRun('DELETE FROM borrows WHERE id=?', [borrow.id]);
    return res.json({ success: true, message: 'ลบรายการยืมแล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ============================================================
//  MAINTENANCE
// ============================================================
app.get('/api/maintenance', async (req, res) => {
  try {
    const { status = '' } = req.query;
    const whereStr = status ? 'WHERE m.status = ?' : '';
    const params = status ? [status] : [];
    const rows = await dbAll(`SELECT m.*, a.name as asset_name FROM maintenance m LEFT JOIN assets a ON a.id = m.asset_id ${whereStr} ORDER BY m.id DESC`, params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/maintenance', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ (ต้องเป็น Admin หรือ Editor)' });
  }
  try {
    const { asset_code, type, description, technician, cost, start_date, end_date, notes } = req.body;
    if (!asset_code) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสอุปกรณ์' });
    const asset = await dbGet('SELECT * FROM assets WHERE asset_code = ?', [asset_code]);
    if (!asset) return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สินนี้' });

    const result = await dbRun(
      `INSERT INTO maintenance (asset_id,asset_code,type,description,technician,cost,start_date,end_date,notes) VALUES (?,?,?,?,?,?,?,?,?)`,
      [asset.id, asset_code, type||'repair', description||'', technician||'', parseFloat(cost)||0, start_date||new Date().toISOString().slice(0,10), end_date||'', notes||'']
    );
    await dbRun(`UPDATE assets SET status='maintenance', updated_at=datetime('now','localtime') WHERE id=?`, [asset.id]);
    const newRec = await dbGet('SELECT * FROM maintenance WHERE id=?', [result.lastID]);
    return res.status(201).json({ success: true, data: newRec });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

app.put('/api/maintenance/:id/complete', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ (ต้องเป็น Admin หรือ Editor)' });
  }
  try {
    const rec = await dbGet('SELECT * FROM maintenance WHERE id=?', [parseInt(req.params.id)]);
    if (!rec) return res.status(404).json({ success: false, message: 'ไม่พบรายการซ่อมนี้' });
    const endDate = req.body.end_date || new Date().toISOString().slice(0,10);
    await dbRun(`UPDATE maintenance SET status='completed', end_date=? WHERE id=?`, [endDate, rec.id]);
    await dbRun(`UPDATE assets SET status='active', updated_at=datetime('now','localtime') WHERE id=?`, [rec.asset_id]);
    return res.json({ success: true, message: 'บันทึกการซ่อมเสร็จสิ้นแล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ลบรายการซ่อม (admin only)
app.delete('/api/maintenance/:id', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ลบรายการ (เฉพาะ Admin เท่านั้น)' });
  }
  try {
    const rec = await dbGet('SELECT * FROM maintenance WHERE id=?', [parseInt(req.params.id)]);
    if (!rec) return res.status(404).json({ success: false, message: 'ไม่พบรายการซ่อมนี้' });
    await dbRun('DELETE FROM maintenance WHERE id=?', [rec.id]);
    return res.json({ success: true, message: 'ลบรายการซ่อมแล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ============================================================
//  AUDITS (ตรวจนับสต็อก)
// ============================================================
app.get('/api/audits', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM audits ORDER BY id DESC');
    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลตรวจนับ' });
  }
});

app.get('/api/audits/:id', async (req, res) => {
  try {
    const auditId = parseInt(req.params.id);
    const audit = await dbGet('SELECT * FROM audits WHERE id=?', [auditId]);
    if (!audit) return res.status(404).json({ success: false, message: 'ไม่พบรอบตรวจนับนี้' });
    const items = await dbAll('SELECT ai.*, a.name as asset_name FROM audit_items ai LEFT JOIN assets a ON a.asset_code = ai.asset_code WHERE ai.audit_id=? ORDER BY ai.id DESC', [auditId]);
    return res.json({ success: true, data: { ...audit, items } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/audits', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์สร้างรอบตรวจนับ (ต้องเป็น Admin หรือ Editor)' });
  }
  try {
    const { title, department, auditor, audit_date, notes } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อรอบการตรวจนับ' });

    const countRow = await dbGet('SELECT COUNT(*) as cnt FROM audits');
    const codeNum = String((countRow ? countRow.cnt : 0) + 1).padStart(2, '0');
    const year = new Date().getFullYear();
    const audit_code = `#AUD-${year}-${codeNum}`;

    const totalAssetsRow = await dbGet('SELECT COUNT(*) as cnt FROM assets');
    const total_items = totalAssetsRow ? totalAssetsRow.cnt : 0;

    const result = await dbRun(
      `INSERT INTO audits (audit_code, title, department, auditor, audit_date, total_items, scanned_items, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'in_progress', ?)`,
      [audit_code, title, department||'ทุกแผนก', auditor||sess.name, audit_date||new Date().toISOString().slice(0, 10), total_items, notes||'']
    );
    const created = await dbGet('SELECT * FROM audits WHERE id = ?', [result.lastID]);
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

app.post('/api/audits/:id/scan', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์บันทึกตรวจนับ (ต้องเป็น Admin หรือ Editor)' });
  }
  try {
    const auditId = parseInt(req.params.id);
    const { asset_code } = req.body;
    if (!asset_code) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสทรัพย์สิน' });
    const cleanCode = String(asset_code).trim().toUpperCase();

    const audit = await dbGet('SELECT * FROM audits WHERE id = ?', [auditId]);
    if (!audit) return res.status(404).json({ success: false, message: 'ไม่พบรอบตรวจนับนี้' });
    const asset = await dbGet('SELECT * FROM assets WHERE UPPER(asset_code) = ?', [cleanCode]);
    if (!asset) return res.status(404).json({ success: false, message: `ไม่พบทรัพย์สินรหัส "${cleanCode}" ในระบบ` });

    // Check if already scanned
    const already = await dbGet('SELECT id FROM audit_items WHERE audit_id = ? AND UPPER(asset_code) = ?', [auditId, cleanCode]);
    if (already) {
      return res.json({ success: true, message: `รหัส ${cleanCode} ถูกบันทึกไปแล้วในรอบนี้`, alreadyScanned: true, asset });
    }

    await dbRun('INSERT INTO audit_items (audit_id, asset_code, scanned_by) VALUES (?, ?, ?)', [auditId, asset.asset_code, sess.name]);
    const scannedCountRow = await dbGet('SELECT COUNT(*) as cnt FROM audit_items WHERE audit_id = ?', [auditId]);
    const scanned_items = scannedCountRow ? scannedCountRow.cnt : 1;
    await dbRun('UPDATE audits SET scanned_items = ? WHERE id = ?', [scanned_items, auditId]);
    return res.json({ success: true, message: `ตรวจนับ ${asset.name} (${cleanCode}) สำเร็จ!`, scanned_items, asset });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
});

app.put('/api/audits/:id/complete', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (!['admin', 'editor'].includes(sess.role)) {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการ' });
  }
  try {
    const auditId = parseInt(req.params.id);
    await dbRun(`UPDATE audits SET status = 'completed' WHERE id = ?`, [auditId]);
    return res.json({ success: true, message: 'บันทึกเสร็จสมบูรณ์รอบการตรวจนับแล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

app.delete('/api/audits/:id', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ลบ (เฉพาะ Admin เท่านั้น)' });
  }
  try {
    const auditId = parseInt(req.params.id);
    await dbRun('DELETE FROM audit_items WHERE audit_id = ?', [auditId]);
    await dbRun('DELETE FROM audits WHERE id = ?', [auditId]);
    return res.json({ success: true, message: 'ลบรอบตรวจนับแล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ============================================================
//  STATS / DASHBOARD
// ============================================================
app.get('/api/stats', async (req, res) => {
  try {
    const totalAssets   = (await dbGet("SELECT COUNT(*) as cnt FROM assets")).cnt;
    const activeAssets  = (await dbGet("SELECT COUNT(*) as cnt FROM assets WHERE status='active'")).cnt;
    const borrowed      = (await dbGet("SELECT COUNT(*) as cnt FROM assets WHERE status='borrowed'")).cnt;
    const maintenance   = (await dbGet("SELECT COUNT(*) as cnt FROM assets WHERE status='maintenance'")).cnt;
    const disposed      = (await dbGet("SELECT COUNT(*) as cnt FROM assets WHERE status='disposed'")).cnt;
    const totalAudits   = (await dbGet("SELECT COUNT(*) as cnt FROM audits"))?.cnt || 0;
    const totalBorrows  = (await dbGet("SELECT COUNT(*) as cnt FROM borrows"))?.cnt || 0;
    const totalMaint    = (await dbGet("SELECT COUNT(*) as cnt FROM maintenance"))?.cnt || 0;
    const recentAssets  = await dbAll("SELECT * FROM assets ORDER BY id DESC LIMIT 10");
    const categoryStats = await dbAll("SELECT category, COUNT(*) as cnt FROM assets WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY cnt DESC");

    // Real monthly trends (last 6 months)
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const label = d.toLocaleDateString('th-TH', { month: 'short' });
      const prefix = `${yyyy}-${mm}`;
      const borrowCnt = (await dbGet("SELECT COUNT(*) as cnt FROM borrows WHERE borrow_date LIKE ?", [`${prefix}%`]))?.cnt || 0;
      const maintCnt  = (await dbGet("SELECT COUNT(*) as cnt FROM maintenance WHERE start_date LIKE ?", [`${prefix}%`]))?.cnt || 0;
      months.push({ month: label, prefix, borrows: borrowCnt, maintenance: maintCnt });
    }

    return res.json({
      success: true,
      data: {
        totalAssets, activeAssets, borrowed, maintenance, disposed,
        totalAudits, totalBorrows, totalMaint,
        recentAssets: recentAssets.map(formatAssetOutput),
        categoryStats,
        monthlyTrends: months
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ============================================================
//  QR CODE
// ============================================================
app.get('/api/qr', (req, res) => {
  const id = req.query.id || 'A001';
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const qrData  = `${baseUrl}/asset-detail.html?id=${id}`;
  QRCode.toDataURL(qrData, { margin: 1, width: 200 }, (err, dataUrl) => {
    if (err) return res.status(500).send('QR generation failed');
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': img.length });
    res.end(img);
  });
});

// ============================================================
//  USERS MANAGEMENT
// ============================================================
app.get('/api/users', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
  try {
    const users = await dbAll('SELECT id,username,name,role,created_at FROM users');
    // แนบ oauth_accounts ให้แต่ละ user
    const result = users.map(u => {
      const linked = db.prepare('SELECT provider,email,display_name,linked_at FROM oauth_accounts WHERE user_id=?').all([u.id]);
      return { ...u, oauth_accounts: linked };
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

app.post('/api/users', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
  try {
    const { username, password, name, role } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน' });
    const existing = await dbGet('SELECT id FROM users WHERE username=?', [username]);
    if (existing) return res.status(409).json({ success: false, message: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
    const hash = crypto.createHash('sha256').update(String(password)).digest('hex');
    const result = await dbRun('INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)', [username, hash, name||'', role||'viewer']);
    return res.status(201).json({ success: true, data: { id: result.lastID, username, name: name||'', role: role||'viewer' } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// PUT /api/users/:id/role — admin เปลี่ยน role ผู้ใช้ (admin only)
app.put('/api/users/:id/role', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
  try {
    const targetId = parseInt(req.params.id);
    const { role } = req.body;
    if (!['admin', 'editor', 'viewer'].includes(role))
      return res.status(400).json({ success: false, message: 'Role ไม่ถูกต้อง (admin / editor / viewer)' });
    const target = await dbGet('SELECT id,username FROM users WHERE id=?', [targetId]);
    if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
    await dbRun('UPDATE users SET role=? WHERE id=?', [role, targetId]);
    // อัปเดต session ที่ยังค้างอยู่ด้วย
    await dbRun('UPDATE sessions SET role=? WHERE user_id=?', [role, targetId]);
    return res.json({ success: true, message: `เปลี่ยน role ของ ${target.username} เป็น ${role} แล้ว` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// DELETE /api/users/:id — admin ลบผู้ใช้ (admin only, ป้องกันลบตัวเอง)
app.delete('/api/users/:id', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
  try {
    const targetId = parseInt(req.params.id);
    if (sess.user_id === targetId)
      return res.status(400).json({ success: false, message: 'ไม่สามารถลบบัญชีของตัวเองได้' });
    const target = await dbGet('SELECT id FROM users WHERE id=?', [targetId]);
    if (!target) return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้' });
    await dbRun('DELETE FROM sessions WHERE user_id=?', [targetId]);
    await dbRun('DELETE FROM oauth_accounts WHERE user_id=?', [targetId]);
    await dbRun('DELETE FROM users WHERE id=?', [targetId]);
    return res.json({ success: true, message: 'ลบผู้ใช้เรียบร้อยแล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

app.put('/api/users/:id/password', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  const targetId = parseInt(req.params.id);
  if (sess.role !== 'admin' && sess.user_id !== targetId)
    return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสผ่านใหม่' });
    const hash = crypto.createHash('sha256').update(String(password)).digest('hex');
    await dbRun('UPDATE users SET password=? WHERE id=?', [hash, targetId]);
    return res.json({ success: true, message: 'เปลี่ยนรหัสผ่านแล้ว' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ============================================================
//  OAUTH — Google & Facebook Account Linking
//  (อ่านการตั้งค่าจาก oauth.config.js หรือ Environment Variables)
// ============================================================
let oauthConfig = {};
try {
  oauthConfig = require('./oauth.config.js');
} catch (e) {
  // หากไม่มีไฟล์ config ให้ใช้ default empty
}

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || oauthConfig.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || oauthConfig.GOOGLE_CLIENT_SECRET || '';
const FB_APP_ID            = process.env.FB_APP_ID            || oauthConfig.FB_APP_ID            || '';
const FB_APP_SECRET        = process.env.FB_APP_SECRET        || oauthConfig.FB_APP_SECRET        || '';
const OAUTH_BASE_URL       = process.env.OAUTH_BASE_URL       || oauthConfig.OAUTH_BASE_URL       || `http://127.0.0.1:${PORT}`;

// GET /api/auth/status — ตรวจสอบสถานะว่าระบบเปิดใช้ Google / Facebook หรือไม่
app.get('/api/auth/status', (_req, res) => {
  return res.json({
    success: true,
    providers: {
      google:   { enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) },
      facebook: { enabled: Boolean(FB_APP_ID && FB_APP_SECRET) }
    }
  });
});

// ── Google OAuth ─────────────────────────────────────────────
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID)
    return res.status(503).json({ success: false, message: 'Google OAuth ยังไม่ได้ตั้งค่า (โปรดใส่ GOOGLE_CLIENT_ID ใน oauth.config.js)' });
  const returnTo = req.query.return_to || '/account.html';
  const clientOrigin = req.query.client_origin || req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '');
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${OAUTH_BASE_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope:         'openid email profile',
    state:         Buffer.from(JSON.stringify({ token: req.query.token || '', returnTo, clientOrigin })).toString('base64')
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  let clientBase = '';
  try {
    const { code, state } = req.query;
    let stateObj = {};
    try { stateObj = JSON.parse(Buffer.from(state || '', 'base64').toString()); } catch {}
    const { token: sessToken, returnTo = '/account.html', clientOrigin = '' } = stateObj;
    clientBase = clientOrigin ? clientOrigin.replace(/\/+$/, '') : '';

    if (!GOOGLE_CLIENT_ID)
      return res.redirect(`${clientBase}/account.html?error=oauth_disabled`);
    if (!code) return res.redirect(`${clientBase}/account.html?error=no_code`);

    // แลก code -> access_token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${OAUTH_BASE_URL}/api/auth/google/callback`, grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect(`${clientBase}/account.html?error=token_failed`);

    // ดึงโปรไฟล์จาก Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();
    const { sub: provider_id, email, name: display_name } = profile;

    if (sessToken) {
      // โหมดเชื่อมต่อบัญชี — ผู้ใช้ล็อกอินอยู่แล้ว
      const sess = db.prepare('SELECT * FROM sessions WHERE token=?').get([sessToken]);
      if (sess && sess.expires_at > Date.now()) {
        const already = db.prepare('SELECT id FROM oauth_accounts WHERE provider=? AND provider_id=?').get(['google', provider_id]);
        if (!already) {
          db.prepare('INSERT OR IGNORE INTO oauth_accounts (user_id,provider,provider_id,email,display_name) VALUES (?,?,?,?,?)')
            .run([sess.user_id, 'google', provider_id, email||'', display_name||'']);
        }
        logAudit('LINK_OAUTH', 'user', sess.user_id, `เชื่อมต่อบัญชี Google: ${email || display_name}`, req, sess.name);
        const dest = returnTo.startsWith('http') ? returnTo : `${clientBase}${returnTo.startsWith('/') ? returnTo : '/' + returnTo}`;
        return res.redirect(`${dest}${dest.includes('?') ? '&' : '?'}linked=google`);
      }
    }

    // โหมดเข้าสู่ระบบ — หาผู้ใช้จาก oauth_accounts หรือสร้างบัญชีใหม่
    let oauthRow = db.prepare('SELECT * FROM oauth_accounts WHERE provider=? AND provider_id=?').get(['google', provider_id]);
    let userId;
    if (oauthRow) {
      userId = oauthRow.user_id;
    } else {
      const existingUser = db.prepare('SELECT id FROM users WHERE username=?').get([email]);
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const info = db.prepare('INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)')
          .run([email, '', display_name || email, 'viewer']);
        userId = info.lastInsertRowid;
      }
      db.prepare('INSERT OR IGNORE INTO oauth_accounts (user_id,provider,provider_id,email,display_name) VALUES (?,?,?,?,?)')
        .run([userId, 'google', provider_id, email||'', display_name||'']);
    }

    const user = db.prepare('SELECT * FROM users WHERE id=?').get([userId]);
    const newToken = generateToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    db.prepare('DELETE FROM sessions WHERE user_id=?').run([userId]);
    db.prepare('INSERT INTO sessions (token,user_id,username,name,role,expires_at) VALUES (?,?,?,?,?,?)')
      .run([newToken, userId, user.username, user.name, user.role, expiresAt]);

    logAudit('LOGIN_GOOGLE', 'user', user.username, `เข้าสู่ระบบด้วย Google: ${email || display_name}`, req, user.name);
    return res.redirect(`${clientBase}/dashboard.html?oauth_token=${newToken}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return res.redirect(`${clientBase}/index.html?error=oauth_failed`);
  }
});

// ── Facebook OAuth ───────────────────────────────────────────
app.get('/api/auth/facebook', (req, res) => {
  if (!FB_APP_ID)
    return res.status(503).json({ success: false, message: 'Facebook OAuth ยังไม่ได้ตั้งค่า (โปรดใส่ FB_APP_ID ใน oauth.config.js)' });
  const returnTo = req.query.return_to || '/account.html';
  const clientOrigin = req.query.client_origin || req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '');
  const params = new URLSearchParams({
    client_id:     FB_APP_ID,
    redirect_uri:  `${OAUTH_BASE_URL}/api/auth/facebook/callback`,
    scope:         'email,public_profile',
    state:         Buffer.from(JSON.stringify({ token: req.query.token || '', returnTo, clientOrigin })).toString('base64')
  });
  return res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
});

app.get('/api/auth/facebook/callback', async (req, res) => {
  let clientBase = '';
  try {
    const { code, state } = req.query;
    let stateObj = {};
    try { stateObj = JSON.parse(Buffer.from(state || '', 'base64').toString()); } catch {}
    const { token: sessToken, returnTo = '/account.html', clientOrigin = '' } = stateObj;
    clientBase = clientOrigin ? clientOrigin.replace(/\/+$/, '') : '';

    if (!FB_APP_ID)
      return res.redirect(`${clientBase}/account.html?error=oauth_disabled`);
    if (!code) return res.redirect(`${clientBase}/account.html?error=no_code`);

    // แลก code -> access_token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` + new URLSearchParams({
      client_id: FB_APP_ID,
      client_secret: FB_APP_SECRET,
      redirect_uri: `${OAUTH_BASE_URL}/api/auth/facebook/callback`,
      code
    });
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect(`${clientBase}/account.html?error=token_failed`);

    // ดึงโปรไฟล์ Facebook
    const profileUrl = `https://graph.facebook.com/me?fields=id,name,email&access_token=${tokenData.access_token}`;
    const profileRes = await fetch(profileUrl);
    const profile = await profileRes.json();
    const { id: provider_id, email = '', name: display_name = '' } = profile;

    if (sessToken) {
      // โหมดเชื่อมต่อบัญชี
      const sess = db.prepare('SELECT * FROM sessions WHERE token=?').get([sessToken]);
      if (sess && sess.expires_at > Date.now()) {
        const already = db.prepare('SELECT id FROM oauth_accounts WHERE provider=? AND provider_id=?').get(['facebook', provider_id]);
        if (!already) {
          db.prepare('INSERT OR IGNORE INTO oauth_accounts (user_id,provider,provider_id,email,display_name) VALUES (?,?,?,?,?)')
            .run([sess.user_id, 'facebook', provider_id, email, display_name]);
        }
        logAudit('LINK_OAUTH', 'user', sess.user_id, `เชื่อมต่อบัญชี Facebook: ${email || display_name}`, req, sess.name);
        const dest = returnTo.startsWith('http') ? returnTo : `${clientBase}${returnTo.startsWith('/') ? returnTo : '/' + returnTo}`;
        return res.redirect(`${dest}${dest.includes('?') ? '&' : '?'}linked=facebook`);
      }
    }

    // โหมดเข้าสู่ระบบ
    let oauthRow = db.prepare('SELECT * FROM oauth_accounts WHERE provider=? AND provider_id=?').get(['facebook', provider_id]);
    let userId;
    if (oauthRow) {
      userId = oauthRow.user_id;
    } else {
      const fallbackUser = email || `fb_${provider_id}`;
      const existingUser = db.prepare('SELECT id FROM users WHERE username=?').get([fallbackUser]);
      if (existingUser) {
        userId = existingUser.id;
      } else {
        const info = db.prepare('INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)')
          .run([fallbackUser, '', display_name || fallbackUser, 'viewer']);
        userId = info.lastInsertRowid;
      }
      db.prepare('INSERT OR IGNORE INTO oauth_accounts (user_id,provider,provider_id,email,display_name) VALUES (?,?,?,?,?)')
        .run([userId, 'facebook', provider_id, email, display_name]);
    }

    const user = db.prepare('SELECT * FROM users WHERE id=?').get([userId]);
    const newToken = generateToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    db.prepare('DELETE FROM sessions WHERE user_id=?').run([userId]);
    db.prepare('INSERT INTO sessions (token,user_id,username,name,role,expires_at) VALUES (?,?,?,?,?,?)')
      .run([newToken, userId, user.username, user.name, user.role, expiresAt]);

    logAudit('LOGIN_FACEBOOK', 'user', user.username, `เข้าสู่ระบบด้วย Facebook: ${email || display_name}`, req, user.name);
    return res.redirect(`${clientBase}/dashboard.html?oauth_token=${newToken}`);
  } catch (err) {
    console.error('Facebook OAuth callback error:', err);
    return res.redirect(`${clientBase}/index.html?error=oauth_failed`);
  }
});

// GET /api/me/linked-accounts — ดูบัญชีที่เชื่อมอยู่
app.get('/api/me/linked-accounts', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  try {
    const accounts = await dbAll('SELECT provider,email,display_name,linked_at FROM oauth_accounts WHERE user_id=?', [sess.user_id]);
    return res.json({ success: true, data: accounts });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// DELETE /api/auth/unlink/:provider — ยกเลิกการเชื่อมบัญชี
app.delete('/api/auth/unlink/:provider', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  try {
    const { provider } = req.params;
    await dbRun('DELETE FROM oauth_accounts WHERE user_id=? AND provider=?', [sess.user_id, provider]);
    return res.json({ success: true, message: `ยกเลิกการเชื่อมบัญชี ${provider} แล้ว` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ============================================================
//  AUDIT / EXPORT / BACKUP & RESTORE
// ============================================================

// GET /api/backup/download — ดาวน์โหลดไฟล์ฐานข้อมูล SQLite (.db) ฉบับสมบูรณ์
app.get('/api/backup/download', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  try {
    // Checkpoint WAL data into main database file before downloading
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { console.warn('WAL checkpoint notice:', e.message); }

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `assets-backup-${dateStr}.db`;

    logAudit('BACKUP_DB', 'database', 'assets.db', 'ดาวน์โหลดสำรองฐานข้อมูล SQLite (.db)', req, sess.name);
    return res.download(DB_PATH, filename);
  } catch (err) {
    console.error('Backup download error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดาวน์โหลดฐานข้อมูล' });
  }
});

// GET /api/backup/export-json — ส่งออกข้อมูลทั้งหมดเป็น JSON
app.get('/api/backup/export-json', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  try {
    const assets = (await dbAll('SELECT * FROM assets')).map(formatAssetOutput);
    const borrows = await dbAll('SELECT * FROM borrows');
    const maintenance = await dbAll('SELECT * FROM maintenance');
    const audits = await dbAll('SELECT * FROM audits');
    const audit_items = await dbAll('SELECT * FROM audit_items');
    const users = (await dbAll('SELECT id, username, name, role, created_at FROM users'));

    const exportData = {
      version: '3.4',
      exported_at: new Date().toISOString(),
      exported_by: sess.username,
      data: {
        assets,
        borrows,
        maintenance,
        audits,
        audit_items,
        users
      }
    };

    logAudit('BACKUP_JSON', 'database', 'all_tables', `ส่งออกข้อมูลสำรอง JSON (${assets.length} ทรัพย์สิน)`, req, sess.name);

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="asset-console-backup-${dateStr}.json"`);
    return res.send(JSON.stringify(exportData, null, 2));
  } catch (err) {
    console.error('Backup export JSON error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการส่งออก JSON' });
  }
});

// POST /api/backup/restore — กู้คืนฐานข้อมูลจากไฟล์ .db หรือ .json
app.post('/api/backup/restore', uploadMiddleware, async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  if (sess.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'สิทธิ์ไม่เพียงพอ (ต้องเป็น Admin เท่านั้นในการกู้คืนฐานข้อมูล)' });
  }

  const files = req.files || (req.file ? [req.file] : []);
  if (!files || files.length === 0) {
    return res.status(400).json({ success: false, message: 'ไม่พบไฟล์สำรองข้อมูลที่อัปโหลด' });
  }

  const uploaded = files[0];
  const originalName = uploaded.originalname || 'backup';
  const ext = path.extname(originalName).toLowerCase();

  try {
    if (ext === '.json') {
      // Restore from JSON export
      const content = uploaded.buffer.toString('utf8');
      const parsed = JSON.parse(content);
      const dataset = parsed.data || parsed;

      if (!dataset.assets && !dataset.borrows) {
        return res.status(400).json({ success: false, message: 'รูปแบบไฟล์ JSON สำรองข้อมูลไม่ถูกต้อง' });
      }

      // Safe transaction restore
      const restoreTx = db.transaction(() => {
        if (Array.isArray(dataset.assets)) {
          db.prepare('DELETE FROM assets').run();
          const insertAsset = db.prepare(`
            INSERT INTO assets (id, asset_code, name, serial_number, category, department, holder, received_date, status, notes, photos, image, created_at, updated_at)
            VALUES (@id, @asset_code, @name, @serial_number, @category, @department, @holder, @received_date, @status, @notes, @photos, @image, @created_at, @updated_at)
          `);
          for (const item of dataset.assets) {
            insertAsset.run({
              id: item.id || null,
              asset_code: item.asset_code,
              name: item.name || '',
              serial_number: item.serial_number || '',
              category: item.category || '',
              department: item.department || '',
              holder: item.holder || '',
              received_date: item.received_date || '',
              status: item.status || 'active',
              notes: item.notes || '',
              photos: typeof item.photos === 'string' ? item.photos : JSON.stringify(item.photos || []),
              image: item.image || '',
              created_at: item.created_at || new Date().toISOString(),
              updated_at: item.updated_at || new Date().toISOString()
            });
          }
        }

        if (Array.isArray(dataset.borrows)) {
          db.prepare('DELETE FROM borrows').run();
          const insertBorrow = db.prepare(`
            INSERT INTO borrows (id, asset_id, asset_code, borrower, department, borrow_date, due_date, return_date, status, notes, created_by, created_at)
            VALUES (@id, @asset_id, @asset_code, @borrower, @department, @borrow_date, @due_date, @return_date, @status, @notes, @created_by, @created_at)
          `);
          for (const item of dataset.borrows) {
            insertBorrow.run({
              id: item.id || null,
              asset_id: item.asset_id,
              asset_code: item.asset_code,
              borrower: item.borrower,
              department: item.department || '',
              borrow_date: item.borrow_date || '',
              due_date: item.due_date || '',
              return_date: item.return_date || '',
              status: item.status || 'borrowed',
              notes: item.notes || '',
              created_by: item.created_by || '',
              created_at: item.created_at || new Date().toISOString()
            });
          }
        }

        if (Array.isArray(dataset.maintenance)) {
          db.prepare('DELETE FROM maintenance').run();
          const insertMaint = db.prepare(`
            INSERT INTO maintenance (id, asset_id, asset_code, type, description, technician, cost, start_date, end_date, status, notes, created_at)
            VALUES (@id, @asset_id, @asset_code, @type, @description, @technician, @cost, @start_date, @end_date, @status, @notes, @created_at)
          `);
          for (const item of dataset.maintenance) {
            insertMaint.run({
              id: item.id || null,
              asset_id: item.asset_id,
              asset_code: item.asset_code,
              type: item.type || 'repair',
              description: item.description || '',
              technician: item.technician || '',
              cost: Number(item.cost) || 0,
              start_date: item.start_date || '',
              end_date: item.end_date || '',
              status: item.status || 'pending',
              notes: item.notes || '',
              created_at: item.created_at || new Date().toISOString()
            });
          }
        }
      });

      restoreTx();
      logAudit('RESTORE_DB', 'database', originalName, `กู้คืนข้อมูลสำเร็จจาก JSON (${originalName})`, req, sess.name);
      return res.json({ success: true, message: 'กู้คืนข้อมูลจากไฟล์ JSON สำเร็จเรียบร้อยแล้ว' });

    } else {
      // Restore from SQLite .db file
      if (uploaded.buffer.length < 16 || uploaded.buffer.slice(0, 15).toString() !== 'SQLite format 3') {
        return res.status(400).json({ success: false, message: 'ไฟล์ที่อัปโหลดไม่ใช่ไฟล์ SQLite Database (.db) ที่ถูกต้อง' });
      }

      // 1. Safety backup of current database
      const backupPath = `${DB_PATH}.bak-${Date.now()}`;
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        fs.copyFileSync(DB_PATH, backupPath);
      } catch (e) {
        console.warn('Backup safety copy notice:', e.message);
      }

      // 2. Close active db connection
      try { db.close(); } catch (e) {}

      // 3. Write new database file
      fs.writeFileSync(DB_PATH, uploaded.buffer);

      // Clean wal / shm files if present to prevent corrupt sync
      if (fs.existsSync(`${DB_PATH}-wal`)) try { fs.unlinkSync(`${DB_PATH}-wal`); } catch (e) {}
      if (fs.existsSync(`${DB_PATH}-shm`)) try { fs.unlinkSync(`${DB_PATH}-shm`); } catch (e) {}

      // 4. Reopen connection
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      logAudit('RESTORE_DB', 'database', originalName, `กู้คืนฐานข้อมูลสมบูรณ์จากไฟล์ .db (${originalName})`, req, sess.name);
      return res.json({ success: true, message: 'กู้คืนฐานข้อมูล SQLite (.db) สำเร็จเรียบร้อยแล้ว' });
    }
  } catch (err) {
    console.error('Restore error:', err);
    return res.status(500).json({ success: false, message: `เกิดข้อผิดพลาดในการกู้คืน: ${err.message}` });
  }
});

// GET /api/audit-logs — ดึงประวัติกิจกรรมและบันทึกการสำรองข้อมูล
app.get('/api/audit-logs', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const filterAction = req.query.action ? String(req.query.action) : null;

    let logs;
    if (filterAction) {
      logs = await dbAll('SELECT * FROM audit_logs WHERE action LIKE ? ORDER BY id DESC LIMIT ?', [`%${filterAction}%`, limit]);
    } else {
      logs = await dbAll('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
    }
    return res.json({ success: true, data: logs });
  } catch (err) {
    console.error('/api/audit-logs error:', err);
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการดึง Audit Logs' });
  }
});

// GET /api/audit (legacy compatibility)
app.get('/api/audit', async (req, res) => {
  const sess = await authenticate(req, res);
  if (!sess) return;
  try {
    const assets = (await dbAll('SELECT * FROM assets')).map(formatAssetOutput);
    const borrows = await dbAll('SELECT * FROM borrows');
    const maint   = await dbAll('SELECT * FROM maintenance');
    return res.json({ success: true, data: { assets, borrows, maintenance: maint, exported_at: new Date().toISOString() } });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
});

// ============================================================
//  START SERVER
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Asset Console Enterprise v3.4`);
  console.log(`   http://127.0.0.1:${PORT}`);
  console.log(`   Default login: admin / admin1234\n`);
});
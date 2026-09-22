// ============================================================
//  Asset Console Enterprise - OAuth Configuration (oauth.config.js)
//  ตั้งค่า Google OAuth 2.0 สำหรับการเข้าสู่ระบบ
//  - ตรวจสอบค่าจาก process.env หรือไฟล์ .env ก่อน
//  - หรือสามารถกรอกค่า Client ID และ Secret ลงในไฟล์นี้ได้โดยตรง
// ============================================================
const fs   = require('fs');
const path = require('path');

// ฟังก์ชันโหลดค่าจากไฟล์ .env อัตโนมัติ (Zero-dependency)
function readEnvFile() {
  const envVars = {};
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          envVars[key] = val;
          process.env[key] = val;
        }
      });
    } catch (_) {}
  }
  return envVars;
}

// โหลด Environment Variables ทันที
const initialEnv = readEnvFile();

const config = {
  // ── Google OAuth 2.0 ───────────────────────────────────────
  // รับค่าจาก https://console.cloud.google.com/apis/credentials
  // (เลือกสร้าง "OAuth client ID" -> "Web application")
  // ตรวจสอบค่าจาก process.env.GOOGLE_CLIENT_ID หรือระบุในไฟล์นี้ได้โดยตรง
  GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // URL สำหรับรับ Callback จาก Google
  // หากปล่อยว่างไว้ ระบบจะใช้ค่าเริ่มต้นอัตโนมัติตาม Host: http://{host}/api/auth/google/callback
  // หรือระบุ URL เต็มได้ที่นี่ (เช่น https://yourdomain.com/api/auth/google/callback)
  GOOGLE_CALLBACK_URL:  process.env.GOOGLE_CALLBACK_URL  || '',

  // โหมดทดสอบการล็อกอิน (สำหรับ Development / Testing เมื่อยังไม่ได้สร้าง Google Cloud Project)
  GOOGLE_MOCK_LOGIN:    process.env.GOOGLE_MOCK_LOGIN === 'true',

  // ── Facebook OAuth (ทางเลือกเสริม) ───────────────────────────
  FB_APP_ID:            process.env.FB_APP_ID            || '',
  FB_APP_SECRET:        process.env.FB_APP_SECRET        || '',

  // ── OAuth Base URL ─────────────────────────────────────────
  // โดเมนหลักของเซิร์ฟเวอร์ Backend สำหรับการ Redirect
  OAUTH_BASE_URL:       process.env.OAUTH_BASE_URL       || 'http://127.0.0.1:8080'
};

// ฟังก์ชันทำความสะอาดค่าตัวแปร (ตัด whitespace และเครื่องหมายคำพูดรอบนอกที่อาจติดมาจากการ Copy-Paste)
function cleanVal(v) {
  if (v === undefined || v === null) return '';
  let val = String(v).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

// ฟังก์ชันดึงค่าตัวแปรอย่างยืดหยุ่น โดยรองรับชื่อเรียกหลายแบบ (aliases)
function resolveKey(keys, fallbackVal = '', envVars = {}) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const k of keyList) {
    if (process.env[k] !== undefined && cleanVal(process.env[k]) !== '') {
      return cleanVal(process.env[k]);
    }
  }
  for (const k of keyList) {
    if (envVars[k] !== undefined && cleanVal(envVars[k]) !== '') {
      return cleanVal(envVars[k]);
    }
  }
  return cleanVal(fallbackVal);
}

// ปรับแต่ง Base URL ให้มีโปรโตคอล (http:// หรือ https://) เสมอ
function normalizeBaseUrl(rawUrl) {
  let url = cleanVal(rawUrl);
  if (!url) return 'http://127.0.0.1:8080';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
  }
  return url.replace(/\/+$/, '');
}

// ฟังก์ชันตรวจสอบความพร้อมและดึงค่า OAuth ที่ใช้งานล่าสุด
function getGoogleAuthStatus() {
  const env = readEnvFile();
  const clientId = resolveKey(['GOOGLE_CLIENT_ID', 'GOOGLE_ID', 'CLIENT_ID'], config.GOOGLE_CLIENT_ID, env);
  const clientSecret = resolveKey(['GOOGLE_CLIENT_SECRET', 'GOOGLE_SECRET', 'CLIENT_SECRET'], config.GOOGLE_CLIENT_SECRET, env);
  const isMock = resolveKey('GOOGLE_MOCK_LOGIN', config.GOOGLE_MOCK_LOGIN ? 'true' : '', env) === 'true';
  const rawBase = resolveKey(['OAUTH_BASE_URL', 'RENDER_EXTERNAL_URL', 'BASE_URL'], config.OAUTH_BASE_URL, env) || 'http://127.0.0.1:8080';
  const baseUrl = normalizeBaseUrl(rawBase);
  const callbackUrl = resolveKey(['GOOGLE_CALLBACK_URL', 'CALLBACK_URL'], config.GOOGLE_CALLBACK_URL, env);
  const redirectUri = callbackUrl || `${baseUrl}/api/auth/google/callback`;

  const isConfigured = Boolean(
    clientId &&
    clientSecret &&
    !clientId.includes('YOUR_GOOGLE_CLIENT_ID') &&
    !clientSecret.includes('YOUR_GOOGLE_CLIENT_SECRET')
  );

  return {
    isConfigured,
    isMock,
    clientId,
    clientSecret,
    callbackUrl,
    baseUrl,
    redirectUri,
    errorMessage: isConfigured ? null : (isMock ? 'Google OAuth เปิดใช้งานในโหมดทดสอบ (Mock Login)' : 'Google OAuth ยังไม่ได้ตั้งค่า Client ID & Secret ใน Environment Variables หรือไฟล์ .env')
  };
}

module.exports = {
  ...config,
  cleanVal,
  resolveKey,
  normalizeBaseUrl,
  readEnvFile,
  loadEnvFile: readEnvFile,
  getGoogleAuthStatus
};


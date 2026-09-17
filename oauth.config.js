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
  // หากปล่อยว่างไว้ ระบบจะใช้ค่าเริ่มต้น: ${OAUTH_BASE_URL}/api/auth/google/callback
  // หากใช้ Cloudflare Tunnel หรือ Cloud Server ให้ระบุ URL เต็มได้ที่นี่
  GOOGLE_CALLBACK_URL:  process.env.GOOGLE_CALLBACK_URL  || '',

  // ── Facebook OAuth (ทางเลือกเสริม) ───────────────────────────
  FB_APP_ID:            process.env.FB_APP_ID            || '',
  FB_APP_SECRET:        process.env.FB_APP_SECRET        || '',

  // ── OAuth Base URL ─────────────────────────────────────────
  // โดเมนหลักของเซิร์ฟเวอร์ Backend สำหรับการ Redirect
  OAUTH_BASE_URL:       process.env.OAUTH_BASE_URL       || 'http://127.0.0.1:8080'
};

// ฟังก์ชันตรวจสอบความพร้อมและดึงค่า OAuth ที่ใช้งานล่าสุด
function getGoogleAuthStatus() {
  const env = readEnvFile();
  const clientId = (process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || config.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || config.GOOGLE_CLIENT_SECRET || '').trim();
  const isConfigured = Boolean(
    clientId &&
    clientSecret &&
    !clientId.includes('YOUR_GOOGLE_CLIENT_ID') &&
    !clientSecret.includes('YOUR_GOOGLE_CLIENT_SECRET')
  );

  return {
    isConfigured,
    clientId,
    clientSecret,
    callbackUrl: (process.env.GOOGLE_CALLBACK_URL || env.GOOGLE_CALLBACK_URL || config.GOOGLE_CALLBACK_URL || '').trim(),
    baseUrl: (process.env.OAUTH_BASE_URL || env.OAUTH_BASE_URL || config.OAUTH_BASE_URL || 'http://127.0.0.1:8080').trim(),
    errorMessage: isConfigured ? null : 'Google OAuth ยังไม่ได้ตั้งค่า Client ID & Secret ใน oauth.config.js หรือไฟล์ .env'
  };
}

module.exports = {
  ...config,
  readEnvFile,
  loadEnvFile: readEnvFile,
  getGoogleAuthStatus
};


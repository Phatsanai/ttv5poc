// ============================================================
//  Asset Console Enterprise - OAuth Configuration
//  กรอก Client ID & Secret ของ Google และ Facebook ได้ที่ไฟล์นี้
//  หรือตั้งค่าผ่าน Environment Variables ได้เช่นกัน
// ============================================================

module.exports = {
  // Google OAuth (รับค่าจาก https://console.cloud.google.com)
  GOOGLE_CLIENT_ID:     process.env.GOOGLE_CLIENT_ID     || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // Facebook OAuth (รับค่าจาก https://developers.facebook.com)
  FB_APP_ID:            process.env.FB_APP_ID            || '',
  FB_APP_SECRET:        process.env.FB_APP_SECRET        || '',

  // Base URL สำหรับ Callback (ค่าเริ่มต้นรันที่ Localhost พอร์ต 8080)
  OAUTH_BASE_URL:       process.env.OAUTH_BASE_URL       || 'http://127.0.0.1:8080'
};

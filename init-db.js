// ============================================================
//  Asset Console - Database Initialization & Verification Script
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function getDbPath() {
  const configured = process.env.DB_PATH;
  const defaultPath = path.join(__dirname, 'assets.db');

  if (!configured || /^[zZ]:/i.test(configured.trim())) {
    return defaultPath;
  }

  return path.isAbsolute(configured) ? configured : path.resolve(__dirname, configured);
}

const dbPath = getDbPath();
console.log(`🔍 กำลังตรวจสอบฐานข้อมูลที่: ${dbPath}`);

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;
try {
  db = new Database(dbPath, { timeout: 15000 });
  console.log(`✅ เชื่อมต่อไฟล์ฐานข้อมูลสำเร็จ: ${dbPath}`);
} catch (err) {
  console.error(`❌ ไม่สามารถเปิดฐานข้อมูลที่ ${dbPath}:`, err.message);
  const fallback = path.join(__dirname, 'assets.db');
  console.log(`🔄 สลับมาใช้ default: ${fallback}`);
  db = new Database(fallback, { timeout: 15000 });
}

try {
  // Check tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  console.log(`📊 ตารางในฐานข้อมูล (${tables.length} ตาราง):`, tables.map(t => t.name).join(', '));
  
  if (tables.some(t => t.name === 'assets')) {
    const assetCount = db.prepare("SELECT count(*) as count FROM assets").get().count;
    console.log(`📦 จำนวนรายการครุภัณฑ์ในระบบ: ${assetCount} รายการ`);
  }
  if (tables.some(t => t.name === 'users')) {
    const userCount = db.prepare("SELECT count(*) as count FROM users").get().count;
    console.log(`👤 จำนวนผู้ใช้งานในระบบ: ${userCount} บัญชี`);
  }
} catch (err) {
  console.error('เกิดข้อผิดพลาดในการตรวจสอบข้อมูล:', err.message);
} finally {
  db.close();
  console.log('🔒 ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อย');
}

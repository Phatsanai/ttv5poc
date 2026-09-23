// ============================================================
//  Asset Console - Database Backup Script (backup-db.js)
//  สำรองข้อมูลไฟล์ assets.db ไปยังโฟลเดอร์ backup/ พร้อมระบุวันเวลา
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ฟังก์ชันโหลด Environment Variables จาก .env (ถ้ามี)
(function loadEnv() {
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
          if (!process.env[key] && val !== '') {
            process.env[key] = val;
          }
        }
      });
    } catch (_) {}
  }
})();

// ตรวจสอบและระบุตำแหน่งไฟล์ฐานข้อมูล
function getDbPath() {
  const configured = process.env.DB_PATH;
  const defaultPath = path.join(__dirname, 'assets.db');

  if (!configured || /^[zZ]:/i.test(configured.trim())) {
    return defaultPath;
  }

  return path.isAbsolute(configured) ? configured : path.resolve(__dirname, configured);
}

// จัดรูปแบบวันเวลาสำหรับตั้งชื่อไฟล์ เช่น 2026-09-23_13-30-45
function formatDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());
  return `${year}-${month}-${day}_${hours}-${mins}-${secs}`;
}

async function runBackup() {
  const srcDbPath = getDbPath();
  console.log(`📦 เริ่มกระบวนการสำรองฐานข้อมูล SQLite...`);
  console.log(`📍 ต้นทาง: ${srcDbPath}`);

  if (!fs.existsSync(srcDbPath)) {
    console.error(`❌ ไม่พบไฟล์ฐานข้อมูลต้นทางที่: ${srcDbPath}`);
    process.exit(1);
  }

  // สร้างโฟลเดอร์ backup ถ้ายังไม่มี
  const backupDir = path.join(__dirname, 'backup');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`📁 สร้างโฟลเดอร์สำรองข้อมูล: ${backupDir}`);
  }

  const timestamp = formatDateTime();
  const backupFileName = `assets-backup-${timestamp}.db`;
  const destDbPath = path.join(backupDir, backupFileName);

  let db;
  try {
    // เปิดการเชื่อมต่อเพื่อ Checkpoint ข้อมูล WAL ให้ไฟล์หลักสมบูรณ์ 100%
    db = new Database(srcDbPath, { timeout: 10000 });
    
    try {
      // Flush ข้อมูลจาก WAL (Write-Ahead Logging) ลงไฟล์หลัก
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch (_) {}

    // ใช้ SQLite Online Backup API ของ better-sqlite3 เพื่อความปลอดภัยสูงสุดแม้เซิร์ฟเวอร์กำลังเปิดอยู่
    if (typeof db.backup === 'function') {
      await db.backup(destDbPath);
    } else {
      // Fallback: หากไม่มีฟังก์ชัน backup ให้ copy ตรงๆ
      db.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(srcDbPath, destDbPath);
    }

    // ตรวจสอบความถูกต้องและสถิติข้อมูลของไฟล์ Backup
    const stats = fs.statSync(destDbPath);
    const sizeKB = (stats.size / 1024).toFixed(1);

    const backupDb = new Database(destDbPath);
    try {
      backupDb.pragma('wal_checkpoint(TRUNCATE)');
      backupDb.pragma('journal_mode = DELETE');
    } catch (_) {}
    const tables = backupDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    
    let assetCount = 0;
    let userCount = 0;
    try {
      if (tables.some(t => t.name === 'assets')) {
        assetCount = backupDb.prepare("SELECT count(*) as count FROM assets").get().count;
      }
      if (tables.some(t => t.name === 'users')) {
        userCount = backupDb.prepare("SELECT count(*) as count FROM users").get().count;
      }
    } catch (_) {}
    backupDb.close();

    // ล้างไฟล์ -shm / -wal ของไฟล์ backup หากมีหลงเหลือ เพื่อให้เหลือเพียงไฟล์ .db เดี่ยวๆ ที่สมบูรณ์
    const shmFile = `${destDbPath}-shm`;
    const walFile = `${destDbPath}-wal`;
    if (fs.existsSync(shmFile)) try { fs.unlinkSync(shmFile); } catch (_) {}
    if (fs.existsSync(walFile)) try { fs.unlinkSync(walFile); } catch (_) {}

    console.log(`\n✅ สำรองข้อมูลเสร็จสมบูรณ์!`);
    console.log(`📄 ชื่อไฟล์: ${backupFileName}`);
    console.log(`💾 ขนาดไฟล์: ${sizeKB} KB (${stats.size.toLocaleString()} bytes)`);
    console.log(`📂 ปลายทาง: ${destDbPath}`);
    console.log(`📊 ตรวจสอบข้อมูล: ${tables.length} ตาราง (${assetCount} รายการครุภัณฑ์, ${userCount} บัญชีผู้ใช้)`);
    
    // แสดงรายการไฟล์สำรองที่มีทั้งหมด
    const allBackups = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'));
    console.log(`\n🗄️ ไฟล์สำรองทั้งหมดในโฟลเดอร์ backup/ (${allBackups.length} ไฟล์):`);
    allBackups.slice(-5).forEach(f => {
      const fStat = fs.statSync(path.join(backupDir, f));
      console.log(`   - ${f} (${(fStat.size / 1024).toFixed(1)} KB)`);
    });
    if (allBackups.length > 5) {
      console.log(`   ...และอีก ${allBackups.length - 5} ไฟล์`);
    }

  } catch (err) {
    console.error(`❌ เกิดข้อผิดพลาดในการสำรองฐานข้อมูล:`, err.message);
    process.exit(1);
  } finally {
    if (db) {
      try { db.close(); } catch (_) {}
    }
  }
}

runBackup();

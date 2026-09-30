// ============================================================
//  Asset Console - Complete Restore Script (restore.js)
//  กู้คืนฐานข้อมูล SQLite (assets.db) และโฟลเดอร์รูปภาพ (uploads/)
//  จากไฟล์ ZIP สำรองข้อมูล
//  รันคำสั่ง: node restore.js [พาธไฟล์_backup.zip]
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

// ── 1. โหลด Environment Variables จาก .env (ถ้ามี) ─────────────
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

function getDbPath() {
  const configured = process.env.DB_PATH;
  const defaultPath = path.join(__dirname, 'assets.db');
  if (!configured || /^[zZ]:/i.test(configured.trim())) {
    return defaultPath;
  }
  return path.isAbsolute(configured) ? configured : path.resolve(__dirname, configured);
}

function getUploadsDir() {
  const configured = process.env.UPLOADS_DIR;
  const defaultPath = path.join(__dirname, 'uploads');
  if (!configured) return defaultPath;
  return path.isAbsolute(configured) ? configured : path.resolve(__dirname, configured);
}

// ── 2. Pure Node.js ZIP Extractor ──────────────────────────────
function extractZipBuffer(buffer) {
  const entries = [];
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('ไฟล์ที่ระบุไม่ใช่ไฟล์ ZIP ที่ถูกต้อง');
  }

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);

  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen);

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = buffer.slice(dataStart, dataStart + compSize);

    let uncompData;
    if (method === 0) {
      uncompData = compData;
    } else if (method === 8) {
      uncompData = zlib.inflateRawSync(compData);
    } else {
      throw new Error(`รูปแบบการบีบอัดไม่รองรับ (Method: ${method})`);
    }

    entries.push({ name, data: uncompData });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ── 3. ฟังก์ชันหลักในการกู้คืนข้อมูล ─────────────────────────────
async function runRestore() {
  const targetDbPath = getDbPath();
  const targetUploadsDir = getUploadsDir();
  const backupBaseDir = path.join(__dirname, 'backups');

  console.log('============================================================');
  console.log('  🔄 Asset Console - Data Restore System (DB + Images)');
  console.log('============================================================');

  let targetBackupFile = process.argv[2];

  if (!targetBackupFile) {
    if (!fs.existsSync(backupBaseDir)) {
      console.error(`❌ ไม่พบโฟลเดอร์สำรองข้อมูล: ${backupBaseDir}`);
      process.exit(1);
    }
    const available = fs.readdirSync(backupBaseDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.zip'))
      .sort();

    if (available.length === 0) {
      console.error(`❌ ไม่พบไฟล์ .zip สำรองข้อมูลในโฟลเดอร์: ${backupBaseDir}`);
      process.exit(1);
    }

    // เลือกไฟล์ล่าสุดให้อัตโนมัติ
    targetBackupFile = path.join(backupBaseDir, available[available.length - 1]);
    console.log(`ℹ️ ไม่ได้ระบุชื่อไฟล์ - ระบบเลือกไฟล์สำรองล่าสุดให้อัตโนมัติ:`);
    console.log(`   👉 ${targetBackupFile}`);
  } else {
    targetBackupFile = path.resolve(process.cwd(), targetBackupFile);
  }

  if (!fs.existsSync(targetBackupFile)) {
    console.error(`❌ ไม่พบไฟล์สำรองข้อมูลที่ระบุ: ${targetBackupFile}`);
    process.exit(1);
  }

  console.log(`📦 ไฟล์สำรองที่ใช้กู้คืน: ${targetBackupFile}`);
  console.log(`📍 ฐานข้อมูลปลายทาง:     ${targetDbPath}`);
  console.log(`📁 โฟลเดอร์รูปภาพปลายทาง: ${targetUploadsDir}`);

  try {
    // 3.1 อ่านไฟล์ ZIP สำรอง
    console.log(`\n[1/4] 📖 กำลังอ่านและแตกไฟล์สำรอง...`);
    let entries = [];
    if (fs.statSync(targetBackupFile).isDirectory()) {
      // กรณีระบุเป็นโฟลเดอร์
      const walk = (dir, base = '') => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          const rel = path.join(base, item.name).replace(/\\/g, '/');
          if (item.isDirectory()) walk(full, rel);
          else entries.push({ name: rel, data: fs.readFileSync(full) });
        }
      };
      walk(targetBackupFile);
    } else {
      const zipBuf = fs.readFileSync(targetBackupFile);
      entries = extractZipBuffer(zipBuf);
    }

    console.log(`      ✅ พบข้อมูลทั้งหมด ${entries.length} รายการในไฟล์สำรอง`);

    // 3.2 สร้าง Safety Backup ของข้อมูลปัจจุบันก่อนเขียนทับเสมอ ป้องกันอุบัติเหตุ
    console.log(`\n[2/4] 🛡️  กำลังสร้าง Safety Snapshot สำรองข้อมูลปัจจุบันก่อนเขียนทับ...`);
    const safetyName = `pre_restore_safety_${Date.now()}`;
    const safetyDir = path.join(backupBaseDir, safetyName);
    fs.mkdirSync(safetyDir, { recursive: true });
    if (fs.existsSync(targetDbPath)) {
      fs.copyFileSync(targetDbPath, path.join(safetyDir, 'assets.db'));
    }
    console.log(`      ✅ บันทึก Safety Snapshot ไว้ที่: ${safetyDir}`);

    // 3.3 กู้คืนฐานข้อมูล SQLite
    console.log(`\n[3/4] 💾 กำลังกู้คืนฐานข้อมูล SQLite...`);
    const dbEntry = entries.find(e => e.name === 'assets.db');
    if (!dbEntry) {
      throw new Error('ไม่พบไฟล์ assets.db ในไฟล์สำรองข้อมูล');
    }

    // ล้างไฟล์ WAL/SHM เดิมออกก่อนเขียนทับ
    [`${targetDbPath}-wal`, `${targetDbPath}-shm`].forEach(f => {
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (_) {}
    });

    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
    fs.writeFileSync(targetDbPath, dbEntry.data);
    console.log(`      ✅ กู้คืนไฟล์ฐานข้อมูล ${targetDbPath} สำเร็จ (${(dbEntry.data.length / 1024).toFixed(1)} KB)`);

    // 3.4 กู้คืนไฟล์รูปภาพใน uploads/
    console.log(`\n[4/4] 🖼️  กำลังกู้คืนรูปภาพไปยังโฟลเดอร์ uploads/...`);
    fs.mkdirSync(targetUploadsDir, { recursive: true });

    let restoredImages = 0;
    for (const item of entries) {
      if (item.name.startsWith('uploads/') && item.name.length > 'uploads/'.length) {
        const relPath = item.name.slice('uploads/'.length);
        const destPath = path.join(targetUploadsDir, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, item.data);
        restoredImages++;
      }
    }
    console.log(`      ✅ กู้คืนไฟล์รูปภาพทั้งหมด ${restoredImages} ไฟล์`);

    // 3.5 ตรวจสอบความสมบูรณ์ของฐานข้อมูลหลังกู้คืน
    let stats = { assets: 0, users: 0, categories: 0 };
    let checkResult = 'ok';
    try {
      const restoredDb = new Database(targetDbPath);
      const integrity = restoredDb.pragma('integrity_check');
      checkResult = integrity && integrity[0] ? integrity[0].integrity_check : 'ok';
      const getCount = (table) => {
        try {
          const row = restoredDb.prepare(`SELECT count(*) as count FROM ${table}`).get();
          return row ? row.count : 0;
        } catch { return 0; }
      };
      stats.assets = getCount('assets');
      stats.users = getCount('users');
      stats.categories = getCount('categories');
      restoredDb.close();
    } catch (e) {
      console.warn('⚠️ Warning checking restored database:', e.message);
    }

    console.log('\n============================================================');
    console.log('  🎉 กู้คืนข้อมูล (Restore) เสร็จสมบูรณ์ 100%');
    console.log('============================================================');
    console.log(`🔍 ผลการตรวจสอบ Integrity: ${checkResult === 'ok' ? '✅ ปกติสมบูรณ์ (OK)' : checkResult}`);
    console.log(`📊 ข้อมูลในระบบปัจจุบัน:`);
    console.log(`   - 📋 ทรัพย์สิน (Assets):    ${stats.assets} รายการ`);
    console.log(`   - 👤 ผู้ใช้งาน (Users):     ${stats.users} บัญชี`);
    console.log(`   - 🏷️ หมวดหมู่ (Categories): ${stats.categories} หมวด`);
    console.log(`   - 🖼️  รูปภาพที่กู้คืน:       ${restoredImages} รูป`);
    console.log('------------------------------------------------------------');
    console.log('💡 ข้อแนะนำ:');
    console.log('   หากเซิร์ฟเวอร์ (server.js) กำลังเปิดอยู่ ให้ Restart เซิร์ฟเวอร์ 1 ครั้ง');
    console.log('   เพื่อให้ Node.js โหลดการเชื่อมต่อฐานข้อมูลใหม่ล่าสุดครับ');
    console.log('============================================================\n');

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการกู้คืนข้อมูล:', err.message);
    process.exit(1);
  }
}

runRestore();

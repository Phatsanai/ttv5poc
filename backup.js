// ============================================================
//  Asset Console - Complete Backup Script (backup.js)
//  สำรองข้อมูลฐานข้อมูล SQLite (assets.db) + โฟลเดอร์รูปภาพ (uploads/)
//  รวมเป็นไฟล์ ZIP พร้อมระบุวันเวลา (Timestamp) อัตโนมัติ
//  รันคำสั่ง: node backup.js หรือ npm run backup
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

// ── 2. กำหนดตำแหน่งไฟล์และโฟลเดอร์ ──────────────────────────────
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

// ── 3. Pure Node.js ZIP Generator (ไม่ต้องพึ่งโมดูลภายนอก) ────────
function createZipBuffer(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const item of entries) {
    const nameBuf = Buffer.from(item.name.replace(/\\/g, '/'), 'utf8');
    const dataBuf = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data, 'utf8');
    
    // Deflate raw compression
    const compBuf = zlib.deflateRawSync(dataBuf);
    const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(dataBuf) : computeCrc32(dataBuf);

    // Current MS-DOS Date and Time
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    // 3.1 Local File Header (30 bytes + name length)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // Local header signature
    local.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6);      // General purpose bit flag (UTF-8)
    local.writeUInt16LE(8, 8);          // Compression method (8 = Deflate)
    local.writeUInt16LE(dosTime, 10);    // Last mod file time
    local.writeUInt16LE(dosDate, 12);    // Last mod file date
    local.writeUInt32LE(crc >>> 0, 14);  // CRC-32
    local.writeUInt32LE(compBuf.length, 18); // Compressed size
    local.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // File name length
    local.writeUInt16LE(0, 28);         // Extra field length
    nameBuf.copy(local, 30);

    parts.push(local, compBuf);

    // 3.2 Central Directory Header (46 bytes + name length)
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // Central directory signature
    cd.writeUInt16LE(20, 4);        // Version made by
    cd.writeUInt16LE(20, 6);        // Version needed
    cd.writeUInt16LE(0x0800, 8);     // Bit flag (UTF-8)
    cd.writeUInt16LE(8, 10);        // Compression (Deflate)
    cd.writeUInt16LE(dosTime, 12);   // Time
    cd.writeUInt16LE(dosDate, 14);   // Date
    cd.writeUInt32LE(crc >>> 0, 16); // CRC-32
    cd.writeUInt32LE(compBuf.length, 20); // Compressed size
    cd.writeUInt32LE(dataBuf.length, 24); // Uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28); // File name length
    cd.writeUInt16LE(0, 30);        // Extra field length
    cd.writeUInt16LE(0, 32);        // Comment length
    cd.writeUInt16LE(0, 34);        // Disk number start
    cd.writeUInt16LE(0, 36);        // Internal file attributes
    cd.writeUInt32LE(0, 38);        // External file attributes
    cd.writeUInt32LE(offset, 42);   // Relative offset of local header
    nameBuf.copy(cd, 46);

    central.push(cd);
    offset += local.length + compBuf.length;
  }

  const centralBuf = Buffer.concat(central);

  // 3.3 End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature
  eocd.writeUInt16LE(0, 4);          // Disk number
  eocd.writeUInt16LE(0, 6);          // Disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // Number of entries on disk
  eocd.writeUInt16LE(entries.length, 10); // Total number of entries
  eocd.writeUInt32LE(centralBuf.length, 12); // Central dir size
  eocd.writeUInt32LE(offset, 16);    // Central dir offset
  eocd.writeUInt16LE(0, 20);         // Comment length

  return Buffer.concat([...parts, centralBuf, eocd]);
}

// Fallback CRC32 หากรันบน Node รุ่นเก่ากว่า v18
function computeCrc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (~crc) >>> 0;
}
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

// ── 4. ฟังก์ชันหลักในการสำรองข้อมูล ─────────────────────────────
async function runFullBackup() {
  const timestamp = formatDateTime();
  const srcDbPath = getDbPath();
  const uploadsDir = getUploadsDir();
  const backupBaseDir = path.join(__dirname, 'backups');

  console.log('============================================================');
  console.log('  📦 Asset Console - Full Backup System (DB + Images)');
  console.log('============================================================');
  console.log(`⏰ เวลาสำรองข้อมูล: ${new Date().toLocaleString('th-TH')}`);
  console.log(`📍 ฐานข้อมูลต้นทาง: ${srcDbPath}`);
  console.log(`📁 โฟลเดอร์รูปภาพ:  ${uploadsDir}`);

  if (!fs.existsSync(srcDbPath)) {
    console.error(`❌ ไม่พบไฟล์ฐานข้อมูลที่: ${srcDbPath}`);
    process.exit(1);
  }

  // สร้างโฟลเดอร์ backups/ ถ้ายังไม่มี
  if (!fs.existsSync(backupBaseDir)) {
    fs.mkdirSync(backupBaseDir, { recursive: true });
  }

  // สร้างโฟลเดอร์สำรองข้อมูลประจำรอบนี้ backups/YYYY-MM-DD_HH-mm-ss/
  const currentBackupFolder = path.join(backupBaseDir, `backup_${timestamp}`);
  fs.mkdirSync(currentBackupFolder, { recursive: true });

  const tempDbSnapshot = path.join(currentBackupFolder, 'assets.db');
  let db = null;
  let stats = {
    assets: 0,
    users: 0,
    categories: 0,
    borrows: 0,
    maintenance: 0,
    auditLogs: 0
  };

  const filesForZip = [];

  try {
    // 4.1 สแนปช็อตฐานข้อมูล SQLite ผ่าน Online Backup API ปลอดภัยแม้เซิร์ฟเวอร์รันอยู่
    console.log(`\n[1/3] 💾 กำลังสำรองฐานข้อมูล SQLite...`);
    db = new Database(srcDbPath, { timeout: 15000 });

    try {
      db.pragma('wal_checkpoint(PASSIVE)');
    } catch (_) {}

    if (typeof db.backup === 'function') {
      await db.backup(tempDbSnapshot);
    } else {
      db.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(srcDbPath, tempDbSnapshot);
    }

    // ตรวจสอบข้อมูลใน Snapshot
    const backupDb = new Database(tempDbSnapshot);
    try {
      backupDb.pragma('wal_checkpoint(TRUNCATE)');
      backupDb.pragma('journal_mode = DELETE');
      const getCount = (table) => {
        try {
          const row = backupDb.prepare(`SELECT count(*) as count FROM ${table}`).get();
          return row ? row.count : 0;
        } catch { return 0; }
      };
      stats.assets = getCount('assets');
      stats.users = getCount('users');
      stats.categories = getCount('categories');
      stats.borrows = getCount('borrows');
      stats.maintenance = getCount('maintenance');
      stats.auditLogs = getCount('audit_logs');
    } catch (dbErr) {
      console.warn('⚠️ Warning checking snapshot stats:', dbErr.message);
    } finally {
      backupDb.close();
    }

    // ล้างไฟล์ -wal / -shm ที่อาจเกิดขึ้นในโฟลเดอร์สำรอง
    ['assets.db-wal', 'assets.db-shm'].forEach(extra => {
      const p = path.join(currentBackupFolder, extra);
      if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch (_) {}
    });

    const dbBuffer = fs.readFileSync(tempDbSnapshot);
    filesForZip.push({ name: 'assets.db', data: dbBuffer });
    console.log(`      ✅ สำรอง SQLite สำเร็จ (${(dbBuffer.length / 1024).toFixed(1)} KB)`);

    // 4.2 สำรองโฟลเดอร์รูปภาพ uploads/
    console.log(`\n[2/3] 🖼️  กำลังสำรองไฟล์รูปภาพจากโฟลเดอร์ uploads/...`);
    let imageCount = 0;
    let totalImageSize = 0;

    const currentUploadsFolder = path.join(currentBackupFolder, 'uploads');
    fs.mkdirSync(currentUploadsFolder, { recursive: true });

    if (fs.existsSync(uploadsDir)) {
      const walkDir = (dir, relDir = '') => {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          const relPath = path.join(relDir, item.name);
          if (item.isDirectory()) {
            walkDir(fullPath, relPath);
          } else if (item.isFile()) {
            const fileData = fs.readFileSync(fullPath);
            const zipEntryName = `uploads/${relPath.replace(/\\/g, '/')}`;
            filesForZip.push({ name: zipEntryName, data: fileData });
            
            // คัดลอกลงโฟลเดอร์สำรองแยกด้วย
            const destFilePath = path.join(currentUploadsFolder, relPath);
            fs.mkdirSync(path.dirname(destFilePath), { recursive: true });
            fs.copyFileSync(fullPath, destFilePath);

            imageCount++;
            totalImageSize += fileData.length;
          }
        }
      };
      walkDir(uploadsDir);
    }
    console.log(`      ✅ สำรองรูปภาพ ${imageCount} ไฟล์ (${(totalImageSize / 1024).toFixed(1)} KB)`);

    // 4.3 สร้าง metadata.json บันทึกรายละเอียดการสำรอง
    const metadata = {
      backup_name: `backup_${timestamp}`,
      created_at: new Date().toISOString(),
      timestamp,
      system: 'Asset Console Enterprise',
      version: '3.4.0',
      database: {
        file: 'assets.db',
        size_bytes: dbBuffer.length,
        size_kb: (dbBuffer.length / 1024).toFixed(1),
        records: stats
      },
      uploads: {
        total_files: imageCount,
        total_bytes: totalImageSize,
        size_kb: (totalImageSize / 1024).toFixed(1)
      },
      files: filesForZip.map(f => f.name)
    };

    const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2), 'utf8');
    fs.writeFileSync(path.join(currentBackupFolder, 'metadata.json'), metaBuffer);
    filesForZip.push({ name: 'metadata.json', data: metaBuffer });

    // 4.4 บีบอัดเป็นไฟล์ ZIP
    console.log(`\n[3/3] 🗜️  กำลังบีบอัดไฟล์ ZIP...`);
    const zipBuffer = createZipBuffer(filesForZip);
    const zipFileName = `backup_${timestamp}.zip`;
    const zipFilePath = path.join(backupBaseDir, zipFileName);
    fs.writeFileSync(zipFilePath, zipBuffer);

    const zipStat = fs.statSync(zipFilePath);
    const zipSizeKB = (zipStat.size / 1024).toFixed(1);

    // 4.5 ทำความสะอาดและจำกัดจำนวนไฟล์สำรองเก่า (เก็บ 10 ชุดล่าสุด)
    const MAX_KEEP = parseInt(process.env.KEEP_BACKUPS || '10', 10);
    const allZipBackups = fs.readdirSync(backupBaseDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.zip'))
      .sort();

    if (allZipBackups.length > MAX_KEEP) {
      const toDelete = allZipBackups.slice(0, allZipBackups.length - MAX_KEEP);
      for (const oldZip of toDelete) {
        try {
          fs.unlinkSync(path.join(backupBaseDir, oldZip));
          const oldFolder = path.join(backupBaseDir, oldZip.replace('.zip', ''));
          if (fs.existsSync(oldFolder)) {
            fs.rmSync(oldFolder, { recursive: true, force: true });
          }
        } catch (_) {}
      }
    }

    console.log('\n============================================================');
    console.log('  🎉 สำรองข้อมูลเสร็จสมบูรณ์เรียบร้อย 100%');
    console.log('============================================================');
    console.log(`📦 ไฟล์ ZIP:      ${zipFilePath}`);
    console.log(`📁 โฟลเดอร์สำรอง: ${currentBackupFolder}`);
    console.log(`💾 ขนาดไฟล์ ZIP:  ${zipSizeKB} KB (${zipStat.size.toLocaleString()} bytes)`);
    console.log(`📊 สถิติข้อมูลที่สำรอง:`);
    console.log(`   - 📋 ทรัพย์สิน (Assets):    ${stats.assets} รายการ`);
    console.log(`   - 👤 ผู้ใช้งาน (Users):     ${stats.users} บัญชี`);
    console.log(`   - 🏷️ หมวดหมู่ (Categories): ${stats.categories} หมวด`);
    console.log(`   - 🔄 รายการยืม-คืน:         ${stats.borrows} รายการ`);
    console.log(`   - 🛠️ รายการแจ้งซ่อม:       ${stats.maintenance} รายการ`);
    console.log(`   - 📝 ประวัติการทำงาน:      ${stats.auditLogs} รายการ`);
    console.log(`   - 🖼️  รูปภาพทั้งหมด:        ${imageCount} รูป`);
    console.log('------------------------------------------------------------');
    console.log('💡 วิธีการกู้คืนข้อมูล (Restore):');
    console.log(`   รันคำสั่ง: node restore.js backups/${zipFileName}`);
    console.log('============================================================\n');

  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดขณะทำการสำรองข้อมูล:', err);
    process.exit(1);
  } finally {
    if (db) {
      try { db.close(); } catch (_) {}
    }
  }
}

runFullBackup();

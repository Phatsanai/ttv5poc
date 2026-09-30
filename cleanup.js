// ============================================================
//  Asset Console - Safe Repository Cleanup Script (cleanup.js)
//  ตรวจสอบและทำความสะอาดไฟล์/โฟลเดอร์ขยะในโปรเจกต์อย่างปลอดภัย
//  - ตรวจสอบโฟลเดอร์ซ้ำซ้อน: ttv5poc/
//  - ตรวจสอบโฟลเดอร์ชั่วคราว: scratch/
//  - ตรวจสอบไฟล์รูปภาพกำพร้าใน uploads/ ที่ไม่มีใน SQLite DB
//  - ปรับปรุง .gitignore
//  
//  การใช้งาน:
//    node cleanup.js            (สแกน แสดงรายการ และถามยืนยันก่อนลบ)
//    node cleanup.js --dry-run  (ตรวจสอบอย่างเดียว ไม่มีการลบข้อมูลใดๆ)
//    node cleanup.js --force    (ลบทันทีโดยไม่ต้องถามยืนยัน)
// ============================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isForce = args.includes('--force') || args.includes('-y');

// ตำแหน่งไฟล์และโฟลเดอร์เป้าหมาย
const ROOT_DIR = __dirname;
const TTV5POC_DIR = path.join(ROOT_DIR, 'ttv5poc');
const SCRATCH_DIR = path.join(ROOT_DIR, 'scratch');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const DB_PATH = path.join(ROOT_DIR, 'assets.db');
const GITIGNORE_PATH = path.join(ROOT_DIR, '.gitignore');

// ฟังก์ชันคำนวณขนาดและนับจำนวนไฟล์ในโฟลเดอร์แบบ Recursive
function getDirectoryStats(dirPath) {
  let totalBytes = 0;
  let fileCount = 0;
  if (!fs.existsSync(dirPath)) return { exists: false, totalBytes: 0, fileCount: 0 };

  function scan(currentPath) {
    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(currentPath, item.name);
        if (item.isDirectory()) {
          scan(fullPath);
        } else if (item.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            totalBytes += stat.size;
            fileCount++;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  scan(dirPath);
  return { exists: true, totalBytes, fileCount };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// ── 1. ตรวจสอบไฟล์รูปภาพกำพร้า (Orphaned Images ใน uploads/) ──
function scanOrphanImages() {
  const orphans = [];
  if (!fs.existsSync(UPLOADS_DIR) || !fs.existsSync(DB_PATH)) {
    return orphans;
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true, timeout: 5000 });

    const usedFiles = new Set();
    const rows = db.prepare('SELECT photos, image FROM assets').all();
    for (const row of rows) {
      if (row.image) usedFiles.add(path.basename(row.image).trim());
      try {
        const parsed = JSON.parse(row.photos || '[]');
        if (Array.isArray(parsed)) {
          parsed.forEach(p => {
            if (p) usedFiles.add(path.basename(p).trim());
          });
        }
      } catch (_) {}
    }
    db.close();

    const uploadFiles = fs.readdirSync(UPLOADS_DIR);
    for (const file of uploadFiles) {
      const filePath = path.join(UPLOADS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && !usedFiles.has(file)) {
          orphans.push({ name: file, path: filePath, size: stat.size });
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('⚠️ ไม่สามารถตรวจสอบรูปภาพกำพร้ากับฐานข้อมูลได้:', err.message);
  }

  return orphans;
}

// ── 2. ตรวจสอบและอัปเดตไฟล์ .gitignore ──────────────────────────
function checkGitignore() {
  if (!fs.existsSync(GITIGNORE_PATH)) return { needed: false, missingRules: [] };
  const content = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  const neededRules = [
    'ttv5poc/',
    'scratch/',
    'assets.db-wal',
    'assets.db-shm'
  ];

  const missing = [];
  for (const rule of neededRules) {
    const escaped = rule.replace('/', '\\/').replace('.', '\\.');
    const regex = new RegExp(`^\\s*${escaped}\\s*$`, 'm');
    if (!regex.test(content)) {
      missing.push(rule);
    }
  }
  return { needed: missing.length > 0, missingRules: missing };
}

function updateGitignore(missingRules) {
  if (!missingRules || missingRules.length === 0) return;
  let content = fs.readFileSync(GITIGNORE_PATH, 'utf8');

  // ปลดคอมเมนต์บรรทัด assets.db-wal / assets.db-shm ถ้ามีอยู่แล้ว
  content = content.replace(/^#\s*(assets\.db-wal)/m, '$1');
  content = content.replace(/^#\s*(assets\.db-shm)/m, '$1');

  const additions = [];
  if (!content.includes('ttv5poc/')) additions.push('ttv5poc/');
  if (!content.includes('scratch/')) additions.push('scratch/');
  if (!/^assets\.db-wal/m.test(content)) additions.push('assets.db-wal');
  if (!/^assets\.db-shm/m.test(content)) additions.push('assets.db-shm');

  if (additions.length > 0) {
    content = content.trimEnd() + '\n\n# Temporary & Duplicate Workspaces\n' + additions.join('\n') + '\n';
  }

  fs.writeFileSync(GITIGNORE_PATH, content, 'utf8');
  console.log('   ✅ อัปเดต .gitignore เรียบร้อยแล้ว (เพิ่ม ttv5poc/, scratch/, assets.db-wal, assets.db-shm)');
}

// ── 3. ขั้นตอนการตรวจสอบและแสดงผลรายงาน (Report) ───────────────
async function runCleanup() {
  console.log('\n======================================================');
  console.log('   🧹 Asset Console - Repository Cleanup Utility');
  console.log('======================================================');

  // ตรวจสอบโฟลเดอร์ซ้ำซ้อน
  const ttvStats = getDirectoryStats(TTV5POC_DIR);
  const scratchStats = getDirectoryStats(SCRATCH_DIR);
  const orphanImages = scanOrphanImages();
  const gitignoreStatus = checkGitignore();

  let totalReclaimableBytes = 0;
  if (ttvStats.exists) totalReclaimableBytes += ttvStats.totalBytes;
  if (scratchStats.exists) totalReclaimableBytes += scratchStats.totalBytes;
  orphanImages.forEach(img => totalReclaimableBytes += img.size);

  console.log('\n📋 สรุปรายการไฟล์และโฟลเดอร์ที่ตรวจพบ:');
  console.log('------------------------------------------------------');

  if (ttvStats.exists) {
    console.log(` 1. [โฟลเดอร์ซ้ำซ้อน] ttv5poc/`);
    console.log(`    - ตำแหน่ง: ${TTV5POC_DIR}`);
    console.log(`    - จำนวน: ${ttvStats.fileCount.toLocaleString()} ไฟล์ | ขนาดรวม: ${formatBytes(ttvStats.totalBytes)}`);
  } else {
    console.log(` 1. [โฟลเดอร์ซ้ำซ้อน] ttv5poc/ -> สะอาด (ไม่พบโฟลเดอร์นี้)`);
  }

  if (scratchStats.exists) {
    console.log(` 2. [โฟลเดอร์ทดสอบชั่วคราว] scratch/`);
    console.log(`    - ตำแหน่ง: ${SCRATCH_DIR}`);
    console.log(`    - จำนวน: ${scratchStats.fileCount.toLocaleString()} ไฟล์ | ขนาดรวม: ${formatBytes(scratchStats.totalBytes)}`);
  } else {
    console.log(` 2. [โฟลเดอร์ทดสอบชั่วคราว] scratch/ -> สะอาด (ไม่พบโฟลเดอร์นี้)`);
  }

  if (orphanImages.length > 0) {
    const orphanSize = orphanImages.reduce((sum, img) => sum + img.size, 0);
    console.log(` 3. [ไฟล์รูปภาพตกค้าง] ใน uploads/ (${orphanImages.length} ไฟล์, ขนาดรวม: ${formatBytes(orphanSize)})`);
    orphanImages.forEach((img, idx) => {
      console.log(`    ${idx + 1}. uploads/${img.name} (${formatBytes(img.size)})`);
    });
  } else {
    console.log(` 3. [ไฟล์รูปภาพตกค้าง] ใน uploads/ -> สะอาด (ไม่มีรูปภาพค้าง)`);
  }

  console.log('------------------------------------------------------');
  console.log(`💾 พื้นที่ดิสก์ที่จะได้รับคืนทั้งหมด: ~${formatBytes(totalReclaimableBytes)}`);

  const hasItemsToDelete = ttvStats.exists || scratchStats.exists || orphanImages.length > 0;

  if (!hasItemsToDelete && !gitignoreStatus.needed) {
    console.log('\n🎉 โปรเจกต์สะอาดสมบูรณ์อยู่แล้ว ไม่พบไฟล์ขยะที่ต้องลบ!\n');
    return;
  }

  if (isDryRun) {
    console.log('\n🔍 [Dry-Run Mode] โหมดตรวจสอบอย่างเดียว ไม่มีการเปลี่ยนแปลงหรือลบไฟล์ใดๆ');
    console.log('   หากต้องการดำเนินการจริง ให้รัน: node cleanup.js\n');
    return;
  }

  // ถามยืนยันก่อนลบ (หากไม่ได้ใช้ --force)
  if (!isForce) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const confirmed = await new Promise(resolve => {
      rl.question('\n⚠️  คุณต้องการลบไฟล์และโฟลเดอร์ขยะตามรายการข้างต้นหรือไม่? (y/N): ', answer => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });

    if (!confirmed) {
      console.log('\n❌ ยกเลิกการทำความสะอาด ไม่มีการลบข้อมูลใดๆ\n');
      return;
    }
  }

  console.log('\n🚀 กำลังดำเนินการทำความสะอาด...');

  // 1. ลบ ttv5poc/
  if (ttvStats.exists) {
    try {
      fs.rmSync(TTV5POC_DIR, { recursive: true, force: true });
      console.log('   ✅ ลบโฟลเดอร์สำเนา ttv5poc/ สำเร็จ');
    } catch (err) {
      console.error('   ❌ ไม่สามารถลบ ttv5poc/ ได้:', err.message);
    }
  }

  // 2. ลบ scratch/
  if (scratchStats.exists) {
    try {
      fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
      console.log('   ✅ ลบโฟลเดอร์ชั่วคราว scratch/ สำเร็จ');
    } catch (err) {
      console.error('   ❌ ไม่สามารถลบ scratch/ ได้:', err.message);
    }
  }

  // 3. ลบรูปภาพกำพร้าใน uploads/
  if (orphanImages.length > 0) {
    let deletedCount = 0;
    for (const img of orphanImages) {
      try {
        if (fs.existsSync(img.path)) {
          fs.unlinkSync(img.path);
          deletedCount++;
        }
      } catch (err) {
        console.warn(`   ⚠️ ไม่สามารถลบ ${img.name}:`, err.message);
      }
    }
    console.log(`   ✅ ลบไฟล์รูปภาพตกค้างสำเร็จ (${deletedCount}/${orphanImages.length} ไฟล์)`);
  }

  // 4. อัปเดต .gitignore
  if (gitignoreStatus.needed) {
    updateGitignore(gitignoreStatus.missingRules);
  }

  console.log('\n🎉 การทำความสะอาดเสร็จสมบูรณ์เรียบร้อยแล้ว!');
  console.log('======================================================\n');
}

runCleanup().catch(err => {
  console.error('เกิดข้อผิดพลาดในการทำความสะอาด:', err);
});

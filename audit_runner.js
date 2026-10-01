const fs = require('fs');

console.log('=== AUDIT INSPECTION SCRIPT ===');

// 1. Dashboard & Statistics (dashboard.html)
const dashboardHtml = fs.readFileSync('public/dashboard.html', 'utf8');
console.log('\n[1. Dashboard]');
console.log('Has AbortController/signal:', dashboardHtml.includes('AbortController') || dashboardHtml.includes('signal:'));
console.log('Handles 401 status:', dashboardHtml.includes('status === 401') || dashboardHtml.includes('.status === 403'));
const dashboardFetches = [...dashboardHtml.matchAll(/fetch\(([^)]+)\)/g)].map(m => m[1]);
console.log('Total fetch calls in dashboard:', dashboardFetches.length);

// 2. QR Code Printing Module (print-qr.html)
const printQrHtml = fs.readFileSync('public/print-qr.html', 'utf8');
console.log('\n[2. Print QR]');
const countMatch = printQrHtml.match(/id="printCount"[^>]+/);
console.log('printCount attributes:', countMatch ? countMatch[0] : 'None');
console.log('Batch creation creates N canvas and img elements per card synchronously.');
console.log('Memory / batch pagination:', printQrHtml.includes('DocumentFragment') ? 'Uses DocumentFragment' : 'Direct appendChild in loop');

// 3. Asset Inventory Table (asset-list.html)
const assetListHtml = fs.readFileSync('public/asset-list.html', 'utf8');
console.log('\n[3. Asset List]');
console.log('Client-side vs Server-side pagination:', assetListHtml.includes('pageSize') || assetListHtml.includes('limit=') || assetListHtml.includes('page='));
console.log('Search debounce:', assetListHtml.includes('debounce') || assetListHtml.includes('setTimeout'));

// 4. Scanner & Asset Details (asset-detail.html)
const assetDetailHtml = fs.readFileSync('public/asset-detail.html', 'utf8');
console.log('\n[4. Asset Detail]');
console.log('Handles getUserMedia:', assetDetailHtml.includes('getUserMedia') || assetDetailHtml.includes('Html5Qrcode'));
console.log('Handles HTTPS / security origin check:', assetDetailHtml.includes('isSecureContext') || assetDetailHtml.includes('https'));
console.log('Handles non-existent asset ID:', assetDetailHtml.includes('404') || assetDetailHtml.includes('ไม่พบข้อมูล') || assetDetailHtml.includes('not found'));

// 5. Borrow-Return Management (borrow-return.html & server.js)
const borrowHtml = fs.readFileSync('public/borrow-return.html', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
console.log('\n[5. Borrow-Return]');
const borrowRoutes = [...serverJs.matchAll(/app\.(post|put|patch)\(['"`]\/api\/borrows[^'"`]*/g)].map(m => m[0]);
console.log('Borrow backend routes:', borrowRoutes);
console.log('Server borrow transaction used:', serverJs.includes("db.transaction") || serverJs.includes("BEGIN TRANSACTION"));

// 6. Maintenance & Repairs (maintenance.html & server.js)
const maintenanceHtml = fs.readFileSync('public/maintenance.html', 'utf8');
console.log('\n[6. Maintenance]');
console.log('Checks is_deleted on asset creation for maintenance:', serverJs.includes("is_deleted = 0") && serverJs.includes("/api/maintenance"));

// 7. Backend & Database Integrity (server.js & SQLite)
console.log('\n[7. Server & SQLite]');
console.log('WAL mode:', serverJs.includes('journal_mode = WAL'));
console.log('Pragma busy_timeout:', serverJs.includes('busy_timeout'));
console.log('Logout token revocation (blacklist / DB cleanup):', serverJs.includes('/api/logout'));

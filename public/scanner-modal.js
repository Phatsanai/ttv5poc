/**
 * Asset Console - Universal Camera QR / Barcode Scanner Modal
 * Uses local html5-qrcode.min.js with WebRTC fallback
 */
(function() {
    let html5QrCode = null;
    let scanCallback = null;

    // Beep sound on successful scan
    function playBeep() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        } catch(e) {}
    }

    function createScannerUI() {
        if (document.getElementById('globalCameraModal')) return;

        const modal = document.createElement('div');
        modal.id = 'globalCameraModal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(6px);
            z-index: 99999;
            align-items: center;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
        `;

        modal.innerHTML = `
            <div style="background: var(--bg-card, #ffffff); color: var(--text-title, #0f172a); border-radius: 16px; border: 1px solid var(--border-color, #cbd5e1); width: 100%; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
                <div style="padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color, #e2e8f0);">
                    <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.05rem;">
                        <i class="fa-solid fa-camera" style="color: var(--accent-blue, #2563eb);"></i>
                        <span>สแกน QR Code / บาร์โค้ด</span>
                    </div>
                    <button id="btnCloseScannerModal" style="background: none; border: none; font-size: 1.4rem; color: var(--text-muted, #64748b); cursor: pointer; padding: 4px;">&times;</button>
                </div>
                <div style="padding: 20px; display: flex; flex-direction: column; align-items: center;">
                    <div id="qrReader" style="width: 100%; max-width: 380px; min-height: 260px; background: #000; border-radius: 12px; overflow: hidden; position: relative;"></div>
                    <div id="scannerStatusText" style="margin-top: 12px; font-size: 0.85rem; color: var(--text-muted, #64748b); text-align: center;">
                        กำลังเปิดกล้อง... หันกล้องไปที่ QR Code หรือ Barcode
                    </div>
                    <!-- Manual input fallback -->
                    <div style="margin-top: 16px; width: 100%; display: flex; gap: 8px;">
                        <input type="text" id="manualScanInput" placeholder="หรือพิมพ์รหัสทรัพย์สิน เช่น A001" style="flex: 1; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border-color, #cbd5e1); background: var(--bg-input, #fff); color: var(--text-title, #0f172a); font-size: 0.9rem;">
                        <button id="btnManualSubmit" style="background: var(--accent-blue, #2563eb); color: #fff; border: none; border-radius: 8px; padding: 0 16px; font-weight: 600; cursor: pointer;">ค้นหา</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('btnCloseScannerModal').addEventListener('click', closeCameraScanner);
        document.getElementById('btnManualSubmit').addEventListener('click', () => {
            const val = document.getElementById('manualScanInput').value.trim();
            if (val) handleScannedCode(val);
        });
        document.getElementById('manualScanInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = document.getElementById('manualScanInput').value.trim();
                if (val) handleScannedCode(val);
            }
        });
    }

    function parseAssetCode(text) {
        if (!text) return '';
        let clean = text.trim();
        // If it's a URL like http://.../asset-detail.html?id=A001 or ?code=A001
        try {
            if (clean.includes('?id=')) {
                const u = new URL(clean, window.location.origin);
                const id = u.searchParams.get('id');
                if (id) return id.trim();
            }
            if (clean.includes('?code=')) {
                const u = new URL(clean, window.location.origin);
                const code = u.searchParams.get('code');
                if (code) return code.trim();
            }
        } catch(e) {}
        return clean;
    }

    function handleScannedCode(rawText) {
        const code = parseAssetCode(rawText);
        playBeep();
        closeCameraScanner();
        if (typeof scanCallback === 'function') {
            scanCallback(code, rawText);
        }
    }

    window.openCameraScanner = async function(callback) {
        scanCallback = callback;
        createScannerUI();

        const modal = document.getElementById('globalCameraModal');
        const statusText = document.getElementById('scannerStatusText');
        const manualInput = document.getElementById('manualScanInput');
        manualInput.value = '';
        modal.style.display = 'flex';
        statusText.textContent = 'กำลังเปิดกล้อง... หันกล้องไปที่ QR Code หรือ Barcode';

        if (typeof Html5Qrcode === 'undefined') {
            statusText.innerHTML = '<span style="color:#ef4444;">กำลังโหลดโมดูลกล้อง... กรุณารอสักครู่</span>';
            return;
        }

        try {
            if (html5QrCode) {
                try { await html5QrCode.stop(); } catch(e) {}
                html5QrCode = null;
            }
            html5QrCode = new Html5Qrcode("qrReader");
            const config = {
                fps: 15,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            };

            await html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    handleScannedCode(decodedText);
                },
                (errorMessage) => {
                    // Ignore transient frame decode misses
                }
            );
            statusText.textContent = 'กล้องพร้อมใช้งาน: ส่องไปยัง QR Code หรือ Barcode ได้ทันที';
        } catch(err) {
            console.warn('Camera start error:', err);
            statusText.innerHTML = `<span style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถเข้าถึงกล้องได้ (${err.message || 'Permission denied'}) สามารถพิมพ์รหัสด้านล่างแทนได้ครับ</span>`;
        }
    };

    window.closeCameraScanner = async function() {
        const modal = document.getElementById('globalCameraModal');
        if (modal) modal.style.display = 'none';
        if (html5QrCode) {
            try {
                await html5QrCode.stop();
            } catch(e) {}
            html5QrCode = null;
        }
    };
})();

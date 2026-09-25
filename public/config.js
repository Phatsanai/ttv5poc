/**
 * ============================================================
 *  Asset Console - Central API Configuration & Environment
 *  Supports seamless communication between Cloudflare Frontend
 *  and Backend Server (Localhost, Cloudflare Tunnel, or Cloud Domain)
 * ============================================================
 */
(function () {
    // 1. Check for manual override in localStorage
    const savedApi = localStorage.getItem('api_base_url') || sessionStorage.getItem('api_base_url');

    // 2. Detect environment
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';

    // 3. Resolve API_BASE_URL:
    // - If saved in localStorage: use it (allows pointing Cloudflare frontend to any tunnel or server IP)
    // - If running on localhost: default to '' (same origin, port 8080)
    // - If running on Cloudflare / external hosting: default to savedApi or window.DEFAULT_API_URL or ''
    let resolvedBase = '';
    if (savedApi && savedApi.trim()) {
        resolvedBase = savedApi.trim();
    } else if (isLocal) {
        resolvedBase = ''; // Same origin in local development
    } else if (window.DEFAULT_API_URL) {
        resolvedBase = window.DEFAULT_API_URL.trim();
    } else {
        // Fallback: use current origin if backend and frontend are hosted together,
        // or leave empty for relative routing.
        resolvedBase = '';
    }

    // Strip trailing slash
    window.API_BASE_URL = resolvedBase ? resolvedBase.replace(/\/+$/, '') : '';

    /**
     * Helper to build a complete API endpoint URL.
     * Prevents double slashes and ensures full cross-domain URL when on Cloudflare.
     * @param {string} path - e.g. '/api/assets' or 'api/assets'
     * @returns {string} full URL - e.g. 'https://api.domain.com/api/assets'
     */
    window.getApiUrl = function (path) {
        if (!path) return window.API_BASE_URL || '';
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        const cleanPath = path.startsWith('/') ? path : '/' + path;
        return (window.API_BASE_URL || '') + cleanPath;
    };

    /**
     * Helper to format photo and image URLs from relative uploads path.
     * Ensures images load correctly whether hosted on same origin or backend domain.
     * @param {string} photoPath - e.g. 'uploads/asset-123.jpg'
     * @returns {string} full image URL
     */
    window.formatPhotoUrl = function (photoPath) {
        if (!photoPath) return '';
        if (photoPath.startsWith('http://') || photoPath.startsWith('https://') || photoPath.startsWith('data:')) {
            return photoPath;
        }
        const clean = photoPath.startsWith('/') ? photoPath : '/' + photoPath;
        return window.getApiUrl(clean);
    };

    /**
     * Shared helper to delete an image file from the server.
     * Handles local/base64 check, authentication token attachment, and error extraction.
     * @param {string} photoPath - e.g. 'uploads/photo-123.jpg'
     * @returns {Promise<Object>} API response object
     */
    window.deleteAssetImage = async function (photoPath) {
        if (!photoPath) return { success: false, message: 'ไม่พบชื่อรูปภาพ' };
        if (photoPath.startsWith('data:')) {
            return { success: true, isLocal: true, message: 'รูปภาพชั่วคราวถูกลบแล้ว' };
        }
        const cleanFilename = (photoPath.split('/').pop() || '').trim();
        if (!cleanFilename) return { success: false, message: 'ชื่อไฟล์ไม่ถูกต้อง' };

        const token = localStorage.getItem('auth_token') || localStorage.getItem('authToken');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(window.getApiUrl(`/api/assets/images/${encodeURIComponent(cleanFilename)}`), {
            method: 'DELETE',
            headers
        });
        let data = {};
        try { data = await res.json(); } catch (_) { }
        if (!res.ok || !data.success) {
            const err = new Error(data.message || 'ลบรูปภาพไม่สำเร็จ');
            err.status = res.status;
            throw err;
        }
        return data;
    };

    /**
     * Shared helper to upload multiple photos to backend (/api/upload).
     * Automatically applies slot limiting, token attachment, and error handling.
     * @param {FileList|File[]} files - Files from file input or drag-and-drop
     * @param {number} currentLength - Current number of photos already attached
     * @param {number} maxAllowed - Maximum photos allowed per asset (default: 5)
     * @returns {Promise<string[]>} Array of uploaded image paths (urls)
     */
    window.uploadAssetPhotos = async function (files, currentLength = 0, maxAllowed = 5) {
        if (!files || files.length === 0) return [];
        const remaining = Math.max(0, maxAllowed - currentLength);
        if (remaining <= 0) {
            throw new Error(`สามารถอัปโหลดรูปภาพได้สูงสุด ${maxAllowed} รูปต่ออุปกรณ์`);
        }
        const filesToUpload = Array.from(files).slice(0, remaining);
        const formData = new FormData();
        filesToUpload.forEach(f => formData.append('photos', f));

        const token = localStorage.getItem('auth_token') || localStorage.getItem('authToken');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(window.getApiUrl('/api/upload'), {
            method: 'POST',
            headers,
            body: formData
        });
        let data = {};
        try { data = await res.json(); } catch (_) {
            throw new Error(`เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (${res.status}: ${res.statusText})`);
        }
        if (!res.ok || !data.success || !Array.isArray(data.urls)) {
            throw new Error(data.message || 'อัปโหลดรูปภาพไม่สำเร็จ');
        }
        return data.urls;
    };

    /**
     * Helper to change API Base URL dynamically (e.g. from UI or console).
     * @param {string} newUrl - e.g. 'https://my-tunnel.trycloudflare.com'
     */
    window.setApiBaseUrl = function (newUrl) {
        if (!newUrl || !newUrl.trim()) {
            localStorage.removeItem('api_base_url');
            sessionStorage.removeItem('api_base_url');
            window.API_BASE_URL = '';
        } else {
            const clean = newUrl.trim().replace(/\/+$/, '');
            localStorage.setItem('api_base_url', clean);
            window.API_BASE_URL = clean;
        }
        console.log(`[Config] API_BASE_URL updated to: "${window.API_BASE_URL || '(same-origin)'}"`);
    };

    console.log(`[Config] Asset Console API_BASE_URL: "${window.API_BASE_URL || '(same-origin)'}"`);

    /**
     * Universal Logout Helper (shared across all pages)
     */
    window.handleLogout = async function () {
        const token = localStorage.getItem('auth_token');
        if (token) {
            try {
                await fetch(window.getApiUrl('/api/logout'), {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (e) {}
        }
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        window.location.href = 'index.html';
    };
    window.logout = window.handleLogout;

    // Automated user profile & sidebar role sync across all pages
    document.addEventListener('DOMContentLoaded', function () {
        try {
            const userStr = localStorage.getItem('auth_user');
            if (userStr) {
                const user = JSON.parse(userStr);
                const nameEls = ['sidebarUserName', 'topbarUserName', 'topUserName'];
                const roleEls = ['sidebarUserRole', 'topbarUserRole'];
                nameEls.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = user.name || user.username || 'Admin';
                });
                roleEls.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        const roleName = user.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' :
                                         user.role === 'editor' ? 'ผู้แก้ไขข้อมูล (Editor)' :
                                         user.role === 'manager' ? 'ผู้จัดการทรัพย์สิน (Manager)' : 'ผู้เข้าชม (Viewer)';
                        el.textContent = roleName;
                    }
                });
                const avatarEls = ['topbarAvatar', 'topAvatar'];
                avatarEls.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && !el.querySelector('i')) {
                        el.textContent = (user.name || user.username || 'A').charAt(0).toUpperCase();
                    }
                });
            }
        } catch (e) {}
    });
})();

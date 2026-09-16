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
})();

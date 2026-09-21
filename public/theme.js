/**
 * Asset Console Enterprise Edition
 * Global Theme & Typography Manager
 * - Persists theme selection (Dark / Light) in localStorage
 * - Persists typography selection (Font Family & Base Font Size) in localStorage
 * - Runs synchronously in <head> to prevent FOUC (flash of unstyled content)
 * - Synchronizes across browser tabs via storage events
 */
(function () {
    'use strict';

    // ── Theme Configuration ─────────────────────────────────────
    const THEME_KEY = 'theme';
    const THEME_DARK = 'dark';
    const THEME_LIGHT = 'light';

    // ── Typography Configuration ────────────────────────────────
    const FONT_FAMILY_KEY = 'app_font_family';
    const FONT_SIZE_KEY = 'app_font_size';

    const DEFAULT_FONT = 'kanit';
    const DEFAULT_SIZE = 'normal';

    const VALID_FONTS = ['kanit', 'prompt', 'sarabun', 'inter', 'noto'];
    const VALID_SIZES = ['small', 'normal', 'large', 'xlarge'];

    const FONT_STACKS = {
        kanit: "'Kanit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        prompt: "'Prompt', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        sarabun: "'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        inter: "'Inter', 'Kanit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        noto: "'Noto Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    };

    const FONT_SIZES = {
        small: '13.5px',
        normal: '15px',
        large: '16.5px',
        xlarge: '18px'
    };

    // ── Theme Functions ─────────────────────────────────────────
    function getSavedTheme() {
        try {
            return localStorage.getItem(THEME_KEY) === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
        } catch (e) {
            return THEME_DARK;
        }
    }

    function applyThemeClasses(theme) {
        const isLight = (theme === THEME_LIGHT);
        const root = document.documentElement;

        if (isLight) {
            root.classList.add('light-theme', 'light-mode');
            root.setAttribute('data-theme', 'light');
        } else {
            root.classList.remove('light-theme', 'light-mode');
            root.setAttribute('data-theme', 'dark');
        }

        if (document.body) {
            if (isLight) {
                document.body.classList.add('light-theme', 'light-mode');
                document.body.setAttribute('data-theme', 'light');
            } else {
                document.body.classList.remove('light-theme', 'light-mode');
                document.body.setAttribute('data-theme', 'dark');
            }
        }
    }

    function updateIcons(theme) {
        const isLight = (theme === THEME_LIGHT);
        const iconClass = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        const iconColor = isLight ? '#f59e0b' : '';
        const titleText = isLight ? 'สลับเป็นโหมดมืด (Dark Mode)' : 'สลับเป็นโหมดสว่าง (Light Mode)';

        // Update all theme icons across the DOM
        const themeIcons = document.querySelectorAll('#themeIcon, .theme-icon');
        themeIcons.forEach(icon => {
            icon.className = iconClass;
            icon.style.color = iconColor;
        });

        // Update all toggle buttons
        const toggleButtons = document.querySelectorAll('.btn-theme-toggle, .theme-toggle-btn, .theme-toggle, #themeToggleBtn, #themeBtn');
        toggleButtons.forEach(btn => {
            btn.setAttribute('title', titleText);
            const iconInside = btn.querySelector('i');
            if (iconInside) {
                iconInside.className = iconClass;
                iconInside.style.color = iconColor;
            }
        });
    }

    // ── Typography Functions ────────────────────────────────────
    function getSavedFont() {
        try {
            const saved = (localStorage.getItem(FONT_FAMILY_KEY) || '').toLowerCase();
            return VALID_FONTS.includes(saved) ? saved : DEFAULT_FONT;
        } catch (e) {
            return DEFAULT_FONT;
        }
    }

    function getSavedSize() {
        try {
            const saved = (localStorage.getItem(FONT_SIZE_KEY) || '').toLowerCase();
            return VALID_SIZES.includes(saved) ? saved : DEFAULT_SIZE;
        } catch (e) {
            return DEFAULT_SIZE;
        }
    }

    function applyTypography(font, size) {
        const f = VALID_FONTS.includes(font) ? font : DEFAULT_FONT;
        const s = VALID_SIZES.includes(size) ? size : DEFAULT_SIZE;
        const root = document.documentElement;

        root.setAttribute('data-font', f);
        root.setAttribute('data-font-size', s);
        root.style.setProperty('--font-family-base', FONT_STACKS[f]);
        root.style.setProperty('--font-size-base', FONT_SIZES[s]);
        root.style.fontSize = FONT_SIZES[s];

        if (document.body) {
            document.body.setAttribute('data-font', f);
            document.body.setAttribute('data-font-size', s);
        }
    }

    // ── Synchronous Init in <head> ──────────────────────────────
    const initialTheme = getSavedTheme();
    applyThemeClasses(initialTheme);

    const initialFont = getSavedFont();
    const initialSize = getSavedSize();
    applyTypography(initialFont, initialSize);

    // ── Global Theme API ────────────────────────────────────────
    window.getTheme = function () {
        return getSavedTheme();
    };

    window.setTheme = function (theme) {
        const targetTheme = (theme === THEME_LIGHT) ? THEME_LIGHT : THEME_DARK;
        try {
            localStorage.setItem(THEME_KEY, targetTheme);
        } catch (e) { }

        applyThemeClasses(targetTheme);
        updateIcons(targetTheme);

        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: targetTheme } }));
    };

    window.toggleTheme = function () {
        const current = getSavedTheme();
        const next = (current === THEME_LIGHT) ? THEME_DARK : THEME_LIGHT;
        window.setTheme(next);
        return next;
    };

    window.updateThemeIcon = function (theme) {
        updateIcons(typeof theme === 'string' ? theme : (theme ? THEME_LIGHT : THEME_DARK));
    };

    window.updateThemeIcons = function (theme) {
        updateIcons(theme || getSavedTheme());
    };

    window.ThemeManager = {
        getTheme: window.getTheme,
        setTheme: window.setTheme,
        toggleTheme: window.toggleTheme,
        updateIcons: window.updateThemeIcons
    };

    // ── Global Typography API ───────────────────────────────────
    window.getFontFamily = function () {
        return getSavedFont();
    };

    window.setFontFamily = function (font) {
        const target = (font || '').toLowerCase();
        if (!VALID_FONTS.includes(target)) return;
        try {
            localStorage.setItem(FONT_FAMILY_KEY, target);
        } catch (e) { }
        applyTypography(target, getSavedSize());
        window.dispatchEvent(new CustomEvent('typographychange', {
            detail: { fontFamily: target, fontSize: getSavedSize() }
        }));
    };

    window.getFontSize = function () {
        return getSavedSize();
    };

    window.setFontSize = function (size) {
        const target = (size || '').toLowerCase();
        if (!VALID_SIZES.includes(target)) return;
        try {
            localStorage.setItem(FONT_SIZE_KEY, target);
        } catch (e) { }
        applyTypography(getSavedFont(), target);
        window.dispatchEvent(new CustomEvent('typographychange', {
            detail: { fontFamily: getSavedFont(), fontSize: target }
        }));
    };

    window.resetTypography = function () {
        try {
            localStorage.removeItem(FONT_FAMILY_KEY);
            localStorage.removeItem(FONT_SIZE_KEY);
        } catch (e) { }
        applyTypography(DEFAULT_FONT, DEFAULT_SIZE);
        window.dispatchEvent(new CustomEvent('typographychange', {
            detail: { fontFamily: DEFAULT_FONT, fontSize: DEFAULT_SIZE }
        }));
    };

    window.TypographyManager = {
        getFontFamily: window.getFontFamily,
        setFontFamily: window.setFontFamily,
        getFontSize: window.getFontSize,
        setFontSize: window.setFontSize,
        resetTypography: window.resetTypography,
        applyTypography: applyTypography,
        getAvailableFonts: function () { return VALID_FONTS.slice(); },
        getAvailableSizes: function () { return VALID_SIZES.slice(); }
    };

    // ── Mobile Responsive Sidebar Drawer Manager ────────────────
    function initMobileSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        // Ensure backdrop exists
        let backdrop = document.querySelector('.sidebar-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'sidebar-backdrop';
            backdrop.setAttribute('aria-hidden', 'true');
            document.body.appendChild(backdrop);
        }

        backdrop.addEventListener('click', closeMobileSidebar);

        // Inject close button in sidebar header if not present
        const brandHeader = sidebar.querySelector('.brand-header, .brand');
        if (brandHeader && !sidebar.querySelector('.btn-sidebar-close')) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn-sidebar-close';
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'ปิดเมนู');
            closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            closeBtn.addEventListener('click', closeMobileSidebar);
            brandHeader.appendChild(closeBtn);
        }

        // Find topbar and inject mobile toggle if not present
        const topbar = document.querySelector('.topbar');
        if (topbar && !topbar.querySelector('.btn-mobile-toggle')) {
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'btn-mobile-toggle';
            toggleBtn.type = 'button';
            toggleBtn.setAttribute('aria-label', 'เปิดเมนู');
            toggleBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
            toggleBtn.addEventListener('click', toggleMobileSidebar);

            // Put it at the beginning of topbar or inside topbar-left
            const topbarLeft = topbar.querySelector('.topbar-left');
            if (topbarLeft) {
                topbarLeft.insertBefore(toggleBtn, topbarLeft.firstChild);
            } else {
                topbar.insertBefore(toggleBtn, topbar.firstChild);
            }
        }

        // Close sidebar when clicking any nav-item link on mobile
        sidebar.querySelectorAll('.nav-menu a, .nav-item a').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    closeMobileSidebar();
                }
            });
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
                closeMobileSidebar();
            }
        });
    }

    function toggleMobileSidebar() {
        document.body.classList.toggle('sidebar-open');
    }

    function closeMobileSidebar() {
        document.body.classList.remove('sidebar-open');
    }

    function openMobileSidebar() {
        document.body.classList.add('sidebar-open');
    }

    window.toggleMobileSidebar = toggleMobileSidebar;
    window.closeMobileSidebar = closeMobileSidebar;
    window.openMobileSidebar = openMobileSidebar;

    // ── Global User Info Sync & Logout Handler ──────────────────
    function syncSidebarUserInfo() {
        try {
            const raw = localStorage.getItem('auth_user');
            if (!raw) return;
            const u = JSON.parse(raw);
            const roleLabels = {
                admin: 'ผู้ดูแลระบบ (Admin)',
                manager: 'ผู้จัดการทรัพย์สิน (Manager)',
                editor: 'ผู้แก้ไขข้อมูล (Editor)',
                viewer: 'ผู้ชม (Viewer)'
            };
            const name = u.name || u.username || 'Admin';
            const role = roleLabels[u.role] || u.role || 'ผู้ดูแลระบบ';

            document.querySelectorAll('#sidebarUserName, .sidebar-user-name').forEach(el => el.textContent = name);
            document.querySelectorAll('#sidebarUserRole, .sidebar-user-role').forEach(el => el.textContent = role);
            document.querySelectorAll('#topUserName, #topbarUserName, .topbar-user-name, #userName').forEach(el => el.textContent = name);
            document.querySelectorAll('#topUserRole, #topbarUserRole, .topbar-user-role').forEach(el => el.textContent = role);
        } catch (e) {}
    }

    if (!window.handleLogout) {
        window.handleLogout = async function() {
            const token = localStorage.getItem('auth_token');
            if (token && typeof window.getApiUrl === 'function') {
                try {
                    await fetch(window.getApiUrl('/api/logout'), {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + token }
                    });
                } catch (e) {}
            }
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            window.location.href = 'index.html';
        };
    }
    if (!window.logout) {
        window.logout = function() { window.handleLogout(); };
    }

    // ── DOM Ready / Load Handler ────────────────────────────────
    function onReady() {
        const currentTheme = getSavedTheme();
        applyThemeClasses(currentTheme);
        updateIcons(currentTheme);

        applyTypography(getSavedFont(), getSavedSize());
        initMobileSidebar();
        syncSidebarUserInfo();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }

    window.addEventListener('load', () => {
        updateIcons(getSavedTheme());
        applyTypography(getSavedFont(), getSavedSize());
        syncSidebarUserInfo();
    });

    // ── Multi-Tab Storage Synchronization ───────────────────────
    window.addEventListener('storage', function (e) {
        if (e.key === THEME_KEY) {
            const newTheme = e.newValue === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
            applyThemeClasses(newTheme);
            updateIcons(newTheme);
        } else if (e.key === FONT_FAMILY_KEY || e.key === FONT_SIZE_KEY) {
            applyTypography(getSavedFont(), getSavedSize());
            window.dispatchEvent(new CustomEvent('typographychange', {
                detail: { fontFamily: getSavedFont(), fontSize: getSavedSize() }
            }));
        }
    });
})();


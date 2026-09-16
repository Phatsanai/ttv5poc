/**
 * Asset Console Enterprise Edition
 * Global Theme Manager (Dark / Light Mode)
 * - Persists theme selection across all pages in localStorage
 * - Runs synchronously in <head> to prevent FOUC (flash of unstyled content)
 * - Synchronizes across browser tabs via storage events
 */
(function () {
    'use strict';

    const THEME_KEY = 'theme';
    const THEME_DARK = 'dark';
    const THEME_LIGHT = 'light';

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

        // 1. All elements with id 'themeIcon'
        const themeIcons = document.querySelectorAll('#themeIcon, .theme-icon');
        themeIcons.forEach(icon => {
            icon.className = iconClass;
            icon.style.color = iconColor;
        });

        // 2. All toggle buttons
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

    // Apply theme immediately upon script evaluation (in <head>)
    const initialTheme = getSavedTheme();
    applyThemeClasses(initialTheme);

    // Global Theme Object & Functions
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

    // When DOM is parsed or fully loaded, ensure body classes and icons are up to date
    function onReady() {
        const currentTheme = getSavedTheme();
        applyThemeClasses(currentTheme);
        updateIcons(currentTheme);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }

    window.addEventListener('load', () => {
        updateIcons(getSavedTheme());
    });

    // Multi-tab sync
    window.addEventListener('storage', function (e) {
        if (e.key === THEME_KEY) {
            const newTheme = e.newValue === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
            applyThemeClasses(newTheme);
            updateIcons(newTheme);
        }
    });
})();

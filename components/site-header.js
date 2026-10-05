/* ============================================================
   OPTIONEXT · 站点页眉组件 site-header.js
   纯原生、零依赖、可被任意深度页面引用。

   用法（任意子目录中，只需把 src 指到本文件）：
     <script src="components/site-header.js"></script>          <!-- 根目录页面 -->
     <script src="../../components/site-header.js"></script>   <!-- 二级子目录 -->

   资源寻址：组件以“自身脚本 URL”推导站点根目录（components 的上一级），
   因此 logo / css / 导航链接在 GitHub Pages 任意深度子页面中都能正确解析，
   无需关心页面所在层级，也无需写死仓库名。

   主题：右侧圆形按钮切换“明 / 暗”另一半，以按钮为圆心圆形扩散展开
   （View Transitions API，不支持的浏览器降级为即时切换）。
   ============================================================ */
(function () {
    'use strict';

    if (window.__OPTIONEXT_HEADER_LOADED__) return;
    window.__OPTIONEXT_HEADER_LOADED__ = true;

    /* ---------- 站点根目录：<本文件>/../ ---------- */
    var SELF = new URL(document.currentScript.src, document.baseURI);
    var ROOT = new URL('../', SELF).href;                 // 以 / 结尾
    var URL_CSS  = ROOT + 'components/site-header.css';
    var URL_LOGO_LIGHT = ROOT + 'image/' + encodeURIComponent('LOGO横版黑.png'); // 明主题用黑 logo
    var URL_LOGO_DARK  = ROOT + 'image/' + encodeURIComponent('LOGO横版白.png'); // 暗主题用白 logo
    var THEME_KEY = 'optionext-theme';

    /* ---------- 导航配置（后续直接改这里） ----------
       href 以 '/' 开头表示相对站点根，其余按字面值使用 */
    var NAV = [
        { cn: '团队介绍', en: 'TEAM',      href: '/index.html' },
        { cn: '项目',     en: 'PROJECTS',  href: '#' }
    ];

    function resolve(href) {
        if (href.charAt(0) === '/') return ROOT + href.slice(1);
        return href;
    }

    function storedTheme() {
        try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
    }
    function saveTheme(t) {
        try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 隐私模式等 */ }
    }
    function currentTheme() {
        return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    }

    /* ---------- 注入样式（去重） ---------- */
    if (!document.querySelector('link[data-sh-style]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = URL_CSS;
        link.setAttribute('data-sh-style', '1');
        document.head.appendChild(link);
    }

    /* ---------- 页面未引入品牌字体时兜底注入 ---------- */
    if (!document.querySelector('link[href*="IBM+Plex+Mono"]')) {
        var pc = document.createElement('link');
        pc.rel = 'preconnect'; pc.href = 'https://fonts.googleapis.com';
        var pc2 = document.createElement('link');
        pc2.rel = 'preconnect'; pc2.href = 'https://fonts.gstatic.com'; pc2.crossOrigin = '';
        var gf = document.createElement('link');
        gf.rel = 'stylesheet';
        gf.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
        document.head.appendChild(pc);
        document.head.appendChild(pc2);
        document.head.appendChild(gf);
    }

    /* ---------- 尽早确定初始主题（页面头部内联脚本可抢先防闪烁） ---------- */
    if (!document.documentElement.dataset.theme) {
        var saved = storedTheme();
        var initial = saved === 'dark' || saved === 'light'
            ? saved
            : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = initial;
    }

    /* ---------- 圆形按钮图形：左实右空的圆（◐），切换时旋转 180° ---------- */
    var ICON =
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/>' +
            '<path d="M12 3.5 A8.5 8.5 0 0 0 12 20.5 Z" fill="currentColor"/>' +
        '</svg>';

    /* ---------- 构建 DOM ---------- */
    var root = document.createElement('div');
    root.className = 'sh-root';
    root.innerHTML =
        '<div class="sh-bar">' +
            '<a class="sh-brand" href="' + ROOT + 'index.html" aria-label="Optionext 药铺子 · 首页">' +
                '<img alt="药铺子 Optionext" loading="eager">' +
            '</a>' +
            '<nav class="sh-nav" aria-label="主导航"></nav>' +
            '<button class="sh-toggle" type="button" aria-label="切换到暗色模式" aria-pressed="false" title="切换另一半">' + ICON + '</button>' +
            '<button class="sh-burger" type="button" aria-label="展开菜单" aria-expanded="false" aria-controls="sh-mobile">' +
                '<span></span><span></span><span></span>' +
            '</button>' +
        '</div>' +
        '<nav class="sh-mobile" id="sh-mobile" aria-label="移动端导航"></nav>';

    var navDesk = root.querySelector('.sh-nav');
    var navMob  = root.querySelector('.sh-mobile');
    var toggle = root.querySelector('.sh-toggle');
    var logoImg = root.querySelector('.sh-brand img');
    var here = location.pathname.replace(/index\.html$/, '');

    function isActive(item) {
        if (item.href === '#' || item.href.charAt(0) !== '/') return false;
        var target = new URL(resolve(item.href));
        var tp = target.pathname.replace(/index\.html$/, '');
        return tp === here || (tp.length > 1 && here.indexOf(tp) === 0);
    }

    NAV.forEach(function (item) {
        var a = document.createElement('a');
        a.href = resolve(item.href);
        if (isActive(item)) a.className = 'sh-active';
        a.innerHTML = '<span class="sh-cn">' + item.cn + '</span>' + item.en;
        navDesk.appendChild(a);

        var m = document.createElement('a');
        m.href = resolve(item.href);
        if (isActive(item)) m.className = 'sh-active';
        m.innerHTML = '<span class="sh-cn">' + item.cn + '</span><span class="sh-en">' + item.en + '</span>';
        navMob.appendChild(m);
    });

    /* ---------- 主题：落地 + 同步外观 ---------- */
    function syncThemeUI() {
        var dark = currentTheme() === 'dark';
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        root.setAttribute('data-dark', dark ? '1' : '0');
        logoImg.src = dark ? URL_LOGO_DARK : URL_LOGO_LIGHT;
        toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
        toggle.setAttribute('aria-label', dark ? '切换到明色模式' : '切换到暗色模式');
    }

    function commitTheme(next) {
        var prev = currentTheme();
        if (next === prev) return;
        document.documentElement.dataset.theme = next;
        syncThemeUI();
        saveTheme(next);
        window.dispatchEvent(new CustomEvent('optionext:themechange', { detail: { theme: next, prev: prev } }));
    }

    /* ---------- 点击：以按钮为圆心的圆形扩散切换 ---------- */
    function expandSwitch() {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        var rect = toggle.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;

        var reduced = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduced || typeof document.startViewTransition !== 'function') {
            commitTheme(next);
            return;
        }

        document.documentElement.classList.add('sh-vt');
        var transition = document.startViewTransition(function () { commitTheme(next); });

        var clearVt = function () { document.documentElement.classList.remove('sh-vt'); };
        transition.finished.then(clearVt, clearVt);

        transition.ready.then(function () {
            var maxR = Math.hypot(
                Math.max(x, window.innerWidth - x),
                Math.max(y, window.innerHeight - y)
            );
            // 快速扩散：锋刃略快，整体 ~0.72s
            document.documentElement.animate(
                {
                    clipPath: [
                        'circle(0px at ' + x + 'px ' + y + 'px)',
                        'circle(' + maxR + 'px at ' + x + 'px ' + y + 'px)'
                    ]
                },
                {
                    duration: 720,
                    easing: 'cubic-bezier(.22, 1, .36, 1)',
                    fill: 'forwards',
                    pseudoElement: '::view-transition-new(root)'
                }
            );
        }).catch(function () { /* 动画准备失败则保留即时结果 */ });
    }

    toggle.addEventListener('click', expandSwitch);

    /* ---------- 汉堡开关 ---------- */
    var burger = root.querySelector('.sh-burger');
    burger.addEventListener('click', function () {
        var open = root.classList.toggle('sh-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        burger.setAttribute('aria-label', open ? '收起菜单' : '展开菜单');
    });
    navMob.addEventListener('click', function (e) {
        if (e.target.closest('a')) {
            root.classList.remove('sh-open');
            burger.setAttribute('aria-expanded', 'false');
        }
    });

    /* ---------- 滚动状态（节流） ---------- */
    var ticking = false;
    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
            root.classList.toggle('sh-scrolled', window.scrollY > 24);
            ticking = false;
        });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---------- 挂载 ---------- */
    function mount() {
        syncThemeUI();
        document.body.appendChild(root);
    }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();

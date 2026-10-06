/* ============================================================
   OPTIONEXT · 移动端底部导航组件 mobile-tabbar.js
   纯原生、零依赖、可被任意深度页面引用。

   用法（任意子目录中，只需把 src 指到本文件）：
     <script src="components/mobile-tabbar.js"></script>          <!-- 根目录页面 -->
     <script src="../../components/mobile-tabbar.js"></script>   <!-- 二级子目录 -->

   资源寻址：组件以“自身脚本 URL”推导站点根目录（components 的上一级），
   因此 css / 导航链接在 GitHub Pages 任意深度子页面中都能正确解析，
   无需关心页面所在层级，也无需写死仓库名。

   形态：底部固定 · 毛玻璃全胶囊 · 纯文字双项（无 logo）+ 右侧日月切换钮。
   主题：与 site-header 共用 localStorage 键 optionext-theme，
   既负责尽早落地初始主题，也内聚明 / 暗切换（以按钮为圆心圆形扩散），
   组件样式随 <html data-theme> 自动响应。
   ============================================================ */
(function () {
    'use strict';

    if (window.__OPTIONEXT_TABBAR_LOADED__) return;
    window.__OPTIONEXT_TABBAR_LOADED__ = true;

    /* ---------- 站点根目录：<本文件>/../ ---------- */
    var SELF = new URL(document.currentScript.src, document.baseURI);
    var ROOT = new URL('../', SELF).href;                 // 以 / 结尾
    var URL_CSS = ROOT + 'components/mobile-tabbar.css';
    var THEME_KEY = 'optionext-theme';

    /* ---------- 导航配置（后续直接改这里） ----------
       href 以 '/' 开头表示相对站点根，其余按字面值使用 */
    var NAV = [
        { cn: '团队介绍', href: '/mobile.html' },
        { cn: '项目',     href: '#' }
    ];

    function resolve(href) {
        if (href.charAt(0) === '/') return ROOT + href.slice(1);
        return href;
    }

    function storedTheme() {
        try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
    }

    /* ---------- 注入样式（去重） ---------- */
    if (!document.querySelector('link[data-mt-style]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = URL_CSS;
        link.setAttribute('data-mt-style', '1');
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

    /* ---------- 主题图标：亮色显月亮 · 暗色显太阳（与 site-header 同款） ---------- */
    var ICON_MOON =
        '<svg class="mt-moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" ' +
                'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    var ICON_SUN =
        '<svg class="mt-sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.6"/>' +
            '<path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3' +
                     'M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" ' +
                'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
        '</svg>';

    /* ---------- 构建 DOM ---------- */
    var root = document.createElement('div');
    root.className = 'mt-root';
    root.innerHTML =
        '<nav class="mt-bar" aria-label="底部导航">' +
            '<i class="mt-sep" aria-hidden="true"></i>' +
            '<button class="mt-theme" type="button" aria-pressed="false">' +
                '<span class="mt-tt">' + ICON_MOON + ICON_SUN + '</span>' +
            '</button>' +
        '</nav>';

    var bar = root.querySelector('.mt-bar');

    /* index.html / mobile.html 都归一化为目录，保证首页项高亮 */
    function norm(p) { return p.replace(/(index|mobile)\.html$/i, ''); }
    var here = norm(location.pathname);

    function isActive(item) {
        if (item.href === '#' || item.href.charAt(0) !== '/') return false;
        var tp = norm(new URL(resolve(item.href)).pathname);
        return tp === here || (tp.length > 1 && here.indexOf(tp) === 0);
    }

    var sep = bar.querySelector('.mt-sep');
    NAV.forEach(function (item) {
        var a = document.createElement('a');
        a.className = 'mt-item';
        a.href = resolve(item.href);
        if (isActive(item)) {
            a.classList.add('mt-active');
            a.setAttribute('aria-current', 'page');
        }
        a.innerHTML =
            '<span class="mt-cn">' + item.cn + '</span>';
        bar.insertBefore(a, sep);
    });

    /* ============================================================
       主题切换（与 site-header 同一逻辑）
       localStorage 落地 · 以切换钮为圆心 View Transition 圆形扩散
       · 矩阵通过 optionext:themechange 事件同步变色
       ============================================================ */
    var themeBtn = bar.querySelector('.mt-theme');

    function curTheme() {
        return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    }
    function syncTheme() {
        var dark = curTheme() === 'dark';
        themeBtn.setAttribute('data-icon', dark ? 'sun' : 'moon');
        themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        themeBtn.setAttribute('aria-label', dark ? '切换到明色模式' : '切换到暗色模式');
    }
    function commitTheme(next) {
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
        syncTheme();
        window.dispatchEvent(new CustomEvent('optionext:themechange', { detail: { theme: next } }));
    }

    syncTheme();
    themeBtn.addEventListener('click', function () {
        var next = curTheme() === 'dark' ? 'light' : 'dark';
        var rmReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (rmReduce || typeof document.startViewTransition !== 'function') {
            commitTheme(next);
            return;
        }

        var r = themeBtn.getBoundingClientRect();
        var x = r.left + r.width / 2, y = r.top + r.height / 2;

        document.documentElement.classList.add('mt-vt');
        var tr = document.startViewTransition(function () { commitTheme(next); });
        var clearVt = function () { document.documentElement.classList.remove('mt-vt'); };
        tr.finished.then(clearVt, clearVt);

        tr.ready.then(function () {
            var maxR = Math.hypot(
                Math.max(x, window.innerWidth - x),
                Math.max(y, window.innerHeight - y)
            );
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
        }).catch(function () {});
    });

    /* ---------- 挂载 ---------- */
    function mount() { document.body.appendChild(root); }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();

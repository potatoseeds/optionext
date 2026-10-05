/* ============================================================
   OPTIONEXT · 移动端底部导航组件 mobile-tabbar.js
   纯原生、零依赖、可被任意深度页面引用。

   用法（任意子目录中，只需把 src 指到本文件）：
     <script src="components/mobile-tabbar.js"></script>          <!-- 根目录页面 -->
     <script src="../../components/mobile-tabbar.js"></script>   <!-- 二级子目录 -->

   资源寻址：组件以“自身脚本 URL”推导站点根目录（components 的上一级），
   因此 css / 导航链接在 GitHub Pages 任意深度子页面中都能正确解析，
   无需关心页面所在层级，也无需写死仓库名。

   形态：底部固定 · 毛玻璃圆角矩形 · 纯文字双项（无 logo）。
   主题：与 site-header 共用 localStorage 键 optionext-theme，
   仅负责尽早落地初始主题；明 / 暗切换由页面或其它组件驱动，
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

    /* ---------- 构建 DOM ---------- */
    var root = document.createElement('div');
    root.className = 'mt-root';
    root.innerHTML =
        '<nav class="mt-bar" aria-label="底部导航"></nav>';

    var bar = root.querySelector('.mt-bar');

    /* index.html / mobile.html 都归一化为目录，保证首页项高亮 */
    function norm(p) { return p.replace(/(index|mobile)\.html$/i, ''); }
    var here = norm(location.pathname);

    function isActive(item) {
        if (item.href === '#' || item.href.charAt(0) !== '/') return false;
        var tp = norm(new URL(resolve(item.href)).pathname);
        return tp === here || (tp.length > 1 && here.indexOf(tp) === 0);
    }

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
        bar.appendChild(a);
    });

    /* ---------- 挂载 ---------- */
    function mount() { document.body.appendChild(root); }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();

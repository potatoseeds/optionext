/* ============================================================
   OPTIONEXT · 移动端底部导航组件 mobile-tabbar.js
   纯原生、零依赖、可被任意深度页面引用。

   用法（任意子目录中，只需把 src 指到本文件）：
     <script src="components/mobile-tabbar.js"></script>          <!-- 根目录页面 -->
     <script src="../../components/mobile-tabbar.js"></script>   <!-- 二级子目录 -->

   资源寻址：组件以“自身脚本 URL”推导站点根目录（components 的上一级），
   因此 css / 导航链接在 GitHub Pages 任意深度子页面中都能正确解析，
   无需关心页面所在层级，也无需写死仓库名。

   形态：底部固定 · 液态玻璃两件浮件并排——
         左侧圆润小卡片（纯中文双链接，无 logo）· 右侧独立圆形日月切换钮。
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

    /* ---------- 构建 DOM：左卡片（双链接）· 右圆钮（日夜切换） ---------- */
    var root = document.createElement('div');
    root.className = 'mt-root';
    root.innerHTML =
        '<nav class="mt-card" aria-label="底部导航">' +
            '<span class="mt-clip" aria-hidden="true"><i class="mt-sheen"></i></span>' +
        '</nav>' +
        '<button class="mt-theme" type="button" aria-pressed="false">' +
            '<span class="mt-clip" aria-hidden="true"><i class="mt-sheen"></i></span>' +
            '<span class="mt-tt">' + ICON_MOON + ICON_SUN + '</span>' +
        '</button>';

    var card = root.querySelector('.mt-card');
    var themeBtn = root.querySelector('.mt-theme');

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
        card.appendChild(a);
    });

    /* ============================================================
       主题切换（与 site-header 同一逻辑）
       localStorage 落地 · 以切换钮为圆心 View Transition 圆形扩散
       · 矩阵通过 optionext:themechange 事件同步变色
       ============================================================ */
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

    /* ============================================================
       液态玻璃交互：指针微光 + 渐近橡皮筋拽开 + 液态形变 + 松手复位
       · 手感：轻拖只动一点点；手拖到屏幕另一端，控件也只移动一小段
         （渐近曲线，位移永远趋近上限而不死顶），形变随之加大
       · 横向拖变长变窄；纵向拖变短变宽
       · 卡片与圆钮各自独立响应；拖拽后松手的 click 被吞掉，点按不受影响
       · touch-action:none + 无 PointerEvent 时的 touch 兜底，保证真机可用
       ============================================================ */
    (function () {
        var reduced = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var hoverable = window.matchMedia &&
            window.matchMedia('(hover: hover)').matches;
        var DRAG_GATE = 4;

        function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
        /* 渐近橡皮筋：手位移 m 再大，控件位移也只趋近 max；tau 越大近处越"沉" */
        function asym(m, max, tau) {
            if (!m) return 0;
            return (m < 0 ? -1 : 1) * max * (1 - Math.exp(-Math.abs(m) / tau));
        }

        function bind(glass, maxX, tauX, maxY, tauY, edgeD) {
            var down = false, moved = false, armed = false;
            var startX = 0, startY = 0;
            var px = 0, py = 0;
            var gxNorm = 0;   // 按压点水平位置 -1..1：决定垂直拖时哪一侧先沉
            var raf = 0, rect = null;

            function schedule() {
                if (raf) return;
                raf = requestAnimationFrame(flush);
            }
            function flush() {
                raf = 0;
                if (!rect) rect = glass.getBoundingClientRect();
                glass.style.setProperty('--gx', (px - rect.left).toFixed(1) + 'px');
                glass.style.setProperty('--gy', (py - rect.top).toFixed(1) + 'px');

                if (!down || !moved || reduced) return;
                var mx = px - startX, my = py - startY;
                var horiz = Math.abs(mx) >= Math.abs(my);
                var dx = asym(mx, maxX, tauX);
                var dy = asym(my, maxY, tauY);
                var p = Math.max(
                    clamp01(Math.abs(dx) / maxX),
                    clamp01(Math.abs(dy) / maxY)
                );
                glass.style.setProperty('--dx', dx.toFixed(2) + 'px');
                glass.style.setProperty('--dy', dy.toFixed(2) + 'px');
                if (horiz) {
                    glass.style.setProperty('--rot', (dx * 0.12).toFixed(2) + 'deg');
                    glass.style.setProperty('--skx',
                        (clamp01(Math.abs(dx) / maxX) * 4 * (mx < 0 ? -1 : 1)).toFixed(2) + 'deg');
                    glass.style.setProperty('--sky', '0deg');
                } else {
                    /* 垂直拖：按下的那一侧跟随手指先沉（skewY 使 ux>0 处视觉下移，
                       角度符号 = 拖动方向 × 按压点侧别；幅度按边缘位移反算） */
                    var pv2 = clamp01(Math.abs(dy) / maxY);
                    var tilt = (my < 0 ? -1 : 1) * gxNorm *
                        Math.atan((pv2 * edgeD) / (rect.width / 2)) * 180 / Math.PI;
                    glass.style.setProperty('--rot', '0deg');
                    glass.style.setProperty('--skx', '0deg');
                    glass.style.setProperty('--sky', tilt.toFixed(2) + 'deg');
                }
                glass.style.setProperty('--sx', (1 + p * 0.05).toFixed(3));  // 拖向变长/变宽
                glass.style.setProperty('--sy', (1 - p * 0.05).toFixed(3));  // 横向变窄 / 纵向变短
            }
            function release() {
                if (!down) return;
                down = false;
                armed = moved;
                moved = false;
                glass.classList.remove('mt-press', 'mt-drag');
                ['--dx', '--dy', '--rot', '--skx', '--sky', '--sx', '--sy'].forEach(function (k) {
                    glass.style.removeProperty(k);
                });
                if (raf) { cancelAnimationFrame(raf); raf = 0; }
                setTimeout(function () { armed = false; }, 300);
            }
            function begin(x, y) {
                down = true; moved = false;
                startX = px = x;
                startY = py = y;
                rect = glass.getBoundingClientRect();
                var cx = rect.left + rect.width / 2, w2 = rect.width / 2 || 1;
                gxNorm = Math.max(-1, Math.min(1, (x - cx) / w2));
                glass.classList.add('mt-press');
                schedule();
            }
            function dragMove(x, y) {
                px = x; py = y;
                if (down && !moved && Math.hypot(px - startX, py - startY) > DRAG_GATE) {
                    moved = true;
                    if (!reduced) glass.classList.add('mt-drag');
                }
                schedule();
            }

            if (window.PointerEvent) {
                glass.addEventListener('pointerdown', function (e) {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    begin(e.clientX, e.clientY);
                });
                glass.addEventListener('pointermove', function (e) {
                    if (down || !hoverable) return;
                    px = e.clientX; py = e.clientY;
                    schedule();
                });
                window.addEventListener('pointermove', function (e) {
                    if (down) dragMove(e.clientX, e.clientY);
                });
                window.addEventListener('pointerup', release);
                window.addEventListener('pointercancel', release);
            } else {
                /* 旧移动浏览器（无 PointerEvent，如 iOS 12）：跟踪第一根手指 */
                var tid = null;
                function findTouch(list, id) {
                    for (var i = 0; i < list.length; i++)
                        if (list[i].identifier === id) return list[i];
                    return null;
                }
                glass.addEventListener('touchstart', function (e) {
                    if (tid !== null) return;
                    var t = e.changedTouches[0];
                    tid = t.identifier;
                    begin(t.clientX, t.clientY);
                }, { passive: false });
                window.addEventListener('touchmove', function (e) {
                    if (tid === null) return;
                    var t = findTouch(e.touches, tid);
                    if (!t) return;
                    dragMove(t.clientX, t.clientY);
                    if (moved) e.preventDefault();   // 双保险：阻止页面滚动抢走手势
                }, { passive: false });
                function endTouch() { if (tid === null) return; tid = null; release(); }
                window.addEventListener('touchend', endTouch);
                window.addEventListener('touchcancel', endTouch);
            }
            window.addEventListener('resize', function () {
                rect = null;
                schedule();   // 用最后已知指针位置把光斑校正回玻璃内
            });
            glass.addEventListener('click', function (e) {
                if (armed) {
                    e.stopPropagation();
                    e.preventDefault();
                    armed = false;
                }
            }, true);
        }

        /* 卡片：横向可渐近到 46px（手划到屏幕另一端时），纵向 30px；
           圆钮更小：26 / 18px。edgeD=垂直拖满时受力侧边缘额外下沉量 */
        bind(card, 46, 130, 30, 110, 10);
        bind(themeBtn, 26, 110, 18, 90, 5);
    })();

    /* ---------- 挂载 ---------- */
    function mount() { document.body.appendChild(root); }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();

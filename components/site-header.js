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

    /* ---------- 主题图标：明 / 暗模式下各显“另一半” ----------
       亮色显月亮（点按进入暗色）· 暗色显太阳（点按进入亮色） */
    var ICON_MOON =
        '<svg class="sh-ic-moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" ' +
                'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    var ICON_SUN =
        '<svg class="sh-ic-sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.6"/>' +
            '<path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3' +
                     'M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" ' +
                'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
        '</svg>';

    /* ---------- 构建 DOM ---------- */
    var root = document.createElement('div');
    root.className = 'sh-root';
    root.innerHTML =
        '<div class="sh-bar">' +
            '<span class="sh-clip" aria-hidden="true"><i class="sh-sheen"></i></span>' +
            '<a class="sh-brand" href="' + ROOT + 'index.html" aria-label="Optionext 药铺子 · 首页">' +
                '<img alt="药铺子 Optionext" loading="eager">' +
            '</a>' +
            '<nav class="sh-nav" aria-label="主导航"></nav>' +
            '<button class="sh-toggle" type="button" aria-label="切换到暗色模式" aria-pressed="false" title="切换另一半">' +
                '<span class="sh-icon">' + ICON_MOON + ICON_SUN + '</span>' +
            '</button>' +
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
        toggle.setAttribute('data-icon', dark ? 'sun' : 'moon');
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

    /* ============================================================
       液态玻璃交互：
       · 指针微光：静态渐变圆片 + transform 跟随（合成线程）
       · 横向：渐近橡皮筋——近处几乎不动，手拖很远控件只移一小段
       · 纵向（桌面）：较为跟手，越过阈值松手 → 页眉吸附到底部；
         底部再向上拖过阈值 → 回顶部（--dock 锚点 + 弹簧飞行）
       · 液态形变：横向拖变长变窄，纵向拖变短变宽，松手弹簧复位
       · 拖拽后松手的 click 被吞掉；普通点按放行
       PointerEvent 不可用的旧移动浏览器走 touch 事件兜底。
       ============================================================ */
    var glass = root.querySelector('.sh-bar');
    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hoverable = window.matchMedia &&
        window.matchMedia('(hover: hover)').matches;

    var DOCK_KEY = 'optionext-hdock';
    var H_MAX = 26, H_TAU = 120;      // 横向渐近：位移上限 px / 手感常数（越大越"不跟手"）
    var V_FOLLOW = 0.72;              // 纵向跟手系数（1=完全跟手）
    var DRAG_GATE = 4;

    var docked = false;               // 当前锚点：false=顶部 true=底部
    var flyingTimer = 0, resizeTimer = 0;
    var down = false, moved = false, armed = false, armedHint = false;
    var startX = 0, startY = 0;
    var px = 0, py = 0;
    var raf = 0, rect = null;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    /* 渐近橡皮筋：手位移 m 再大，控件位移也只趋近 max（斜率随距离衰减） */
    function asym(m, max, tau) {
        if (!m) return 0;
        return (m < 0 ? -1 : 1) * max * (1 - Math.exp(-Math.abs(m) / tau));
    }
    function dockOffset() { return window.innerHeight - root.offsetHeight - 28; }
    function dockGate() { return Math.min(220, window.innerHeight * 0.26); }

    function setDockVar() {
        root.style.setProperty('--dock', docked ? dockOffset().toFixed(1) + 'px' : '0px');
    }
    function initDock() {
        try { docked = localStorage.getItem(DOCK_KEY) === 'bottom'; } catch (e) { docked = false; }
        root.classList.toggle('sh-docked', docked);
        setDockVar();   // 挂载同帧写入：首帧即终值，不触发过渡
    }
    function commitDock(next) {
        docked = next;
        root.classList.toggle('sh-docked', docked);
        setDockVar();
        try { localStorage.setItem(DOCK_KEY, docked ? 'bottom' : 'top'); } catch (e) {}
        root.classList.add('sh-flying');
        clearTimeout(flyingTimer);
        flyingTimer = setTimeout(function () { root.classList.remove('sh-flying'); }, 620);
    }

    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(flush);
    }
    function flush() {
        raf = 0;
        if (!rect) rect = glass.getBoundingClientRect();
        var r = rect;
        glass.style.setProperty('--gx', (px - r.left).toFixed(1) + 'px');
        glass.style.setProperty('--gy', (py - r.top).toFixed(1) + 'px');

        if (!down || !moved || reduced) return;
        var mx = px - startX, my = py - startY;
        var horiz = Math.abs(mx) >= Math.abs(my);

        var dx = asym(mx, H_MAX, H_TAU);          // 横向：渐近、不跟手

        var off = dockOffset(), over = 80;        // 纵向：较跟手，夹在两个锚点之间（留 80px 过冲）
        var fy = clamp(my * V_FOLLOW,
            docked ? -(off + over) : -12,
            docked ? 12 : off + over);

        var gate = dockGate();
        var ph = clamp(Math.abs(dx) / H_MAX, 0, 1);
        var pv = clamp(Math.abs(my) / gate, 0, 1);
        var p = Math.max(ph, pv);                 // 形变程度 0..1

        glass.style.setProperty('--dx', dx.toFixed(2) + 'px');
        glass.style.setProperty('--rot', (dx * 0.12).toFixed(2) + 'deg');
        if (horiz) {
            glass.style.setProperty('--skx', (ph * 4 * (mx < 0 ? -1 : 1)).toFixed(2) + 'deg');
            glass.style.setProperty('--sky', '0deg');
        } else {
            glass.style.setProperty('--skx', '0deg');
            glass.style.setProperty('--sky', (pv * 3 * (my < 0 ? -1 : 1)).toFixed(2) + 'deg');
        }
        glass.style.setProperty('--sx', (1 + p * 0.05).toFixed(3));   // 拖向变长/变宽
        glass.style.setProperty('--sy', (1 - p * 0.05).toFixed(3));   // 横向变窄 / 纵向变短
        root.style.setProperty('--fy', fy.toFixed(2) + 'px');

        var willDock = !horiz && (docked ? my < -gate : my > gate);
        if (willDock !== armedHint) {
            armedHint = willDock;
            glass.classList.toggle('sh-dock-hint', willDock);
        }
    }
    function release() {
        if (!down) return;
        down = false;
        armed = moved;
        var doDock = armedHint;
        moved = false; armedHint = false;
        root.classList.remove('sh-dragging');                 // 恢复过渡
        glass.classList.remove('sh-press', 'sh-drag', 'sh-dock-hint');
        root.style.removeProperty('--fy');                    // fy 归零与 --dock 变更同帧 → 弹簧飞行
        ['--dx', '--rot', '--skx', '--sky', '--sx', '--sy'].forEach(function (k) {
            glass.style.removeProperty(k);
        });
        if (doDock) commitDock(!docked);
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        setTimeout(function () { armed = false; }, 300);
    }
    function begin(x, y) {
        down = true; moved = false; armedHint = false;
        startX = px = x; startY = py = y;
        rect = glass.getBoundingClientRect();
        glass.classList.add('sh-press');
        schedule();
    }
    function move(x, y) {
        px = x; py = y;
        if (down && !moved && Math.hypot(px - startX, py - startY) > DRAG_GATE) {
            moved = true;
            if (!reduced) {
                glass.classList.add('sh-drag');
                root.classList.add('sh-dragging');   // 冻结飞行过渡，纵向 1:1 跟手
            }
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
            if (down) move(e.clientX, e.clientY);
        });
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
    } else {
        /* 旧移动浏览器（无 PointerEvent，如 iOS 12）：touch 兜底，跟踪第一根手指 */
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
            move(t.clientX, t.clientY);
            if (moved) e.preventDefault();   // 双保险：阻止页面滚动抢走手势
        }, { passive: false });
        function endTouch() { if (tid === null) return; tid = null; release(); }
        window.addEventListener('touchend', endTouch);
        window.addEventListener('touchcancel', endTouch);
    }
    glass.addEventListener('click', function (e) {
        if (armed) {
            e.stopPropagation();
            e.preventDefault();
            armed = false;
        }
    }, true);

    /* 窗口缩放：缓存矩形作废（光斑下一帧自动校正）；底部锚点随高度瞬时跟随 */
    window.addEventListener('resize', function () {
        rect = null;
        if (docked) {
            root.classList.add('sh-dragging');
            setDockVar();
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { root.classList.remove('sh-dragging'); }, 160);
        }
        schedule();
    });

    /* ---------- 挂载 ---------- */
    function mount() {
        syncThemeUI();
        document.body.appendChild(root);
        initDock();
    }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();

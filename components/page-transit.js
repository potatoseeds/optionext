/* ============================================================
   OPTIONEXT · 软导航 page-transit.js
   纯原生、零依赖，所有页面在页眉/底栏组件之后引入：
     <script src="components/page-transit.js"></script>

   做什么：
     · 拦截同源内链点击，fetch 目标页后只替换 <main>
       —— 页眉 .sh-root / 底栏 .mt-root 节点全程不重载、不重建
     · 主体「淡出 → 换页 → 淡入」（约 .24s，reduced-motion 下瞬时切换）
     · history.pushState / popstate 保持浏览器前进后退可用
     · 同步目标页 title、换入目标页 style[data-page]（单页策略，
       离开页的样式同步移除）、
       重执行目标页 script[data-page-script]（如主页字符矩阵引擎）
     · 换页前后派发 window 事件：
         'optionext:pageteardown' —— 旧页资源可在此停（引擎也可直接
                                    注册 window.__optionextPageStop）
         'optionext:locationchange' —— 页眉/底栏据此刷新当前栏目红点

   约定：
     · 页面专属样式 <style data-page="home|projects|…">
       （单页策略：只保留当前页这一份，避免跨页全局规则互相污染）
     · 页面专属启动脚本 <script data-page-script>…</script>
       （内联文本会在新主体就位后重跑；引擎离开时须能被
         window.__optionextPageStop() 停机，避免 rAF 空转）

   失败一律降级为整页跳转，任何异常都不阻断导航。
   ============================================================ */
(function () {
    'use strict';

    if (window.__OPTIONEXT_TRANSIT_LOADED__) return;
    window.__OPTIONEXT_TRANSIT_LOADED__ = true;

    if (!window.fetch || !window.DOMParser || !window.history || !window.history.pushState) return;

    var FADE = 240;
    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) FADE = 0;

    var busy = false;

    /* ---------------- 过渡样式（只注入一次） ---------------- */
    var style = document.createElement('style');
    style.textContent =
        'main{transition:opacity .24s ease,transform .24s ease}' +
        'html.page-leaving main{opacity:0;transform:translateY(8px)}' +
        '@media (prefers-reduced-motion:reduce){' +
            'main{transition:none}' +
            'html.page-leaving main{transform:none}' +
        '}';
    document.head.appendChild(style);

    /* ---------------- 工具 ---------------- */
    function hardGo(href) { window.location.assign(href); }

    /* 把新文档主体内的相对资源地址按“目标页 URL”改写成绝对地址，
       避免插入当前文档后被按当前目录解析（/projects/ → / 场景） */
    function absolutize(baseUrl, doc) {
        var nodes = doc.querySelectorAll('main [src],main [href],main [poster]');
        Array.prototype.forEach.call(nodes, function (el) {
            ['src', 'href', 'poster'].forEach(function (attr) {
                var v = el.getAttribute(attr);
                if (v == null || v === '' || v.charAt(0) === '#') return;
                try { el.setAttribute(attr, new URL(v, baseUrl).href); } catch (e) {}
            });
        });
    }

    function render(href, html, push) {
        var doc;
        try {
            doc = new DOMParser().parseFromString(html, 'text/html');
        } catch (e) { hardGo(href); return; }

        var incoming = doc.querySelector('main');
        if (!incoming) { hardGo(href); return; }

        absolutize(href, doc);

        /* 1) 旧页停机：矩阵引擎停 rAF / 摘窗口监听 */
        try { window.dispatchEvent(new CustomEvent('optionext:pageteardown')); } catch (e) {}
        try {
            if (typeof window.__optionextPageStop === 'function') window.__optionextPageStop();
        } catch (e) {}
        window.__optionextPageStop = null;

        /* 2) 换主体 */
        var oldMain = document.querySelector('main');
        if (!oldMain) { hardGo(href); return; }
        oldMain.replaceWith(incoming);

        /* 3) 单页样式：移除其它页的 style[data-page]，只保留/注入目标页那份。
           各页含全局裸规则（如 h1 边距），多页共存会互相污染；
           各页 :root 令牌取值一致，替换不会产生主题闪烁 */
        var keepKeys = {};
        var pageStyles = doc.querySelectorAll('style[data-page]');
        Array.prototype.forEach.call(pageStyles, function (s) {
            var key = s.getAttribute('data-page');
            if (key) keepKeys[key] = s.textContent;
        });
        Array.prototype.forEach.call(document.querySelectorAll('style[data-page]'), function (s) {
            if (!keepKeys.hasOwnProperty(s.getAttribute('data-page'))) s.remove();
        });
        Object.keys(keepKeys).forEach(function (key) {
            var ns = document.createElement('style');
            ns.setAttribute('data-page', key);
            ns.textContent = keepKeys[key];
            document.head.appendChild(ns);
        });

        /* 4) 标题 / 历史 / 滚动位 */
        if (doc.title) document.title = doc.title;
        if (push !== false) {
            try { history.pushState({ optionextTransit: 1 }, '', href); } catch (e) {}
        }
        window.scrollTo(0, 0);

        /* 5) 页眉 / 底栏刷新红点（节点本身不重建） */
        window.dispatchEvent(new CustomEvent('optionext:locationchange'));

        /* 6) 重跑目标页启动脚本（字符矩阵引擎等） */
        var pageScript = doc.querySelector('script[data-page-script]');
        if (pageScript && pageScript.textContent.trim()) {
            var ns = document.createElement('script');
            ns.textContent = pageScript.textContent;
            document.body.appendChild(ns);   // 同步执行
            ns.remove();                     // 执行后即可移除，闭包/监听已自行留存
        }

        /* 7) 双 rAF 后淡入（确保新主体先以 opacity:0 上屏一帧） */
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                document.documentElement.classList.remove('page-leaving');
            });
        });
        setTimeout(function () { busy = false; }, FADE + 80);
    }

    function go(href, push) {
        if (busy) return;
        busy = true;
        document.documentElement.classList.add('page-leaving');

        setTimeout(function () {
            fetch(href, { credentials: 'same-origin' })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.text();
                })
                .then(function (html) { render(href, html, push); })
                .catch(function () { hardGo(href); });
        }, FADE);
    }

    /* ---------------- 点击拦截 ---------------- */
    document.addEventListener('click', function (e) {
        if (busy || e.defaultPrevented) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        var a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        if (a.target && a.target !== '' && a.target.toLowerCase() !== '_self') return;
        if (a.hasAttribute('download')) return;

        var url;
        try { url = new URL(a.href, location.href); } catch (err) { return; }
        if (url.origin !== location.origin) return;
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

        /* 同页（仅 hash 不同，如 #team、#）：交给浏览器原生锚点行为 */
        if (url.pathname === location.pathname && url.search === location.search) return;

        e.preventDefault();
        go(url.href, true);
    });

    /* ---------------- 前进 / 后退 ---------------- */
    window.addEventListener('popstate', function () {
        if (busy) return;
        go(location.href, false);
    });
})();

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

    /* ---------------- 真实文件 vs 显示地址 ----------------
       网络层永远请求【真实文件】（index.html / mobile.html /
       projects/mobile.html…），地址栏只显示目录形式（/、/projects/，
       桌面/移动共用同一显示地址）。绝不能 fetch 裸目录——file:// 直开、
       关闭目录索引、对 .html 做规范化跳转的服务器都会因此出错。
       每个软导航历史条目把真实文件地址存在 history.state.f，
       前进/后退时据此请求。
       canonPath 前面必须带 '/'，避免误伤 fooindex.html 这类详情页。 */
    var FLAVOR = document.documentElement.getAttribute('data-flavor') === 'mob'
        ? 'mob' : 'desk';

    function canonPath(p) {
        return p.replace(/\/(index|mobile)\.html$/i, '/');
    }

    /* 当前文档对应的真实文件地址（写入初始历史条目的 state.f） */
    function currentRealHref() {
        var p = location.pathname;
        if (/\/(index|mobile)\.html$/i.test(p)) return location.href;
        if (p.charAt(p.length - 1) === '/') {
            return p + (FLAVOR === 'mob' ? 'mobile.html' : 'index.html') +
                location.search + location.hash;
        }
        return location.href;   // 普通详情页：原样
    }

    /* 落地整理：地址栏静默显示目录形式，真实文件地址存进 state.f。
       纯 replaceState，不刷新、不新增历史条目（device-guard 信任
       <html data-flavor>，不会因这个显示地址误跳） */
    (function () {
        var display = canonPath(location.pathname) + location.search + location.hash;
        var st = {};
        try { st = history.state || {}; } catch (e) {}
        var need = !st.optionextTransit ||
            st.f !== currentRealHref() ||
            canonPath(location.pathname) !== location.pathname;
        if (need) {
            try {
                history.replaceState(
                    { optionextTransit: 1, f: currentRealHref() },
                    '', display);
            } catch (e) {}
        }
    })();

    /* 当前已渲染文档的规范路径（不含 hash）。
       点击 <a href="#xxx"> 产生的 popstate 只改 hash，据此识别并放行 */
    var docPath = canonPath(location.pathname) + location.search;

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
        var targetUrl;
        try { targetUrl = new URL(href, location.href); } catch (e) { targetUrl = null; }

        if (doc.title) document.title = doc.title;
        /* 地址栏写目录规范形式；真实 fetch 地址（真实文件）存 state.f，
           前进/后退靠它重新请求——绝不直接 fetch 裸目录 */
        var display = targetUrl
            ? canonPath(targetUrl.pathname) + targetUrl.search + targetUrl.hash
            : href;
        if (push !== false) {
            try { history.pushState({ optionextTransit: 1, f: href }, '', display); } catch (e) {}
        }
        /* push===false（前进/后退）：历史条目本就是本层写入的规范形式，不再动 */
        docPath = targetUrl ? canonPath(targetUrl.pathname) + targetUrl.search : docPath;

        /* 目标带 hash（如 projects/x.html#sec）：换页后落到对应锚点；否则回顶 */
        var hashEl = targetUrl && targetUrl.hash
            ? document.getElementById(targetUrl.hash.slice(1))
            : null;
        if (hashEl) hashEl.scrollIntoView();
        else window.scrollTo(0, 0);

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

        /* 同一页面（规范地址相同，忽略 /index.html 与 / 的字面差异）：
           · 指向不同锚点（#team 等）→ 交给浏览器原生锚点滚动；
           · 重复点击当前栏目 → preventDefault 后什么都不做：
             不请求、不淡出、不重跑脚本，<main> 与页眉/底栏纹丝不动。
           地址栏在落地时已规范，这里无需再动历史 */
        if (canonPath(url.pathname) === canonPath(location.pathname) &&
            url.search === location.search) {
            if (url.hash && url.hash !== location.hash) return;
            e.preventDefault();
            return;
        }

        e.preventDefault();
        go(url.href, true);
    });

    /* ---------------- 前进 / 后退 ----------------
       注意：点击页内 <a href="#xxx"> 是同源文档内跳转，浏览器同样会派发
       popstate —— 这种只改 hash 的情况必须放行，交给原生锚点行为 */
    window.addEventListener('popstate', function (e) {
        if (busy) return;
        if (canonPath(location.pathname) + location.search === docPath) return;
        /* 真实文件地址存在 state.f：软导航按它 fetch 真实文件；
           没有 state.f 的历史条目（非本层产生）→ 整页加载兜底 */
        var f = e.state && e.state.f;
        if (f) go(f, false);
        else hardGo(location.href);
    });
})();

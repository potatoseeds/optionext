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

    if (!window.DOMParser || !window.history) return;

    /* ---------- 站点根目录（由本组件自身 URL 推导，与页眉组件同款） ---------- */
    var ROOT_HREF = null;
    try {
        ROOT_HREF = new URL('../', document.currentScript.src, document.baseURI).href;
    } catch (e) {}
    /* 暴露给各页 data-page-script：软导航换页后只重跑内联启动脚本、
       不加载目标页的外部 <script src>，页面专属组件需要据此自行补载。
       file:// 软导航不改地址栏，相对路径会从“初始落地目录”解析而指错，
       用本根地址可在任意入口目录下拼出正确的组件 URL */
    window.__OPTIONEXT_ROOT__ = ROOT_HREF;

    /* ---------- 页面清单（tools/build_manifest.py 生成） ----------
       file:// 直开时 fetch/XHR 被浏览器安全策略禁止，软导航改从清单取
       目标页 HTML；http(s) 下 fetch 失败（漏传/临时故障）时兜底。 */
    function manifestGet(href) {
        var m = window.__OPTIONEXT_PAGE_MANIFEST__;
        if (!m || !m.pages || !ROOT_HREF || href.slice(0, ROOT_HREF.length) !== ROOT_HREF) return null;
        var key = href.slice(ROOT_HREF.length).split('#')[0].split('?')[0];
        return Object.prototype.hasOwnProperty.call(m.pages, key) ? m.pages[key] : null;
    }

    var FADE = 240;
    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) FADE = 0;

    var busy = false;
    var pendingHref = null;        // 过渡进行中又点了导航：排队，绝不放行成原生硬跳转

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

    /* 路径规范化：识别真实文件的多种落地形式，统一成“目录形式”。
       托管可能把 .html 扩展名去掉（clean URL）：
         /mobile.html、/mobile        -> /
         /projects/mobile.html、/projects/mobile -> /projects/
         /index.html、/index          -> /
       canonPath 前的 / 保证不误伤 /mobileism 这类路径（必须以
       /mobile 或 /mobile.html 结尾）。 */
    function canonPath(p) {
        return p.replace(/\/(?:index|mobile)(?:\.html)?$/i, '/');
    }

    /* 当前文档对应的真实文件地址（写入初始历史条目的 state.f） */
    function currentRealHref() {
        var p = location.pathname;
        if (/\/(?:index|mobile)\.html$/i.test(p)) return location.href;
        var bare = /\/(?:index|mobile)$/i.test(p);   // clean URL：/mobile、/index
        if (p.charAt(p.length - 1) === '/' || bare) {
            var dir = bare ? p.slice(0, p.lastIndexOf('/') + 1) : p;
            return dir + (FLAVOR === 'mob' ? 'mobile.html' : 'index.html') +
                location.search + location.hash;
        }
        return location.href;   // 普通详情页：原样
    }

    /* 落地整理：地址栏静默显示目录形式，真实文件地址存进 state.f。
       纯 replaceState，不刷新、不新增历史条目（device-guard 信任
       <html data-flavor>，不会因这个显示地址误跳） */
    (function () {
        /* file:// 下 pushState/replaceState 一律被安全策略禁止：
           地址栏保持初始文件地址，软路径由 window.__optionextSoftPath 维护 */
        if (location.protocol === 'file:') return;
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

    /* ============================================================
       file:// 虚拟 hash 路由
       ------------------------------------------------------------
       file:// 下 history.pushState 被安全策略禁止，软导航无法改地址栏。
       改用 location.hash 承载“站点相对虚拟地址”：
           物理文件 D:/Optionext/projects/index.html
           + 地址栏 hash  #/projects/?PG=1
       · hash 在 file:// 下可读写、产生历史条目（前进/后退生效）；
       · 路由 hash 一律以 '#/' 开头，普通锚点 '#xxx' 仍走原生滚动；
       · 网络层依旧取物理文件（页面清单），hash 只负责显示与历史。
       ============================================================ */
    var IS_FILE = location.protocol === 'file:';
    var ROOT_PATHNAME = null;
    try { ROOT_PATHNAME = new URL(ROOT_HREF).pathname; } catch (e) {}

    /* 真实文件 key（'projects/mobile.html'）→ 虚拟目录（'/projects/'） */
    function virtFromKey(key) {
        return '/' + String(key || '').replace(/(?:index|mobile)\.html$/i, '');
    }
    function filePhysicalKey() {
        if (ROOT_PATHNAME && location.pathname.indexOf(ROOT_PATHNAME) === 0)
            return decodeURIComponent(location.pathname.slice(ROOT_PATHNAME.length));
        return location.pathname.slice(location.pathname.lastIndexOf('/') + 1);
    }
    function fileKeyOfHref(href) {
        try {
            var u = new URL(href, location.href);
            if (u.protocol !== 'file:') return null;
            if (ROOT_PATHNAME && u.pathname.indexOf(ROOT_PATHNAME) === 0)
                return decodeURIComponent(u.pathname.slice(ROOT_PATHNAME.length));
            return decodeURIComponent(u.pathname.slice(u.pathname.lastIndexOf('/') + 1));
        } catch (e) { return null; }
    }
    function fileVirtOfHref(href) {
        var key = fileKeyOfHref(href);
        if (key == null) return null;
        var search = '';
        try { search = new URL(href, location.href).search || ''; } catch (e) {}
        return virtFromKey(key) + search;
    }
    /* 虚拟地址 → 物理文件 href（按当前 desk/mob flavor 选 index/mobile） */
    function fileHrefOfVirt(virt) {
        var path = (virt || '').split('?')[0].split('#')[0];
        var qi = virt.indexOf('?');
        var search = qi !== -1 ? virt.slice(qi) : '';
        var key;
        if (path === '/' || path === '') {
            key = FLAVOR === 'mob' ? 'mobile.html' : 'index.html';
        } else {
            key = path.replace(/^\/+/, '').replace(/\/+$/, '') + '/' +
                  (FLAVOR === 'mob' ? 'mobile.html' : 'index.html');
        }
        return ROOT_HREF + key + search;
    }
    function fileVirtPage(virt) {
        return (virt || '').split('?')[0].split('#')[0];
    }
    /* 地址栏 hash 承载的虚拟地址；无路由 hash 时由物理文件推导 */
    function fileCurrentVirt() {
        var h = location.hash || '';
        if (h.charAt(1) === '/') return h.slice(1);
        return virtFromKey(filePhysicalKey()) + location.search;
    }

    /* 当前已渲染文档的规范路径（不含 hash）。
       http(s)：物理路径规范化；file://：虚拟地址（hash 或物理推导）。
       点击 <a href="#xxx"> 产生的 popstate 只改 hash，据此识别并放行 */
    var docPath = IS_FILE
        ? fileCurrentVirt()
        : canonPath(location.pathname) + location.search;
    /* file:// 落地即给页眉/底栏一个正确软路径（栏目红点不等首次导航） */
    if (IS_FILE) window.__optionextSoftPath = docPath;

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
        if (IS_FILE) {
            /* file://：把虚拟地址写进 hash（地址栏可见、产生历史条目、
               前进/后退经 hashchange 回本层）。物理文件地址始终不变。 */
            var fkey = fileKeyOfHref(href);
            var fvirt = (fkey != null ? virtFromKey(fkey)
                                     : canonPath(targetUrl ? targetUrl.pathname : '')) +
                        (targetUrl ? targetUrl.search : '');
            if (push !== false) {
                var wantHash = '#' + fvirt;
                if (location.hash !== wantHash) {
                    try { location.hash = wantHash; } catch (e) {}
                }
            }
            docPath = fvirt;
            window.__optionextSoftPath = fvirt;
        } else if (push !== false) {
            try { history.pushState({ optionextTransit: 1, f: href }, '', display); } catch (e) {}
            /* push===false（前进/后退）：历史条目本就是本层写入的规范形式，不再动 */
            docPath = targetUrl ? canonPath(targetUrl.pathname) + targetUrl.search : docPath;
            window.__optionextSoftPath = null;
        } else {
            docPath = targetUrl ? canonPath(targetUrl.pathname) + targetUrl.search : docPath;
        }

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
        setTimeout(function () {
            busy = false;
            /* 过渡进行中被排队的点击：此时续航，避免原生硬加载导致页眉重建 */
            if (pendingHref) {
                var next = pendingHref;
                pendingHref = null;
                go(next, true);
            }
        }, FADE + 80);
    }

    /* 取目标页 HTML：
       · file:// —— 浏览器禁止 fetch 本地文件，只从页面清单取；
         清单缺页（新增页面未重新生成）才整页跳转
       · http(s) —— 实时 fetch；失败时用清单兜底（如漏传文件的部署），
         清单也没有才整页跳转 */
    function fetchPage(href) {
        if (location.protocol === 'file:') {
            var cached = manifestGet(href);
            return cached != null
                ? Promise.resolve(cached)
                : Promise.reject(new Error('manifest miss'));
        }
        if (!window.fetch) return Promise.reject(new Error('no fetch'));
        return fetch(href, { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .catch(function (err) {
                var fallback = manifestGet(href);
                if (fallback != null) return fallback;
                throw err;
            });
    }

    function go(href, push) {
        if (busy) return;
        busy = true;
        document.documentElement.classList.add('page-leaving');

        setTimeout(function () {
            fetchPage(href)
                .then(function (html) { render(href, html, push); })
                .catch(function () { hardGo(href); });
        }, FADE);
    }

    /* ---------------- 点击拦截 ---------------- */
    document.addEventListener('click', function (e) {
        if (e.defaultPrevented) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        var a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        if (a.target && a.target !== '' && a.target.toLowerCase() !== '_self') return;
        if (a.hasAttribute('download')) return;

        var url;
        try { url = new URL(a.href, location.href); } catch (err) { return; }
        /* 协议必须与当前文档一致（file↔http 混链交原生）；file:// 下
           每个本地文件的 origin 都相同，同源判断无意义，改由 ROOT 前缀
           + 页面清单命中与否决定（miss 时自然降级整页跳转） */
        var isFile = location.protocol === 'file:';
        if (url.protocol !== location.protocol) return;
        if (!isFile && url.origin !== location.origin) return;

        /* 同一页面（规范地址相同，忽略 /index.html 与 / 的字面差异）：
           · 指向不同锚点（#team 等）→ 交给浏览器原生锚点滚动；
           · 重复点击当前栏目 → preventDefault 后什么都不做：
             不请求、不淡出、不重跑脚本，<main> 与页眉/底栏纹丝不动。
           http(s) 用物理规范路径；file:// 物理文件永不切换，必须按
           hash 承载的虚拟地址比较，否则“回根目录再点当前栏目”会误判 */
        if (isFile) {
            var tvirt = fileVirtOfHref(url.href);
            if (tvirt === docPath) {
                /* '#xxx' 普通锚点（非 '#/' 路由 hash）交原生滚动 */
                if (url.hash && url.hash.slice(0, 2) !== '#/' &&
                    url.hash !== location.hash) return;
                e.preventDefault();
                return;
            }
        } else if (canonPath(url.pathname) + url.search === docPath) {
            if (url.hash && url.hash !== location.hash) return;
            e.preventDefault();
            return;
        }

        e.preventDefault();
        /* 过渡进行中：排队等续航，不放行成浏览器原生跳转（否则整页刷新、页眉重建） */
        if (busy) { pendingHref = url.href; return; }
        go(url.href, true);
    });

    /* ---------------- 前进 / 后退 ----------------
       注意：点击页内 <a href="#xxx"> 是同源文档内跳转，浏览器同样会派发
       popstate —— 这种只改 hash 的情况必须放行，交给原生锚点行为 */
    function onBack() {
        if (busy) return;

        if (IS_FILE) {
            var h = location.hash || '';
            /* 非 '#/' 路由 hash：普通锚点 / 浏览器原生行为，放行 */
            if (h.charAt(1) !== '/') return;
            var nv = fileCurrentVirt();
            if (nv === docPath) return;
            if (fileVirtPage(nv) === fileVirtPage(docPath)) {
                /* 同栏目、仅查询串变化（项目页抽屉 ?PG=n 的开合）：
                   不整页重渲染，只同步软路径；抽屉自己的 popstate
                   监听会据 ?PG 展开 / 收起 */
                docPath = nv;
                window.__optionextSoftPath = nv;
                return;
            }
            /* 跨栏目前进 / 后退：按虚拟地址还原物理文件，软导航取清单 */
            go(fileHrefOfVirt(nv), false);
            return;
        }

        if (canonPath(location.pathname) + location.search === docPath) return;
        /* 真实文件地址存在 state.f：软导航按它 fetch 真实文件；
           没有 state.f 的历史条目（非本层产生）→ 整页加载兜底 */
        var f = history.state && history.state.f;
        if (f) go(f, false);
        else hardGo(location.href);
    }
    /* hash 变化在浏览器里 popstate / hashchange 都会派发；
       两入口共用同一判重逻辑，重复触发自然被 nv===docPath 挡掉 */
    window.addEventListener('popstate', onBack);
    window.addEventListener('hashchange', onBack);

    /* ---------------- file:// 落地引导 ----------------
       物理文件与路由 hash（#/…）指向不同栏目时（刷新、收藏直开），
       以 hash 为准软导航一次，保证“所见地址”与页面内容一致 */
    if (IS_FILE && location.hash.charAt(1) === '/') {
        var bootVirt = fileCurrentVirt();
        var physVirt = virtFromKey(filePhysicalKey());
        if (fileVirtPage(bootVirt) !== fileVirtPage(physVirt)) {
            go(fileHrefOfVirt(bootVirt), false);
        }
    }
})();

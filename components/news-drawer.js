/* ============================================================
   OPTIONEXT · 新闻板块（抽屉）组件 news-drawer.js
   纯原生、零依赖，项目页（desk / mob 同一份）在软导航之前引入：
     <script src="../components/news-drawer.js"></script>
     <script data-page-script>window.OptionextNewsDrawer()</script>

   做什么：
     · 每条新闻是一个 .news[data-pg] 板块，点头部在原位展开抽屉，
       抽屉内 <iframe data-src> 直接载入对应的独立 HTML 文件；
     · 同时只展开一条（手风琴），再点一次同一条即收起；
     · URL 同步为 ?PG=n（可直接复制 / 收藏的文档链接）：
       http(s) 下写 history（state 结构与 page-transit 兼容，
       前进 / 后退既能内联开合，也能由软导航整体重建）；
       file:// 下 pushState 被禁，退化为 __optionextSoftPath
       + locationchange，供页眉红点追踪（与软导航同约定）；
     · 落地带 ?PG=n 时自动展开对应板块；
     · iframe 高度由子文档 frame-fit.js 经 postMessage 上报，
       父子跨域（file://）也能用；2s 无上报则兜底高度，绝不卡死。

   页面被软导航切走时，page-transit 会调 window.__optionextPageStop()
   完成本实例的全部摘听；新主体就位后 data-page-script 重新初始化。
   ============================================================ */
(function () {
    'use strict';

    var FLAVOR = document.documentElement.getAttribute('data-flavor') === 'mob'
        ? 'mob' : 'desk';

    /* 上一个实例（软导航重建主体时）先停机，避免窗口监听叠加 */
    var current = null;
    function stopCurrent() {
        try { if (current && typeof current.stop === 'function') current.stop(); }
        catch (e) {}
        current = null;
        window.__optionextPageStop = null;
    }

    function init() {
        stopCurrent();

        var blocks = Array.prototype.slice.call(document.querySelectorAll('.news[data-pg]'));
        if (!blocks.length) return null;

        /* ---------- ?PG 读写 ----------
           http(s)：参数在 location.search；
           file://：软导航把虚拟地址放在路由 hash（#/projects/?PG=1），
           直接双击物理文件带 ?PG=1 时参数仍在 location.search */
        function virtSearch() {
            if (location.protocol === 'file:') {
                var h = location.hash || '';
                if (h.charAt(1) === '/') {
                    var qi = h.indexOf('?');
                    return qi !== -1 ? h.slice(qi) : '';
                }
                return location.search || '';
            }
            return location.search || '';
        }
        function pgFromSearch() {
            var m = /[?&]PG=(\d+)/i.exec(virtSearch());
            return m ? m[1] : null;
        }

        /* history.state.f：与 page-transit 同构的“真实文件地址”，
           万一该历史条目由软导航 popstate 接管，fetch 它即可 */
        function realFileHref(pg) {
            var p = location.pathname;
            var file;
            if (/\/(index|mobile)\.html$/i.test(p)) file = p;
            else if (p.charAt(p.length - 1) === '/')
                file = p + (FLAVOR === 'mob' ? 'mobile.html' : 'index.html');
            else file = p;
            return file + (pg ? '?PG=' + encodeURIComponent(pg) : '') + location.hash;
        }

        /* 地址栏只显示目录形式（与 page-transit canonPath 同款） */
        function displayHref(pg) {
            var dir = location.pathname.replace(/\/(index|mobile)\.html$/i, '/');
            return dir + (pg ? '?PG=' + encodeURIComponent(pg) : '') + location.hash;
        }

        /* ---------- 元素索引 ---------- */
        var items = blocks.map(function (block) {
            return {
                pg: String(block.getAttribute('data-pg')),
                block: block,
                head: block.querySelector('.news-head'),
                frame: block.querySelector('.news-frame'),
                box: block.querySelector('.news-frame-box'),
                loaded: false,
                docReady: false,
                fitted: false,
                timers: []
            };
        });

        function byPg(pg) {
            for (var i = 0; i < items.length; i++)
                if (items[i].pg === String(pg)) return items[i];
            return null;
        }

        var activePg = null;

        function failHint(it, reason) {
            var hint = it.box ? it.box.querySelector('.news-frame-hint') : null;
            if (!hint) return;
            hint.textContent = reason;
            hint.classList.add('is-error');
        }

        /* 同源（http(s) 直连 / 经 308 到同站）时父页直接量子文档高度，
           不必等 postMessage 往返——慢网、平台 .html→无扩展名 308
           （猫仔云等）下也能在 load 瞬间贴合；file:// 下访问 contentDocument
           会抛 SecurityError，自动退回子文档 frame-fit.js 的消息通道 */
        function directMeasure(it) {
            var doc = null;
            try { doc = it.frame.contentDocument; } catch (e) { doc = null; }
            if (!doc || !doc.documentElement) return false;
            var de = doc.documentElement;
            var h = Math.max(de.scrollHeight, de.offsetHeight,
                doc.body ? doc.body.scrollHeight : 0);
            if (h > 0) { fitFrame(it.frame, h); return true; }
            return false;
        }

        function clearTimers(it) {
            (it.timers || []).forEach(function (t) { clearTimeout(t); });
            it.timers = [];
        }

        /* ---------- 主题同步到子文档 ----------
           外壳（site-header / mobile-tabbar）只改父页 <html data-theme>，
           iframe 是独立文档不会跟随。两条通道：
           · 同源 http(s)：直接写子文档 documentElement.dataset.theme；
           · file://（跨文档直读被拒）：postMessage，由 frame-fit.js 接收。
           子文档初载时也立即推一次当前主题 */
        function currentTheme() {
            return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        }
        function pushTheme(it, theme) {
            if (!it.frame || !it.loaded) return;
            try {
                if (it.frame.contentDocument && it.frame.contentDocument.documentElement)
                    it.frame.contentDocument.documentElement.dataset.theme = theme;
            } catch (e) {}
            try {
                if (it.frame.contentWindow)
                    it.frame.contentWindow.postMessage(
                        { type: 'optionext:frame-theme', theme: theme }, '*');
            } catch (e) {}
        }
        function broadcastTheme() {
            var t = currentTheme();
            items.forEach(function (it) { pushTheme(it, t); });
        }

        /* ---------- iframe 载入 / 高度 ---------- */
        function ensureFrame(it) {
            if (!it.frame || it.loaded) return;
            it.loaded = true;
            var src = it.frame.getAttribute('data-src') || '';

            it.frame.addEventListener('load', function () {
                it.docReady = true;
                clearTimers(it);

                /* 0) 主题：子文档落地瞬间与外壳保持一致（子文档自带
                   localStorage 防闪烁，此处纠正“载入后才切主题”的时差） */
                pushTheme(it, currentTheme());

                /* 1) 同源直量：load 即贴合，随后再补几轮等字体 / 图片落位 */
                directMeasure(it);
                [120, 360, 800, 1500, 2400].forEach(function (ms) {
                    it.timers.push(setTimeout(function () { directMeasure(it); }, ms));
                });

                /* 2) load 之后仍贴合失败：子文档脚本缺失 / 被拦 / 404 页，
                   给出显性原因（子文档 frame-fit.js 的消息随时可救回） */
                it.timers.push(setTimeout(function () {
                    if (it.fitted) return;
                    failHint(it, '文档高度获取失败：' + src +
                        '（子文档脚本缺失 / 被拦截，或该文件未随页面部署；强刷后重试）');
                }, 2600));
            });

            /* 3) load 始终没发生：网络不可达 / 文件根本不存在（云端漏传） */
            it.timers.push(setTimeout(function () {
                if (it.docReady || it.fitted) return;
                failHint(it, '文档载入失败或超时：' + src +
                    '（请确认该文件已随页面一起部署 / 刷新缓存后重试）');
            }, 9000));

            if (src) it.frame.setAttribute('src', src);
        }

        function fitFrame(frame, height) {
            var it = null;
            for (var i = 0; i < items.length; i++)
                if (items[i].frame === frame) { it = items[i]; break; }
            if (!it || !(height > 0)) return;
            it.fitted = true;
            var hint = it.box ? it.box.querySelector('.news-frame-hint') : null;
            if (hint) hint.classList.remove('is-error');
            /* 字体 / 图片异步到达时高度会先小后大；子文档 ResizeObserver
               的持续上报 + 同源直量补轮会不断给出最新值，始终采用最新值 */
            it.frame.style.height = Math.ceil(height) + 'px';
            if (it.box) it.box.classList.add('is-fit');
        }

        /* ---------- 开合 ---------- */
        function applyOpen(pg, opts) {
            opts = opts || {};
            var target = pg == null ? null : byPg(pg);
            activePg = target ? target.pg : null;
            items.forEach(function (it) {
                var open = !!(target && it === target);
                it.block.classList.toggle('is-open', open);
                if (it.head) it.head.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (open) ensureFrame(it);
            });
        }

        function openTo(pg, push) {
            var it = pg == null ? null : byPg(pg);
            var nextPg = it ? it.pg : null;
            if (push !== false) syncUrl(nextPg);
            applyOpen(nextPg);
        }

        /* ---------- 地址栏 / 历史 ---------- */
        function syncUrl(pg) {
            /* file://：pushState 整条被安全策略禁止，改把虚拟地址写进
               路由 hash（#/projects/?PG=1）——地址栏可见、可复制、
               前进/后退由 page-transit 的 hash 监听接管 */
            if (location.protocol === 'file:') {
                var soft = window.__optionextSoftPath || '';
                var page = soft.split('?')[0] || '/';
                if (page.charAt(0) !== '/') page = '/' + page;
                if (page.charAt(page.length - 1) !== '/') page += '/';
                var want = '#' + page + (pg ? '?PG=' + encodeURIComponent(pg) : '');
                window.__optionextSoftPath = page + (pg ? '?PG=' + encodeURIComponent(pg) : '');
                if (location.hash !== want) {
                    try { location.hash = want; } catch (e) {}
                }
                try { window.dispatchEvent(new CustomEvent('optionext:locationchange')); }
                catch (e) {}
                return;
            }
            try {
                history.pushState(
                    { optionextTransit: 1, f: realFileHref(pg) },
                    '', displayHref(pg)
                );
            } catch (e) {}
            try { window.dispatchEvent(new CustomEvent('optionext:locationchange')); }
            catch (e) {}
        }

        function onHeadClick(it) {
            return function (e) {
                e.preventDefault();
                if (activePg === it.pg) openTo(null, true);   /* 再点一次：收起 */
                else openTo(it.pg, true);
            };
        }

        /* 前进 / 后退：以地址栏为准把板块对齐（不写历史）。
           若该 popstate 同时被 page-transit 接管整体换主体，
           本实例稍后会随旧主体一起停机，互不冲突。 */
        function onPop() {
            applyOpen(pgFromSearch());
        }

        /* 子文档 frame-fit.js 上报高度。只认本页抽屉里的 iframe，
           file:// 下 contentWindow 的属性访问一律 try 住 */
        function onMessage(e) {
            var d = e.data;
            if (!d || d.type !== 'optionext:frame-fit') return;
            for (var i = 0; i < items.length; i++) {
                var f = items[i].frame;
                var mine = false;
                try { mine = !!f.contentWindow && e.source === f.contentWindow; }
                catch (err) { mine = false; }
                if (mine) { fitFrame(f, d.height); return; }
            }
        }

        /* ---------- 绑定 ---------- */
        var unbinders = items.map(function (it) {
            var fn = onHeadClick(it);
            if (it.head) it.head.addEventListener('click', fn);
            return function () {
                if (it.head) it.head.removeEventListener('click', fn);
                clearTimers(it);
            };
        });
        function onThemeChange() { broadcastTheme(); }

        window.addEventListener('popstate', onPop);
        window.addEventListener('message', onMessage);
        window.addEventListener('optionext:themechange', onThemeChange);

        function stop() {
            unbinders.forEach(function (u) { try { u(); } catch (e) {} });
            window.removeEventListener('popstate', onPop);
            window.removeEventListener('message', onMessage);
            window.removeEventListener('optionext:themechange', onThemeChange);
            if (window.__optionextPageStop === stop)
                window.__optionextPageStop = null;
        }

        var api = { stop: stop };
        window.__optionextPageStop = stop;

        /* ---------- 落地：?PG=n 自动展开 ----------
           双 rAF 后再展开，让抽屉的展开动效在首屏完整播放一遍，
           直接拿 ?PG=1 文档链接落地也有“匣子拉开”的仪式感 */
        var initial = pgFromSearch();
        if (initial && byPg(initial)) {
            requestAnimationFrame(function () {
                requestAnimationFrame(function () { applyOpen(initial); });
            });
        }

        return api;
    }

    window.OptionextNewsDrawer = function () { current = init(); return current; };
})();

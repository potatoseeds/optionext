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

        /* ---------- ?PG 读写 ---------- */
        function pgFromSearch(search) {
            var m = /[?&]PG=(\d+)/i.exec(search || location.search);
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
                fitted: false,
                watchdog: 0
            };
        });

        function byPg(pg) {
            for (var i = 0; i < items.length; i++)
                if (items[i].pg === String(pg)) return items[i];
            return null;
        }

        var activePg = null;

        /* ---------- iframe 载入 / 高度 ---------- */
        function ensureFrame(it) {
            if (!it.frame || it.loaded) return;
            it.loaded = true;
            var src = it.frame.getAttribute('data-src');
            if (src) it.frame.setAttribute('src', src);
            /* 兜底：子文档脚本失效 / 被拦 / 文件缺失（云端漏传 news/），
               2s 内没收到高度上报就在匣面给出显性失败原因，绝不留空白盒 */
            it.watchdog = setTimeout(function () {
                if (it.fitted) return;
                var src = it.frame.getAttribute('data-src') || '';
                var hint = it.box ? it.box.querySelector('.news-frame-hint') : null;
                if (hint) {
                    hint.textContent = '文档载入失败或超时：' + src +
                        '（请确认该文件已随页面一起部署 / 刷新缓存后重试）';
                    hint.classList.add('is-error');
                }
            }, 2000);
        }

        function fitFrame(frame, height) {
            var it = null;
            for (var i = 0; i < items.length; i++)
                if (items[i].frame === frame) { it = items[i]; break; }
            if (!it || !(height > 0)) return;
            if (!it.fitted) {
                it.fitted = true;
                clearTimeout(it.watchdog);
            }
            /* 高度只增不减会留出尸体，但字体 / 图片异步到达时
               上报值会先小后大；最终值由子文档 ResizeObserver 持续纠偏，
               这里始终采用最新值即可 */
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
            /* file://：pushState 整条被安全策略禁止，沿用站点既有的
               软路径约定，让页眉等组件仍能“追踪”当前栏目 */
            if (location.protocol === 'file:') {
                var dir = location.pathname.replace(/\/(index|mobile)\.html$/i, '/');
                window.__optionextSoftPath = dir + (pg ? '?PG=' + encodeURIComponent(pg) : '');
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
                clearTimeout(it.watchdog);
            };
        });
        window.addEventListener('popstate', onPop);
        window.addEventListener('message', onMessage);

        function stop() {
            unbinders.forEach(function (u) { try { u(); } catch (e) {} });
            window.removeEventListener('popstate', onPop);
            window.removeEventListener('message', onMessage);
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

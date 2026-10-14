/* ============================================================
   OPTIONEXT · 子文档高度上报 frame-fit.js
   被“新闻抽屉”（news-drawer.js）以 iframe 载入的独立 HTML
   在文末引入本脚本即可：
     <script src="../../components/frame-fit.js"></script>

   做什么：
     · 测量自身文档高度，postMessage 给父窗口，父侧据此把
       iframe 高度贴合成文档高度（无滚动条、像直接铺进页面）；
     · postMessage 不受同源策略限制，file:// 直开也能上报；
     · 监听加载、字体、图片、ResizeObserver、窗口尺寸，持续纠偏；
     · 页面被单独打开（不在 iframe 里）时自动休眠，零副作用。
   ============================================================ */
(function () {
    'use strict';

    /* 独立打开：没有父窗口，不需要上报 */
    try { if (window.top === window.self) return; } catch (e) { return; }

    var last = 0;
    var tick = 0;

    function measure() {
        /* rAF 节流：图片 / 字体会话期间可能连续触发多次布局变化 */
        if (tick) return;
        tick = requestAnimationFrame(function () {
            tick = 0;
            var h = 0;
            try {
                var de = document.documentElement;
                h = Math.max(
                    de.scrollHeight, de.offsetHeight,
                    document.body ? document.body.scrollHeight : 0
                );
            } catch (e) { return; }
            if (h && h !== last) {
                last = h;
                try {
                    window.parent.postMessage(
                        { type: 'optionext:frame-fit', height: h }, '*'
                    );
                } catch (e) {}
            }
        });
    }

    /* 首帧多发几次：样式表 / 字体 / 图片在不同时机落位 */
    function boot() {
        measure();
        setTimeout(measure, 60);
        setTimeout(measure, 240);
        setTimeout(measure, 600);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
    else document.addEventListener('DOMContentLoaded', boot);
    window.addEventListener('load', measure);

    /* 字体到位后排版高度可能变化 */
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(measure, function () {});
    }

    /* 图片 / 异步内容撑高：ResizeObserver 盯住整棵文档树；
       不支持的旧浏览器退到 window resize */
    if (window.ResizeObserver) {
        var ro = new ResizeObserver(measure);
        var observeTarget = document.body || document.documentElement;
        if (observeTarget) ro.observe(observeTarget);
    }
    window.addEventListener('resize', measure);
})();

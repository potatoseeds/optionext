/* ============================================================
   OPTIONEXT · 临时真机自检组件（仅 ?DBG=1 激活）
   用法：任意页面 URL 后加 ?DBG=1，如 /mobile.html?DBG=1
   做什么：
     · 尽早收集外部资源（link/script/img）加载错误
     · 在屏幕上画一个不依赖任何站点样式的诊断面板
     · 给每个 .mt-dot 套洋红描边、在激活项里塞一个内联对照红块，
       用几何盒/层级数据区分：元素缺失 / 无布局 / CSS 未生效 /
       被祖先合成层（transform/filter/mask/overflow）裁切或吞掉
   纯原生、零依赖、全程 try/catch，绝不影响正常页面。
   调试结束后从各页移除本脚本引用即可。
   ============================================================ */
(function () {
    'use strict';

    var DBG = /(^|[?&])DBG=1\b/.test(location.search);
    window.__DBG_ERR__ = window.__DBG_ERR__ || [];

    /* 资源加载错误不冒泡，只能在捕获阶段抓；本脚本须在 <head> 尽早引入 */
    window.addEventListener('error', function (e) {
        var t = e.target;
        if (t && t !== window && t.tagName &&
            (t.tagName === 'LINK' || t.tagName === 'SCRIPT' || t.tagName === 'IMG')) {
            window.__DBG_ERR__.push(t.tagName + ' ' + (t.href || t.src) +
                ' @' + Math.round(performance.now()) + 'ms');
        }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        window.__DBG_ERR__.push('PROMISE ' + ((e.reason && e.reason.message) || e.reason));
    });

    if (!DBG) return;

    var PANEL_CSS =
        'position:fixed;left:0;right:0;top:0;z-index:2147483647;' +
        'max-height:72vh;overflow:auto;margin:0;' +
        'background:rgba(0,0,0,.86);color:#3f3;font:11px/1.45 ui-monospace,Consolas,monospace;' +
        'padding:8px 10px 10px;white-space:pre-wrap;word-break:break-all;' +
        '-webkit-text-size-adjust:100%;pointer-events:auto;touch-action:pan-x pan-y';

    function el(tag, attrs, text) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
        if (text != null) n.textContent = text;
        return n;
    }

    function safe(fn, dflt) {
        try { return fn(); } catch (e) { return 'ERR:' + e.name; }
    }

    /* 从红点向上收集可能导致裁切/合成丢失的祖先属性 */
    function ancestorChain(node) {
        var out = [];
        var n = node;
        while (n && n !== document.documentElement) {
            var cs = safe(function () { return getComputedStyle(n); });
            if (cs && cs !== undefined && typeof cs === 'object') {
                var flags = [];
                ['overflow','overflowX','overflowY','transform','opacity','zIndex','position',
                 'contain','filter','backdropFilter','webkitBackdropFilter','clipPath','maskImage',
                 'isolation','mixBlendMode'].forEach(function (p) {
                    var v = cs.getPropertyValue(p.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }));
                    if (v && v !== 'none' && v !== 'visible' && v !== '0' && v !== 'auto' &&
                        v !== 'normal' && v !== 'rgba(0, 0, 0, 0)' && v !== '') {
                        flags.push(p + '=' + v);
                    }
                });
                if (flags.length) {
                    out.push((n.tagName || '?') +
                        (n.className ? '.' + String(n.className).split(' ').join('.') : '') +
                        ' [' + flags.join('; ') + ']');
                }
            }
            n = n.parentElement;
        }
        return out;
    }

    function collect() {
        var L = [];
        function p(s) { L.push(s); }

        p('===== OPTIONEXT DBG =====');
        p('time ' + new Date().toISOString().slice(11, 19) +
          ' | ' + navigator.userAgent.slice(0, 46));
        p('protocol=' + location.protocol + ' host=' + location.host);
        p('path=' + location.pathname + location.search);
        p('soft=' + (window.__optionextSoftPath == null ? 'null' : window.__optionextSoftPath));
        p('flavor=' + document.documentElement.getAttribute('data-flavor') +
          ' | viewport=' + window.innerWidth + 'x' + window.innerHeight +
          ' dpr=' + window.devicePixelRatio +
          ' hover=' + (matchMedia('(hover:hover)').matches) +
          ' coarse=' + (matchMedia('(pointer:coarse)').matches));
        p('tabbar=' + !!window.__OPTIONEXT_TABBAR_LOADED__ +
          ' transit=' + !!window.__OPTIONEXT_TRANSIT_LOADED__ +
          ' state=' + safe(function () { return JSON.stringify(history.state); }));

        /* ---- tabbar CSS 链接落地情况 ---- */
        var link = document.querySelector('link[data-mt-style]');
        p('--- CSS link ---');
        if (!link) {
            p('link[data-mt-style] = NULL（CSS <link> 根本没插入）');
        } else {
            p('href=' + link.href + ' disabled=' + link.disabled);
            var rules = 'N/A', hasDot = false, hasAfter = false, signal = '?';
            try {
                rules = link.sheet ? link.sheet.cssRules.length : 'sheet=null';
                signal = getComputedStyle(document.documentElement).getPropertyValue('--mt-signal').trim();
                for (var i = 0; link.sheet && i < link.sheet.cssRules.length; i++) {
                    var sel = link.sheet.cssRules[i].selectorText || '';
                    if (sel.indexOf('mt-dot') >= 0) hasDot = true;
                    if (sel.indexOf('mt-item') >= 0 && sel.indexOf('::after') >= 0) hasAfter = true;
                }
            } catch (e) { rules = 'THROW ' + e.name + ': ' + e.message; }
            p('cssRules=' + rules + ' 含.mt-dot规则=' + hasDot +
              ' 含旧::after规则=' + hasAfter + ' --mt-signal=' + signal);
        }

        /* ---- 根/卡片容器 ---- */
        var root = document.querySelector('.mt-root');
        var card = document.querySelector('.mt-card');
        p('--- 容器 ---');
        if (root) {
            var r0 = root.getBoundingClientRect();
            var cr = getComputedStyle(root);
            p('.mt-root rect=' + Math.round(r0.left) + ',' + Math.round(r0.top) +
              ',' + Math.round(r0.width) + 'x' + Math.round(r0.height) +
              ' op=' + cr.opacity + ' display=' + cr.display + ' visibility=' + cr.visibility);
        } else p('.mt-root = NULL');

        /* ---- 每个导航项 + 红点 ---- */
        var items = document.querySelectorAll('.mt-item');
        p('--- mt-item ×' + items.length + ' ---');
        Array.prototype.forEach.call(items, function (a, idx) {
            var cn = safe(function () { return a.querySelector('.mt-cn').textContent; });
            p('[' + idx + '] ' + cn + '  class="' + a.className + '"');
            var ar = a.getBoundingClientRect();
            var acs = getComputedStyle(a);
            p('   item rect=' + Math.round(ar.left) + ',' + Math.round(ar.top) +
              ' ' + Math.round(ar.width) + 'x' + Math.round(ar.height) +
              ' pos=' + acs.position + ' op=' + acs.opacity + ' overflow=' + acs.overflow +
              ' transform=' + acs.transform);

            var dot = a.querySelector('.mt-dot');
            if (!dot) {
                p('   .mt-dot 子元素 = NULL');
            } else {
                var dr = dot.getBoundingClientRect();
                var dc = getComputedStyle(dot);
                var hit = '?';
                try {
                    var h = document.elementFromPoint(dr.left + dr.width / 2, dr.top + dr.height / 2);
                    hit = h ? (h.tagName + '.' + (h.className || '')) : 'NULL';
                } catch (e) { hit = 'ERR'; }
                p('   .mt-dot rect=' + Math.round(dr.left) + ',' + Math.round(dr.top) +
                  ' ' + dr.width + 'x' + dr.height +
                  ' display=' + dc.display + ' vis=' + dc.visibility +
                  ' op=' + dc.opacity + ' bg=' + dc.backgroundColor +
                  ' z=' + dc.zIndex + ' transform=' + dc.transform);
                p('   dot中点命中=' + hit);
                p('   dot ancestors: ' + (ancestorChain(dot).join('  >  ') || '（无特殊合成属性）'));
                /* 高亮几何盒 */
                dot.style.outline = '2px solid #ff00ff';
                dot.style.outlineOffset = '3px';
            }

            var af = safe(function () {
                var x = getComputedStyle(a, '::after');
                return 'content=' + x.content + ' op=' + x.opacity;
            });
            p('   ::after ' + af);

            /* 激活项内塞一个完全内联的对照红块，绕开全部 class 样式 */
            if (idx === 0) {
                var probe = a.querySelector('#__dbgprobe');
                if (!probe) {
                    probe = el('span', { id: '__dbgprobe' });
                    probe.style.cssText =
                        'position:absolute;top:5px;left:50%;width:4px;height:4px;border-radius:50%;' +
                        'background:#00ff00;opacity:1;transform:translateX(22px);z-index:99999;' +
                        'pointer-events:none;display:block;visibility:visible';
                    a.appendChild(probe);
                }
                var pr = probe.getBoundingClientRect();
                var ph = safe(function () {
                    var h = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
                    return h ? (h.tagName + '.' + (h.className || '')) : 'NULL';
                });
                p('   #对照绿块 rect=' + Math.round(pr.left) + ',' + Math.round(pr.top) +
                  ' ' + pr.width + 'x' + pr.height + ' 命中=' + ph +
                  '（绿块可见=合成正常，红点不在则是 .mt-dot 样式/类问题）');
            }
        });

        p('--- 资源错误(' + window.__DBG_ERR__.length + ') ---');
        if (!window.__DBG_ERR__.length) p('（无）');
        else window.__DBG_ERR__.slice(-12).forEach(function (e) { p('  ' + e); });

        var res = safe(function () {
            return performance.getEntriesByType('resource')
                .filter(function (e) { return /tabbar|page-transit|page-manifest/.test(e.name); })
                .map(function (e) {
                    return e.name.split('/').slice(-2).join('/') +
                        ' status=' + (e.responseStatus == null ? 'n/a' : e.responseStatus) +
                        ' bytes=' + e.decodedBodySize;
                });
        });
        p('--- 相关资源 ---');
        (res || []).forEach(function (r) { p('  ' + r); });

        return L.join('\n');
    }

    function init() {
        var panel = el('div');
        panel.setAttribute('data-dbg-panel', '1');
        panel.style.cssText = PANEL_CSS;
        var title = el('div', null, '');
        title.style.cssText = 'color:#ff0;font-weight:bold;margin-bottom:4px';
        title.textContent = '● DBG 自检（每 0.7s 刷新）';
        var pre = el('div');
        panel.appendChild(title);
        panel.appendChild(pre);
        document.body.appendChild(panel);

        function tick() {
            pre.textContent = safe(collect, 'collect failed');
        }
        tick();
        setInterval(tick, 700);
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})();

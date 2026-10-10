/* ============================================================
   OPTIONEXT · 设备守卫组件 device-guard.js
   纯原生、零依赖，桌面页 / 移动页引入同一份脚本即可：
     <script src="components/device-guard.js"></script>

   规则（PAIRS 桌面页 ↔ 移动页 配对表，路径相对站点根，
         同一栏目放在同一个子目录中，如 projects/index ↔ projects/mobile）：
     每个页面在 <html data-flavor="desk|mob"> 自报版本。
     移动设备访问桌面页 → 跳转该页对应的移动页
     桌面设备访问移动页 → 跳转该页对应的桌面页
     移动设备访问未登记页面 → 兜底跳转移动首页 mobile.html
     桌面设备访问未登记页面 → 不干预

   为什么信任 data-flavor 而不是 URL：软导航会把地址栏规范成目录
   （/mobile.html 显示为 /），而 pageshow 复查晚于页面脚本——按 URL
   推断会把"正确版本的文档"误判成错版，与地址规范化互相触发导致
   无限刷新。文档自身标记与设备一致时，任何情况下都不跳。
   另设跳转熔断：同一会话 10 秒内连续 3 次跳转即停止，双保险。

   目标地址以“自身脚本 URL”推导站点根目录（components 的上一级），
   GitHub Pages 任意深度子页面引用都能正确跳回根目录入口页。
   ============================================================ */
(function () {
    'use strict';

    if (window.__OPTIONEXT_DEVICE_GUARD_LOADED__) return;
    window.__OPTIONEXT_DEVICE_GUARD_LOADED__ = true;

    // ROOT 只在脚本首次执行时推导：事件回调里 document.currentScript 为 null
    var ROOT = new URL('../', document.currentScript.src);

    /* 桌面页（desk）↔ 移动页（mob）配对，相对站点根；新增页面对时追加一行 */
    var PAIRS = [
        { desk: 'index.html',           mob: 'mobile.html' },
        { desk: 'projects/index.html',  mob: 'projects/mobile.html' }
    ];

    function isMobileDevice() {
        // 现代 Chromium（Android Chrome / Edge）客户端提示，比 UA 字符串更权威
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
            return navigator.userAgentData.mobile;
        }
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    /* 当前页面相对站点根的路径（如 'projects/mobile.html'）。
       必须带子目录——不同栏目下同名文件（多个 mobile.html）否则无法区分。
       软导航把地址规范成目录形式（'/'、'/projects/'），服务器此时落地的
       其实是该目录的 index.html，这里一并还原，否则会漏配 PAIRS */
    function currentRel() {
        var rootPath = new URL(ROOT).pathname;   // '/' 或 '/Optionext/' 等
        var path = location.pathname;
        var rel = path.indexOf(rootPath) === 0
            ? path.slice(rootPath.length)
            : path.slice(path.lastIndexOf('/') + 1);
        if (!rel) return 'index.html';
        if (rel.charAt(rel.length - 1) === '/') return rel + 'index.html';
        return rel;
    }

    /* 跳转熔断：正常流程最多只跳一次。10 秒内连续 3 次说明环境异常
       （服务器把文件名重定向掉等），立即停止，杜绝无限刷新 */
    var DG_KEY = 'optionext-dg';
    function go(file) {
        var now = Date.now();
        try {
            var n = 0;
            var raw = sessionStorage.getItem(DG_KEY);
            if (raw) {
                var parts = raw.split('|');
                var t0 = parseInt(parts[0], 10) || 0;
                n = (now - t0 < 10000) ? (parseInt(parts[1], 10) || 0) : 0;
            }
            if (n >= 3) return;
            sessionStorage.setItem(DG_KEY, now + '|' + (n + 1));
        } catch (e) {}
        window.location.replace(new URL(file, ROOT).href);
    }

    function check() {
        /* 文档自报版本（<html data-flavor>）：与设备一致就绝不跳转。
           此时 URL 可能已被软导航规范成目录形式，不能再拿 URL 判版本 */
        var flavor = document.documentElement.getAttribute('data-flavor');
        var mobile = isMobileDevice();
        var want = mobile ? 'mob' : 'desk';
        if (flavor === want) return;

        /* 文档版本错配：按当前 URL 所属栏目，跳到该栏目的正确版本 */
        var rel = currentRel();
        for (var i = 0; i < PAIRS.length; i++) {
            var p = PAIRS[i];
            if (rel === p.desk || rel === p.mob) {
                go(mobile ? p.mob : p.desk);
                return;
            }
        }

        // 未登记页面：移动设备兜底送移动首页；桌面设备保持当前页
        if (mobile) go('mobile.html');
    }

    check();
    // bfcache 恢复（前进 / 后退）时脚本不会重新执行，必须在 pageshow 复查一次
    window.addEventListener('pageshow', check);
})();

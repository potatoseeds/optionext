/* ============================================================
   OPTIONEXT · 设备守卫组件 device-guard.js
   纯原生、零依赖，桌面页 / 移动页引入同一份脚本即可：
     <script src="components/device-guard.js"></script>

   规则（PAIRS 桌面页 ↔ 移动页 配对表，路径相对站点根，
         同一栏目放在同一个子目录中，如 projects/index ↔ projects/mobile）：
     移动设备访问桌面页 → 跳转该页对应的移动页
     桌面设备访问移动页 → 跳转该页对应的桌面页
     移动设备访问未登记页面 → 兜底跳转移动首页 mobile.html
     桌面设备访问未登记页面 → 不干预

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
       必须带子目录——不同栏目下同名文件（多个 mobile.html）否则无法区分 */
    function currentRel() {
        var rootPath = new URL(ROOT).pathname;   // '/' 或 '/Optionext/' 等
        var path = location.pathname;
        var rel = path.indexOf(rootPath) === 0
            ? path.slice(rootPath.length)
            : path.slice(path.lastIndexOf('/') + 1);
        return rel || 'index.html';
    }

    function go(file) {
        window.location.replace(new URL(file, ROOT).href);
    }

    function check() {
        var rel = currentRel();
        var mobile = isMobileDevice();

        for (var i = 0; i < PAIRS.length; i++) {
            var p = PAIRS[i];
            if (rel === p.desk) { if (mobile) go(p.mob); return; }
            if (rel === p.mob)  { if (!mobile) go(p.desk); return; }
        }

        // 未登记页面：移动设备兜底送移动首页；桌面设备保持当前页
        if (mobile) go('mobile.html');
    }

    check();
    // bfcache 恢复（前进 / 后退）时脚本不会重新执行，必须在 pageshow 复查一次
    window.addEventListener('pageshow', check);
})();

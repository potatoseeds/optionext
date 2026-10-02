/* ============================================================
   OPTIONEXT · 设备守卫组件 device-guard.js
   纯原生、零依赖，桌面页 / 移动页引入同一份脚本即可：
     <script src="components/device-guard.js"></script>

   规则：
     移动设备访问非 mobile.html  → 跳转站点根目录 mobile.html
     桌面设备访问 mobile.html    → 跳转站点根目录 index.html

   目标地址以“自身脚本 URL”推导站点根目录（components 的上一级），
   GitHub Pages 任意深度子页面引用都能正确跳回根目录入口页。
   ============================================================ */
(function () {
    'use strict';

    if (window.__OPTIONEXT_DEVICE_GUARD_LOADED__) return;
    window.__OPTIONEXT_DEVICE_GUARD_LOADED__ = true;

    // ROOT 只在脚本首次执行时推导：事件回调里 document.currentScript 为 null
    var ROOT = new URL('../', document.currentScript.src);

    function isMobileDevice() {
        // 现代 Chromium（Android Chrome / Edge）客户端提示，比 UA 字符串更权威
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
            return navigator.userAgentData.mobile;
        }
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    function check() {
        var onMobilePage = /mobile\.html$/i.test(location.pathname);

        if (isMobileDevice() && !onMobilePage) {
            window.location.replace(new URL('mobile.html', ROOT).href);
        } else if (!isMobileDevice() && onMobilePage) {
            window.location.replace(new URL('index.html', ROOT).href);
        }
    }

    check();
    // bfcache 恢复（前进 / 后退）时脚本不会重新执行，必须在 pageshow 复查一次
    window.addEventListener('pageshow', check);
})();

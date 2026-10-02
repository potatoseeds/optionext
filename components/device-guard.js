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

    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    var onMobilePage = /mobile\.html$/i.test(location.pathname);
    var ROOT = new URL('../', document.currentScript.src);

    if (isMobile && !onMobilePage) {
        window.location.replace(new URL('mobile.html', ROOT).href);
    } else if (!isMobile && onMobilePage) {
        window.location.replace(new URL('index.html', ROOT).href);
    }
})();

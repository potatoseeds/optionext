// 桌面端页面守卫：移动端设备访问时切换到根目录 mobile.html
(function () {
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        window.location.replace(new URL('mobile.html', document.currentScript.src).href);
    }
})();

// 移动端页面守卫：桌面端设备访问时切换到根目录 index.html
(function () {
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) {
        window.location.replace(new URL('index.html', document.currentScript.src).href);
    }
})();

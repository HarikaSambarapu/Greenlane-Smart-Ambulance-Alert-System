// GREEN LANE — loader.js
// Plain script (not type="module") - runs independently of the
// Firebase/Firestore module scripts on each page, so it can never
// delay or interfere with auth, GPS, or realtime listeners. It only
// hides the purely visual #preloader overlay once the page has loaded.
(function () {
    var start = Date.now();
    var minShow = 1000; // keep the loader visible long enough to actually see it
    function hidePreloader() {
        var pre = document.getElementById("preloader");
        if (!pre) return;
        var wait = Math.max(0, minShow - (Date.now() - start));
        setTimeout(function () {
            pre.classList.add("hidden");
            setTimeout(function () { pre.style.display = "none"; }, 550);
        }, wait);
    }
    if (document.readyState === "complete") {
        hidePreloader();
    } else {
        window.addEventListener("load", hidePreloader);
    }
})();
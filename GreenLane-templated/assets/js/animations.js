// GREEN LANE — animations.js
// Adds a small, subtle staggered entrance animation to dashboard
// cards/panels when a page loads, plus a click ripple on buttons.
// Pure DOM/CSS-class work, no Firebase dependency - purely
// cosmetic, safe to run on any page.
document.addEventListener("DOMContentLoaded", function () {
    const targets = document.querySelectorAll(
        ".welcome-banner, .stat-card, .panel, .help-hero, .help-card, .auth-card"
    );
    targets.forEach(function (el, i) {
        el.style.animationDelay = Math.min(i * 45, 300) + "ms";
        el.classList.add("fade-in-up");
        // BUGFIX: animation-fill-mode "both" keeps applying the final
        // keyframe's transform forever after the animation ends - even
        // though translateY(0) scale(1) is visually identical to no
        // transform, a non-"none" transform value still changes how
        // some mobile browsers compute touch/tap coordinates and how
        // any position:fixed descendant is positioned. Removing the
        // class once the animation finishes clears it completely.
        el.addEventListener("animationend", function handler() {
            el.classList.remove("fade-in-up");
            el.style.animationDelay = "";
            el.removeEventListener("animationend", handler);
        });
    });
});

// Click ripple - works on any element with the .btn class, including
// ones added or shown later (event delegation on document), so it
// doesn't matter which page or which button.
document.addEventListener("click", function (e) {
    const btn = e.target.closest(".btn");
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
    ripple.style.top = (e.clientY - rect.top - size / 2) + "px";

    btn.appendChild(ripple);
    setTimeout(function () { ripple.remove(); }, 550);
});
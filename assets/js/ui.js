// GREEN LANE — ui.js
// Small, self-contained UI behaviors used across dashboard pages:
// dark mode toggle, the live clock, and the profile popup. None of
// this reads or writes Firebase/Firestore - it's pure DOM +
// localStorage, so it's safe to load before (or independently of)
// each page's Firebase module script.

// ── DARK MODE TOGGLE ──────────────────────────────────
// Uses the existing CSS custom properties (--bg, --surface, --text,
// --border etc.) already used throughout the stylesheet, so
// switching theme only needs one attribute on <body> plus the
// overrides in theme.css. Preference is remembered across visits.
function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    const settingsNavBtn = document.getElementById("settingsNavBtn");
    if (settingsNavBtn) {
        settingsNavBtn.innerHTML = theme === "dark"
            ? '<i class="fas fa-sun"></i> Settings'
            : '<i class="fas fa-moon"></i> Settings';
    }
}

function toggleTheme() {
    const current = document.body.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
}
window.toggleTheme = toggleTheme;

applyTheme(localStorage.getItem("theme") || "light");

// ── LIVE CLOCK ────────────────────────────────────────
function updateClock() {
    const el = document.getElementById("liveClock");
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
        "  •  " + now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
if (document.getElementById("liveClock")) {
    updateClock();
    setInterval(updateClock, 1000 * 30); // updates every 30s — a clock doesn't need per-second re-renders
}

// ── PROFILE POPUP ─────────────────────────────────────
function toggleProfile() {
    const popup = document.getElementById("profilePopup");
    if (!popup) return;
    popup.style.display = popup.style.display === "block" ? "none" : "block";
}
window.toggleProfile = toggleProfile;

document.addEventListener("click", function (e) {
    const popup = document.getElementById("profilePopup");
    if (!popup) return;
    // BUGFIX: this used to only check .user-section (the topbar profile
    // chip). The sidebar's Profile menu item also opens this popup but
    // isn't inside .user-section, so clicking it would open the popup
    // and then this same click would immediately close it again, since
    // the click target wasn't recognized as a valid trigger. Both
    // triggers now share the .profile-trigger class.
    const clickedATrigger = e.target.closest(".profile-trigger");
    if (!popup.contains(e.target) && !clickedATrigger) {
        popup.style.display = "none";
    }
});
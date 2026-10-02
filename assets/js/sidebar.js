// GREEN LANE — sidebar.js
// Opens/closes the off-canvas sidebar drawer. Pure DOM class
// toggling - no Firebase or app-data dependency, safe to load
// before the page's Firebase module script.
function openSidebar(){
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebarScrim").classList.add("show");
}

function closeSidebar(){
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarScrim").classList.remove("show");
}

window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;

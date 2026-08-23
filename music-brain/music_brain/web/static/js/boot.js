window.MB = window.MB || {};

/** Auto-start floating mini player on every panel page. */
MB.boot = function boot() {
  MB.Player.init();
  MB.Player.loadPersistentLibrary();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", MB.boot);
} else {
  MB.boot();
}

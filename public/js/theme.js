(function () {
  var STORAGE_KEY = 'goince-theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function updateIcons(theme) {
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'লাইট মোড' : 'ডার্ক মোড';
    });
    // Mobile drawer-er theme button (header-e jayga pay na bole drawer-e):
    // icon + label dutoi theme onujayi bodlay.
    document.querySelectorAll('.shop-drawer-theme').forEach(function (btn) {
      btn.textContent = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
    });
  }

  window.toggleGoinceTheme = function () {
    var current = document.documentElement.getAttribute('data-theme') || 'light';
    var next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    updateIcons(next);
  };

  document.addEventListener('DOMContentLoaded', function () {
    var stored = localStorage.getItem(STORAGE_KEY) || 'light';
    updateIcons(stored);
  });
})();

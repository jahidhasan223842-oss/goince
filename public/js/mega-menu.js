// Header mega menu (Categories): desktop-e click-e toggle, hover-e CSS-e khole;
// mobile-e ☰ Categories button-e khole, protita column accordion hishebe khole.
// Keyboard: button-e focus korle khole, Esc chaple bondho hoy, baire click
// korle bondho hoy, Tab kore panel-er baire gele bondho hoy.
(function () {
  var wrap = document.querySelector('.mega-menu-wrap');
  if (!wrap) return;
  var panel = document.getElementById('mega-menu-panel');
  var buttons = [
    document.getElementById('mega-menu-btn'),
    document.getElementById('mega-menu-btn-mobile')
  ].filter(Boolean);
  if (!panel || !buttons.length) return;

  function setOpen(open) {
    panel.classList.toggle('open', open);
    buttons.forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  }
  function isOpen() { return panel.classList.contains('open'); }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!isOpen());
    });
    // Keyboard-e button-e focus ashle-i panel khulbe, jate Tab kore
    // vitore dhoka jay.
    btn.addEventListener('focus', function () { setOpen(true); });
  });

  // Baire click korle bondho.
  document.addEventListener('click', function (e) {
    if (isOpen() && !wrap.contains(e.target)) setOpen(false);
  });
  // Esc chaple bondho, focus button-e firbe.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      if (buttons[0]) buttons[0].focus();
    }
  });
  // Focus puro menu-r baire chole gele bondho (Tab kore beriye gele).
  wrap.addEventListener('focusout', function (e) {
    if (!wrap.contains(e.relatedTarget)) setOpen(false);
  });

  // Mobile accordion: protita main category-r caret chaple tar
  // sub-category list khulbe/bondho hobe (desktop-e list shob shomoy khola).
  wrap.querySelectorAll('.mega-col-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var col = toggle.closest('.mega-col');
      if (!col) return;
      var open = col.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
})();

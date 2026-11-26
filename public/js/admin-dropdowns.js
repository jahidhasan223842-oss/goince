// Admin top-bar dropdowns (fix/dropdown-close-premium): ONE source of
// truth for open/close state — the .open class, driven only by this
// file. PR #63 added the animation but left TWO open mechanisms alive:
// CSS :hover / :focus-within opened the top-nav menus, while the JS
// close functions only removed the .open class. A CSS-hovered menu
// therefore ignored Esc, click-toggle and one-at-a-time closes while
// the pointer stayed over it, and there was no mouseleave handler at
// all — menus stayed stuck open (found live 2026-11-26: mouse-away,
// Esc, opening another menu and clicking the same button all failed
// to close Shop, and two menus sat open overlapping). Now CSS never
// opens a menu: hover, focus, click, Esc and outside-click all go
// through here.
//   - Hover (hover-capable devices only, same gate as the old CSS
//     @media (hover: hover)): mouseenter opens the group and closes
//     the others; mouseleave closes it after a 150ms grace (a quick
//     pointer pass does not flicker it shut) unless it was latched
//     open by a click. On touch devices a tap only toggles the latch
//     — a tap also fires mouseenter, which would open the menu and
//     then the click would instantly close it again.
//   - Click: toggles the latch. Clicking the same button while
//     hovering closes the menu and hover does NOT instantly re-open
//     it — no new mouseenter fires while the pointer stays put.
//   - Keyboard: focusin opens the top-nav menu (replaces the old CSS
//     :focus-within) — but ONLY for keyboard focus (:focus-visible):
//     a mouse click also focuses the button, and that focusin must
//     NOT turn the following click into a latch, or bug #4 above
//     (click-toggle while hovering) breaks again. A menu opened by
//     keyboard focusin is latched by the following click instead of
//     toggled shut. focusout closes the menu when focus leaves the
//     group. Esc closes every open menu + the search panel and returns
//     focus to the button that opened it; the focus return is guarded
//     by a short suppress window so its own focusin does not reopen
//     the menu it just closed.
//   - A non-menu nav item (Dashboard) closes any open menu when the
//     pointer moves onto it.
//   - Bell / profile menus are click-only (as before) + focusout.
//   - The search panel shares the same close rules.
// CLOSE ANIMATION (fix/dropdown-animations, unchanged): removing .open
// does NOT hide the menu instantly — the CSS keeps it visible while it
// fades + slides up (opacity/transform .15s) and flips visibility to
// hidden only after the transition, so every close path here animates
// and a menu can never stay invisible-but-clickable. The 150ms grace
// below is a HOVER-INTENT delay, not a close-animation timeout.
// Node-testable: this file exports its init function when required
// (scripts/test-dropdown-close-premium.js runs the REAL handlers
// against a stub DOM); in the browser it auto-inits on load — the
// script tag sits at the end of <body> in admin-footer.ejs, so the
// header markup already exists.
(function (root) {
  'use strict';

  // Grace after the pointer leaves a hover-opened menu before it
  // closes — long enough to cross the button/panel boundary without a
  // flicker, short enough to feel instant.
  var HOVER_CLOSE_DELAY_MS = 150;
  // After an Esc-close, the focus return to the opener fires a
  // focusin on the same group — ignore focus-open for this long so
  // Esc cannot instantly reopen the menu it just closed.
  var ESC_FOCUS_SUPPRESS_MS = 500;

  function initAdminDropdowns(doc) {
    var view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    var hoverCapable = !view || !view.matchMedia || view.matchMedia('(hover: hover)').matches;

    var lastOpenerBtn = null;

    function menuForBtn(btn) {
      var wrap = btn.parentElement;
      if (!wrap || !wrap.querySelector) return null;
      return wrap.querySelector('.admin-topnav-menu') || wrap.querySelector('.admin-dropdown-menu');
    }
    function wrapForBtn(btn) { return btn.parentElement || null; }
    function cancelPendingClose(btn) {
      var wrap = wrapForBtn(btn);
      if (wrap && wrap._adminCloseTimer) {
        clearTimeout(wrap._adminCloseTimer);
        wrap._adminCloseTimer = null;
      }
    }
    function openMenu(btn, latched) {
      var menu = menuForBtn(btn);
      if (!menu) return;
      cancelPendingClose(btn);
      closeAdminDropdowns(btn);
      menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      // A hover/focus open never clears an existing latch: a menu
      // latched by click stays latched when the pointer or focus
      // re-enters it.
      if (latched) {
        var wrap = wrapForBtn(btn);
        if (wrap) wrap._adminLatched = true;
      }
      lastOpenerBtn = btn;
    }
    function closeMenu(btn) {
      var menu = menuForBtn(btn);
      cancelPendingClose(btn);
      if (menu) menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      var wrap = wrapForBtn(btn);
      if (wrap) {
        wrap._adminLatched = false;
        wrap._adminOpenedByFocus = false;
      }
    }
    function closeAdminDropdowns(exceptBtn) {
      doc.querySelectorAll('[data-dropdown-btn]').forEach(function (btn) {
        if (btn === exceptBtn) return;
        closeMenu(btn);
      });
      doc.querySelectorAll('[data-topnav-btn]').forEach(function (btn) {
        if (btn === exceptBtn) return;
        closeMenu(btn);
      });
    }
    function closeAdminSearch() {
      var form = doc.getElementById('admin-topbar-search');
      var btn = doc.getElementById('admin-topbar-search-btn');
      if (form) form.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    function anyMenuOpen() {
      var open = false;
      doc.querySelectorAll('[data-dropdown-btn]').forEach(function (btn) {
        var menu = menuForBtn(btn);
        if (menu && menu.classList.contains('open')) open = true;
      });
      doc.querySelectorAll('[data-topnav-btn]').forEach(function (btn) {
        var menu = menuForBtn(btn);
        if (menu && menu.classList.contains('open')) open = true;
      });
      var form = doc.getElementById('admin-topbar-search');
      if (form && form.classList.contains('open')) open = true;
      return open;
    }
    // Click-toggle shared by the bell/profile buttons and the top-nav
    // buttons. A menu that keyboard focusin just opened is LATCHED by
    // the click instead of toggled shut — otherwise Tab + Enter would
    // open the menu and instantly close it again.
    function toggleMenu(btn) {
      var menu = menuForBtn(btn);
      if (!menu) return;
      var wrap = wrapForBtn(btn);
      if (wrap && wrap._adminOpenedByFocus) {
        wrap._adminOpenedByFocus = false;
        openMenu(btn, true);
        return;
      }
      var willOpen = !menu.classList.contains('open');
      if (willOpen) openMenu(btn, true);
      else closeMenu(btn);
    }

    // Bell + profile menus: click-only toggle (as before), plus the
    // focusout close so the button state follows the keyboard too.
    doc.querySelectorAll('[data-dropdown-btn]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMenu(btn);
      });
      var wrap = wrapForBtn(btn);
      if (wrap) {
        wrap.addEventListener('focusout', function (e) {
          if (wrap.contains(e.relatedTarget)) return;
          closeMenu(btn);
        });
      }
    });

    // Top-nav menus: hover / focus / click-latch, all through .open.
    doc.querySelectorAll('[data-topnav-btn]').forEach(function (btn) {
      var wrap = wrapForBtn(btn);
      var menu = menuForBtn(btn);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleMenu(btn);
      });
      if (!wrap || !menu) return;
      if (hoverCapable) {
        wrap.addEventListener('mouseenter', function () {
          openMenu(btn, false);
        });
        wrap.addEventListener('mouseleave', function () {
          if (wrap._adminLatched) return;
          cancelPendingClose(btn);
          wrap._adminCloseTimer = setTimeout(function () {
            wrap._adminCloseTimer = null;
            closeMenu(btn);
          }, HOVER_CLOSE_DELAY_MS);
        });
        // A non-menu nav item (Dashboard) closes any open menu when
        // the pointer moves onto it — handled below, once, for all
        // .admin-topnav-link elements.
      }
      // Keyboard: focusing into the group opens the menu (the old CSS
      // :focus-within rule). Only keyboard focus counts — a mouse
      // click also focuses the button, and that focusin must not
      // interfere with the click toggle. A focus that only just
      // returned here from an Esc-close is suppressed (see below).
      wrap.addEventListener('focusin', function (e) {
        if (wrap.contains(e.relatedTarget)) return;
        if (wrap._adminSuppressFocusOpenUntil && Date.now() < wrap._adminSuppressFocusOpenUntil) return;
        var target = e.target || btn;
        if (target.matches && !target.matches(':focus-visible')) return;
        wrap._adminOpenedByFocus = true;
        openMenu(btn, false);
      });
      wrap.addEventListener('focusout', function (e) {
        if (wrap.contains(e.relatedTarget)) return;
        closeMenu(btn);
      });
    });

    // A non-menu nav item (Dashboard) closes any open menu when the
    // pointer moves onto it — a hover-opened menu must not survive
    // the pointer leaving the nav groups.
    if (hoverCapable) {
      doc.querySelectorAll('.admin-topnav-link').forEach(function (link) {
        link.addEventListener('mouseenter', function () {
          closeAdminDropdowns(null);
        });
      });
    }

    doc.addEventListener('click', function (e) {
      closeAdminDropdowns(null);
      // A click outside the search panel closes it; clicks inside the
      // panel (typing in the box) or on the 🔍 icon leave it open.
      if (e.target.closest && (e.target.closest('#admin-topbar-search') || e.target.closest('#admin-topbar-search-btn'))) return;
      closeAdminSearch();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var hadOpen = anyMenuOpen();
      closeAdminDropdowns(null);
      closeAdminSearch();
      // Return focus to the button that opened the menu — but guard
      // its focusin so the menu does not instantly reopen.
      if (hadOpen && lastOpenerBtn && lastOpenerBtn.focus) {
        var wrap = wrapForBtn(lastOpenerBtn);
        if (wrap) wrap._adminSuppressFocusOpenUntil = Date.now() + ESC_FOCUS_SUPPRESS_MS;
        lastOpenerBtn.focus();
        lastOpenerBtn = null;
      }
    });

    // One-line top bar search (fix/whmcs-one-line-topbar): the 🔍 icon
    // opens the search as a panel under the icon (desktop) or a row
    // under the bar (mobile). Same close rules as the menus above —
    // and the same close animation (fix/dropdown-animations).
    // stopPropagation stops the document click handler from closing
    // it the instant it opens; opening it closes any open menu.
    var adminSearchBtn = doc.getElementById('admin-topbar-search-btn');
    var adminSearchForm = doc.getElementById('admin-topbar-search');
    if (adminSearchBtn && adminSearchForm) {
      adminSearchBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeAdminDropdowns(null);
        var willOpen = !adminSearchForm.classList.contains('open');
        adminSearchForm.classList.toggle('open', willOpen);
        adminSearchBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen) {
          lastOpenerBtn = adminSearchBtn;
          var input = adminSearchForm.querySelector('input[name="q"]');
          if (input) input.focus();
        }
      });
    }

    return {
      closeAdminDropdowns: closeAdminDropdowns,
      closeAdminSearch: closeAdminSearch,
      HOVER_CLOSE_DELAY_MS: HOVER_CLOSE_DELAY_MS,
      ESC_FOCUS_SUPPRESS_MS: ESC_FOCUS_SUPPRESS_MS
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = initAdminDropdowns;
  } else if (root && root.document) {
    initAdminDropdowns(root.document);
  }
})(typeof window !== 'undefined' ? window : this);

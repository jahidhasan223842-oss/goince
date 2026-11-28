// One-page checkout — inline validation (E4) + district → area
// picker (E5). Loaded by views/checkout.ejs AFTER the server
// inlines window.BD_DISTRICTS ({ districts, areas }).
//
// Rules MUST match lib/checkout.js validateCheckoutFields: same
// BD phone rule, same email rule, same required fields. The server
// re-validates on POST — this script only gives instant feedback
// and keeps Place Order disabled until the form is valid. Without
// JS the button stays enabled and the server validates instead.
//
// The PR #81 Place Order double-submit lock (inline in
// checkout.ejs) is untouched: this script never disables the button
// on submit — it only gates it BEFORE submit, and on a valid submit
// it steps aside and lets the lock take over.
(function () {
  'use strict';

  var BD = (typeof window !== 'undefined' && window.BD_DISTRICTS) || { districts: [], areas: {} };

  function normalizePhone(raw) {
    var p = String(raw || '').replace(/[^0-9+]/g, '');
    if (p.indexOf('+880') === 0) p = '0' + p.slice(4);
    else if (p.indexOf('880') === 0) p = '0' + p.slice(3);
    return p;
  }
  function isValidBdPhone(raw) {
    return /^01[3-9][0-9]{8}$/.test(normalizePhone(raw));
  }
  function isValidEmail(raw) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || '').trim());
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // field name -> error message ('' = valid). `get` reads live values
  // so the transaction-ID rule follows the chosen payment method.
  function validateField(name, get) {
    var v = String((get(name) || '')).trim();
    if (name === 'customer_name') return v ? '' : 'Enter your full name.';
    if (name === 'email') return (!v || isValidEmail(v)) ? '' : 'Enter a valid email address.';
    if (name === 'phone') return isValidBdPhone(v) ? '' : 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).';
    if (name === 'district') {
      if (!v) return 'Choose your district.';
      if (BD.districts.length && BD.districts.indexOf(v) === -1) return 'Choose a district from the list.';
      return '';
    }
    if (name === 'area') {
      if (!String(get('district') || '').trim()) return '';
      return v ? '' : 'Choose your area / thana.';
    }
    if (name === 'address_line') return v ? '' : 'Enter your house / road / landmark.';
    if (name === 'transaction_id') {
      var method = String(get('payment_method') || '');
      var isGateway = !!get('payment_method_gateway');
      if (method && method !== 'Cash on Delivery' && !isGateway) {
        return v ? '' : 'Enter the Transaction ID from your payment.';
      }
      return '';
    }
    return '';
  }

  var FIELDS = ['customer_name', 'email', 'phone', 'district', 'area', 'address_line', 'transaction_id'];

  function GoinceCheckout(doc) {
    this.doc = doc;
    this.form = doc.querySelector ? doc.querySelector('.checkout-form') : null;
    this.btn = doc.querySelector ? doc.querySelector('.btn-place-order') : null;
    this.hint = doc.getElementById ? doc.getElementById('place-order-hint') : null;
  }

  GoinceCheckout.prototype.el = function (name) {
    if (name === 'transaction_id') return this.doc.getElementById ? this.doc.getElementById('txn-input') : null;
    return this.doc.getElementById ? this.doc.getElementById(name) : null;
  };
  GoinceCheckout.prototype.msgEl = function (name) {
    return this.doc.getElementById ? this.doc.getElementById(name + '-msg') : null;
  };
  GoinceCheckout.prototype.get = function (name) {
    if (name === 'payment_method_gateway') {
      var sel = this.el('payment_method');
      if (!sel || !sel.options || sel.selectedIndex == null || sel.selectedIndex < 0) return false;
      var opt = sel.options[sel.selectedIndex];
      return !!(opt && opt.dataset && opt.dataset.gateway === '1');
    }
    var el = this.el(name);
    return el ? el.value : '';
  };
  GoinceCheckout.prototype.showField = function (name, touched) {
    var el = this.el(name);
    var msgEl = this.msgEl(name);
    var err = validateField(name, this.get.bind(this));
    // Empty + untouched fields stay neutral (no red on first paint);
    // once typed in, they show ✓ or the error.
    var value = String(this.get(name) || '').trim();
    if (el && el.classList) {
      el.classList.remove('is-valid');
      el.classList.remove('is-invalid');
      if (value || touched) {
        el.classList.add(err ? 'is-invalid' : 'is-valid');
      }
    }
    if (msgEl) {
      if (err && (value || touched)) {
        msgEl.textContent = err;
        if (msgEl.classList) { msgEl.classList.add('field-msg--error'); msgEl.classList.remove('field-msg--ok'); }
      } else if (!err && value) {
        msgEl.textContent = '✓';
        if (msgEl.classList) { msgEl.classList.add('field-msg--ok'); msgEl.classList.remove('field-msg--error'); }
      } else {
        msgEl.textContent = '';
        if (msgEl.classList) { msgEl.classList.remove('field-msg--error'); msgEl.classList.remove('field-msg--ok'); }
      }
    }
    return err;
  };
  GoinceCheckout.prototype.validateForm = function (touched) {
    var self = this;
    var errors = {};
    FIELDS.forEach(function (name) {
      var err = self.showField(name, touched);
      if (err) errors[name] = err;
    });
    var valid = Object.keys(errors).length === 0;
    if (self.btn) self.btn.disabled = !valid;
    if (self.hint) {
      self.hint.textContent = valid ? '' : 'Fill in your name, phone and address to place the order.';
      self.hint.style.display = valid ? 'none' : '';
    }
    return { valid: valid, errors: errors };
  };
  GoinceCheckout.prototype.populateAreas = function (selectedArea) {
    var districtEl = this.el('district');
    var areaEl = this.el('area');
    if (!districtEl || !areaEl) return;
    var district = String(districtEl.value || '').trim();
    var areas = (BD.areas && BD.areas[district]) || [];
    var html = '<option value="">Select area / thana</option>';
    areas.forEach(function (a) {
      html += '<option value="' + esc(a) + '"' + (a === selectedArea ? ' selected' : '') + '>' + esc(a) + '</option>';
    });
    areaEl.innerHTML = html;
    if (selectedArea && areas.indexOf(selectedArea) !== -1) areaEl.value = selectedArea;
    else areaEl.value = '';
  };
  // E5 — Dhaka district suggests the Inside Dhaka zone, any other
  // district suggests Outside Dhaka; the customer can still change
  // the zone by hand afterwards (updateTotal re-prices on change).
  GoinceCheckout.prototype.suggestZone = function () {
    var district = String(this.get('district') || '').trim();
    var zone = this.doc.getElementById ? this.doc.getElementById('delivery_area') : null;
    if (!zone || !district) return;
    zone.value = district === 'Dhaka' ? 'inside_dhaka' : 'outside_dhaka';
    if (typeof window !== 'undefined' && typeof window.updateTotal === 'function') window.updateTotal();
  };
  GoinceCheckout.prototype.init = function () {
    var self = this;
    if (!self.form) return self;
    // Pre-filled district (logged-in customer, E3): build its areas.
    var areaEl = self.el('area');
    var presetArea = areaEl ? areaEl.getAttribute('data-selected') : null;
    if (self.get('district')) self.populateAreas(presetArea || '');
    FIELDS.forEach(function (name) {
      var el = self.el(name);
      if (!el || !el.addEventListener) return;
      el.addEventListener('input', function () { self.showField(name, true); self.validateForm(true); });
      el.addEventListener('change', function () { self.showField(name, true); self.validateForm(true); });
    });
    var districtEl = self.el('district');
    if (districtEl && districtEl.addEventListener) {
      districtEl.addEventListener('change', function () {
        self.populateAreas('');
        self.suggestZone();
        self.validateForm(true);
      });
    }
    // The Transaction ID rule follows the payment method (E4): a
    // switch to bKash/Nagad/Rocket must re-validate immediately,
    // even though payment_method itself has no ✓/error display.
    var paymentEl = self.el('payment_method');
    if (paymentEl && paymentEl.addEventListener) {
      paymentEl.addEventListener('change', function () { self.validateForm(true); });
    }
    if (self.form.addEventListener) {
      self.form.addEventListener('submit', function (ev) {
        var result = self.validateForm(true);
        if (!result.valid) {
          if (ev && ev.preventDefault) ev.preventDefault();
          var firstBad = null;
          FIELDS.some(function (name) {
            if (result.errors[name]) { firstBad = self.el(name); return true; }
            return false;
          });
          if (firstBad && firstBad.focus) firstBad.focus();
        }
        // Valid: do nothing — the PR #81 lock (inline in the view)
        // disables the button and shows its spinner from here.
      });
    }
    self.validateForm(false);
    return self;
  };

  function boot(doc) {
    var inst = new GoinceCheckout(doc);
    inst.init();
    return inst;
  }

  if (typeof window !== 'undefined') {
    window.GoinceCheckout = {
      validateField: validateField,
      isValidBdPhone: isValidBdPhone,
      isValidEmail: isValidEmail,
      boot: boot,
    };
    var doc = window.document;
    if (doc) {
      if (doc.readyState === 'loading' && doc.addEventListener) {
        doc.addEventListener('DOMContentLoaded', function () { boot(doc); });
      } else {
        boot(doc);
      }
    }
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateField: validateField, isValidBdPhone: isValidBdPhone, isValidEmail: isValidEmail, GoinceCheckout: GoinceCheckout, boot: boot };
  }
})();

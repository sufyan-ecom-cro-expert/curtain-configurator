const formatMoney = (cents, format) =>
  format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
    const [thousands, decimal] = key.includes('comma_separator') ? ['.', ','] : [',', '.'];
    const [whole, fraction] = (cents / 100).toFixed(key.includes('no_decimals') ? 0 : 2).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return fraction ? `${grouped}${decimal}${fraction}` : grouped;
  });

const addDays = (days, workingDaysOnly) => {
  const date = new Date();
  while (days > 0) {
    date.setDate(date.getDate() + 1);
    // getDay() is 0 on Sunday and 6 on Saturday.
    if (!workingDaysOnly || date.getDay() % 6 !== 0) days--;
  }
  return date;
};


const ZOOM_SCALE = 2.5;

const formatDay = (date) =>
  `${date.getDate()} ${date.toLocaleDateString(document.documentElement.lang || undefined, { month: 'long' })}`;

class CurtainConfigurator extends HTMLElement {
  connectedCallback() {
    this.querySelectorAll('[data-media-target]').forEach((thumb) =>
      thumb.addEventListener('click', () => this.showMedia(thumb.dataset.mediaTarget))
    );
    this.setupZoom();
    this.section = this.closest('.shopify-section');
    this.onResize = () =>
      this.section.style.setProperty('--cc-offset-top', `${this.section.getBoundingClientRect().top + window.scrollY}px`);
    this.onResize();
    window.addEventListener('resize', this.onResize);

    this.rows = [...this.querySelectorAll('.cc__row')];
    this.rows.forEach((row) =>
      row.querySelector('summary').addEventListener('click', (event) => {
        event.preventDefault();
        this.toggleRow(row, !row.classList.contains('is-open'));
      })
    );
    this.addEventListener('shopify:block:select', (event) => {
      if (this.rows.includes(event.target)) this.toggleRow(event.target, true);
    });

    // Blocks can be removed in the theme editor, so stop if a required one is missing.
    this.form = this.querySelector('form');
    const config = this.querySelector('[data-config]');
    const required = ['[name="width"]', '[name="drop"]', '[name="color"]', '[data-submit]'];
    if (!config || required.some((selector) => !this.form.querySelector(selector))) return;

    this.config = JSON.parse(config.textContent);
    this.widthInput = this.form.elements.width;
    this.widthError = this.querySelector('[data-width-error]');
    this.price = this.querySelector('[data-price]');
    this.submitButton = this.querySelector('[data-submit]');
    this.submitLabel = this.querySelector('[data-submit-label]');
    this.formError = this.querySelector('[data-form-error]');
    this.selectedColor = this.querySelector('[data-selected-color]');
    this.specs = Object.fromEntries([...this.querySelectorAll('[data-spec]')].map((el) => [el.dataset.spec, el]));

    ['drop', 'color'].forEach((name) => {
      if (!this.form.querySelector(`[name="${name}"]:checked`)) this.form.querySelector(`[name="${name}"]`).checked = true;
    });

    this.form.addEventListener('input', (event) => this.onInput(event));
    this.form.addEventListener('submit', (event) => this.onSubmit(event));
    this.widthInput.addEventListener('change', () => this.showWidthError());

    this.renderDeliveryDates();
    this.update();
  }

  renderDeliveryDates() {
    const note = this.querySelector('[data-delivery-note]');
    if (!note) return;

    const { deliveryNote, minDays, maxDays, workingDays } = note.dataset;
    const workingDaysOnly = workingDays === 'true';
    const start = addDays(Number(minDays), workingDaysOnly);
    const end = addDays(Math.max(Number(minDays), Number(maxDays)), workingDaysOnly);
    note.textContent = deliveryNote.replace('[start]', formatDay(start)).replace('[end]', formatDay(end));
  }

  // Mouse: zoom while hovering. Touch and pen: tap to toggle, drag to pan. The button works for everyone.
  setupZoom() {
    this.stage = this.querySelector('.cc__stage');
    this.zoom = this.querySelector('.cc__zoom');
    this.zoomToggle = this.querySelector('[data-zoom-toggle]');
    if (!this.zoom) return;

    this.stage.addEventListener('pointerdown', (event) => (this.pointerType = event.pointerType));
    this.stage.addEventListener('pointerenter', (event) => event.pointerType === 'mouse' && this.setZoom(true, event));
    this.stage.addEventListener('pointerleave', (event) => event.pointerType === 'mouse' && this.setZoom(false));
    this.stage.addEventListener('pointermove', (event) => this.zoomed && this.moveZoom(event));
    this.stage.addEventListener('click', (event) => {
      if (this.pointerType !== 'mouse' && !event.target.closest('[data-zoom-toggle]')) this.setZoom(!this.zoomed, event);
    });
    this.zoomToggle.addEventListener('click', () => this.setZoom(!this.zoomed));
    this.zoomToggle.addEventListener('keydown', (event) => event.key === 'Escape' && this.setZoom(false));
  }

  setZoom(on, event) {
    const slide = this.querySelector('.cc__slide.is-active[data-zoom-src]');
    if (on && !slide) return;

    this.zoomed = on;
    if (on) {
      // Size the copy like object-fit: cover, then enlarge it.
      const image = slide.querySelector('img');
      const stage = this.stage.getBoundingClientRect();
      const coverWidth = Math.max(stage.width, stage.height * (image.naturalWidth / image.naturalHeight || 1));
      this.zoom.style.backgroundImage = `url("${slide.dataset.zoomSrc}")`;
      this.zoom.style.backgroundSize = `${coverWidth * ZOOM_SCALE}px auto`;
      this.moveZoom(event);
    }
    this.stage.classList.toggle('is-zoomed', on);
    this.zoomToggle.setAttribute('aria-pressed', on);
  }

  moveZoom(event) {
    const stage = this.stage.getBoundingClientRect();
    const percent = (value, start, size) => (event ? Math.min(100, Math.max(0, ((value - start) / size) * 100)) : 50);
    this.zoom.style.backgroundPosition = `${percent(event?.clientX, stage.left, stage.width)}% ${percent(event?.clientY, stage.top, stage.height)}%`;
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this.onResize);
  }

  // Animates the row's height. The details element stays open until the closing animation ends.
  toggleRow(row, open) {
    if (open) this.rows.forEach((other) => other !== row && other.classList.contains('is-open') && this.toggleRow(other, false));

    const startHeight = row.offsetHeight;
    row.animation?.cancel();
    row.classList.toggle('is-open', open);
    row.open = true;
    const endHeight = open ? row.offsetHeight : row.offsetHeight - row.querySelector('.cc__row-content').offsetHeight;

    row.style.overflow = 'hidden';
    row.animation = row.animate(
      { height: [`${startHeight}px`, `${endHeight}px`] },
      { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
    );
    row.animation.onfinish = () => {
      row.open = open;
      row.style.overflow = '';
      row.animation = null;
    };
  }

  onInput(event) {
    clearTimeout(this.errorTimer);
    this.formError.textContent = '';
    this.update();

    if (event.target === this.widthInput) {
      // Wait for a pause in typing so "1" on the way to "180" isn't flagged.
      this.errorTimer = setTimeout(() => this.showWidthError(), 800);
    } else if (event.target.name === 'color') {
      this.showMedia(this.findMediaForColor(event.target.value));
    }
  }

  readWidth() {
    const raw = this.widthInput.value.trim();
    const value = Number(raw);
    const { strings } = this.config;

    if (this.widthInput.validity.badInput) return { error: strings.widthInteger };
    if (raw === '') return { error: strings.widthEmpty };
    if (!Number.isInteger(value)) return { error: strings.widthInteger };
    if (value < Number(this.widthInput.min) || value > Number(this.widthInput.max)) return { error: strings.widthRange };
    return { value };
  }

  update() {
    const { tiers, variants, optionIndex, moneyFormat, strings } = this.config;
    const width = this.readWidth();
    const dropInput = this.form.querySelector('[name="drop"]:checked');
    const color = this.form.querySelector('[name="color"]:checked').value;
    const tier = width.error ? null : tiers.find((t) => width.value >= t.minWidth && width.value <= t.maxWidth);

    this.widthMessage = width.error || (tier ? '' : strings.widthUnpriced);
    if (!this.widthMessage) this.showWidthError();

    this.variant = null;
    this.selectedColor.textContent = color;
    this.setSpec('width', width.error ? '—' : `${width.value} cm`);
    this.setSpec('drop', dropInput.value);
    this.setSpec('color', color);
    this.setSpec('panels', tier ? tier.panels : '—');

    if (!tier) {
      this.setPrice('—');
      return this.setButton(strings.enterWidth, false);
    }

    const price = Math.round((tier.basePrice + tier.pricePerDropTier * Number(dropInput.dataset.step)) * 100);
    const formattedPrice = formatMoney(price, moneyFormat);
    const variant = variants.find(
      (v) =>
        v.options[optionIndex.color] === color &&
        v.options[optionIndex.drop] === dropInput.value &&
        v.options[optionIndex.panels] === String(tier.panels)
    );
    this.setPrice(formattedPrice);

    if (!variant || variant.price !== price) {
      console.warn('[curtain-configurator] Price does not match variant. Check the variant prices against the pricing tiers.', {
        width: width.value,
        drop: dropInput.value,
        color,
        panels: tier.panels,
        expected: price,
        variant: variant ? { id: variant.id, price: variant.price } : null,
      });
      return this.setButton(strings.unavailable, false);
    }
    if (!variant.available) return this.setButton(strings.soldOut, false);

    this.variant = variant;
    this.properties = { Width: `${width.value}cm`, Drop: dropInput.value, _fabric_panels: tier.panels };
    this.setButton(`${strings.addToCart} – ${formattedPrice}`, true);
  }

  setSpec(name, value) {
    if (this.specs[name]) this.specs[name].textContent = value;
  }

  setPrice(text) {
    if (this.price.textContent === text) return;
    this.price.textContent = text;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.price.animate([{ opacity: 0.35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], {
      duration: 220,
      easing: 'ease-out',
    });
  }

  setButton(label, enabled) {
    this.submitLabel.textContent = label;
    this.submitButton.disabled = !enabled;
  }

  showWidthError() {
    const message = this.widthMessage || '';
    this.widthError.textContent = message;
    this.widthError.hidden = !message;
    this.widthInput.setAttribute('aria-invalid', Boolean(message));
  }

  findMediaForColor(color) {
    return this.config.variants.find((v) => v.options[this.config.optionIndex.color] === color && v.mediaId)?.mediaId;
  }

  showMedia(mediaId) {
    if (!mediaId) return;
    if (this.zoomed) this.setZoom(false);
    this.querySelectorAll('[data-media-id]').forEach((slide) =>
      slide.classList.toggle('is-active', slide.dataset.mediaId === String(mediaId))
    );
    this.querySelectorAll('[data-media-target]').forEach((thumb) =>
      thumb.toggleAttribute('aria-current', thumb.dataset.mediaTarget === String(mediaId))
    );
  }

  async onSubmit(event) {
    event.preventDefault();
    this.showWidthError();
    if (!this.variant || this.submitButton.getAttribute('aria-busy') === 'true') return;

    const cart = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
    const variant = this.variant;
    const payload = { id: variant.id, quantity: 1, properties: this.properties };

    // Ask for the cart sections in the same request so the drawer can render without a second fetch.
    if (cart) {
      payload.sections = cart.getSectionsToRender().map((section) => section.id);
      payload.sections_url = window.location.pathname;
      cart.setActiveElement(document.activeElement);
    }

    this.setBusy(true);
    try {
      const response = await fetch(`${window.routes.cart_add_url}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return this.showCartError(data.description || data.message);

      if (!cart) {
        window.location = window.routes.cart_url;
        return;
      }

      if (typeof publish === 'function') {
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'curtain-configurator', productVariantId: variant.id, cartData: data });
      }
      cart.classList.remove('is-empty');
      cart.renderContents(data);
      this.setBusy(false);
      this.showAdded();
    } catch (error) {
      console.error(error);
      this.showCartError();
    }
  }

  showCartError(message) {
    this.setBusy(false);
    this.formError.textContent = message || this.config.strings.cartError;
    this.update();
  }

  setBusy(busy) {
    this.submitButton.setAttribute('aria-busy', busy);
    this.submitButton.classList.toggle('is-loading', busy);
    if (busy) this.submitLabel.textContent = this.config.strings.adding;
  }

  showAdded() {
    this.submitButton.classList.add('is-added');
    this.submitLabel.textContent = this.config.strings.added;
    setTimeout(() => {
      this.submitButton.classList.remove('is-added');
      this.update();
    }, 2000);
  }
}

if (!customElements.get('curtain-configurator')) customElements.define('curtain-configurator', CurtainConfigurator);

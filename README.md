# Made-to-Measure Curtain Configurator

A product page section for Shopify's Dawn theme that sells curtains made to measure. The customer enters a width, picks a drop and a fabric, and sees the price straight away. In the background the section works out how many fabric panels the curtain needs, adds the matching hidden variant to the cart, and passes the panel count to the order as a private property.

All pricing data lives in a metaobject. The theme code contains no width ranges or prices.

![Product page](docs/screenshots/pdp-desktop.png)

## What's in this repo

| Path | Purpose |
| --- | --- |
| `sections/curtain-configurator.liquid` | The section: gallery, inputs, summary card, and the JSON config read from the metafield |
| `snippets/curtain-swatch.liquid` | One fabric swatch radio, used by swatch blocks and by the fallback |
| `assets/curtain-configurator.js` | The `<curtain-configurator>` custom element (vanilla ES2020, no libraries) |
| `assets/curtain-configurator.css` | Styles, loaded only by this section |
| `templates/product.curtain.json` | Product template with the configurator blocks and three collapsible rows |
| `schema/curtain-pricing-tier.json` | Export of the metaobject definition, its entries and the product metafield definition |
| `schema/example-cart-add-payload.json` | The exact request body sent to `/cart/add.js` |
| `schema/example-cart-line.json` | The resulting cart line, read back from `/cart.js` |
| `tests/e2e/run.mjs` | End-to-end Playwright test of the full flow |
| `docs/screenshots/` | Desktop, tablet, mobile, cart drawer and cart page |

Everything else is stock Dawn 16.0.0. The only Dawn files changed are listed under [Changes to Dawn files](#changes-to-dawn-files).

## Setup on a fresh store

### 1. Metaobject definition

In **Settings → Custom data → Metaobject definitions**, add a definition:

- **Name:** Curtain Pricing Tier
- **Type:** `curtain_pricing_tier`
- **Storefront access:** turned on, so Liquid can read it

| Key | Type | Validation |
| --- | --- | --- |
| `min_width` | Integer | Required, min 1 |
| `max_width` | Integer | Required, min 1 |
| `panels_required` | Integer | Required, min 1 |
| `base_price` | Decimal | Required, min 0 |
| `price_per_drop_tier` | Decimal | Required, min 0 |

The prices are decimals rather than money fields because the formula needs plain numbers. The theme formats the result with the shop's own money format.

To create the definition through the Admin API instead, send the `metaobjectDefinition` object from `schema/curtain-pricing-tier.json` as the input:

```graphql
mutation ($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition { id }
    userErrors { field message }
  }
}
```

### 2. Pricing tiers

Add one entry per width band. The ranges must not overlap. Leave no gaps if every width in the range should be sellable.

| Handle | Width (cm) | Panels | Base price | Price per drop tier |
| --- | --- | --- | --- | --- |
| `tier-1-panel` | 50–120 | 1 | 12,000.00 | 2,500.00 |
| `tier-2-panels` | 121–240 | 2 | 22,000.00 | 4,500.00 |
| `tier-3-panels` | 241–360 | 3 | 32,000.00 | 6,500.00 |

The allowed width range on the storefront comes from these entries. It runs from the lowest `min_width` to the highest `max_width`, so adding a 361–480 cm tier extends the input automatically.

### 3. Product metafield

In **Settings → Custom data → Products**, add a definition:

- **Namespace and key:** `custom.pricing_tiers`
- **Type:** Metaobject, list of entries, limited to Curtain Pricing Tier
- **Storefront access:** turned on

### 4. Product

Create a product with three options, in this order:

| Option | Values | Shown to the customer? |
| --- | --- | --- |
| Color | Ivory, Stone Grey, Teal | Yes, as swatches |
| Drop | 150cm, 200cm, 250cm | Yes, as buttons |
| Panels | 1, 2, 3 | Never |

That gives 27 variants. Set each variant's price with the formula in the next section. Then:

1. Link all three tier entries in the product's **Pricing tiers** metafield.
2. Set **Theme template** to `curtain`.
3. Set inventory to not tracked, or allow overselling. Every curtain is made to order.
4. Assign each color's image to its variants so the gallery follows the swatch.

The option names are section settings, so a product that uses "Colour" or "Length" still works.

### 5. Theme

1. Push the theme with `shopify theme push --unpublished`, or copy in the files from the table above.
2. In **Theme settings → Cart**, set **Cart type** to **Drawer**. The section also works with the notification popup or the cart page, but the drawer is the intended experience.
3. Open the product in the theme editor. Each part of the product column is a block. Each Fabric swatch block's **Color option value** must match the variant's Color value exactly.

## How the price is calculated

```
panels    = panels_required of the tier where min_width ≤ width ≤ max_width
drop_step = position of the chosen Drop value in the product's Drop option (first = 0)
price     = base_price + price_per_drop_tier × drop_step
```

**Worked example.** A customer enters a width of 180 cm and chooses a 200 cm drop in Stone Grey.

1. 180 cm falls in the 121–240 cm tier, so the curtain needs **2 panels**.
2. 200cm is the second Drop value, so `drop_step` is **1**.
3. The price is 22,000 + 4,500 × 1 = **Rs. 26,500**.
4. The script selects the variant **Stone Grey / 200cm / 2**, whose price is also Rs. 26,500, and adds it to the cart.

Full price grid for each color:

| Drop | 1 panel | 2 panels | 3 panels |
| --- | --- | --- | --- |
| 150cm (step 0) | 12,000 | 22,000 | 32,000 |
| 200cm (step 1) | 14,500 | 26,500 | 38,500 |
| 250cm (step 2) | 17,000 | 31,000 | 45,000 |

The script works in cents with `Math.round(price × 100)` to avoid floating-point drift. It then compares that figure to the matched variant's price.

## Cart payload and serialization

### Request

The section posts one JSON request to the locale-aware `/cart/add.js` route:

```json
{
  "id": 67634407407803,
  "quantity": 1,
  "properties": { "Width": "180cm", "Drop": "200cm", "_fabric_panels": 2 },
  "sections": ["cart-drawer", "cart-icon-bubble"],
  "sections_url": "/products/made-to-measure-curtain"
}
```

The resulting cart line, read back from `/cart.js`:

```json
{
  "variant_options": ["Stone Grey", "200cm", "2"],
  "price": 2650000,
  "properties": { "Width": "180cm", "Drop": "200cm", "_fabric_panels": 2 }
}
```

### Decisions

**Why the panel count is a hidden variant and not just a property.**
- **Shopify charges the variant price.** A line item property can't change what checkout charges. That would need a Cart Transform function, which isn't available on every plan. Pricing each panel count as a real variant keeps the charged amount correct with no app or function.
- **Fulfillment sees the right item.** Each panel count has its own SKU, for example `MTM-STN-200-P2`. Inventory, reporting and fulfillment line up with what has to be cut.
- **The buyer never chooses it.** The Panels option is never rendered. The script picks it from the width.

**Why the client checks the price against the variant.** The script recomputes the price from the metaobject and compares it to the variant it is about to add. If they differ, the button is disabled and a warning naming the expected and actual prices is logged to the console. A stale variant price can never be charged silently.

**Why underscore properties.**
- **Visible properties.** `Width` and `Drop` are written for the customer and show in the cart, checkout and order confirmation.
- **Private property.** `_fabric_panels` starts with an underscore. Dawn's cart templates skip underscore keys, and Shopify hides them at checkout. The value still appears on the order in the admin and in the order JSON for the workroom.
- **Value types.** Properties are kept as plain key and value pairs. `_fabric_panels` is a number, so downstream systems don't need to parse a string.

**Why JSON and not FormData.** The body is built from validated state, not from form fields, so a stale or tampered input can't reach the request. JSON also keeps `_fabric_panels` as a number.

**Why the Section Rendering API.**
- **One request.** Passing `sections` and `sections_url` makes Shopify return the freshly rendered cart drawer and cart icon in the add response. The drawer updates without a second fetch.
- **Dawn does the rendering.** The section names come from the cart element's own `getSectionsToRender()`, and the response goes to Dawn's existing `renderContents()`. This works with the cart drawer, and with the notification popup if the merchant switches to it.
- **Fallback.** With neither element on the page, the browser goes to the cart page.
- **Other listeners stay in sync.** A `cartUpdate` event is published on Dawn's pub/sub bus.

**Button states.** The button shows a spinner while the request runs, then "Added to cart" for two seconds. On failure it shows Shopify's error message, or a generic message for network errors, in a reserved slot under the button, and becomes usable again.

## Keeping variant prices in sync with the metaobject

The metaobject is the source of truth for the storefront calculation. Shopify still charges the variant price. If a tier price changes, the matching variants must change too.

- **What happens if they drift.** The storefront detects the mismatch and disables "Add to Cart" for the affected combinations. Customers can't be charged a price that differs from the one displayed.
- **How to update.** Recompute each variant with the formula above and send the new prices in one `productVariantsBulkUpdate` call per product. The `variantPrice` rule in `schema/curtain-pricing-tier.json` is the formula to apply.
- **Automating it.** A Shopify Flow workflow or a small script triggered on metaobject update can run the same calculation. That removes the manual step for teams that change prices often.
- **Adding a tier.** Add an entry, link it on the product, and add one more Panels value with its variants.

## Changes to Dawn files

| File | Change | Why |
| --- | --- | --- |
| `config/settings_data.json` | `cart_type` set to `drawer` in the current settings | So the add-to-cart flow opens the drawer |
| `snippets/cart-drawer.liquid` | Four lines in the options loop | Skips the Panels option on configured curtain lines and skips any option already sent as a property, such as Drop |
| `sections/main-cart-items.liquid` | Same four lines | Same rule on the cart page |

Dawn already hides underscore properties in both cart templates, so no change was needed for `_fabric_panels`.

## Zero layout shift

- **Fixed media box.** On desktop the main image height is the screen height minus everything above the page content. A small inline script measures that before the gallery renders, so the image never resizes after load. On tablet and mobile the gallery uses a fixed aspect ratio. Every image has width and height attributes.
- **Reserved message slot.** The hint and the validation error share one grid cell. Errors toggle visibility instead of being inserted.
- **Stable text boxes.** The price, the summary values and the button label sit in boxes that don't change size when their text changes. Numbers use tabular figures.
- **Reserved note height.** The delivery note keeps room for its text before the script fills in the dates, two lines on mobile.
- **First paint.** The first price is rendered by Liquid, so nothing moves when the script runs.
- **Animation.** Price changes animate with `opacity` and `transform` only.

The end-to-end test records every `layout-shift` entry during the interactions and asserts the total is zero.

## Accessibility

- **Labels.** Every input has a label. Drop and Fabric are fieldsets with legends.
- **Keyboard.** Swatches and drops are native radio groups, so arrow keys work. Focus rings use the accent color.
- **Validation.** The width field sets `aria-invalid` and is described by both the hint and the error.
- **Announcements.** The price is an `output` with `aria-live="polite"`, and cart errors use `role="alert"`.
- **Reduced motion.** The `prefers-reduced-motion` media query turns transitions off.

## Theme editor settings

Every part of the product column is its own block, so it can be reordered, removed or added again in the theme editor.

| Block | Settings | Notes |
| --- | --- | --- |
| Vendor | None | Shows the product vendor |
| Title | Heading | Blank uses the product title |
| Description | None | Shows the product description |
| Width input | Label, hint | The allowed range is added after the hint |
| Drop picker | Label | Values come from the Drop option |
| Fabric picker | Label | Shows the Fabric swatch blocks, or the Color values if there are none |
| Fabric swatch | Color option value, swatch color, optional fabric image | One per color. The value must match the variant's Color value exactly |
| Price and add to cart | Title, panel count visibility, note, delivery days, working days only | The summary card and button |
| Collapsible row | Heading, content, open by default | Add as many as needed. The template has three under the button, all closed |

Collapsible rows slide open and closed, and only one stays open at a time. Opening a row closes any other open row. Selecting a row's block in the theme editor opens it.

The add to cart button uses a curtain hover: a pleated curtain with a scalloped hem drops over the button, and the label turns to the accent color. The curtain color is the **Button hover curtain** section setting.

The step numbers 01, 02 and 03 come from a CSS counter, so they follow the block order. The script stops quietly if the width, drop, fabric or add to cart block is removed, and the gallery keeps working.

**Delivery dates.** The note in the add to cart block can contain `[start]` and `[end]`. The script fills them with dates counted from today, for example "Made to order · Ships 16 October to 21 October". The earliest and latest day counts are settings, and weekends can be skipped. The dates are worked out in the browser, because Shopify may serve a cached page rendered on an earlier day.

**Section settings.**
- **Gallery:** image ratio. On desktop the main image fills the screen below the header, with thumbnails in a column on its left. On tablet and mobile the ratio applies, and on mobile the thumbnails move under the image.
- **Configuration:** default width, and the names of the Color, Drop and Panels options.
- **Style:** heading font, background, alternative background for the summary card, inputs and image backdrop, text, accent, and the button hover curtain color.
- **Spacing:** top and bottom padding, and the column gap.

The section only appears on product templates. It shows a setup notice in the editor if the metafield or the options are missing.

## Testing

`tests/e2e/run.mjs` runs 49 checks against a live preview:

- **Rendering:** no Panels control on the page, and no Dawn product form.
- **Pricing:** price and panel count at every tier boundary, from 50 to 360 cm.
- **Validation:** inline errors for 49, 361, 180.5 and an empty field.
- **Delivery dates:** the note shows the dates 7 and 10 working days from today.
- **Interaction:** color swaps the gallery image, and arrow keys move through the swatches.
- **Layout:** thumbnails to the left of the main image, the main image filling the screen below the header, three collapsible rows under the button, zero layout shift, and no horizontal overflow at tablet and mobile widths.
- **Interaction:** rows start closed and only one opens at a time, and the button curtain covers the button on hover.
- **Cart:** the exact `/cart/add.js` payload, the drawer contents, the cart page contents, and the cart line read back from `/cart.js`.
- **Errors:** a simulated 422 response and a simulated network failure.

```bash
cd tests/e2e
npm install
npx playwright install chromium
STORE_URL=https://your-store.myshopify.com STORE_PASSWORD=... THEME_ID=123456789 npm test
```

## Known limitations

- **Checkout shows the variant title.** Checkout and Shopify's order emails list the full variant title, for example "Stone Grey / 200cm / 2". Hiding the panel value there needs checkout customization, which depends on the plan, or edited notification templates.
- **Variant count grows with the catalog.** It equals colors × drops × tiers. Shopify allows up to 2,048 variants per product, so this scales well. Very large fabric ranges could move color to separate products.

## Credits

Product photos are from [Unsplash](https://unsplash.com) and are free to use under the Unsplash License.

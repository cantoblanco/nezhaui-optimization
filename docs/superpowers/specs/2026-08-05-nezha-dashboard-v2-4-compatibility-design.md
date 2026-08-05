# Nezha Dashboard v2.4 Compatibility Design

## Goal

Restore the behavior of `nezhaop.js` on the official Nezha user frontend v2.4.2 while retaining compatibility with older dashboard releases:

- hide the server-detail tab switch;
- show both the detail chart and network chart at the same time;
- keep both chart views live rather than copying a static DOM snapshot;
- continue inserting cycle-transfer usage bars into server cards on the home page.

## Root Cause

The official user frontend changed in `hamster1963/nezha-dash-v2` commit `03977c4` (released in v2.3.0). `ServerDetail` previously mounted both chart components and hid the inactive one with an inline `display` style. It now conditionally mounts only the selected component and lazy-loads `NetworkChart`.

The existing script assumes both chart panels are present as direct `div` children of `.server-info`. Setting their `display` properties can no longer reveal the unmounted panel. The home-page logic also observes only direct child-list changes, which is too narrow for current React rendering updates.

## Chosen Approach

Use a same-origin embedded detail view for current frontends and keep the legacy two-mounted-panel path for old frontends.

### Parent detail page

1. Detect a normal `/server/:id` detail page that is not already in embedded mode.
2. Detect whether the frontend uses conditional panel mounting.
3. Add an iframe pointing to the same URL with a dedicated query marker, `nezhaop_view=detail`.
4. Select the Network tab in the parent page, hide the tab-switch section, and place the iframe before the live network chart.
5. Read the same-origin iframe document and keep the iframe height synchronized with its detail-chart content.

The parent continues to own the live network chart. The iframe owns a second React application instance whose selected tab remains Detail, so its detail chart remains mounted and live.

### Embedded detail page

1. Detect `nezhaop_view=detail` before running normal parent-page behavior.
2. Never create another iframe, preventing recursive embedding.
3. Keep the Detail tab selected.
4. Hide global chrome, the detail overview, the tab-switch section, footer, and unrelated layout elements.
5. Expose only the detail chart and report its content height to the parent through same-origin DOM access and `postMessage` as a fallback.

### Legacy detail page

If two chart panels are already mounted, retain the existing lightweight behavior: click Network once, reveal both mounted panels, and hide the tab switch. Do not create an iframe.

## Home-Page Cycle Transfer Bars

The cycle-transfer renderer will continue consuming `/api/v1/service` and support scalar or per-server-map values for `max`, `from`, `to`, and `next_update`.

DOM integration will use semantic anchors already supplied by the official frontend:

- `.server-card-list` and `.server-inline-list` for list roots;
- the server-name text inside each card rather than exact Tailwind class strings;
- script-owned `data-*` attributes for inserted elements and lookup;
- subtree observation so nested React updates trigger reconciliation.

Inserted rows will be idempotent: an existing row is updated in place, removed when disabled, and recreated only when its owning card changes.

## Lifecycle and Failure Handling

- Route changes remove stale iframe and observer state before initializing a new detail page.
- Repeated script execution reuses one global runtime and does not duplicate timers, observers, styles, or iframes.
- The iframe is shown only after its detail chart is ready; a load timeout leaves the normal tabbed frontend usable rather than hiding all content.
- If same-origin iframe access is unavailable, the script logs a diagnostic only when logging is enabled and leaves the normal Network view intact.
- Fetch failures keep the last rendered transfer values and retry on the next configured interval.

## Testing

Automated Node tests will execute the script against representative DOM fixtures for both frontend generations and assert:

1. v2.4 conditional rendering creates exactly one marked iframe and never recurses in embedded mode.
2. Legacy dual-panel markup uses the no-iframe path.
3. Reinitialization and route changes do not duplicate observers, timers, styles, or inserted elements.
4. Server-card discovery works for card and inline layouts without exact Tailwind class dependencies.
5. Cycle-transfer fields work in scalar and per-server-map forms.
6. Inserted progress values are clamped and updated idempotently.
7. The source contains no obsolete `nth-child` or exact generated-class selectors.

Manual verification will build or serve the official v2.4.2 frontend with its mock API, load the custom script, and confirm both charts remain live while navigating between the home page and multiple server-detail routes.

## Out of Scope

- Forking or rebuilding the official Nezha frontend for production.
- Supporting third-party user templates whose semantic structure differs from the official frontend.
- Combining both charts into one React tree; the script cannot safely mount private React components from the compiled application.

# Provider List Selection Actions

## Goal

Make provider list actions explicit and selection-based. Rows should no longer open editing by clicking anywhere, and provider test/output features should be removed from the provider panel code path.

## Requirements

* Add a checkbox to every provider row.
* Delete action must operate on checked providers only.
* Duplicate/copy action must operate on checked providers only and be enabled only when exactly one provider is checked.
* Add an explicit row-level edit action.
* Clicking the provider row body must not open the editor drawer.
* Selecting a row checkbox must not open the editor drawer.
* Preserve row display layout and keep test-like actions out of row actions.
* Remove provider test UI, output dialog entry, and related provider-panel test/output code paths.
* Keep account page test behavior out of scope unless shared state/code removal requires a small adjustment.
* Keep add provider behavior unchanged.

## Acceptance Criteria

* [x] Provider rows include checkboxes.
* [x] Delete button is disabled until at least one provider is checked.
* [x] Delete deletes all checked providers after confirmation.
* [x] Duplicate button is disabled unless exactly one provider is checked.
* [x] Duplicate creates a draft from the single checked provider.
* [x] Row body click does not edit/open drawer.
* [x] Row-level edit button opens the drawer for that provider.
* [x] Provider test button, view output button, output dialog, and provider row test action are removed.
* [x] `npm run build` passes.
* [x] `npm run test:auth` passes.

## Definition of Done

* Existing unrelated workspace files are not touched.
* Frontend code removes obsolete test/output paths rather than hiding them.
* No backend changes unless frontend build requires command cleanup.

## Technical Notes

* Primary file: `src/App.tsx`.
* Likely style file: `src/styles.css`.
* Existing provider panel functions include `ProvidersPanel`, `selectProvider`, `duplicateProvider`, `deleteProvider`, `testCurrentProvider`, and output dialog state.

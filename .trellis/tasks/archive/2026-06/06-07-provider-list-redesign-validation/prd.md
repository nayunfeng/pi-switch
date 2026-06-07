# Provider List Redesign And Validation Delay

## Goal

Improve provider management UX by delaying required-field error display until the user saves/tests or touches a field, and redesigning the provider list into a horizontal row list with list-level actions.

## Requirements

* Newly added providers must not immediately show required-field error text before the user tries to save/test or edits the relevant field.
* Newly added providers stay as an unsaved drawer draft and must not appear in the provider row list until a successful save.
* Save/test validation must still block invalid providers and show the relevant errors after the user attempts the action.
* Replace the left-side provider list with a horizontal list/table where each provider occupies one row.
* Provide a list-level action bar for adding providers and future batch-style actions. Move duplicate/delete/view-output style actions out of the page header into this action area where appropriate.
* Put the provider test action on each provider row.
* Selecting or creating a provider opens its detail editor in a right-side drawer instead of rendering the full form inline below the list.
* Keep existing provider editing capabilities: basic info, auth settings, advanced config, model selection, save, duplicate, delete, refresh/fetch models.
* Keep responsive behavior usable on narrow screens.

## Acceptance Criteria

* [x] Clicking "New provider" creates/selects a provider without immediate required-field error messages.
* [x] Clicking "New provider" opens an unsaved drawer draft; the provider row list is unchanged until save succeeds.
* [x] Clicking "Save provider" on an invalid provider displays required-field errors and does not save.
* [x] Clicking row-level "Test" on an invalid provider displays required-field errors and does not run the test.
* [x] Provider list is rendered as one provider per row, not a left sidebar.
* [x] There is a list-level action bar containing add and non-row-specific actions.
* [x] Each provider row has a test action.
* [x] Provider detail editing opens in a right-side drawer, and closing it leaves the row list visible.
* [x] `npm run build` passes.

## Definition of Done

* No backend changes unless needed for tests.
* Existing unrelated workspace files are not touched.
* UI remains dense and operational, not landing-page-like.

## Technical Notes

* Current frontend files: `src/App.tsx`, `src/styles.css`, possibly `src/i18n.ts`.
* Current validation source: `validationErrors(activeProvider)` in `src/App.tsx`.
* Current provider UI: `ProvidersPanel` in `src/App.tsx`, `.prov-layout`, `.prov-list`, `.prov-item` in `src/styles.css`.

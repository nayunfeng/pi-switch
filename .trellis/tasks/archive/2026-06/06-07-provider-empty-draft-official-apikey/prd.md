# Provider Empty Draft And Official API Key Auth

## Goal

Make newly added providers start as an empty draft, and constrain newly added official providers to API Key authentication in the provider editor.

## Requirements

* A newly added provider draft must not be prefilled with a provider name.
* A newly added provider draft must not be prefilled with Base URL.
* When a newly added provider draft is switched to an official provider, its authentication mode must be API Key.
* For newly added official provider drafts, the auth mode choices "Use existing Pi auth" and "Use account" must not be shown.
* Existing persisted official providers must keep their current authentication behavior and available auth modes.
* Validation must still require the necessary fields on save/test.

## Acceptance Criteria

* [x] Clicking "New provider" opens a drawer with an empty provider name.
* [x] Clicking "New provider" opens a drawer with an empty Base URL.
* [x] Switching the new draft to official provider selects API Key auth.
* [x] In that new official draft, only API Key auth is shown.
* [x] Existing official providers still show their existing auth mode options.
* [x] `npm run build` passes.

## Definition of Done

* No backend changes.
* Existing unrelated workspace files are not touched.
* UI remains consistent with the provider drawer/list design.

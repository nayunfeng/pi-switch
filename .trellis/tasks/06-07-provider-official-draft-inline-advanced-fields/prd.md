# Provider Official Draft Inline Advanced Fields

## Goal

When creating an official provider, expose the provider-level Pi fields that are usually hidden in "Provider default advanced config" directly in the main drawer form.

## Requirements

* For new unsaved official provider drafts, show these `provider.advanced` fields in the main provider form:
  * `baseUrl`
  * `api`
  * `apiKey` ("Provider API Key override")
* These fields must write to `provider.advanced`, not to the official provider authentication API Key (`provider.apiKey`).
* Existing persisted official providers keep the existing advanced dialog flow.
* Custom providers keep their existing main form fields.
* The existing advanced dialog still contains the remaining advanced fields such as headers, authHeader, compat, and remains usable.
* Validation and save behavior remain unchanged unless an existing validation rule already applies.

## Acceptance Criteria

* [x] New official provider draft shows Base URL in the main form.
* [x] New official provider draft shows API type in the main form.
* [x] New official provider draft shows Provider API Key override in the main form.
* [x] Editing these fields updates `provider.advanced.baseUrl`, `provider.advanced.api`, and `provider.advanced.apiKey`.
* [x] Persisted official provider editing does not duplicate these fields in the main form.
* [x] `npm run build` passes.

## Definition of Done

* No backend changes.
* Existing unrelated workspace files are not touched.
* UI remains dense and consistent with the provider drawer design.

## Technical Notes

* `docs/pi-official-docs-ai-context.md` states provider-level `baseUrl`, `api`, and `apiKey` are supported fields for `models.json` / provider config.
* Current form code: `OfficialProviderForm` and `ProviderAdvancedForm` in `src/App.tsx`.

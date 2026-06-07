# Provider New Official Default And Locked Kind

## Goal

Make new provider creation default to official providers, and prevent provider kind changes after creation.

## Requirements

* Clicking "New provider" must open an unsaved official provider draft by default.
* The new provider draft may choose official or custom kind before it is saved.
* Persisted providers must not expose an editable kind control.
* Persisted provider kind must remain unchanged during normal editing.
* Existing saved official and custom provider details must remain editable in their relevant fields.
* Existing validation behavior must remain intact.

## Acceptance Criteria

* [x] Clicking "New provider" opens a draft whose kind is official.
* [x] In the new draft drawer, kind can be selected before save.
* [x] After saving a provider, reopening it does not show an editable kind selector.
* [x] Existing official providers cannot be switched to custom.
* [x] Existing custom providers cannot be switched to official.
* [x] `npm run build` passes.

## Definition of Done

* No backend changes.
* Existing unrelated workspace files are not touched.
* UI remains consistent with the provider drawer/list design.

# Remove Provider Apply To Pi

## Goal

Remove the provider-configuration page's direct "Apply to Pi" capability so provider edits are saved only to the Pi Switch app config. Applying credentials to Pi remains an account workflow.

## Requirements

* Remove the provider page action that directly applies the selected provider to Pi.
* Remove frontend command plumbing for `apply_provider_to_pi` when it is no longer used.
* Remove backend Tauri command registration for direct provider apply if no remaining UI path calls it.
* Preserve provider creation, editing, saving, model selection, model refresh/fetch, and provider ping test behavior.
* Preserve account workflows, including `apply_auth_account`, OAuth login, API key account creation, and account active-state refresh.

## Acceptance Criteria

* [ ] The provider configuration footer no longer shows an "Apply to Pi" button.
* [ ] Saving a provider persists only the app config and does not write Pi `models.json`, `auth.json`, or `settings.json`.
* [ ] Account application still writes account credentials/endpoints to Pi through `apply_auth_account`.
* [ ] Provider test still works as its own explicit test flow.
* [ ] TypeScript build passes.
* [ ] Rust tests for backend behavior pass or any skipped verification is documented.

## Definition of Done

* Frontend code has no unused `applyProviderToPi` import/wrapper.
* Backend command handler list has no stale `apply_provider_to_pi` entry.
* Existing unrelated user changes are not reverted.

## Technical Approach

Remove the provider-level apply action at the UI boundary, then remove the unused command wrapper and backend Tauri command. Keep shared backend helper functions used by `test_provider` and existing tests, because provider testing still applies a temporary provider config before running `pi -p "ping"`.

## Out of Scope

* Removing provider creation/editing.
* Removing model configuration or provider test.
* Changing account-based Pi application behavior.
* Updating historical docs/prototypes unless required by build or tests.

## Technical Notes

* Relevant frontend files: `src/App.tsx`, `src/commands.ts`, `src/i18n.ts`.
* Relevant backend file: `src-tauri/src/lib.rs`.
* Relevant specs loaded: `.trellis/spec/frontend/index.md`, `.trellis/spec/frontend/quality-guidelines.md`, `.trellis/spec/frontend/account-contracts.md`.

# Remove Codex Acceptance Panel

## Goal

Remove the "Codex multi-account acceptance/check" panel from the user-facing Accounts page.

## Scope

- Keep normal account actions: add OAuth account, add API Key account, saved account list, filter, apply, rename, duplicate, delete.
- Remove only the readiness/acceptance checklist and its user-facing copy.
- When there are no accounts, show a focused empty state with the primary add-account action instead of an empty list layout.
- Hide account filters when there are no accounts because there is nothing to filter.
- Do not change OAuth login, account storage, or Pi application behavior.

## Verification

- `npm run build` passes.

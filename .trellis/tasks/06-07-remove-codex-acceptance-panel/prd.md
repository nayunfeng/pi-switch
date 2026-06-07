# Remove Codex Acceptance Panel

## Goal

Remove the "Codex multi-account acceptance/check" panel from the user-facing Accounts page.

## Scope

- Keep normal account actions: add OAuth account, add API Key account, saved account list, filter, apply, rename, duplicate, delete.
- Remove only the readiness/acceptance checklist and its user-facing copy.
- Do not change OAuth login, account storage, or Pi application behavior.

## Verification

- `npm run build` passes.

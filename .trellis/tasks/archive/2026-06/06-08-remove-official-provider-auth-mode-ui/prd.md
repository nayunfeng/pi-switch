# Remove Official Provider Auth Mode UI

## Goal

Official providers should use a single API Key configuration path in the provider form. Remove the persisted-provider auth-mode radio cards and the "save API key as account and bind" flow from code, not just from the visible UI.

## Requirements

* Official provider forms must not render the three auth mode radio cards: use Pi existing auth, use account, write API Key.
* Official provider forms must not render the "save API key as account and bind" action.
* Remove the unused official-provider save-as-account handler and prop plumbing from `App.tsx`.
* Keep the API Key input available for official providers.
* Saved official providers should still apply through the existing API Key path by forcing `authMode` to `apiKey` and clearing `authAccountId` on save/provider API Key edits.
* Do not remove the separate Accounts page API Key account creation/import flows in this task.
* Do not remove backend account support in this task.

## Acceptance Criteria

* [x] After saving/reopening an official provider, no auth-mode radio cards are present.
* [x] After saving/reopening an official provider, no "save as account and bind" action is present.
* [x] Official provider API Key still saves and validates through the provider form.
* [x] Saving an official provider no longer preserves old `existing` or `account` auth modes.
* [x] `npm run build` passes.
* [x] `npm run test:auth` passes.

## Definition of Done

* Frontend code removes the obsolete handler and props rather than only hiding buttons with CSS.
* No backend changes unless required by TypeScript/build failures.
* Existing unrelated workspace files are not touched.

## Technical Notes

* Primary file: `src/App.tsx`.
* Related form: `OfficialProviderForm`.
* Previous task moved new-draft official provider basics into the main form; this task fixes persisted official providers showing old auth UI after save.

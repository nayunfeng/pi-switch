# Provider Official Draft API Key Label And API Link

## Goal

Make the new official provider draft form clearer by naming the provider-level API key field simply "API Key" and preselecting API type when the official provider has an obvious matching Pi API type.

## Requirements

* In new official provider drafts, the provider-level `advanced.apiKey` field must be labeled `API Key` instead of `Provider API Key override`.
* The existing persisted-provider advanced dialog may keep the explicit `Provider API Key override` label to distinguish it from auth mode fields.
* When the selected official provider has a clear API type mapping, changing/selecting the provider should set `advanced.api`.
* When there is no clear mapping, do not force an API type; the user can choose or type one manually.
* The API type field remains editable even when it is auto-filled.
* New official provider drafts show one API key input only. That input writes to `provider.advanced.apiKey` and mirrors the same value to the hidden `provider.apiKey` field required by the existing auth/apply validation path.
* The advanced dialog for new official provider drafts must not repeat `Base URL`, `API type`, or `Provider API Key override`; those basics live in the main draft form.

## Known API Type Mappings

* `anthropic`, `ant-ling` -> `anthropic-messages`
* `amazon-bedrock` -> `bedrock-converse-stream`
* `google` -> `google-generative-ai`
* `google-vertex` -> `google-vertex`
* `mistral` -> `mistral-conversations`
* `openai-codex` -> `openai-codex-responses`
* `azure-openai-responses` -> `azure-openai-responses`
* `openai` -> `openai-responses`

Other official providers are left blank unless future code/docs provide a clear mapping.

## Acceptance Criteria

* [x] New official provider draft shows the provider-level API key field as `API Key`.
* [x] New official provider draft shows only one API key input.
* [x] New official provider draft advanced dialog hides the duplicated `Base URL`, `API type`, and `Provider API Key override` fields.
* [x] Changing the official provider to a mapped provider auto-fills API type.
* [x] Changing to an unmapped provider leaves API type empty unless the user has already chosen one.
* [x] API type remains editable after auto-fill.
* [x] The value is stored in `provider.advanced.apiKey` and mirrored to the hidden `provider.apiKey` for the existing official API key auth path.
* [x] `npm run build` passes.

## Definition of Done

* No backend changes.
* Existing unrelated workspace files are not touched.
* UI remains consistent with the provider drawer design.

## Technical Notes

* `docs/pi-official-docs-ai-context.md` documents supported provider-level `api` and `apiKey` fields.
* Current code path: `OfficialProviderForm` and `OfficialProviderAdvancedBasics` in `src/App.tsx`.

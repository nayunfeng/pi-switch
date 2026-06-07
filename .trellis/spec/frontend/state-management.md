# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

### Draft UI state

Use local component state for unsaved entities that should not be visible in persisted collections yet.

For provider creation, `providerDraft` represents the drawer editor state before the user saves. Do not append a newly created provider to `config.providers` until validation passes and `saveAppConfig` succeeds.

```typescript
const draftToSave = providerDraft?.id === providerEntryId ? providerDraft : undefined;
const configToSave = draftToSave
  ? { ...config, activeProviderId: draftToSave.id, providers: [...config.providers, draftToSave] }
  : config;
```

This prevents list rows, batch actions, and row-level tests from treating an unsaved draft as an existing provider.

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## Common Mistakes

### Adding unsaved entities directly to persisted arrays

**Symptom**: Clicking "New provider" immediately creates a row in the provider list before the user saves.

**Cause**: The create action mutates `config.providers`, so the UI treats the draft as persisted.

**Fix**: Keep the new entity in draft state, open the editor drawer, and write it into the persisted array only after save/test validation passes.

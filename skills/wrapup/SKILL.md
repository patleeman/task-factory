---
name: wrapup
description: Verify task completion before marking done. Checks for stubbed code, TODOs, full-stack implementation, test coverage, and ensures nothing is left incomplete.
metadata:
  author: pi-factory
  version: "1.0"
  type: follow-up
---

# Wrapup

Final verification before marking a task complete.

## Purpose

Ensure nothing is left incomplete. Run this after implementation to verify everything is production-ready.

## Checklist

### 1. Task Completeness

Before finishing, verify:

- [ ] **No stubbed implementations** — All functions do what they claim
- [ ] **No TODO comments** — Search for `TODO`, `FIXME`, `XXX`, `HACK`
- [ ] **No placeholder values** — No "lorem ipsum", fake data, or mock implementations
- [ ] **No commented-out code** — Either delete it or uncomment it
- [ ] **No unfinished error handling** — All error paths are handled properly

```bash
# Search for incomplete markers
rg -i "(TODO|FIXME|XXX|HACK|stub|placeholder|not.?implemented)" --type-add 'code:*.{ts,tsx,js,jsx,go,py,rs}' -t code
```

### 2. Full-Stack Implementation

**Every feature must be accessible end-to-end.** Never leave a feature implemented only in one layer.

Verify the complete chain:
- [ ] **Backend API** — Endpoint or handler exists and works
- [ ] **Type definitions** — Types are defined and shared where needed
- [ ] **Frontend integration** — UI calls the API correctly
- [ ] **User access** — User can actually trigger/use the feature

Ask yourself: "Can a user actually use this feature right now?"

If the answer is no, the task is not complete.

### 3. Test Coverage

All implementations must have tests:
- [ ] **Unit tests** — Functions and components tested in isolation
- [ ] **Integration tests** — API endpoints and service interactions tested
- [ ] **No skipped tests** — No `test.skip` or `it.skip`

```bash
# Run all tests
npm test
```

### 4. Code Quality

- [ ] **No debug statements** — Remove console.log, debugger, etc.
- [ ] **No unused imports** — Clean up dead imports
- [ ] **Error handling** — All error paths handled with useful messages

## Instructions

1. **Audit for incomplete code** — Run the search commands above
2. **Trace the feature** — Follow from UI to backend to verify complete implementation
3. **Run tests** — Ensure all tests pass
4. **Fix any gaps** — Complete anything that's missing
5. **Summarize** — Report what you found and what you fixed

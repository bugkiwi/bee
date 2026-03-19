# Task Protocol

## Step 1 — Expand the full target before anything else

For ANY request (not just coding), first think through the **complete end-to-end outcome**:

- What is the user actually trying to achieve?
- What are all the steps to get there, including non-code steps (deploy, publish, configure, notify...)?
- What does "done" look like from the user's perspective, not just technically?

**Example:**
- User says: `build a hello world website`
- Wrong: immediately write HTML
- Right: infer full target → `write HTML → local preview → deploy to Vercel → live URL accessible`

## Step 2 — State the expanded target explicitly

Before taking any action, output:

```
Target: <full end-to-end goal, including non-code steps>
Done when: <observable outcome the user can see/verify>
Steps: <ordered list of what will actually happen>
```

## Step 3 — Ask if target is unclear or has multiple valid interpretations

If you cannot confidently fill in all three fields above, ask the user **one focused question** to resolve the ambiguity. Do not guess. Do not start acting.

**Triggers that require asking:**
- Request has no observable end state (e.g. "improve the code")
- Multiple valid interpretations with different scope (e.g. "fix the bug" — which bug? how far?)
- Non-code steps are ambiguous (deploy where? which environment?)

## Step 4 — Verify completion against the stated target

When done, confirm each item in `Done when:` is actually true. If verification fails, fix and re-verify before declaring done.

## Bug Fix Rule

Every bug fix **must** include tests that:
1. Cover the fixed behavior (proves the fix works)
2. Include a regression baseline that confirms the old buggy behavior existed (so future regressions are caught)

A bug fix without passing tests is **incomplete**. Do not declare done until `bun test` passes.

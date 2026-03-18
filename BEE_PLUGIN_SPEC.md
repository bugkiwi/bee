# CCC_PLUGIN_SPEC.md

## Overview

This document defines the REQUIRED plugin architecture for CCC (Claude Code Controller)
when operating in API mode.

CCC is NOT a simple LLM wrapper.
It is an Agent Runtime System.

---

## Core Architecture

CCC consists of three layers:

### 1. Context Layer
Responsible for selecting and reducing input context.

### 2. Execution Layer
Responsible for planning and executing tasks.

### 3. Quality Layer
Responsible for validation, testing, and correctness.

---

## Layer 1: Context Layer

### 1. Context Selector (MANDATORY)

Purpose:
- Select only relevant files/functions for a task

Capabilities:
- Import graph analysis
- Call chain tracing
- Git diff awareness

Output:
- Minimal file set for prompt

---

### 2. Repo Index (RAG)

Purpose:
- Enable semantic code search

Capabilities:
- Embedding-based search
- Symbol lookup
- Function-level retrieval

---

## Layer 2: Execution Layer

### 3. Task Planner (MANDATORY)

Purpose:
- Convert natural language into structured steps

Example:

Input:
"Implement workflow publish"

Output:
{
  "steps": [
    "validate schema",
    "persist version",
    "lock version"
  ]
}

---

### 4. Diff Engine (MANDATORY)

Purpose:
- Generate code changes as diffs, NOT full files

Benefits:
- Reduce token usage
- Reduce risk
- Improve reviewability

---

### 5. State Manager (MANDATORY)

Purpose:
- Persist task execution state

Requirements:
- JSON or DB storage
- Resume capability
- Track step progress

State lifecycle:
pending → running → verifying → done

---

## Layer 3: Quality Layer

### 6. Test Generator (MANDATORY)

Purpose:
- Generate test cases before implementation

Types:
- Unit tests
- Integration tests
- Edge cases

---

### 7. Test Runner (MANDATORY)

Purpose:
- Execute tests automatically

Behavior:
- Fail → auto fix → retry
- Loop until pass

---

### 8. Critic Plugin (MANDATORY)

Purpose:
- Review generated code

Checks:
- Missing edge cases
- Incorrect assumptions
- Missing error handling

---

### 9. Verifier (MANDATORY)

Purpose:
- Final validation gate

Checks:
- Tests pass
- Lint pass
- Typecheck pass
- Runtime validation

---

## Optional Plugins (HIGH VALUE)

### 10. State Cache

- Cache intermediate reasoning/results
- Reduce token usage

---

### 11. Failure Injection

- Simulate failures:
  - API errors
  - timeouts
  - invalid inputs

---

### 12. Cost Tracker

- Track token usage per step
- Track cost and latency

---

### 13. Replay System

- Replay past executions
- Debug agent behavior

---

## Plugin Interface (TypeScript)

Each plugin must implement:

```ts
interface CCCPlugin {
  name: string

  init(ctx: Context): Promise<void>

  execute(input: any, ctx: Context): Promise<any>

  verify?(output: any): Promise<boolean>
}
```

---

## Execution Flow

1. Context Selector → prepare input
2. Task Planner → generate steps
3. State Manager → load state
4. Executor → run step
5. Diff Engine → apply changes
6. Test Generator → create tests
7. Test Runner → execute tests
8. Critic → review
9. Verifier → final check

---

## Final Rule

Without these plugins, CCC in API mode will degrade to a chat system.

With these plugins, CCC becomes a production-grade agent runtime.

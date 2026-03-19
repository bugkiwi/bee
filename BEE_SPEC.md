# BEE

## 0. Overview

CCC is a deterministic coding agent CLI that orchestrates providers like Claude Code and Codex via ACP.

It is NOT a chat tool.

It is a task-driven, stateful, verifiable execution system.

---

## 1. Core Principles

1. Deterministic execution (no early stop)
2. Task contract enforcement
3. Mandatory verification (tests + checks)
4. Persistent state (no memory loss)
5. Provider-agnostic (Claude / Codex / future)

---

## 2. System Architecture

Layers:
- CLI Layer
- Task System
- State Machine
- Agent Layer (ACP)
- Verifier Layer

---

## 3. Task Contract

All work MUST be defined as structured tasks.

### Task Schema

{
  "task_id": "string",
  "goal": "string",
  "steps": [
    { "id": 1, "desc": "string", "status": "pending" }
  ],
  "acceptance_criteria": ["string"],
  "tests_required": true,
  "status": "pending"
}

---

## 4. Execution Rules

- Execute ALL steps
- No early stop
- No confirmation
- Must verify before done

---

## 5. State Machine

pending → running → verifying → done  
failed → retrying

---

## 6. Agent Loop

1. Load state
2. Pick next task
3. Execute
4. Update state
5. Verify
6. Retry if needed

---

## 7. Provider Layer (ACP)

Supports:
- Claude Code
- Codex

Future:
- OpenAI Agents
- Ollama

---

## 8. Verification

Required:
- tests
- lint
- typecheck
- runtime validation

---

## 9. Failure Handling

Must handle:
- timeout
- API failure
- invalid output

---

## 10. Observability

- trace_id
- logs
- cost tracking

---

## 11. CLI Commands

bee init  
bee plan  
bee run  
bee resume  
bee verify  
bee replay  

---

## 12. File Structure

/bee  
  /tasks  
  /state  
  /specs  
  /logs  
  /providers  

---

## 13. Definition of Done

- all steps done
- tests pass
- no errors
- verified

---

## FINAL RULE

CCC is a deterministic execution system, not a chat assistant.

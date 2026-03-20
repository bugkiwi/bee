# TODOS

## AgentLoop god-object refactor

**What:** Split AgentLoop into three focused classes: `AgentLoop` (orchestration entry point),
`TaskRunner` (single-task execute+verify+retry), and `SkeletonRunner` (skeleton-level execution).

**Why:** After `runSkeleton()` + `runNode()` are added, `AgentLoop` will exceed ~400 lines with
4+ major methods. The current `runTask()` at 160 lines is already near the limit. A god-object
at this scale means every change to task execution risks breaking skeleton execution and vice versa.

**Pros:** Clean separation of concerns, easier to test each piece in isolation, unblocks
future parallelization.

**Cons:** Adds a refactor task after the feature ships.

**Context:** Current `AgentLoop.runTask()` is `src/agent/loop.ts:86-250`. The skeleton methods
will be added adjacent to it. Start the refactor when the skeleton feature is stable and all
skeleton tests pass.

**Depends on:** Hybrid Plan Tree feature complete and tests passing.

---

## Parallel skeleton node execution

**What:** Execute skeleton nodes with no `depends_on` edges concurrently instead of sequentially.

**Why:** A 5-node skeleton where nodes 1+2+3 are independent (no depends_on) currently takes
sum(node times). With parallel execution it would take max(node times). For large projects this
is a 3-5x wall-clock improvement.

**Pros:** Dramatically faster for any non-linear plan.

**Cons:** Two concurrently running nodes could edit the same file simultaneously. Requires conflict
detection (check if two nodes declare overlapping `working_dir` or file targets) and a merge
strategy.

**Context:** The `SkeletonNode.depends_on?: string[]` field is already in the schema design,
so the data model supports it. The execution loop just needs to be changed from sequential
`for...of` to a topological sort + `Promise.all` for independent batches.

**Depends on:** Sequential skeleton execution stable with tests passing. Conflict detection
strategy TBD.

---

## Skeleton generation quality evaluation

**What:** An eval suite of 5-10 representative goals with expected skeleton shapes (node count,
node titles, acceptance criteria format) to catch prompt regressions.

**Why:** The skeleton system prompt will be iterated on frequently to improve quality. Without
an eval, a prompt change that "feels better" might actually produce worse skeletons for certain
goal types. This is especially important because skeleton quality determines the quality of
everything downstream.

**Pros:** Prevents silent regressions during prompt iteration. Makes it safe to experiment.

**Cons:** Requires curating representative goals and defining "good" skeleton output, which
involves judgment calls. Maintaining expected outputs as prompts change adds overhead.

**Context:** The eval approach should match the existing test style (bun:test). LLM calls should
be mocked using fixture JSON responses. The eval goals should cover: small feature additions,
bug fixes, multi-file refactors, and full project features (OAuth, payments, etc.).

**Depends on:** Skeleton generation (`Planner.fromSkeletonSpec()`) implemented and wired up.

---

## `bee logs` command for skeleton run review

**What:** A `bee logs skeleton-{id}` command that pretty-prints the unified skeleton log: each
node, each leaf task result, handoff summaries, exit condition outcomes, and total cost.

**Why:** After a 40-minute skeleton run, the user needs to understand what happened. Currently
they'd have to `cat` a JSONL file. The log contains everything needed for post-mortem, but
requires a reader.

**Pros:** Dramatically improves post-run debuggability. Natural extension of the `bee logs`
namespace.

**Cons:** Adds a new command. Needs a JSONL parser that handles the unified skeleton log format.

**Context:** The unified skeleton log format (`.bee/logs/skeleton-{id}.jsonl`) will be
established as part of the skeleton feature. Each line: `{type, ts, nodeId?, leafId?, data}`.
The reader should group by node, show leaf task outcomes as sub-items, and display total
cost + duration at the bottom.

**Effort:** S (human: ~4 hours / CC: ~10 min) | **Priority:** P2

**Depends on:** Unified skeleton log (`.bee/logs/skeleton-{id}.jsonl`) implemented.

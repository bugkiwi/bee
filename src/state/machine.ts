import type { TaskStatus } from "../types/task.ts";
import {
  TRANSITIONS,
  TERMINAL_STATES,
  type TransitionEvent,
} from "./transitions.ts";

export class StateMachine {
  canTransition(current: TaskStatus, event: TransitionEvent): boolean {
    return event in (TRANSITIONS[current] ?? {});
  }

  transition(current: TaskStatus, event: TransitionEvent): TaskStatus {
    const next = TRANSITIONS[current]?.[event];
    if (next === undefined) {
      throw new Error(
        `Invalid transition: ${current} --[${event}]--> (no target state)`
      );
    }
    return next;
  }

  isTerminal(status: TaskStatus): boolean {
    return TERMINAL_STATES.includes(status);
  }

  getTerminalStates(): TaskStatus[] {
    return [...TERMINAL_STATES];
  }
}

export const stateMachine = new StateMachine();

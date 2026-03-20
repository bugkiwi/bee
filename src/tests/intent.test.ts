import { describe, expect, test } from "bun:test";
import { detectPlanningIntent } from "../utils/intent.ts";

describe("detectPlanningIntent", () => {
  test("detects imperative planning verbs", () => {
    expect(detectPlanningIntent("build a REST API with auth")).toBe(true);
    expect(detectPlanningIntent("implement OAuth login for the app")).toBe(true);
    expect(detectPlanningIntent("create a task queue with Redis")).toBe(true);
    expect(detectPlanningIntent("add dark mode to the settings page")).toBe(true);
    expect(detectPlanningIntent("refactor the database layer")).toBe(true);
    expect(detectPlanningIntent("migrate the app to TypeScript")).toBe(true);
  });

  test("detects 'I want/need to' patterns", () => {
    expect(detectPlanningIntent("I want to implement a payment system")).toBe(true);
    expect(detectPlanningIntent("I need to build a dashboard")).toBe(true);
    expect(detectPlanningIntent("I'd like to create a new feature")).toBe(true);
  });

  test("detects 'Let's' patterns", () => {
    expect(detectPlanningIntent("Let's build a search system")).toBe(true);
    expect(detectPlanningIntent("let's implement caching")).toBe(true);
  });

  test("rejects questions", () => {
    expect(detectPlanningIntent("how does the auth flow work?")).toBe(false);
    expect(detectPlanningIntent("what is the difference between JWT and sessions?")).toBe(false);
    expect(detectPlanningIntent("can you explain the codebase?")).toBe(false);
    expect(detectPlanningIntent("why is the test failing?")).toBe(false);
    expect(detectPlanningIntent("show me how to use the API")).toBe(false);
  });

  test("rejects conversational messages", () => {
    expect(detectPlanningIntent("thanks for the help")).toBe(false);
    expect(detectPlanningIntent("ok sounds good")).toBe(false);
    expect(detectPlanningIntent("yes")).toBe(false);
    expect(detectPlanningIntent("hi")).toBe(false);
  });

  test("rejects short messages", () => {
    expect(detectPlanningIntent("build it")).toBe(false);
    expect(detectPlanningIntent("fix bug")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { Team } from "../../dist/extensions/teams.js";

describe("T-X4: agent teams", () => {
  it("shares tasks, exchanges messages, emits events, enforces the member cap, and cleans up", () => {
    const team = new Team("demo", { maxMembers: 2 });
    expect(team.addMember("a")).toBe(true);
    expect(team.addMember("b")).toBe(true);
    expect(team.addMember("c")).toBe(false);

    const task = team.addTask("write the test");
    expect(team.claimTask(task.id, "a")).toBe(true);
    expect(team.tasks[0]?.status).toBe("claimed");
    expect(team.completeTask(task.id, "a")).toBe(true);
    expect(team.tasks[0]?.status).toBe("completed");

    expect(team.send("a", "b", "done")).toBe(true);
    expect(team.messages).toHaveLength(1);
    team.markIdle("b");

    const types = team.events.map((event) => event.type);
    expect(types).toContain("member_joined");
    expect(types).toContain("task_claimed");
    expect(types).toContain("task_completed");
    expect(types).toContain("message");
    expect(types).toContain("idle");

    team.dispose();
    expect(team.members).toEqual([]);
    expect(team.tasks).toEqual([]);
    expect(team.events).toEqual([]);
  });
});

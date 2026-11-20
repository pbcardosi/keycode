export interface TeamTask {
  id: string;
  description: string;
  status: "pending" | "claimed" | "completed";
  owner?: string | undefined;
  createdAt: string;
}

export type TeamEventType =
  | "member_joined"
  | "task_claimed"
  | "task_completed"
  | "message"
  | "idle";

export interface TeamEvent {
  type: TeamEventType;
  member?: string | undefined;
  taskId?: string | undefined;
  text?: string | undefined;
  timestamp: string;
}

export interface TeamMessage {
  from: string;
  to: string;
  text: string;
  timestamp: string;
}

export class Team {
  readonly name: string;
  readonly maxMembers: number;
  private readonly memberSet = new Set<string>();
  private readonly taskMap = new Map<string, TeamTask>();
  private readonly eventList: TeamEvent[] = [];
  private readonly messageList: TeamMessage[] = [];
  private counter = 0;

  constructor(name: string, options: { maxMembers?: number } = {}) {
    this.name = name;
    this.maxMembers = options.maxMembers ?? 8;
  }

  get members(): string[] {
    return [...this.memberSet];
  }

  get tasks(): TeamTask[] {
    return [...this.taskMap.values()];
  }

  get events(): TeamEvent[] {
    return [...this.eventList];
  }

  get messages(): TeamMessage[] {
    return [...this.messageList];
  }

  addMember(id: string): boolean {
    if (this.memberSet.has(id)) return true;
    if (this.memberSet.size >= this.maxMembers) return false;
    this.memberSet.add(id);
    this.eventList.push({ type: "member_joined", member: id, timestamp: new Date().toISOString() });
    return true;
  }

  addTask(description: string): TeamTask {
    this.counter += 1;
    const task: TeamTask = {
      id: `task-${this.counter}`,
      description,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.taskMap.set(task.id, task);
    return task;
  }

  claimTask(taskId: string, member: string): boolean {
    const task = this.taskMap.get(taskId);
    if (!task || task.status !== "pending" || !this.memberSet.has(member)) return false;
    task.status = "claimed";
    task.owner = member;
    this.eventList.push({ type: "task_claimed", member, taskId, timestamp: new Date().toISOString() });
    return true;
  }

  completeTask(taskId: string, member: string): boolean {
    const task = this.taskMap.get(taskId);
    if (!task || task.status !== "claimed" || task.owner !== member) return false;
    task.status = "completed";
    this.eventList.push({ type: "task_completed", member, taskId, timestamp: new Date().toISOString() });
    return true;
  }

  send(from: string, to: string, text: string): boolean {
    if (!this.memberSet.has(from) || !this.memberSet.has(to)) return false;
    this.messageList.push({ from, to, text, timestamp: new Date().toISOString() });
    this.eventList.push({ type: "message", member: from, text, timestamp: new Date().toISOString() });
    return true;
  }

  markIdle(member: string): void {
    this.eventList.push({ type: "idle", member, timestamp: new Date().toISOString() });
  }

  dispose(): void {
    this.memberSet.clear();
    this.taskMap.clear();
    this.eventList.length = 0;
    this.messageList.length = 0;
  }
}

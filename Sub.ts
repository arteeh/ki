import type { Block, End, Parked, Say } from "./AskAI.ts";
import * as config from "./Config.ts";
import { list as items, rec, text_of } from "./Json.ts";
import * as Names from "./Names.ts";
import { Pick } from "./Pick.ts";
import type { Run } from "./Run.ts";
import type { Talk } from "./View.ts";

// subagents (#116): one-off agents an agent spawns for a task, each with
// its own run, its log in its spawner's folder; done once it has reported,
// never woken again

export type Role = { model: string | null; effort: string | null };

export type Spawn = { task: string; role: Role; memory: boolean; mcp: boolean };

// doing: what it does now, since at (a tool's name, thinking, a usage limit)
// used: the tokens of its last request, when its log had used_at bytes of
// the bytes it has now; told: its spawner knows of the usage limit it waits
// for, until it goes on (#201)
export type Sub<M> = {
  name    : string;
  role    : Role;
  pick    : Pick | null;
  task    : string;
  view    : Block[];
  replies : string[];
  why     : string | null;
  run     : Run<Say, M>;
  doing   : string;
  at      : number;
  used    : number | null;
  used_at : number;
  bytes   : number;
  told    : boolean;
};

// how it runs or ran: its last pick, else what its spawn recorded
export type How = { model: string; effort: string; pick: Pick | null };

// a subagent's row in the chat list
// queue: the messages it hasn't taken yet; sent: its log's ones it took
// but hasn't answered; limit: the usage limit it waits for, for its page
export type Row = How & { name: string; face: string; task: string; meter: Talk | null; doing: string; at: number; queue: string[]; sent: number[]; limit: Parked | null };

const NOTE = "subagent";
const ON   = " on ";
const AT   = " at effort ";
const BARE = " without view";
const NO_MCP = " without MCP tools";
const ROLE = new RegExp("^" + NOTE + "(?:" + ON + "(\\S+))?(?:" + AT + "(\\S+))?(" + BARE + ")?(" + NO_MCP + ")?$");

const TASK_SHOWN = 120;

const QUEUED_SHOWN = 4000;

export namespace Sub {

  // the models a task may name: those offered now
  export function models(): string[] {
    return [...new Set(Pick.models(config.OFFER.vendors, config.OFFER.models).map(([, m]) => m.label))];
  }

  export function spawns(args: Record<string, unknown>): Spawn[] | string {
    if (Object.keys(args).some((k) => k !== "tasks")) {
      return "Give model and effort per task, in each of tasks: { task, model?, effort?, memory?, mcp? }. Nothing started.";
    }
    const models = Sub.models();
    const out: Spawn[] = [];
    for (const [k, t] of items(args.tasks).entries()) {
      const x: Record<string, unknown> = typeof t === "string" ? { task: t } : rec(t) ? t : {};
      const task = typeof x.task === "string" ? x.task.trim() : "";
      const model = x.model === undefined ? null : text_of(x.model, "null");
      const effort = x.effort === undefined ? null : text_of(x.effort, "null");
      const bad = task === "" ? "no task text" : model !== null && !models.includes(model) ? "no model " + model + "; one of " + models.join(", ") : null;
      if (bad !== null) {
        return Sub.refused(k, task, bad);
      }
      out.push({ task, role: { model, effort }, memory: x.memory !== false, mcp: x.mcp !== false });
    }
    return out.length === 0 ? "No tasks. Nothing started." : out;
  }

  export function refused(k: number, task: string, why: string): string {
    return "Task " + (k + 1) + (task === "" ? "" : " (" + JSON.stringify(task.length > 60 ? task.slice(0, 60) + "…" : task) + ")") + ": " + why + ". Nothing started.";
  }

  // each offered model's efforts, for spawn's description
  export function efforts(): string {
    const by = new Map<string, string[]>();
    for (const [, m] of Pick.models(config.OFFER.vendors, config.OFFER.models)) {
      const levels = m.efforts.length === 0 ? "none to set" : m.efforts.join(", ");
      by.set(levels, [...new Set([...by.get(levels) ?? [], m.label])]);
    }
    return [...by].map(([levels, labels]) => labels.join(", ") + ": " + levels).join("; ");
  }

  // why the spawner can't start a task at its effort
  export function no_effort(base: Pick, role: Role): string | null {
    const given = role.model === null ? base : Pick.to_model(base, role.model, config.OFFER.vendors, config.OFFER);
    const model = given === null ? undefined : Pick.model(given.vendor, given.model);
    return role.effort === null || model === undefined || Pick.offers(model, role.effort) ? null : Pick.no_effort(model, role.effort);
  }

  // its log's first line, which says how it runs
  export function note(role: Role, memory: boolean, mcp: boolean): string {
    return NOTE + (role.model === null ? "" : ON + role.model) + (role.effort === null ? "" : AT + role.effort) + (memory ? "" : BARE) + (mcp ? "" : NO_MCP);
  }

  export function role(note: string): { role: Role; memory: boolean; mcp: boolean } | null {
    const m = ROLE.exec(note);
    return m === null ? null : { role: { model: m[1] ?? null, effort: m[2] ?? null }, memory: m[3] === undefined, mcp: m[4] === undefined };
  }

  // the spawner's pick, with the task's model and effort; an effort its
  // model no longer has, its model's default
  export function pick(base: Pick, role: Role, name: string): Pick {
    const given = role.model === null ? base : Pick.to_model(base, role.model, config.OFFER.vendors, config.OFFER);
    if (given === null) {
      throw new Error(name + "'s model " + role.model + " is no longer offered; spawn another subagent.");
    }
    const model = Pick.model(given.vendor, given.model);
    return role.effort === null || model === undefined ? given : Pick.on({ ...given, effort: role.effort }, given.vendor, model);
  }

  // what its report gets from a call: its text, or why it failed, a prompt
  // too long as itself (#88, #89), a usage limit with its model (#201)
  export function ended<M>(sub: Sub<M>, end: End): void {
    const on = end.limits === undefined || sub.pick === null ? "" : " on " + sub.pick.model;
    sub.replies.push(end.ok ? end.text : sub.why ?? "failed" + on + ": " + (end.long === true ? end.why ?? end.text : end.text));
  }

  export function report<M>(sub: Sub<M>): string {
    return "[" + sub.name + "]\n" + (sub.replies.join("\n\n").trim() || "(no reply)");
  }

  export function how(role: Role, pick: Pick | null): How {
    return { model: pick?.model ?? role.model ?? "model not recorded", effort: pick?.effort ?? role.effort ?? "", pick };
  }

  export function row<M>(sub: Sub<M>, pick: Pick | null, meter: Talk | null, sent: number[]): Row {
    const task = sub.task.replace(/\s+/g, " ").trim();
    return {
      name   : sub.name,
      face   : Names.name_face(sub.name),
      task   : task.length > TASK_SHOWN ? task.slice(0, TASK_SHOWN) + "…" : task,
      ...Sub.how(sub.role, pick),
      meter,
      doing  : sub.doing,
      at     : sub.at,
      queue  : sub.run.queue.map(({ q }) => (q.text.length > QUEUED_SHOWN ? q.text.slice(0, QUEUED_SHOWN) + "…" : q.text)),
      sent,
      limit  : sub.run.limit,
    };
  }

}

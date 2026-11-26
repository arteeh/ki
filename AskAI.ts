import { Agent } from "./Agent.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import { stream_lines } from "./Clip.ts";
import { Limit } from "./Limit.ts";
import { Machine } from "./Machine.ts";
import { OpenAI } from "./OpenAI.ts";
import { Pick } from "./Pick.ts";
import * as Prompts from "./Prompts.ts";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { get, text_of } from "./Json.ts";
import type { At } from "./View.ts";

export type Kind = "user" | "work" | "mind" | "reply" | "tool" | "echo" | "note" | "team";

export type Vendor = "claude-api" | "openai-api" | "openai-sub" | "claude-sub";

export type Img = { type: string; data: string };

export type Say = { text: string; imgs: Img[] };

// a message with who sent it, as the prompts name them (prompts/prompt.md)
export type Said = Say & { from: string };

export type Block = { text: string; mark: boolean; back?: boolean; imgs?: Img[] };

// system: the part every agent shares, which ends a cache entry; own:
// the agent's own part after it; handoff: the turn's progress before this
// call, after its blocks (AskAI.handoff); taken: the messages steered into
// this call so far, for a new Claude Code to start with
export type Ask = Pick & {
  system    : string;
  own?      : string;
  blocks    : Block[];
  handoff?  : Block[];
  searches  : number;
  server    : string;
  patient?  : boolean;
  yields?   : string;
  probe?    : boolean;
  agent?    : boolean;
  fallback? : boolean;
  no_wait?  : boolean;
  // a subagent that has done nothing yet: a long usage limit ends its call
  // while the call does nothing, so its spawner can try another model (#201)
  fresh?    : boolean;
  talk?     : boolean;
  repick?   : () => Pick;
  used?     : (tokens: number) => void;
  steer?    : Steer;
  taken?    : Say[];
  limits?   : number;
  who?      : string;
  // ask for the model's reasoning text, to show it (Show thinking as the
  // run starts); else the model reasons all the same, its text left out
  minds?    : boolean;
};

type Prefix = { warm_until: number; writing: Promise<void> | null };

export type Flight = { begun: () => void; end: () => void };

// the messages that come in while a call works, which it puts in its next
// request: pending says one waits, take logs and hands them over
export type Steer = { pending: () => boolean; take: () => Promise<Said[]> };

// why: the reason the vendor or Claude Code gave, if any (#201)
export type Parked = { until: number; known: boolean; vendor: Vendor; why?: string };

export type Again = { why: string; until: number; limit: boolean };

// why a model refused the call for a while: its usage limit, its credit
// gone, or a rate limit
export type Cap = "usage" | "credit" | "rate";

export type Event =
  | { $: "Delta"; kind: Kind; text: string; fresh?: boolean; at?: At }
  | { $: "Entry"; kind: Kind; text: string; of?: string; queued?: boolean; imgs?: Img[]; full?: string }
  | { $: "Start"; of: string }
  | { $: "Limit"; limit: Parked | null }
  | { $: "Again"; again: Again | null }
  | { $: "Run"; run: Pick; from: Pick | null; why: string; cap: Cap | null };

type Progress = Extract<Event, { $: "Entry" }> | Say;

export type End = {
  ok     : boolean;
  text   : string;
  why?   : string;
  stop?  : "fail" | "lost" | "down";
  off?   : boolean;
  acted? : boolean;
  cap?   : Cap;
  until? : number;
  long?  : boolean;
  limits?: number;
  vendor?: Vendor;
};

export type Try = {
  wake : () => void;
  stop : () => void;
  done : Promise<End>;
};

export type Call = Try;

export const AGAIN = 60e3;


// the longest a patient call waits for a refusal to lift (a ChatGPT
// plan's limits last a week at most)
const WEEK = 7 * 86400e3;

// how long a vendor keeps a cache entry unused, in ms, as single flight
// counts it: claude-api's and claude-sub's marks are all an hour's
// (Anthropic.ts HOUR; Claude Code's own by ClaudeSub.ts ENV); OpenAI's
// default is 30 minutes, and openai-sub's backend tells none
const TTL: Record<Vendor, number> = {
  "claude-api" : 3600e3,
  "openai-api" : 1800e3,
  "openai-sub" : 1800e3,
  "claude-sub" : 3600e3,
};

const PREFIXES = new Map<string, Prefix>();

const UNLED: Flight = { begun: () => {}, end: () => {} };

const COOL = 60e3;

// a limit a model refused with: when it lifts, the vendor's reason, and how
// many in a row
type Reset = { until?: number; why?: string; limits: number };

type Down = { why: string; cap: Cap | null; reset?: Reset };

// until: when its cool-down ends
const DOWN = new Map<string, Down & { until: number }>();

export namespace AskAI {

  export function ask(ask: Ask, on: (ev: Event) => void): Call {
    const halt = new AbortController();
    const wake = () => call.wake();
    const stop = () => {
      halt.abort();
      call.stop();
    };
    const { promise, resolve } = Promise.withResolvers<End>();
    const out: Call = { wake, stop, done: promise };
    let picks = AskAI.falls(ask);
    let whys: (string | null)[] = picks.map(() => null);
    let caps = new Map<number, Cap>();
    const progress: Progress[] = [];
    const started = new Set<string>();
    const taken: Say[] = [];
    let handoff: Block[] = [];
    let seen_steers = 0;
    let acted = false;
    const remember_steers = () => {
      progress.push(...taken.slice(seen_steers));
      seen_steers = taken.length;
    };
    // what a turn (Run's) did so far goes into the next call's request; a
    // summary or a check starts over
    const turn = ask.steer !== undefined;
    const carry = () => {
      remember_steers();
      handoff = AskAI.handoff(progress, started);
      taken.splice(0);
      seen_steers = 0;
    };
    // the refusal of this round whose limit lifts first, a skipped model's too
    let held: (Reset & { pick: Pick; vendor: Vendor }) | undefined;
    const hold = (pick: Pick, reset: Reset) => {
      if (held === undefined || (reset.until ?? Infinity) < (held.until ?? Infinity)) {
        held = { ...reset, pick, vendor: pick.vendor };
      }
    };
    const skip = (from: number): number => {
      const to = AskAI.up(picks, from);
      for (let i = from; i < to; i++) {
        const down = DOWN.get(AskAI.down_key(picks[i]));
        whys[i] = (down?.why ?? "") + " (skipped for now)";
        if (down !== undefined && down.cap !== null) {
          caps.set(i, down.cap);
        }
        if (down?.reset !== undefined) {
          hold(picks[i], down.reset);
        }
      }
      return to;
    };
    let k = skip(0);
    let limits = ask.limits ?? 0;
    const go = (): Try => {
      const run = picks[k];
      const from = k > 0 ? picks[k - 1] : null;
      const why = from === null ? "" : whys[k - 1] ?? DOWN.get(AskAI.down_key(from))?.why ?? "";
      let heard = picks.length === 1;
      const hear = (ev: Event) => {
        remember_steers();
        if (ev.$ === "Start") {
          started.add(ev.of);
        } else if (turn && ev.$ === "Entry" && (ev.kind === "reply" || ev.kind === "tool" || ev.kind === "echo")) {
          progress.push(ev);
        }
        if (!heard && (ev.$ === "Delta" || (ev.$ === "Entry" && ev.kind !== "mind"))) {
          heard = true;
          on({ $: "Run", run: Pick.named(run), from: from && Pick.named(from), why, cap: caps.get(k - 1) ?? null });
        }
        on(ev);
      };
      const probe = picks.length > 1 && DOWN.has(AskAI.down_key(run));
      const fallback = k < picks.length - 1;
      return AskAI.start({ ...ask, ...run, handoff, taken, probe, fallback, limits, fresh: ask.fresh && !acted }, hear);
    };
    let call = go();
    const run = async (): Promise<End> => {
      let end = await call.done;
      for (;;) {
        const failed = !end.ok && end.stop !== "fail" && end.stop !== "lost" && !halt.signal.aborted;
        const off = failed && end.off === true;
        const unset = failed && end.stop === undefined;
        const up = !halt.signal.aborted && (end.ok || end.stop === "fail" || (end.stop === "down" && !off));
        const cap = off ? end.cap ?? null : null;
        const reset = failed && end.limits !== undefined ? { until: end.until, why: end.why, limits: end.limits } : undefined;
        if (picks.length > 1 && (off || up)) {
          AskAI.down(picks[k], off ? { why: end.text, cap, reset } : null);
        }
        whys[k] = failed ? end.text : null;
        acted ||= end.acted === true;
        if (cap !== null) {
          caps.set(k, cap);
        }
        const left = picks[k];
        if (reset !== undefined) {
          hold(left, reset);
        }
        const next = (off || unset) && (cap !== null || end.acted !== true) && k < picks.length - 1;
        const wait = failed && !next && ask.patient === true;
        if (next || wait) {
          carry();
        }
        if (wait) {
          const ms = Math.min(WEEK, Math.max(AGAIN, (held?.until ?? 0) - Date.now()));
          const by = held?.pick ?? left;
          const why = by.vendor + ":" + Pick.named(by).model + ": " + (held !== undefined ? "usage limit" : end.why ?? end.text);
          on({ $: "Again", again: { why, until: Date.now() + ms, limit: held !== undefined } });
          await AskAI.nap_till_woken(ask, picks, held?.vendor ?? null, ms, halt.signal);
          const now = ask.repick === undefined || halt.signal.aborted ? picks : AskAI.falls(ask.repick());
          if (!AskAI.same(now, picks)) {
            picks = now;
            whys = picks.map(() => null);
          }
          caps = new Map();
          if (!halt.signal.aborted) {
            on({ $: "Again", again: null });
          }
        }
        if (halt.signal.aborted || (!next && !wait)) {
          const all = whys.flatMap((why, i) => (why === null ? [] : [picks[i].vendor + ":" + Pick.named(picks[i]).model + ": " + why]));
          const limit = failed && held !== undefined ? { until: held.until, vendor: held.vendor, why: held.why, limits: held.limits } : {};
          return failed && all.length > 1 ? { ...end, ...limit, text: "no model answered; " + all.join("; ") } : { ...end, ...limit };
        }
        const was = held;
        if (wait) {
          held = undefined;
        }
        k = skip(next ? k + 1 : 0);
        limits = wait && was !== undefined && picks[k] === was.pick ? was.limits : 0;
        call = go();
        end = await call.done;
      }
    };
    run().then(resolve, (err: unknown) => resolve(AskAI.end(err_why(err))));
    return out;
  }

  // the turn's progress, one JSON line each, a line's images right after it
  export function handoff(progress: Progress[], started: Set<string>): Block[] {
    const results = new Set(progress.flatMap((event) => ("$" in event && event.kind === "echo" && event.of !== undefined ? [event.of] : [])));
    const lines = progress.flatMap((event): Say[] => {
      const imgs = event.imgs ?? [];
      const images = imgs.length > 0 ? { images: imgs.length } : {};
      if (!("$" in event)) {
        return [{ text: JSON.stringify({ kind: "steering message", text: event.text, ...images }), imgs }];
      }
      if (event.kind === "tool" && event.queued === true && (event.of === undefined || !started.has(event.of))) {
        return [];
      }
      const kind = event.kind === "tool" ? "tool call" : event.kind === "echo" ? "tool result" : "assistant reply";
      const no_result = event.kind === "tool" && event.of !== undefined && !results.has(event.of);
      return [{ text: JSON.stringify({ kind, id: event.of, text: event.full ?? event.text, ...(no_result ? { status: "no recorded result; may have run" } : {}), ...images }), imgs }];
    });
    if (lines.length === 0) {
      return [];
    }
    const blocks = [{ text: AskAI.labeled({ text: Prompts.prompt("handoff"), imgs: [], from: Prompts.sender("ki") }), mark: false, imgs: [] as Img[] }];
    for (const line of lines) {
      const top = blocks[blocks.length - 1];
      if (top.imgs.length > 0) {
        blocks.push({ text: line.text, mark: false, imgs: line.imgs });
      } else {
        top.text += "\n" + line.text;
        top.imgs = line.imgs;
      }
    }
    return blocks;
  }

  export function labeled(said: Said, working = false): string {
    return Prompts.prompt(working ? "message-working" : "message", { from: said.from }) + (working ? "\n" : "\n\n") + said.text;
  }

  export async function steered(ask: Ask): Promise<Say | null> {
    const says = (await ask.steer?.take()) ?? [];
    if (says.length === 0) {
      return null;
    }
    const say = { text: says.map((s) => AskAI.labeled(s, true) + "\n\n" + Prompts.prompt("steer")).join("\n\n"), imgs: says.flatMap((s) => s.imgs) };
    ask.taken?.push(say);
    return say;
  }

  // output of the model's: a message it answered is no longer queued
  export function answers(ev: Event): boolean {
    return ev.$ === "Delta" || (ev.$ === "Entry" && (ev.kind === "reply" || ev.kind === "tool"));
  }

  export function falls(pick: Pick): Pick[] {
    return Pick.falls(pick, pick.profile === undefined ? [] : config.OFFER.profiles?.[pick.profile] ?? []);
  }

  export function same(a: Pick[], b: Pick[]): boolean {
    return a.map(Pick.label).join() === b.map(Pick.label).join();
  }

  export async function nap_till_woken(ask: Ask, picks: Pick[], vendor: Vendor | null, ms: number, stopped: AbortSignal): Promise<void> {
    const repicked = AskAI.repicked(ask, picks);
    try {
      const woken = AbortSignal.any([stopped, repicked.signal]);
      await (vendor === null ? Machine.nap(ms, woken) : Limit.wait(vendor, ms, woken));
    } finally {
      repicked.done();
    }
  }

  export function repicked(ask: Ask, picks: Pick[]): { signal: AbortSignal; done: () => void } {
    const moved = new AbortController();
    const reread = () => {
      if (ask.repick !== undefined && !AskAI.same(AskAI.falls(ask.repick()), picks)) {
        moved.abort();
      }
    };
    config.RELOADED.add(reread);
    return { signal: moved.signal, done: () => config.RELOADED.delete(reread) };
  }

  export function start(ask: Ask, on: (ev: Event) => void): Try {
    try {
      return ask.vendor === "claude-sub" ? ClaudeSub.ask(ask, on) : Agent.ask(ask, on);
    } catch (err) {
      return { wake: () => {}, stop: () => {}, done: Promise.resolve(AskAI.end(err_why(err))) };
    }
  }

  export function end(text: string): End {
    return { ok: false, text };
  }

  export function up(picks: Pick[], k: number): number {
    while (k < picks.length - 1 && (DOWN.get(AskAI.down_key(picks[k]))?.until ?? 0) > Date.now()) {
      k += 1;
    }
    return k;
  }

  // a limit's reset ends its cool-down early, so a call woken at it asks
  // that model again
  export function down(run: Pick, off: Down | null): void {
    const key = AskAI.down_key(run);
    if ((off !== null) !== DOWN.has(key)) {
      console.error(Pick.label(Pick.named(run)) + (off !== null ? ": failed; calls go on with their fallbacks" : ": answers again"));
    }
    if (off !== null) {
      DOWN.set(key, { ...off, until: Math.min(Date.now() + COOL, off.reset?.until ?? Infinity) });
    } else {
      DOWN.delete(key);
    }
  }

  export function down_key(run: Pick): string {
    return run.vendor + ":" + run.model;
  }

  export function prefix_keys(ask: Ask): string[] {
    const last = ask.blocks.slice(0, -1).findLastIndex((b) => b.mark);
    // OpenAI caches per session (OpenAI.session)
    const head = [ask.vendor, ask.model, ask.effort, ask.speed, OpenAI.system(ask), ask.searches > 0, ask.vendor.startsWith("openai") ? OpenAI.sharer(ask) : null];
    let key = Bun.hash(JSON.stringify(head));
    return ask.blocks.slice(0, last + 1).map((b) => String((key = Bun.hash(b.text, key))));
  }

  export async function single_flight(ask: Ask): Promise<Flight> {
    const keys = AskAI.prefix_keys(ask);
    const ttl = TTL[ask.vendor];
    for (;;) {
      const now = Date.now();
      const k = keys.findLastIndex((key) => AskAI.warm_or_writing(key, now));
      const got = k < 0 ? null : PREFIXES.get(keys[k]) ?? null;
      if (got !== null && got.writing !== null) {
        await got.writing;
        continue;
      }
      if (got !== null) {
        AskAI.rewarm(keys[k], got, now + ttl);
      }
      return k === keys.length - 1 ? UNLED : AskAI.lead_flight(keys[keys.length - 1], ttl, now);
    }
  }

  export function warm_or_writing(key: string, now: number): boolean {
    const got = PREFIXES.get(key);
    return got !== undefined && (got.writing !== null || got.warm_until > now);
  }

  export function rewarm(key: string, prefix: Prefix, until: number): void {
    prefix.warm_until = until;
    PREFIXES.delete(key);
    PREFIXES.set(key, prefix);
  }

  export function drop_cold(now: number): void {
    for (const [k, c] of PREFIXES) {
      if (c.writing !== null || c.warm_until >= now) {
        break;
      }
      PREFIXES.delete(k);
    }
  }

  export function lead_flight(key: string, ttl: number, now: number): Flight {
    AskAI.drop_cold(now);
    let written = () => {};
    const own: Prefix = { warm_until: 0, writing: new Promise((ok) => (written = ok)) };
    PREFIXES.set(key, own);
    const begun = () => {
      if (own.writing !== null) {
        own.writing = null;
        own.warm_until = Date.now() + ttl;
        written();
      }
    };
    const end = () => {
      if (own.writing !== null) {
        PREFIXES.delete(key);
        own.writing = null;
        written();
      }
    };
    return { begun, end };
  }

  export async function* lines(stream: ReadableStream<Uint8Array>) {
    for await (const lines of stream_lines(stream)) {
      yield* lines.map((line) => line.trim()).filter((line) => line !== "");
    }
  }

  export function show(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }
    return (Array.isArray(content) ? content : []).map((part: unknown) => text_of(get(part, "text"), "[" + text_of(get(part, "type"), "undefined") + "]")).join("\n");
  }

}

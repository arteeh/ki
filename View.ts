import type { Again, Kind, Parked, Vendor } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as Md from "./Md.ts";
import { LABELS, type Fall, type Move, Pick } from "./Pick.ts";
import { GLYPH, WHO } from "./Theme.ts";
import type { Timer } from "./Timer.ts";
import type { Bg, Job } from "./Machine.ts";
import type { How, Row as SubRow } from "./Sub.ts";
import { rec } from "./Json.ts";

export type Part = [number, number];

// pages: a message split in memory comes whole, under its first page's id
// (#151); echo: a tool call's result, logged in the call's message (#188);
// mind: the reasoning that came before it (#204); cmd: its first word
// started a skill or set the goal as it was sent (#203)
type Entry = { kind: Kind; text: string; echo?: string; date?: string; images?: string[]; of?: string; tool?: string; from?: string; pages?: number; mind?: string; cmd?: boolean };

export type Queued = { kind: Kind; text: string };

// hop and from: another agent's message, the hop it is on and whose it is;
// origin: the chat its chain of messages started in
export type Pending = Queued & { images: string[]; act?: string; hop?: number; from?: string; origin?: string; lead?: number };

type Of = { tool: string; apart: boolean };

type Node = { text: string; to: string };

// of: a tool call's id, while it waits for its result; at: the vendor's
// output item it streams, by its id, done once that item ended (#205)
export type Live = { kind: Kind; text: string; of?: string; at?: At };

export type At = { item: string; done?: boolean };

// an agent as the chat list shows it: last, its last message's gist
export type Mate = { id: string; name: string; about: string; picture: string; unread: number; last: string; busy: boolean; archived: number; subs?: SubRow[] };

// a subagent's page: its log as loaded (from: how many of its first
// entries aren't yet), what it says now, whether it is done (#116)
type Logged = Entry & { id?: number };

// how: how it runs or ran, as the server said (#180)
type Page = { name: string; log: Logged[] | null; live: Live[]; from: number; loading: boolean; done: boolean; how: How | null };

export type Progress = { done: number; total: number; why: string | null; msgs: number; open: number[] };

const PACE = 1e-4;

export const OPENING = 1;

// Leader mode's lines per agent: the default, the most (#168)
export const LINES = 6;
export const LINES_MOST = 30;

export const SUMMARIES = "summaries";
export type Wait = string;

export type Sums = { done: number; total: number };

type Turning = {
  busy      : boolean;
  wait      : Wait;
  sums      : Sums | null;
  again     : Again | null;
  importing : Progress | null;
};

type ByRun = {
  limit     : Parked | null;
  queue     : Queued[];
  sent      : number[];
};

type Offered = {
  pick      : Pick | null;
  vendors   : Vendor[];
  models    : string[];
  profiles? : Record<string, Fall[]>;
};

type ChatSet = {
  timers    : Timer[];
  mcp       : Plug[];
  talk      : Talk | null;
  bg        : BgJob[];
};

type ServerSays = {
  agent?    : string;
  thinking? : boolean;
  build?    : string;
  skills?   : Slash[];
};

type State = Turning & ByRun & Offered & ChatSet & ServerSays;

export type Talk = { from: number; used: number; tokens: number; input: number; model: string; guess: boolean };

export type Plug = { name: string; on: boolean };

// what the composer's / list offers (#203): a skill on the devices open
// now, or one of Ki's commands; hint: its argument-hint
export type Slash = { name: string; about: string; hint?: string };

// Ki's own commands, for the / list and the composer's send alike: what
// one sends, or why it sends nothing
type Command = Slash & { act: (rest: string, say: Client) => Client[] | string };

const COMMANDS: Command[] = [
  { name: "goal", about: "Set a goal for the chat, checked after each turn until it is met, and send the message", act: (rest, say) => (rest === "" ? "/goal needs one: /goal <message>." : [{ $: "goal", text: rest }, say]) },
  { name: "halt", about: "Drop the chat's goal", act: () => [{ $: "goal", text: null }] },
];

// a shell call's command that outlasted its call and still runs on its
// device, as job id (#198)
export type BgJob = { device: string; id: string };

// its call's result says so (Machine.ts)
export const MOVED = "(moved to the background after ";
const MOVED_AS = new RegExp("\\" + MOVED + "\\d+ s as job (\\w+), pid ", "g");

// what the view holds of one agent's chat
const CHAT = ["busy", "wait", "importing", "limit", "queue", "sent", "sums", "again", "timers", "talk", "bg", "pick", "mcp", "parts", "turn", "nodes", "whole", "firsts", "open", "live", "minds"] as const;
type Chat = { [K in (typeof CHAT)[number]]: View[K] };

// agent: the agent whose chat is wanted; on: whose chat the server sends
// the link now, as its last state said ("" before its first); held: whose
// chat the view holds, "" for none yet, kept over a reconnect (#114); kept:
// the one it held before the last switch, shown again on a switch back
export type View = State & {
  agent : string;
  on    : string;
  held  : string;
  kept  : { agent: string; chat: Chat } | null;
  pages : Map<string, Page>;
  page  : Page | null;
  team  : Mate[];
  parts : Part[];
  turn  : number;
  nodes : Map<string, Node>;
  whole : Map<number, Entry>;
  firsts: Map<number, number>;
  open  : Map<string, boolean>;
  live  : Live[];
  minds : Map<number, string[]>;
  notes : string[];
  refused : { text: string; old: boolean } | null;
  tab   : string;
  out   : Post[];
  ws    : WebSocket | null;
  up    : boolean;
  down  : number;
  tries : number;
  woke  : number;
  retry : ReturnType<typeof setTimeout> | null;
  flush : () => void;
  wake  : () => void;
  reopen: () => void;
};

type Pack = { nodes?: Record<string, Node>; whole?: Record<string, Entry> };

export type Server =
  | ({ $: "know" } & Pack)
  | { $: "view"; parts: Part[]; turn: number }
  | { $: "zoom"; id: number; n: number; parts: Part[] }
  | ({ $: "entry"; agent?: string; id?: number; sent?: boolean } & Entry)
  | { $: "delta"; agent?: string; kind: Kind; text: string; fresh?: boolean; at?: At }
  | { $: "live"; agent?: string; live: Live[] }
  | { $: "agent"; name: string; found: boolean; from: number; before?: number; entries: Logged[]; done: boolean; end?: boolean; how?: How | null }
  | ({ $: "state"; replaced?: string } & State)
  | { $: "note"; text: string }
  | { $: "team"; agents: Mate[] }
  | { $: "error"; text: string; build?: string; wire?: number }
  | ({ $: "ack"; id: string } & Answer)
  | { $: "jobs"; ids: string[] }
  | { $: "job"; id: string; job: Job };

// picked: the skill the composer's first word last matched in the / list,
// though the list may have lost it since (#203)
export type Sent = { text: string; images?: Blob[]; picked?: string };

export type Answer = { error?: string; status?: number; text?: string; going?: boolean };
type Upload = BodyInit | AsyncIterable<string>;
type Body   = () => Upload | Promise<Upload>;

export type Client =
  | { $: "say"; sizes: number[]; body: Body; agent?: string; cmd?: string }
  | { $: "import"; body: Body; agent: string }
  | { $: "voice"; type: string; body: Body }
  | { $: "stop" }
  | { $: "goal"; text: string | null }
  | { $: "go"; on: boolean }
  | { $: "pick"; to: Pick }
  | { $: "mcp"; name: string; on: boolean }
  | { $: "talk"; on: boolean }
  | { $: "out"; job: string; out: object }
  | { $: "done"; agent: string; text: string }
  | { $: "running"; jobs: Bg[] }
  | { $: "unschedule"; id: string }
  | { $: "zoom"; part: Part }
  | { $: "agent"; name: string; before?: number }
  | { $: "open"; agent: string };

type Post = { msg: Client & { id: string }; ws: WebSocket | null; done: (a: Answer) => void; said: string };

export type Link = {
  open : (query: string) => WebSocket;
  post : (path: string, body: Upload) => Promise<Response>;
  hear : (msg: Server) => void;
  lost : (up: boolean) => void;
};

export type Act =
  | ({ $: "Send" } & Sent)
  | { $: "Move"; move: Move; to: string }
  | { $: "Open"; id: number; n: number }
  | { $: "Shut"; id: number; n: number }
  | { $: "Unschedule"; id: string }
  | { $: "Plug"; name: string }
  | { $: "Talk"; on: boolean }
  | { $: "Goto"; name: string | null }

export type Row =
  | { $: "Sum"; id: number; n: number; msgs: number; text: string }
  | { $: "Box"; id: number; n: number; msgs: number; text: string; rows: Row[] }
  | { $: "Msg"; id: number | null; kind: Kind; who: string; text: string; body: Md.Block[]; call: Call.Call | null; images: string[]; queued?: boolean; from?: string; of?: string; writing?: true; cmd?: string }
  | { $: "Line"; id: number | null; call: Call.Call; echo: string | null; rows: Row[]; phase?: Phase }
  | { $: "Group"; id: number | null; lines: Line[]; phase?: Phase }
  | { $: "Cap"; text: string; think?: true; earlier?: true; wait?: true; notice?: true }

// a tool call while it's written, then while it runs (#129)
type Phase = "typing" | "running";

type Line = Extract<Row, { $: "Line" }>;

export type Knob = { text: string; move: Move; hint: string; choices: Choice[] };

export type Choice = { text: string; to: string; move: Move; here: boolean; vendor: string | null };

export const TURN = "the main turn";

export const WIRE = 7;

export const PING  = 10000;
export const RETRY = 1000;
export const SLOW  = 30000;
export const TICK  = "+";
export const QUIT  = 4000;

export const ACTIVE   = "active";
export const IDLE     = "idle";
export const USE_PING = 20000;

export const FRAME = 2 ** 22;

export const HINT = "Message Ki";

// a browser's sign-in, on the app's page and the server's own
export const SIGN_IN = "This Ki server is private. On the computer it runs on, run <code>ki serve login</code> and type the code it prints here.";
// to: the path of this server the browser goes to once signed in
export function sign_in_form(to: string): string {
  const value = to.replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
  return `<form class="code" method="post" action="/auth"><input type="hidden" name="to" value="${value}"><input name="code" inputmode="numeric" autocomplete="one-time-code" autofocus aria-label="Sign-in code"><button type="submit">Sign in</button></form>`;
}

const WAIT = "compressing…";
const SUMS = "compressing earlier messages…";

const UNSENT = "Sends once connected.";
const OLDER  = "This ki is older than the server: run `ki update`.";
const NEWER  = "The server runs an older ki than this one: run `ki update` there. Trying again every " + SLOW / 1000 + " s.";

const MARKS: Array<[string, number, string]> = [
  ["image/png", 0, "\x89PNG"],
  ["image/jpeg", 0, "\xFF\xD8\xFF"],
  ["image/gif", 0, "GIF8"],
  ["image/webp", 8, "WEBP"],
];
export const HEAD   = 12;
export const IMAGES = "Images are png, jpeg, gif or webp.";

export const MEDIA = Md.MEDIA;
const MEDIA_AS = Md.MEDIA_AS;

export const STORED = /^[0-9a-f]{16}\.([a-z0-9]{1,10})$/;

export function media_kind(url: string): string | null {
  const m = /^\/(?:media|image)\/(?:[a-z0-9]{1,16}\/)?[0-9a-f]{16}\.([a-z0-9]{1,10})$/.exec(url);
  return m === null ? null : ext_kind(m[1]);
}

export function ext_kind(ext: string): string | null {
  const type = MEDIA.get(ext);
  return type === undefined ? null : type === "text/html" ? "html" : type.split("/")[0];
}

export function store_file(url: string): boolean {
  return /^\/media\/(?:[a-z0-9]{1,16}\/)?[^/]+$/.test(url) && STORED.test(url.slice(url.lastIndexOf("/") + 1)) && media_kind(url) === null;
}

export function media_ext(file: string): string {
  const dot = file.lastIndexOf(".");
  const ext = dot < 0 ? "" : file.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return MEDIA_AS.get(ext) ?? ext;
}

export function size_show(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  const k = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024))));
  const n = bytes / 1024 ** k;
  return (k === 0 ? String(bytes) : n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " " + units[k];
}

export const FIT    = 1568;
export const IMAGE  = 2 ** 20;
export const PIXELS = 2 ** 28;


function Cap(text: string): Row {
  return { $: "Cap", text };
}

export const TOKEN = 3;

export function talk_percent(talk: Talk): number {
  return Math.ceil(talk.used * 100);
}

export function talk_tokens(talk: Talk): string {
  const k = (n: number) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));
  return "about " + k(talk.tokens) + " of " + talk.model + "'s " + k(talk.input) + " input tokens" + (talk.guess ? ", guessed: no request yet" : ", in its last request and the messages since");
}

export function view_new(agent: string): View {
  return {
    agent     : agent,
    on        : "",
    team      : [],
    busy      : false,
    wait      : "",
    pick      : null,
    vendors   : [],
    models    : LABELS,
    importing : null,
    limit     : null,
    queue     : [],
    sent      : [],
    sums      : null,
    again     : null,
    timers    : [],
    mcp       : [],
    talk      : null,
    bg        : [],
    held      : "",
    kept      : null,
    pages     : new Map(),
    page      : null,
    parts     : [],
    turn      : Infinity,
    nodes     : new Map(),
    whole     : new Map(),
    firsts    : new Map(),
    open      : new Map(),
    live      : [],
    minds     : new Map(),
    notes     : [],
    refused   : null,
    tab       : uuid(),
    out       : [],
    ws        : null,
    up        : false,
    down      : Date.now(),
    tries     : 0,
    woke      : 0,
    retry     : null,
    flush     : () => {},
    wake      : () => {},
    reopen    : () => {},
  };
}

// to another agent's chat: what the view holds of the one before goes at
// once (#178), kept for a switch back, and the server is asked for it: by
// a link that's up; a link on its way up opens again for it, and one down
// opens for it when it next tries
export function view_switch(v: View, agent: string): Client[] {
  if (v.agent === agent) {
    return [];
  }
  view_to(v, agent);
  if (v.up) {
    return [{ $: "open", agent }];
  }
  v.reopen();
  return [];
}

function view_to(v: View, agent: string): void {
  const back = v.kept?.agent === agent ? v.kept.chat : null;
  if (v.held !== "") {
    v.kept = { agent: v.held, chat: Object.fromEntries(CHAT.map((k) => [k, v[k]])) as Chat };
  }
  view_chat(v);
  Object.assign(v, back ?? {});
  [v.agent, v.held] = [agent, back === null ? "" : agent];
  v.pages.clear();
  v.page = null;
  // the open of a chat no longer wanted would take the link back to it
  v.out = v.out.filter((p) => p.msg.$ !== "open");
}

function view_chat(v: View): void {
  const fresh = view_new(v.agent);
  for (const k of CHAT) {
    Object.assign(v, { [k]: fresh[k] });
  }
}

const OWN = ["team", "ack", "error", "note", "jobs", "job"];

// a state says whose chat the server sends the link from now on (#178):
// what comes after it is the wanted chat's only when it is the wanted
// agent's. A link opens for the wanted chat: its first state is another's
// only when the server had no such agent (one deleted) and gave its own pick
export function view_hear(v: View, msg: Server): Client[] {
  if (msg.$ !== "state" || msg.agent === undefined) {
    return view_heard(v, msg);
  }
  const was = v.on;
  v.on = msg.agent;
  if (msg.agent !== v.agent && (was === "" || msg.replaced === v.agent)) {
    view_to(v, msg.agent);
  }
  if (msg.agent !== v.agent) {
    return [];
  }
  if (msg.agent !== v.held) {
    view_chat(v);
    v.held = msg.agent;
  }
  // a new link: the subagents' pages seen before may have missed what
  // came while it was down, so they're asked for again; the open one now,
  // shown as it was till its answer replaces it, as a chat is (#185)
  const fresh = msg.agent !== was;
  if (fresh) {
    v.pages.clear();
  }
  const again: Client[] = fresh && v.page !== null ? [{ $: "agent", name: v.page.name }] : [];
  if (fresh && v.page !== null) {
    v.page.loading = false;
    v.pages.set(v.page.name, v.page);
  }
  return [...again, ...view_heard(v, msg)];
}

function view_heard(v: View, msg: Server): Client[] {
  if (!OWN.includes(msg.$) && v.on !== v.agent) {
    return [];
  }
  switch (msg.$) {
    case "team": {
      v.team = msg.agents;
      return [];
    }
    case "know": {
      view_learn(v, msg);
      return [];
    }
    case "view": {
      v.parts = msg.parts;
      v.turn  = msg.turn;
      return [];
    }
    case "agent": {
      const page = v.pages.get(msg.name);
      if (page === undefined) {
        return [];
      }
      page.done = msg.done;
      page.how = msg.how ?? page.how;
      if (msg.end === true) {
        page.live = [];
        return [];
      }
      if (msg.found && (msg.before === undefined || msg.before === page.from)) {
        page.log = [...msg.entries, ...(msg.before === undefined ? [] : page.log ?? [])];
        [page.from, page.loading] = [msg.from, false];
        return [];
      }
      if (!msg.found) {
        v.pages.delete(msg.name);
        v.page = v.page === page ? null : v.page;
        v.notes.push("No subagent " + msg.name + ".");
      }
      return [];
    }
    case "zoom":
    case "jobs":
    case "job": {
      return [];
    }
    case "entry": {
      if (msg.agent !== undefined) {
        const { $, agent, id, sent, ...entry } = msg;
        const log = v.pages.get(agent)?.log;
        // the reasoning that came live before it is its own or no one's
        // (#204)
        while (id !== undefined && log?.at(-1)?.kind === "mind" && log.at(-1)?.id === undefined) {
          log.pop();
        }
        log?.push(id === undefined ? entry : { ...entry, id });
        return [];
      }
      view_entry(v, msg);
      return [];
    }
    case "delta": {
      const live = msg.agent === undefined ? v.live : v.pages.get(msg.agent)?.live;
      if (live !== undefined) {
        live_push(live, msg.kind, msg.text, msg.fresh, msg.at);
      }
      return [];
    }
    case "live": {
      const live = msg.agent === undefined ? v.live : v.pages.get(msg.agent)?.live;
      if (live !== undefined) {
        live_set(live, msg.live);
      }
      return [];
    }
    case "state": {
      const { $, agent, replaced, ...state } = msg;
      Object.assign(v, state);
      // what came live that no message kept, once the turn is done (#204)
      if (!v.busy) {
        v.minds.clear();
      }
      return [];
    }
    case "note":
    case "error": {
      v.notes.push(msg.text);
      return [];
    }
    case "ack": {
      const post = v.out.find((p) => p.msg.id === msg.id);
      v.out = v.out.filter((p) => p !== post);
      post?.done(msg);
      // the server had no agent it was asked for (one deleted) and gave its
      // own pick, whose chat came while it wasn't wanted
      if (post?.msg.$ === "open" && post.msg.agent === v.agent && v.on !== v.agent) {
        view_to(v, v.on);
        return [{ $: "open", agent: v.agent }];
      }
      return [];
    }
    default: {
      return [];
    }
  }
}

// a copy of the chat the view holds, as the messages a link sends for it,
// its parts from the one at from on, the entry before them, and what
// streams in (#185)
export function view_copy(v: View, from: number): Server[] {
  const parts = v.parts.filter(([id, n]) => id + n > from);
  const nodes: Record<string, Node> = {};
  const whole: Record<string, Entry> = {};
  const before = parts.length === 0 ? undefined : parts[0][0] - 1;
  for (const at of [...(before === undefined ? [] : [v.firsts.get(before) ?? before]), ...parts.flatMap(([id, n]) => (n === 1 ? [v.firsts.get(id) ?? id] : []))]) {
    const entry = v.whole.get(at);
    if (entry !== undefined) {
      whole[at] = v.thinking === false ? unminded(entry) : entry;
    }
  }
  for (const [id, n] of parts) {
    const node = v.nodes.get(id + "+" + n);
    if (node !== undefined) {
      nodes[id + "+" + n] = node;
    }
  }
  const { busy, wait, sums, again, importing, limit, queue, sent, pick, vendors, models, profiles, timers, mcp, talk, bg, thinking, skills } = v;
  const state = { busy, wait, sums, again, importing, limit, queue, sent, pick, vendors, models, profiles, timers, mcp, talk, bg, thinking, skills };
  return [{ $: "state", agent: v.agent, ...state }, { $: "know", nodes, whole }, { $: "view", parts, turn: v.turn }, { $: "live", live: copy_live(v.live, thinking !== false) }];
}

// a copy of the open subagent page, as the messages a link sends for it,
// its entries from the one with id from on (#185)
export function view_page_copy(page: Page, from: number, minds: boolean): Server[] {
  const log = page.log ?? [];
  const k = Math.max(0, log.findIndex((e) => (e.id ?? Infinity) >= from));
  const entries = minds ? log.slice(k) : log.slice(k).filter((e) => e.kind !== "mind").map(unminded);
  return [{ $: "agent", name: page.name, found: true, from: page.from + k, entries, done: page.done, how: page.how }, { $: "live", agent: page.name, live: copy_live(page.live, minds) }];
}

function copy_live(live: Live[], minds: boolean): Live[] {
  return minds ? live : live.map((piece) => piece.kind === "mind" ? { ...piece, text: "" } : piece);
}

// an entry without the reasoning a copy needn't hold while it is hidden
function unminded(entry: Entry): Entry {
  const { mind, ...rest } = entry;
  return mind === undefined ? entry : rest;
}

// a copy of the open subagent page, while the view holds none of it: the
// link's answer replaces it in place
export function view_page_adopt(v: View, copy: Server[]): void {
  const page = v.page;
  if (page === null || page.log !== null) {
    return;
  }
  const made = view_new(v.agent);
  made.on = v.agent;
  made.pages.set(page.name, { ...page });
  copy.forEach((msg) => view_heard(made, msg));
  Object.assign(page, made.pages.get(page.name));
}

// a copy of the wanted chat, or a page's first messages, while the view
// holds none of it: held as a link's chat is over a reconnect (#114), so
// the link's own replaces it in place (#185)
export function view_adopt(v: View, copy: Server[]): void {
  const made = view_new(v.agent);
  copy.forEach((msg) => view_hear(made, msg));
  v.team = v.team.length === 0 ? made.team : v.team;
  if (v.held !== "" || made.held !== v.agent) {
    return;
  }
  for (const k of [...CHAT, "vendors", "models", "profiles", "thinking", "skills"] as const) {
    Object.assign(v, { [k]: made[k] });
  }
  v.held = v.agent;
}

export function view_act(v: View, act: Act): Client[] {
  switch (act.$) {
    case "Send": {
      const text   = act.text.trim();
      const images = act.images ?? [];
      if (text === "" && images.length === 0) {
        return view_stoppable(v) ? [{ $: "stop" }] : [];
      }
      // only a / the message starts with, as typed: any other /word is
      // text; a skill the list has or had picked, the server's to start, or
      // to say it found none (#203)
      const word = act.text.startsWith("/") ? /^\/(\S+)(?:\s|$)/.exec(text) : null;
      const command = COMMANDS.find((c) => c.name === word?.[1]);
      const skill = command === undefined && word !== null && (word[1] === act.picked || v.skills?.some((s) => s.name === word[1]) === true) ? word[1] : undefined;
      const cmd = command?.name ?? skill;
      const blob = new Blob([...images, text]);
      const say: Client = { $: "say", sizes: images.map((b) => b.size), body: () => blob, ...(cmd === undefined ? {} : { cmd }) };
      const sent = command === undefined || word === null ? [say] : command.act(text.slice(word[0].length).trim(), say);
      if (typeof sent === "string") {
        v.notes.push(sent);
        return [];
      }
      return sent;
    }
    case "Move": {
      const from = v.out.flatMap((p) => (p.msg.$ === "pick" ? [p.msg.to] : [])).at(-1) ?? v.pick;
      if (from === null) {
        return [];
      }
      const to = Pick.move(from, act.move, v, act.to);
      if (act.move === "speed" && Pick.options(from, "speed", v).length === 1) {
        v.notes.push(from.model + " has no fast.");
        return [];
      }
      if (act.move === "effort" && Pick.options(from, "effort", v).length === 0) {
        v.notes.push(from.model + " has no effort to set.");
        return [];
      }
      if (to === null) {
        const parts = Pick.options(from, act.move, v).map(([part]) => part);
        v.notes.push("No " + act.move + " " + act.to + (act.move === "effort" ? " on " + from.model : "") + "; one of: " + [...new Set(parts)].join(", ") + ".");
        return [];
      }
      return [{ $: "pick", to }];
    }
    case "Open": {
      v.open.set(act.id + "+" + act.n, true);
      return act.n === 1 ? [] : [{ $: "zoom", part: [act.id, act.n] }];
    }
    case "Shut": {
      v.open.set(act.id + "+" + act.n, false);
      return [];
    }
    case "Unschedule": {
      return [{ $: "unschedule", id: act.id }];
    }
    case "Talk": {
      return [{ $: "talk", on: act.on }];
    }
    case "Goto": {
      if (act.name === null) {
        v.page = null;
        return [];
      }
      const known = v.pages.get(act.name);
      v.page = known ?? { name: act.name, log: null, live: [], from: 0, loading: false, done: false, how: null };
      v.pages.set(act.name, v.page);
      return known === undefined ? [{ $: "agent", name: act.name }] : [];
    }
    case "Plug": {
      const asked = v.out.flatMap((p) => (p.msg.$ === "mcp" && p.msg.name === act.name ? [p.msg.on] : [])).at(-1);
      const on = asked ?? v.mcp.find((p) => p.name === act.name)?.on;
      if (on === undefined) {
        const names = v.mcp.map((p) => p.name).join(", ");
        v.notes.push("No MCP server " + act.name + (names === "" ? "; none is set up." : "; one of: " + names + "."));
        return [];
      }
      return [{ $: "mcp", name: act.name, on: !on }];
    }
  }
}

// the calls the rows end on, while the tail goes on with calls: they show
// in the tail, one run with those (#210)
let CARRIED: Line[] = [];

export function view_body(v: View): Row[] {
  const rows = body_rows(v);
  let k = rows.length;
  while (k > 0 && is_call(rows[k - 1])) {
    k--;
  }
  CARRIED = view_joins(v) ? rows.slice(k) as Line[] : [];
  return grouped(rows.slice(0, rows.length - CARRIED.length));
}

function body_rows(v: View): Row[] {
  if (v.page !== null) {
    const sub = view_sub(v);
    const rows = page_rows(v.page, v.thinking !== false, sub);
    return backgrounded(sub === undefined ? rows : running(rows, 0), v.bg);
  }
  const rows = view_lines(view_rows(v, v.parts).flat());
  return backgrounded(v.busy ? running(rows, v.turn) : rows, v.bg);
}

// whether what streams in starts with a call: the calls the rows end on go
// on in it, the rows drawn again when that changes
export function view_joins(v: View): boolean {
  const first = tail_live(v)[0];
  return first !== undefined && is_call(first);
}

// two and more tool calls in a row are one line that opens on them, as
// they show (#210): anything else between them, a fold's edge among them,
// ends the run; each made once while its calls stay the same
const GROUPS = new WeakMap<Row, Row>();

function grouped(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (let k = 0; k < rows.length; ) {
    const r = rows[k];
    let j = k;
    while (j < rows.length && is_call(rows[j])) {
      j++;
    }
    if (j - k < 2) {
      out.push(r.$ === "Box" ? { ...r, rows: grouped(r.rows) } : r);
      k++;
      continue;
    }
    const lines = rows.slice(k, j) as Line[];
    const had = GROUPS.get(lines[0]);
    const same = had?.$ === "Group" && had.lines.length === lines.length && had.lines.every((l, i) => l === lines[i]);
    const phase = lines.some((l) => l.phase === "typing") ? "typing" : lines.some((l) => l.phase === "running") ? "running" : undefined;
    const group: Row = same ? had : { $: "Group", id: lines[0].id, lines, ...(phase === undefined ? {} : { phase }) };
    GROUPS.set(lines[0], group);
    out.push(group);
    k = j;
  }
  return out;
}

// a call, one being written too; not a result whose call is in a fold
function is_call(r: Row): r is Line {
  return r.$ === "Line" && r.rows[0]?.$ === "Msg" && r.rows[0].kind === "tool";
}

// its tool, as its group counts it: one being written by the name it has
export function line_tool(l: Line): string {
  return l.call.name !== "" ? l.call.name : Call.tool_name(/^\S*/.exec(l.call.head)?.[0] ?? "");
}

// a subagent's page shown near its top: its earlier entries (#143)
export function view_earlier(v: View): Client[] {
  const page = v.page;
  if (page === null || page.log === null || page.from === 0 || page.loading) {
    return [];
  }
  page.loading = true;
  return [{ $: "agent", name: page.name, before: page.from }];
}

// the shown subagent page's row in the chat list, while it runs
export function view_sub(v: View): SubRow | undefined {
  return v.team.find((m) => m.id === v.agent)?.subs?.find((s) => s.name === v.page?.name);
}

// a subagent's page: its log, earlier entries as it scrolls up (#143),
// the messages it took but hasn't answered marked (#144)
function page_rows(page: Page, minds: boolean, sub: SubRow | undefined): Row[] {
  const log = (page.log ?? []).filter((e) => minds || e.kind !== "mind");
  const earlier: Row[] = page.from > 0 ? [{ $: "Cap", text: page.loading ? "Loading…" : "", earlier: true }] : [];
  const rows = log.flatMap((e, k) => (e.id === 0 && e.kind === "note" ? [] : [...(minds ? mind_rows(e) : []), ...sent_rows(e.id !== undefined && sub?.sent.includes(e.id) === true, whole_rows(e.id ?? null, e, log[k - 1]))]));
  return [...earlier, ...view_lines(rows), ...(page.done && page.log !== null ? [Cap("Done: its report is in the chat that spawned it.")] : [])];
}

// each tool call and its result are one line that opens in place (#121);
// a result whose call is in a fold is one line of its own
function view_lines(rows: Row[]): Row[] {
  const paired = new Set<string>();
  const out: Row[] = [];
  for (const [k, r] of rows.entries()) {
    if (r.$ === "Box") {
      out.push({ ...r, rows: view_lines(r.rows) });
    } else if (r.$ === "Msg" && r.kind === "tool" && r.call !== null) {
      const echo = r.of === undefined ? undefined : rows.slice(k + 1).find((x) => x.$ === "Msg" && x.kind === "echo" && x.of === r.of);
      if (echo !== undefined && r.of !== undefined) {
        paired.add(r.of);
      }
      out.push({ $: "Line", id: r.id, call: r.call, echo: echo?.$ === "Msg" ? echo.text : null, rows: echo === undefined ? [r] : [r, echo] });
    } else if (r.$ === "Msg" && r.kind === "echo" && r.of !== undefined && paired.has(r.of)) {
      continue;
    } else if (r.$ === "Msg" && r.kind === "echo") {
      out.push({ $: "Line", id: r.id, call: { name: "", head: r.who === "" ? "result" : r.who, device: "", blocks: [] }, echo: r.text, rows: [r] });
    } else {
      out.push(r);
    }
  }
  return out;
}

function view_rows(v: View, parts: Part[]): Row[][] {
  const drawn = new Set<number>();
  return parts.map(([id, n]) => part_rows(v, id, n, drawn));
}

// a busy agent looks busy (#129): waiting for its model, writing, thinking,
// writing a tool call, waiting for its result
const WAITING: Row = { $: "Cap", text: "", wait: true };
const THINKING: Row = { $: "Cap", text: "Thinking", think: true };

// thinking starts with no text yet (#154): "Thinking" until its text comes,
// nothing once the model goes on without any
function thinks(live: Live[], k: number): boolean {
  return live[k].kind === "mind" && (live[k].text !== "" || k === live.length - 1);
}

// what streams in now: the text being written, a tool call being written
// or waiting to run
function live_rows(live: Live[], writing: boolean): Row[] {
  return live.flatMap((l, k) => l.kind === "mind" && l.text === "" ? (thinks(live, k) ? [THINKING] : []) : view_lines(entry_rows(null, l.kind, l.text, [], undefined, undefined, l.of)).map((r): Row => {
    if (r.$ === "Line") {
      return l.of === undefined && l.at?.done === true ? r : { ...r, phase: l.of === undefined ? "typing" : "running" };
    }
    return r.$ === "Msg" && l.kind === "reply" && writing && k === live.length - 1 ? { ...r, writing: true } : r;
  }));
}

// a tool call of the turn going on with no result yet runs
function running(rows: Row[], from: number): Row[] {
  return rows.map((r) => (r.$ === "Line" && r.echo === null && r.id !== null && r.id >= from ? { ...r, phase: "running" } : r));
}

// a shell call whose command still runs in the background runs too, the
// agent busy or not (#198)
function backgrounded(rows: Row[], bg: BgJob[]): Row[] {
  if (bg.length === 0) {
    return rows;
  }
  return rows.map((r) => {
    if (r.$ === "Box") {
      return { ...r, rows: backgrounded(r.rows, bg) };
    }
    const id = r.$ === "Line" && r.call.name === "shell" && r.echo !== null ? [...r.echo.matchAll(MOVED_AS)].at(-1)?.[1] : undefined;
    return r.$ === "Line" && id !== undefined && bg.some((j) => j.device === r.call.device && j.id === id) ? { ...r, phase: "running" } : r;
  });
}

// hidden thinking that just ended (#163) stays "Thinking" until what the
// model goes on with comes
function thought_last(v: View): boolean {
  const last = v.parts.at(-1);
  return last !== undefined && v.minds.has(last[0] + last[1] - 1);
}

// what streams in, as rows not yet grouped
function tail_live(v: View): Row[] {
  if (v.page !== null) {
    return live_rows(v.page.live.filter((l) => v.thinking !== false || l.kind !== "mind"), view_sub(v) !== undefined);
  }
  return live_rows(v.live.filter((l) => v.thinking !== false || l.kind !== "mind"), v.busy && v.wait === "");
}

// the rows of the messages that wait in the tail, queued or unsent, made
// once while they wait, so each is parsed and drawn once, not at each paint
let WAITS = new Map<string, Row[]>();

export function view_tail(v: View): Row[] {
  const was = WAITS;
  WAITS = new Map();
  const waits = (kind: Kind, text: string, sent: boolean) => {
    const key = kind + "\n" + String(sent) + "\n" + text;
    const rows = WAITS.get(key) ?? was.get(key) ?? sent_rows(sent, entry_rows(null, kind, text));
    WAITS.set(key, rows);
    return rows;
  };
  const carried = view_joins(v) ? CARRIED : [];
  const streamed = grouped([...carried, ...tail_live(v)]);
  const after_run = (thought: Row[]) => (carried.length > 0 ? [streamed[0], ...thought, ...streamed.slice(1)] : [...thought, ...streamed]);
  if (v.page !== null) {
    const live = v.page.live;
    const thought = v.thinking === false && live.some((_, k) => thinks(live, k)) ? [THINKING] : [];
    const sub = view_sub(v);
    const queued = (sub?.queue ?? []).flatMap((text) => waits("user", text, true));
    const last = v.page.log?.at(-1);
    const limit = sub?.limit ?? null;
    const idle = sub !== undefined && v.page.live.length === 0 && (last?.kind !== "tool" || last.echo !== undefined) && limit === null;
    return [...after_run(thought), ...(idle ? [WAITING] : []), ...(limit === null ? [] : [Cap(limit_show(limit))]), ...queued];
  }
  const thought = v.thinking === false && (v.live.some((_, k) => thinks(v.live, k)) || (v.live.length === 0 && v.busy && v.wait === "" && thought_last(v))) ? [THINKING] : [];
  const rows = after_run(thought);
  const load = v.importing !== null ? [Cap(progress_show(v.importing))] : [];
  const said = !v.up ? v.out.flatMap((p) => waits("user", p.said, false)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  const queued = v.queue.flatMap((q) => waits(q.kind, q.text, true));
  const after = [...queued, ...kept, ...load];
  if (v.limit !== null) {
    return [...rows, { $: "Cap", text: "Ki · " + limit_show(v.limit), notice: true }, ...after];
  }
  if (v.wait === SUMMARIES) {
    return [...rows, ...(rows.length > 0 ? [] : [Cap(sums_show(v.sums, v.again))]), ...after];
  }
  return [...rows, ...(v.busy && v.wait !== "" ? [WAITING] : []), ...after];
}

function sums_show(sums: Sums | null, again: Again | null, now = Date.now()): string {
  const head = sums === null ? SUMS : SUMS.replace(/…$/, "") + ": " + sums.done + " of " + sums.total;
  if (again === null) {
    return head;
  }
  const when = again.limit ? "at " + clock(again.until, now) : "in " + Math.max(1, Math.ceil((again.until - now) / 60e3)) + " min";
  const why  = again.why.length > 120 ? again.why.slice(0, 120) + "…" : again.why.replace(/\.$/, "");
  return head + " · compactor: " + why + ", asking again " + when;
}

function limit_show(limit: Parked, now = Date.now()): string {
  return limit_note(limit, limit.known ? "resumes" : "tries again", now);
}

// the one usage-limit note: the parked wait's row, a call ended by one
// (Limit.off), a subagent's in its spawner's turn (#170); with the reason
// its vendor gave (#201)
export function limit_note(limit: { vendor: Vendor; until: number | null; why?: string }, does: string, now = Date.now(), since: number | null = null): string {
  const { vendor, until, why } = limit;
  return "Usage limit on " + vendor + (since === null ? "" : " since " + clock(since, now)) + ", " + (until === null ? "reset time unknown" : does + " at " + clock(until, now)) + (why === undefined ? "" : " (" + why + ")");
}

function clock(at: number, now = Date.now()): string {
  const day = new Date(at).toDateString() === new Date(now).toDateString() ? {} : { weekday: "short", day: "numeric", month: "short" } as const;
  return new Date(at).toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function progress_show(p: Progress): string {
  const n = (k: number) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  return phase + (p.why === null ? "" : " · paused");
}

// the user's Stop is for the agent's own turn: its subagents go on
export function view_stoppable(v: View): boolean {
  return v.busy || v.limit !== null;
}

// a subagent's page shows its model and effort, not to be changed (#156),
// also once it's done (#180)
export function view_pick(v: View): Knob[] {
  if (v.page !== null) {
    const sub = view_sub(v) ?? v.page.how ?? undefined;
    const shown = (text: string, move: Move): Knob[] => (text === "" ? [] : [{ text, move, hint: text, choices: [] }]);
    return sub === undefined ? [] : sub.pick !== null ? view_knobs(v, sub.pick, false) : [...shown(sub.model, "model"), ...shown(sub.effort, "effort")];
  }
  return v.pick === null ? [] : view_knobs(v, v.pick, true);
}

function view_knobs(v: View, pick: Pick, menus: boolean): Knob[] {
  const { model, effort, speed, profile } = pick;
  const ranks = (v.profiles?.[profile ?? ""] ?? []).map((f) => f.model.label).join(", ");
  const whose = Pick.twin(pick.vendor, model, v.vendors) ? ", " + pick.vendor : "";
  const choices = (move: Move) => (menus ? view_choices(pick, move, v) : []);
  return [
    { text: profile ?? model, move: "model", hint: profile === undefined ? model + whose : profile + ": " + ranks, choices: choices("model") },
    ...(effort === "" ? [] : [{ text: effort, move: "effort" as const, hint: effort + " effort", choices: choices("effort") }]),
    { text: speed, move: "speed", hint: speed, choices: choices("speed") },
  ];
}

function view_choices(pick: Pick, move: Move, v: View): Choice[] {
  return Pick.options(pick, move, v).map(([text, to], i, all) => {
    const head = (p: Pick) => p.profile !== undefined ? "profiles" : p.vendor;
    const vendor = move === "model" && (i === 0 || head(all[i - 1][1]) !== head(to)) ? head(to) : null;
    const here = move !== "model" ? Pick.label(to) === Pick.label(pick) : to.profile !== undefined ? to.profile === pick.profile : pick.profile === undefined && Pick.label(to) === Pick.label(pick);
    const by = move === "model" && to.profile === undefined ? to.vendor + ":" + text : text;
    return { text: move === "model" ? to.profile ?? to.model : text, to: by, move, here, vendor };
  });
}

function view_learn(v: View, pack: Pack): void {
  for (const [key, node] of Object.entries(pack.nodes ?? {})) {
    v.nodes.set(key, node);
  }
  for (const [id, entry] of Object.entries(pack.whole ?? {})) {
    view_whole(v, Number(id), entry);
  }
}

function view_whole(v: View, id: number, entry: Entry): void {
  v.whole.set(id, entry);
  for (let k = 1; k < (entry.pages ?? 1); k++) {
    v.firsts.set(id + k, id);
  }
}

function view_entry(v: View, msg: Server & { $: "entry" }): void {
  const { $, id, sent, ...entry } = msg;
  if (sent === true && id !== undefined) {
    v.sent = [...v.sent, id];
  }
  const last = v.parts.at(-1);
  if (id !== undefined) {
    // the reasoning that came live before it is its own or no one's (#204)
    if (last !== undefined) {
      v.minds.delete(last[0] + last[1] - 1);
    }
    view_whole(v, id, entry);
    for (let k = 0; k < (entry.pages ?? 1); k++) {
      v.parts.push([id + k, 1]);
    }
  } else if (msg.kind === "mind" && last !== undefined) {
    const at = last[0] + last[1] - 1;
    v.minds.set(at, [...(v.minds.get(at) ?? []), msg.text]);
  }
}

// offline shows only once this long has gone, or a reconnect has failed
export const GRACE = 3000;
const BACKOFF = 30000;
// just after the page comes back in view (#159), while the phone's network
// may still be coming back: a link that doesn't open in OPEN_WAIT is tried
// again, every RETRY
const WOKE = 30000;
const OPEN_WAIT = 3000;

// a link that answered is no offline one, however long the chat it sends
// takes to come (#178); just after a wake, a phone's first tries may fail
// while its network comes back, so only the time counts then
export function view_offline(v: View): boolean {
  return v.on === "" && (Date.now() - v.down >= GRACE || (v.tries > 1 && !woken(v)));
}

// a link that drops is opened again at once, then after 1, 2, 4… s
export function link_open(v: View, link: Link): void {
  v.retry = null;
  // the link opens for the wanted chat: an open sent before is spent
  v.out = v.out.filter((p) => p.msg.$ !== "open");
  const ws   = link.open("?tab=" + v.tab + "&wire=" + WIRE + "&agent=" + v.agent);
  let heard  = Date.now();
  const tick = setInterval(() => {
    if (Date.now() - heard > PING) {
      drop();
    }
  }, PING / 2);
  // a link still opening is dropped after its wait of silence, read again
  // each time: a wake shortens it for the first tries, and a link slower
  // than that gets the long wait after
  function opening(): void {
    if (v.up || v.ws !== ws) {
      return;
    }
    const left = (woken(v) && v.tries <= 1 ? OPEN_WAIT : PING) - (Date.now() - heard);
    if (left <= 0) {
      drop();
    } else {
      slow = setTimeout(opening, left);
    }
  }
  let slow = setTimeout(opening, OPEN_WAIT);
  function shut(): void {
    ws.onmessage = null;
    ws.onclose   = null;
    clearInterval(tick);
    clearTimeout(slow);
    ws.close();
    [v.ws, v.up, v.on] = [null, false, ""];
  }
  function drop(): void {
    const up = v.up;
    shut();
    if (up) {
      v.down = Date.now();
    }
    link.lost(up);
    const wait = v.tries === 0 ? 0 : woken(v) ? RETRY : Math.min(BACKOFF, RETRY * 2 ** (v.tries - 1));
    v.tries++;
    v.retry = setTimeout(() => link_open(v, link), wait);
  }
  function flush(): void {
    for (const post of v.up && v.ws === ws ? v.out.filter((p) => p.ws !== ws) : []) {
      post.ws = ws;
      if ("body" in post.msg) {
        void upload(post, post.msg);
      } else {
        ws.send(JSON.stringify(post.msg));
      }
    }
  }
  async function upload(post: Post, msg: Extract<Post["msg"], { body: Body }>): Promise<void> {
    const { body, ...rest } = msg;
    const query = Object.entries(rest).map(([k, x]) => k + "=" + encodeURIComponent(String(x)));
    const res = await link.post("/api/act?" + query.join("&"), await body()).catch(() => null);
    const out = (await res?.json().catch(() => null)) as Answer | null | undefined;
    if (out != null) {
      link.hear({ $: "ack", id: post.msg.id, ...out });
    } else if (post.ws === ws && v.ws === ws) {
      drop();
    }
  }
  // back in view: a link not heard from since the server's last tick is
  // dead, one still opening after RETRY is hung, and one waiting to open
  // again opens now
  function wake(): void {
    v.woke = Date.now();
    if (!v.up) {
      v.down = Date.now();
      v.tries = 0;
    }
    if (v.ws === ws && Date.now() - heard > (v.up ? PING / 2 + RETRY : RETRY)) {
      v.tries = 0;
      drop();
    } else if (v.ws === ws && !v.up) {
      clearTimeout(slow);
      opening();
    } else if (v.ws === null && v.retry !== null) {
      clearTimeout(v.retry);
      v.tries = 0;
      link_open(v, link);
    }
  }
  // the server took no part in this link: its wire is not ours. An older
  // client stops, a newer one tries again slowly till the server is updated
  function refused(msg: Extract<Server, { $: "error" }>): void {
    const old = (msg.wire ?? 0) > WIRE;
    shut();
    if (!old) {
      setTimeout(() => link_open(v, link), SLOW);
    }
    const text = old ? OLDER : NEWER;
    if (v.refused?.text !== text) {
      v.refused = { text, old };
      link.hear({ $: "error", text, ...(old && msg.build !== undefined ? { build: msg.build } : {}) });
    }
  }
  // a link not yet up, opened for a chat no longer wanted, opens again for
  // the wanted one rather than be sent all of the other first (#178)
  function reopen(): void {
    if (v.ws === ws && !v.up) {
      shut();
      link_open(v, link);
    }
  }
  [v.ws, v.flush, v.wake, v.reopen] = [ws, flush, wake, reopen];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data)) as Server;
    if (msg.$ === "error" && !v.up) {
      refused(msg);
      return;
    }
    const join = msg.$ === "view" && !v.up;
    if (join) {
      v.up = true;
      v.tries = 0;
    }
    link.hear(msg);
    if (join) {
      v.refused = null;
      flush();
    }
  };
  ws.onclose = () => drop();
}

function woken(v: View): boolean {
  return Date.now() - v.woke < WOKE;
}

export function link_send(v: View, msg: Client, done = (a: Answer) => link_note(v, a), said = ""): void {
  const to = "agent" in msg ? {} : { agent: v.agent };
  v.out.push({ msg: { id: uuid(), ...msg, ...to }, ws: null, done, said });
  v.flush();
}

// a random id, as crypto.randomUUID makes one: that is only in a secure
// context, and a page on a LAN's plain http is none
function uuid(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b, k) => (k === 6 ? (b & 15) | 64 : k === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function link_note(v: View, a: Answer): void {
  if (a.error !== undefined) {
    v.notes.push(a.error);
  }
}

export async function post(url: string, body: object, auth: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const headers = { ...auth, "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out: unknown = res === null ? { error: "Can't reach the server." } : await res.json().catch(() => (res.ok ? {} : { error: "HTTP " + res.status }));
  return { ...(rec(out) ? out : {}), ok: res?.ok === true, status: res?.status ?? 0 };
}

// one message is shown as itself, never as a fold of one (#120), a team
// copy from before 41 as its line; two and more are a fold till opened,
// which shows its two halves
// a message split in memory shows whole, once, at the first of its pages
// shown whole (drawn: those shown so far); a fold counts messages (#151)
function part_rows(v: View, id: number, n: number, drawn: Set<number>): Row[] {
  const key   = id + "+" + n;
  const at    = n === 1 ? v.firsts.get(id) ?? id : id;
  const entry = v.whole.get(at);
  const half  = n / 2;
  if (n === 1 && entry?.kind === "team") {
    return sum_rows(id, 1, 1, v.nodes.get(key));
  }
  if (n === 1 && entry !== undefined) {
    const shown = v.thinking !== false;
    const after = shown ? (v.minds.get(id) ?? []).flatMap((x) => entry_rows(null, "mind", x)) : [];
    if (drawn.has(at)) {
      return after;
    }
    drawn.add(at);
    const before = v.firsts.get(at - 1) ?? at - 1;
    return [...(shown ? mind_rows(entry) : []), ...sent_rows(v.sent.includes(at), whole_rows(at, entry, v.whole.get(before))), ...after];
  }
  if (n === 1 || v.open.get(key) !== true) {
    const msgs = n - [...v.firsts.keys()].filter((k) => k >= id && k < id + n).length + (drawn.has(v.firsts.get(id) ?? id) ? 0 : v.firsts.has(id) ? 1 : 0);
    return msgs === 0 ? [] : sum_rows(id, n, msgs, v.nodes.get(key));
  }
  const had = drawn.size;
  const rows = [...part_rows(v, id, half, drawn), ...part_rows(v, id + half, half, drawn)];
  const msgs = drawn.size - had + folded(rows);
  return msgs === 0 ? rows : [{ $: "Box", id, n, msgs, text: GLYPH.open + " " + msgs + "x · fold", rows }];
}

const ROWS  = new WeakMap<Entry | Node, Row[]>();
const APART = new WeakMap<Entry, Row[]>();
const MINDS = new WeakMap<Entry, Row[]>();

// the reasoning a message keeps, before it (#204), made once
function mind_rows(entry: Entry): Row[] {
  const rows = entry.mind === undefined ? [] : MINDS.get(entry) ?? entry_rows(null, "mind", entry.mind);
  if (entry.mind !== undefined) {
    MINDS.set(entry, rows);
  }
  return rows;
}

function whole_rows(id: number | null, entry: Entry, before: Entry | undefined): Row[] {
  const of = entry_of(entry, before);
  const made = of.apart ? APART : ROWS;
  const rows = made.get(entry) ?? (entry.echo === undefined ? cmd_rows(entry, entry_rows(id, entry.kind, entry.text, entry.images, of, entry.from, entry.of)) : pair_rows(id, entry, entry.echo));
  made.set(entry, rows);
  return rows;
}

// a message whose first word started a skill or set the goal shows it so
function cmd_rows(entry: Entry, rows: Row[]): Row[] {
  const cmd = entry.cmd === true ? /^\/\S+/.exec(entry.text)?.[0] : undefined;
  return cmd === undefined ? rows : rows.map((r) => (r.$ === "Msg" ? { ...r, cmd } : r));
}

// the / list for the composer's text (#203): while it is one word after a
// / at its start, Ki's commands and the skills whose names hold it, those
// that start with it first
export function view_slash(v: View, text: string): Slash[] {
  const typed = /^\/(\S*)$/.exec(text)?.[1].toLowerCase();
  if (typed === undefined) {
    return [];
  }
  const all = [...COMMANDS.map(({ name, about }) => ({ name, about })), ...(v.skills ?? []).filter((s) => !COMMANDS.some((c) => c.name === s.name))];
  const name = (s: Slash) => s.name.toLowerCase();
  return [...all.filter((s) => name(s).startsWith(typed)), ...all.filter((s) => !name(s).startsWith(typed) && name(s).includes(typed))];
}

// a call logged with its result: the one line they make (view_lines)
function pair_rows(id: number | null, entry: Entry, echo: string): Row[] {
  const call = entry_rows(id, "tool", entry.text, entry.images, undefined, entry.from, entry.of);
  const out = entry_rows(id, "echo", echo, [], { tool: entry.tool ?? "", apart: false });
  return call.map((r) => (r.$ === "Msg" && r.call !== null ? { $: "Line", id, call: r.call, echo, rows: [r, ...out] } : r));
}

// the messages in the closed folds of rows
function folded(rows: Row[]): number {
  return rows.reduce((sum, row) => sum + (row.$ === "Sum" ? row.msgs : row.$ === "Box" ? folded(row.rows) : 0), 0);
}

function sum_rows(id: number, n: number, msgs: number, node: Node = { text: WAIT, to: "" }): Row[] {
  const had = ROWS.get(node);
  const rows = had?.[0]?.$ === "Sum" && had[0].msgs === msgs ? had : [{ $: "Sum" as const, id, n, msgs, text: Md.md_flat(node.text) }];
  ROWS.set(node, rows);
  return rows;
}

// a message's rows while it is queued, each made once (Html.row_html)
const SENT = new WeakMap<Row, Row>();

function sent_rows(sent: boolean, rows: Row[]): Row[] {
  return sent ? rows.map((row) => {
    const made = SENT.get(row) ?? (row.$ === "Msg" ? { ...row, queued: true } : row);
    SENT.set(row, made);
    return made;
  }) : rows;
}

// a delta of an output item (at) goes to that item's own entry, and may
// end it
export function live_push(live: Live[], kind: Kind, text: string, fresh = false, at?: At): void {
  const top = at === undefined ? live[live.length - 1] : live.findLast((l) => l.at?.item === at.item);
  if (top !== undefined && top.kind === kind && !fresh) {
    top.text += text;
    top.at = at === undefined || top.at?.done === true ? top.at : at;
  } else if (at === undefined || fresh || text !== "") {
    live.push({ kind, text, ...(at === undefined ? {} : { at }) });
  }
}

function live_set(live: Live[], now: Live[]): void {
  const goes = live.every((l, k) => now[k]?.kind === l.kind && now[k].text.startsWith(l.text));
  const held = goes ? live : [];
  const next = now.map((l, k) => (k < held.length ? Object.assign(held[k], l) : l));
  live.splice(0, live.length, ...next);
}

export function image_kind(head: Uint8Array): string | null {
  const text = String.fromCharCode(...head.subarray(0, HEAD));
  return MARKS.find(([, at, mark]) => text.slice(at, at + mark.length) === mark)?.[0] ?? null;
}

function entry_of(entry: Entry, before: Entry | undefined): Of {
  return { tool: entry.tool ?? "", apart: entry.kind === "echo" && entry.of !== undefined && before?.of !== entry.of };
}

function entry_rows(id: number | null, kind: Kind, text: string, images: string[] = [], of: Of = { tool: "", apart: false }, from?: string, pair?: string): Row[] {
  const call = kind === "tool" ? Call.call_parse(text) : null;
  const report = kind === "work" ? Call.report_read(text) : null;
  const label = of.apart ? "↳ " + (of.tool === "" ? "" : Call.tool_name(of.tool) + " ") + "result" : "result";
  const body = call === null ? entry_body(kind, report?.text ?? text, label, of.tool) : [];
  const named = body.some((b) => b.$ === "File" && b.k.startsWith(label));
  const who = report?.name ?? WHO[kind] ?? (kind === "echo" && of.apart && !named ? label : "");
  const pics = images.filter((name) => !text.includes("/" + name));
  const sent = { ...(from === undefined ? {} : { from }), ...(pair === undefined ? {} : { of: pair }) };
  return call === null && body.length === 0 && pics.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images: pics, ...sent }];
}

function entry_body(kind: Kind, text: string, label: string, tool: string): Md.Block[] {
  if (kind !== "echo") {
    return Md.md_parse(text, kind === "user" || kind === "work");
  }
  const name = Call.tool_name(tool);
  return name === "show" ? Md.md_shown(text, label) : Md.md_output(text, label);
}

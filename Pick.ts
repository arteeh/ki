import type { Vendor } from "./AskAI.ts";
import { get } from "./Json.ts";

export type Pick = {
  vendor   : Vendor;
  model    : string;
  effort   : string;
  speed    : string;
  profile? : string;
};

export type Move = "model" | "effort" | "speed";

// efforts: its own levels, as its vendor names them, in its order; effort:
// the one its vendor uses when a request names none; input: the most
// tokens a request's input may hold, the room the context meter measures
export type Model = { label: string; id: string; speeds: string[]; efforts: string[]; effort: string; input: number };

export type Offer = { vendors: Vendor[]; models: string[]; profiles?: Record<string, Fall[]> };

export type Fall = { vendor: Vendor; model: Model; effort?: string; speed?: string };

export const VENDORS: Vendor[] = ["claude-api", "openai-api", "openai-sub", "claude-sub"];

// the inputs (#214): Claude's 1M context, its models' default (Claude
// Code's docs: Opus 4.7+, Sonnet 5+, Haiku 5.5 need no [1m]), Anthropic
// naming no other most for the input, at the API and on a plan alike
// (claude-sub took 250K of input for Haiku and refused 1.1M, 23 Nov 2026);
// OpenAI's 922K of each model's 1.05M context, at the API (its models
// pages, for Sol and Astra; Terra and Luna refused 930K) and on a ChatGPT
// plan, whatever Codex's models list says (all four took 921.5K and
// refused 921.9K, 23 Nov 2026)
// the efforts: the vendors' models lists (Anthropic's capabilities.effort,
// Claude Code's supportedEffortLevels, Codex's supported_reasoning_levels)
// and what a request at each level is answered; defaults by their docs
// each vendor's models from large to small, as the picker shows them
const CLAUDE = ["low", "medium", "high", "xhigh", "max"];
const FABLE : Model = { label: "fable-5.2",  id: "claude-fable-5-2",  speeds: ["slow"], efforts: CLAUDE, effort: "high", input: 1e6 };
const OPUS  : Model = { label: "opus-5.5",   id: "claude-opus-5-5",   speeds: ["slow", "fast"], efforts: CLAUDE, effort: "medium", input: 1e6 };
const SONNET: Model = { label: "sonnet-5.5", id: "claude-sonnet-5-5", speeds: ["slow"], efforts: CLAUDE, effort: "high", input: 1e6 };
const HAIKU : Model = { label: "haiku-5.5",  id: "claude-haiku-5-5",  speeds: ["slow"], efforts: CLAUDE, effort: "medium", input: 1e6 };
const GPT  = ["low", "medium", "high", "xhigh", "max"];
const NONE = ["none", ...GPT];
const OPENAI: Model[] = [
  { label: "gpt-6.2-astra", id: "gpt-6.2-astra", speeds: ["slow", "fast", "ultrafast"], efforts: GPT, effort: "medium", input: 922e3 },
  { label: "gpt-6.2-sol",   id: "gpt-6.2-sol",   speeds: ["slow", "fast", "ultrafast"], efforts: GPT, effort: "medium", input: 922e3 },
  { label: "gpt-6.1-terra", id: "gpt-6.1-terra", speeds: ["slow", "fast"], efforts: NONE, effort: "medium", input: 922e3 },
  { label: "gpt-6-luna",    id: "gpt-6-luna",    speeds: ["slow", "fast"], efforts: NONE, effort: "medium", input: 922e3 },
];

// a ChatGPT plan's (ChatGPT.ts): fast is its priority tier, no ultrafast
const PLAN: Model[] = OPENAI.map((m) => ({ ...m, speeds: m.speeds.filter((s) => s !== "ultrafast") }));

const MODELS: Record<Vendor, Model[]> = {
  "claude-api": [FABLE, OPUS, SONNET, HAIKU],
  "openai-api": OPENAI,
  "openai-sub": PLAN,
  "claude-sub": [FABLE, { ...OPUS, speeds: ["slow"] }, SONNET, HAIKU],
};

const SPEEDS = ["slow", "fast", "ultrafast"];

// the models Ki dropped, each with the one in its place (#200): a setting
// that still names one is refused with that name, never moved onto it
const REPLACED: Record<string, string> = { "gpt-6-astra": "gpt-6.2-astra", "gpt-6.1-sol": "gpt-6.2-sol" };

export const LABELS = [...new Set(Object.values(MODELS).flat().map((m) => m.label))];

export namespace Pick {

  export function model(vendor: Vendor, label: string): Model | undefined {
    return MODELS[vendor].find((m) => m.label === label);
  }

  export function replaced(label: string): string | undefined {
    return Object.hasOwn(REPLACED, label) ? REPLACED[label] : undefined;
  }

  export function on(pick: Pick, vendor: Vendor, model: Model): Pick {
    const below = SPEEDS.slice(0, SPEEDS.indexOf(pick.speed) + 1);
    const speed = below.filter((s) => model.speeds.includes(s)).pop() ?? "slow";
    const effort = Pick.offers(model, pick.effort) ? pick.effort : model.effort;
    return { ...pick, vendor, model: model.label, effort, speed };
  }

  // a model without effort control has none: its effort is ""
  export function offers(model: Model, effort: string): boolean {
    return model.efforts.length === 0 ? effort === "" : model.efforts.includes(effort);
  }

  export function no_effort(model: Model, effort: string): string {
    return model.label + " has no effort " + effort + (model.efforts.length === 0 ? ", nor any other" : "; one of " + model.efforts.join(", "));
  }

  export function models(vendors: Vendor[], labels: string[]): Array<[Vendor, Model]> {
    return vendors.flatMap((v) => MODELS[v].filter((m) => labels.includes(m.label)).map((m): [Vendor, Model] => [v, m]));
  }

  export function options(pick: Pick, move: Move, offer: Offer): Array<[string, Pick]> {
    const model = Pick.model(pick.vendor, pick.model);
    const { profile: _, ...plain } = pick;
    const all = Pick.models(offer.vendors, offer.models).map(([v, m]): [string, Pick] => [m.label, Pick.on(plain, v, m)]);
    const profiles = Object.keys(offer.profiles ?? {}).flatMap((name): [string, Pick][] => {
      const on = Pick.profile(name, offer, pick.effort, pick.speed);
      return on === null ? [] : [[name, on]];
    });
    switch (move) {
      case "model": {
        return [...profiles, ...all];
      }
      case "effort": {
        return (model?.efforts ?? []).map((effort) => [effort, { ...pick, effort }]);
      }
      case "speed": {
        return (model?.speeds ?? []).map((speed) => [speed, { ...pick, speed }]);
      }
    }
  }

  export function move(pick: Pick, move: Move, offer: Offer, to: string): Pick | null {
    const list = Pick.options(pick, move, offer);
    const mine = ([, p]: [string, Pick]) => p.profile === undefined && p.vendor === pick.vendor;
    const same = list.filter(([part, p]) => part === to || (p.profile === undefined && p.vendor + ":" + part === to));
    const like = list.filter(([part]) => part.toLowerCase().includes(to.toLowerCase()));
    const one  = like.length === 1 ? like[0] : like.filter(mine).length === 1 ? like.find(mine) : undefined;
    const hit  = same.find(mine) ?? same[0] ?? one;
    return hit === undefined ? null : hit[1];
  }

  export function to_model(pick: Pick, label: string, vendors: Vendor[], { models }: Offer): Pick | null {
    const all = Pick.models(vendors, models).filter(([, m]) => m.label === label);
    const hit = all.find(([v]) => v === pick.vendor) ?? all[0];
    return hit === undefined ? null : Pick.on(pick, hit[0], hit[1]);
  }

  export function twin(vendor: Vendor, label: string, vendors: Vendor[]): boolean {
    return vendors.some((v) => v !== vendor && Pick.model(v, label) !== undefined);
  }

  export function label(pick: Pick): string {
    return [pick.vendor, pick.model, pick.effort, pick.speed].join(":");
  }

  export function ask(pick: Pick): Pick {
    const model = Pick.model(pick.vendor, pick.model);
    return { ...pick, model: model?.id ?? pick.model };
  }

  export function named(run: Pick): Pick {
    const model = MODELS[run.vendor].find((m) => m.id === run.model);
    return { ...run, model: model?.label ?? run.model };
  }

  export function falls(run: Pick, falls: Fall[]): Pick[] {
    const own = { vendor: run.vendor, model: run.model, effort: run.effort, speed: run.speed };
    const list = falls.map((f) => {
      const on = Pick.on(own, f.vendor, f.model);
      return Pick.ask({ ...on, effort: f.effort ?? on.effort, speed: f.speed ?? on.speed });
    });
    return [own, ...list].filter((p, k, all) => all.findIndex((q) => q.vendor === p.vendor && q.model === p.model) === k);
  }

  export function profile(name: string, offer: Offer, effort: string, speed: string): Pick | null {
    const first = Pick.first(name, offer);
    if (first === undefined) {
      return null;
    }
    const on = Pick.on({ vendor: first.vendor, model: first.model.label, effort, speed }, first.vendor, first.model);
    return { ...on, effort: first.effort ?? on.effort, speed: first.speed ?? on.speed, profile: name };
  }

  export function read(x: unknown, offer: Offer): Pick | null {
    const [profile, effort, speed, label] = [get(x, "profile"), get(x, "effort"), get(x, "speed"), get(x, "model")];
    if (profile !== undefined) {
      const first = typeof profile === "string" ? Pick.first(profile, offer) : undefined;
      return typeof profile === "string" && first !== undefined && typeof effort === "string" && Pick.offers(first.model, effort) ? Pick.profile(profile, offer, effort, String(speed)) : null;
    }
    const vendor = offer.vendors.find((v) => v === get(x, "vendor"));
    if (vendor === undefined || typeof label !== "string" || !offer.models.includes(label)) {
      return null;
    }
    const model = Pick.model(vendor, label);
    if (model === undefined || typeof effort !== "string" || !Pick.offers(model, effort) || typeof speed !== "string" || !model.speeds.includes(speed)) {
      return null;
    }
    return { vendor, model: label, effort, speed };
  }

  // a profile's is its first model's, which its pick names, as if that
  // were picked alone: a fallback that refuses a turn as too long says so
  // then (#213)
  export function input(pick: Pick): number {
    return Pick.model(pick.vendor, pick.model)?.input ?? 272e3;
  }

  export function first(profile: string, offer: Offer): Fall | undefined {
    const profiles = offer.profiles ?? {};
    return Object.hasOwn(profiles, profile) ? profiles[profile][0] : undefined;
  }

  // the offered model a pick names
  export function named_model(x: unknown, offer: Offer): Model | undefined {
    const [profile, label] = [get(x, "profile"), get(x, "model")];
    const vendor = offer.vendors.find((v) => v === get(x, "vendor"));
    if (profile !== undefined) {
      return typeof profile === "string" ? Pick.first(profile, offer)?.model : undefined;
    }
    return vendor === undefined || typeof label !== "string" || !offer.models.includes(label) ? undefined : Pick.model(vendor, label);
  }

  // why read refuses a pick, when for its effort
  export function refused(x: unknown, offer: Offer): string | null {
    const model = Pick.named_model(x, offer);
    const effort = get(x, "effort");
    return model !== undefined && typeof effort === "string" && !Pick.offers(model, effort) ? Pick.no_effort(model, effort) : null;
  }

  // one saved by an older Ki at an effort its model doesn't have loads at
  // the model's default
  export function load(saved: object | null, offer: Offer, def: Pick): Pick {
    const x = saved ?? def;
    const model = Pick.named_model(x, offer);
    return Pick.read(x, offer) ?? (model === undefined ? null : Pick.read({ ...x, effort: model.effort }, offer)) ?? def;
  }

}

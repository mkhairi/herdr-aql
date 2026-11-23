// AQL for Herdr: what AQL knows about the focused agent's project, led by its open handoff.
// Roles (props.role): "toggle", the tab-bar button; "panel", the layout column; "confirm", a
// dialog; none, a pane. Views only: the logic lives in scope.js, model.js and aql.js.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, spaces, agents, focused, shared, setShared, theme, layout, openOverlay, closeOverlay, nextCommand, readTextFile, props as blockProps } from "herdr";
import { resolveScope } from "./scope.js";
import { splitHandoffs, hasDot, liveDying, ago, handText, handTarget, nextPlace, pasteSteps, nextAgent, freshTabs } from "./model.js";
import { createAql } from "./aql.js";

const PANEL = "aql-panel";
const POLL = 60 * 1000;
// An action in a dialog bumps this so the panel and toggle refresh at once.
const BUMP = "aql.bump.v1";
const CLAMP = 420;
const TABS = [["scope", "Scope"], ["search", "Search"], ["decay", "Decay"], ["health", "Health"]];

const stop = (_e, cx) => cx.stop_propagation();
// Work started from render waits for the render to end (cx.notify throws during render).
const later = (cx, fn) => cx.spawn(async (cx) => { await cx.sleep(0); return fn(cx); });

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}

// One aql client per machine, so each machine's home is looked up once.
const clients = new Map();
const aqlOn = (on) => {
  if (!clients.has(on)) clients.set(on, createAql({ exec, on }));
  return clients.get(on);
};

// Where the panel looks: the focused terminal's folder, on its space's machine.
function where() {
  const f = focused();
  const space = f && spaces().find((s) => s.id === f.space);
  return { on: space?.machine ?? null, cwd: f?.cwd ?? null };
}
const placeKey = (w) => `${w.on ?? ""}|${w.cwd ?? ""}`;

async function loadScope(w) {
  return resolveScope(w.cwd, (p) => readTextFile(p, { on: w.on }));
}

// ---- Small pieces ----

const label = (t, text) => div().text_size(11).text_color(t.dim).child(text);

function button(t, id, text, onClick, o = {}) {
  const off = Boolean(o.disabled);
  return h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).text_size(12)
    .border(1).border_color(t.border).bg(o.danger ? t.chrome : t.raised)
    .text_color(off ? t.dim : o.danger ? t.blocked : t.foreground)
    .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
    .when(off, (el) => el.opacity(0.6))
    .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => onClick(cx)))
    .child(text);
}

function banner(t, text) {
  return div().flex_none().px(10).py(8).rounded(6).bg(t.selected).text_size(12).text_color(t.blocked).child(text);
}

export default class Aql extends View {
  init(_props, cx) {
    const p = blockProps() ?? {};
    this.role = p.role ?? "pane";
    if (this.role === "confirm") return;
    this.place = null; this.scope = null; this.data = {}; this.error = null; this.at = 0;
    this.loading = false; this.bump = shared(BUMP) ?? 0; this.dot = false;
    if (this.role === "toggle") {
      cx.timer.every(1000, (cx) => this.tick(cx, true));
      later(cx, (cx) => this.tick(cx, true));
      return;
    }
    this.tab = "scope"; this.expanded = new Set(); this.showAuto = false; this.notice = null;
    this.handle = cx.focus_handle();
    this.initTabs(cx);
    cx.timer.every(1000, (cx) => this.tick(cx, false));
    later(cx, (cx) => this.tick(cx, false));
    cx.spawn(async (cx) => { for (;;) { if ((await nextCommand()) === "focus") this.handle.focus(); cx.notify(); } });
  }

  initTabs(_cx) {
    this.query = InputState.new({ placeholder: "Search this project's memory" });
    this.tabData = {};
  }

  shown() {
    if (this.role !== "panel") return true;
    const node = find(layout(), PANEL);
    return Boolean(node && !node.hidden);
  }

  // Refresh on a new place, after an action anywhere, and every minute while shown. The toggle
  // only needs the dot, so it keeps polling while the panel is closed: that's when it matters.
  tick(cx, dotOnly) {
    if (this.loading) return;
    const w = nextPlace(this.last, where()), key = placeKey(w), bump = shared(BUMP) ?? 0;
    this.last = w;
    this.lastAgent = nextAgent(this.lastAgent, focused(), agents());
    const moved = key !== this.place, bumped = bump !== this.bump;
    const due = Date.now() - this.at > POLL && (dotOnly || this.shown());
    if (moved || bumped || due) { this.bump = bump; this.refresh(cx, w, dotOnly); }
  }

  async refresh(cx, w = this.last ?? where(), dotOnly = false) {
    this.loading = true;
    try {
      if (placeKey(w) !== this.place) {
        this.place = placeKey(w); this.data = {};
        if (!dotOnly) Object.assign(this, freshTabs());
      }
      this.on = w.on; this.cwd = w.cwd;
      try {
        this.scope = await loadScope(w);
      } catch (e) {
        // Not the folder name: an unreadable scope must not look like a real one.
        this.scope = null; this.dot = false;
        this.error = { kind: "machine", error: `Couldn't read this folder's .aql-scope on ${w.on ?? "this Mac"}: ${e?.message ?? e}` };
        return;
      }
      const P = this.scope.project;
      if (!P) { this.error = null; this.dot = false; return; }
      const aql = aqlOn(w.on);
      const [handoffs, briefing] = await Promise.all([aql.handoffs(P), dotOnly ? null : aql.briefing(P)]);
      this.error = [handoffs, briefing].find((r) => r && !r.ok) ?? null;
      if (handoffs.ok) this.data.handoffs = handoffs.data;
      if (briefing?.ok) this.data.briefing = briefing.data;
      this.dot = hasDot(this.data.handoffs?.open);
      if (!dotOnly) await this.refreshTab(cx, aql, P);
    } finally {
      this.at = Date.now(); this.loading = false; cx.notify();
    }
  }

  // The open tab's own reads. Search runs on Enter, doctor on its button: neither refreshes here.
  async refreshTab(cx, aql, P) {
    if (!P) return;
    if (this.tab === "decay") {
      const [dying, retention] = await Promise.all([aql.dying(P), aql.retention(P)]);
      this.tabData.decay = { dying, retention };
    } else if (this.tab === "health") {
      this.tabData.pending = await aql.pending(P);
    }
    cx.notify();
  }

  async search(cx) {
    const q = this.query.value().trim(), P = this.scope?.project;
    if (!q || !P) return;
    const place = this.place;
    this.tabData.search = { q, busy: true };
    cx.notify();
    const result = await aqlOn(this.on).retrieve(P, q);
    if (this.place !== place) return; // the project changed meanwhile: these hits aren't its
    this.tabData.search = { q, result };
    cx.notify();
  }

  async doctor(cx) {
    const place = this.place;
    this.tabData.doctor = { busy: true };
    cx.notify();
    const result = await aqlOn(this.on).doctor();
    if (this.place !== place) return;
    this.tabData.doctor = { result };
    cx.notify();
  }

  // Runs an action, says how it went, and refreshes everything.
  async act(cx, what, fn) {
    const r = await fn();
    this.notice = r.ok ? { ok: true, text: what } : { ok: false, text: r.error };
    setShared(BUMP, Date.now());
    cx.notify();
  }

  // Hand to agent: through the clipboard, because `hc send` and terminal.send always press Enter.
  async hand(cx, item) {
    const target = handTarget(focused(), agents(), this.lastAgent);
    if (target.error) return;
    const text = handText({ project: this.scope.project, ...item });
    const r = await exec("sh", ["-c", 'printf %s "$1" | pbcopy', "sh", text]).catch(() => ({ code: 1 }));
    if (r.code !== 0) { this.notice = { ok: false, text: "Couldn't copy to the clipboard" }; cx.notify(); return; }
    for (const [name, args] of pasteSteps(target.terminal)) run(name, args);
    this.notice = { ok: true, text: "Pasted into the agent's prompt — review it, then press Enter" };
    cx.notify();
  }

  confirm(action, item) {
    openOverlay({
      mod: "aql", kind: "dialog", width: 460, height: 280,
      props: { role: "confirm", action, on: this.on, project: this.scope.project, id: item.id, text: item.summary ?? item.content ?? "" },
    });
  }

  // ---- Render ----

  render() {
    const t = theme();
    if (this.role === "toggle") return this.renderToggle(t);
    if (this.role === "confirm") return this.renderConfirm(t);
    return v_flex().id("aql").track_focus(this.handle).size_full().min_h(0).bg(t.background).p(12).gap(10)
      .child(this.header(t))
      .child(this.tabs(t))
      .when(Boolean(this.notice), (el) => el.child(div().flex_none().text_size(12).text_color(this.notice.ok ? t.muted : t.blocked).child(this.notice.text)))
      .when(Boolean(this.error), (el) => el.child(banner(t, this.error.kind === "unreachable" ? `AQL server unreachable — ${this.error.error}` : this.error.error)))
      .child(div().id("aql-body").flex_1().min_h(0).overflow_y_scrollbar().when(Boolean(this.error), (el) => el.opacity(0.5)).child(this.body(t)));
  }

  renderToggle(t) {
    const node = find(layout(), PANEL), on = Boolean(node && !node.hidden);
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("aql-toggle").h(26).px(8).gap(6).flex_none().items_center().rounded(6).text_size(12)
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .tooltip(this.dot ? "An agent left a handoff here" : "AQL memory for this project")
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => run("layout.toggle", { id: PANEL }))
        .child("AQL")
        .when(this.dot, (el) => el.child(div().w(6).h(6).rounded(3).bg(t.accent))));
  }

  header(t) {
    const s = this.scope, b = this.data.briefing;
    if (!s) return label(t, "Looking for this folder's AQL scope…");
    if (!s.project) return v_flex().gap(2).child(div().text_size(14).text_color(t.foreground).child("No AQL scope here"))
      .child(label(t, this.cwd ? this.cwd : "Focus a terminal to see its project"));
    const via = s.via === "file" ? `via ${s.path}` : "via folder name";
    return v_flex().gap(2).flex_none()
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(14).text_color(t.foreground).child(s.project))
        .child(label(t, `· ${this.on ?? "this Mac"}${b ? ` · ${b.total} objects` : ""}`)))
      .child(div().truncate().text_size(11).text_color(t.dim).child(via));
  }

  tabs(t) {
    return h_flex().flex_none().gap(2).p(2).rounded(8).bg(t.chrome).border(1).border_color(t.border)
      .children(TABS.map(([key, text]) => {
        const on = key === this.tab;
        return h_flex().id(`tab-${key}`).flex_1().h(24).justify_center().items_center().rounded(6).text_size(12)
          .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
          .cursor_pointer().on_mouse_down("left", stop)
          .on_click((_e, cx) => { this.tab = key; later(cx, (cx) => this.refreshTab(cx, aqlOn(this.on), this.scope?.project)); cx.notify(); })
          .child(text);
      }));
  }

  body(t) {
    if (!this.scope?.project) return div();
    if (this.tab === "scope") return this.scopeTab(t);
    return this.otherTab(t);
  }

  otherTab(t) {
    if (this.tab === "search") return this.searchTab(t);
    if (this.tab === "decay") return this.decayTab(t);
    return this.healthTab(t);
  }

  failedOr(t, r, fn) {
    if (!r) return div().text_size(12).text_color(t.muted).child("…");
    return r.ok ? fn(r.data) : banner(t, r.error);
  }

  searchTab(t) {
    const s = this.tabData.search;
    const box = h_flex().id("q").h(30).px(8).items_center().rounded(6).border(1).border_color(t.border).bg(t.surface)
      .on_key_down((e, cx) => { if (e.key === "enter") later(cx, (cx) => this.search(cx)); })
      .child(Input.new(this.query).flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground));
    const col = v_flex().gap(10).child(box);
    if (!s) return col.child(label(t, "Press Enter to search"));
    if (s.busy) return col.child(label(t, `Searching “${s.q}”…`));
    return col.child(this.failedOr(t, s.result, (d) => {
      const hits = d.hits ?? [];
      if (!hits.length) return div().text_size(12).text_color(t.muted).child(`Nothing for “${s.q}”`);
      return v_flex().gap(6).children(hits.map((h) => this.objectRow(t, h, { score: h.score ?? null })));
    }));
  }

  decayTab(t) {
    const d = this.tabData.decay;
    if (!d) return div().text_size(12).text_color(t.muted).child("…");
    const col = v_flex().gap(10);
    if (d.retention?.ok) {
      const hist = d.retention.data.histogram ?? {}, b = hist.buckets ?? [], w = hist.bucket_width ?? 0.05;
      const cold = d.retention.data.cold_threshold ?? 0.2;
      const below = b.reduce((n, c, i) => n + ((i + 1) * w <= cold ? c : 0), 0);
      col.child(label(t, `${hist.total ?? 0} objects · ${below} below ${Math.round(cold * 100)}% retention`));
    }
    return col.child(this.failedOr(t, d.dying, (data) => {
      const rows = liveDying(data.dying);
      if (!rows.length) return div().text_size(12).text_color(t.muted).child("Nothing real is decaying");
      return v_flex().gap(6).children(rows.map((o) => this.objectRow(t, o, { decay: true })));
    }));
  }

  healthTab(t) {
    const d = this.tabData.doctor, pending = this.tabData.pending;
    const col = v_flex().gap(10)
      .child(h_flex().gap(8).items_center()
        .child(button(t, "run-doctor", d?.busy ? "Running…" : "Run doctor", (cx) => later(cx, (cx) => this.doctor(cx)), { disabled: Boolean(d?.busy) }))
        .child(label(t, "Checks the server, embedder, capture and backlog")));
    if (d?.result) col.child(this.failedOr(t, d.result, (data) => v_flex().gap(6).children((data.checks ?? []).map((c, i) => {
      const lvl = String(c.level ?? "").toLowerCase(), bad = lvl !== "ok";
      return v_flex().id(`chk-${i}`).gap(2).p(8).rounded(6).bg(t.surface).border(1).border_color(t.border)
        .child(h_flex().gap(6)
          .child(div().text_size(11).text_color(bad ? t.blocked : t.ansi2).child(lvl === "ok" ? "ok" : lvl.toUpperCase()))
          .child(div().text_size(12).text_color(t.foreground).child(c.name ?? "")))
        .child(div().text_size(11).text_color(t.muted).child(c.detail ?? ""))
        .when(Boolean(c.remedy), (el) => el.child(div().text_size(11).text_color(t.dim).child(`→ ${c.remedy}`)));
    }))));
    if (pending?.ok && (pending.data.items ?? []).length) {
      const P = this.scope.project;
      col.child(label(t, `PENDING APPROVAL · ${pending.data.total ?? pending.data.items.length}`))
        .children(pending.data.items.map((o) => v_flex().id(`pa-${o.id}`).gap(6).p(8).rounded(6).bg(t.surface).border(1).border_color(t.border)
          .child(div().text_size(12).text_color(t.foreground).child(o.content ?? ""))
          .child(h_flex().gap(6)
            .child(button(t, `ap-${o.id}`, "Approve", (cx) => later(cx, (cx) => this.act(cx, "Approved", () => aqlOn(this.on).approve(P, o.id)))))
            .child(button(t, `rj-${o.id}`, "Reject", (cx) => later(cx, (cx) => this.act(cx, "Rejected", () => aqlOn(this.on).reject(P, o.id))), { danger: true })))));
    }
    return col;
  }

  scopeTab(t) {
    const h = this.data.handoffs, b = this.data.briefing;
    const { lead, more, auto } = splitHandoffs(h?.open);
    const col = v_flex().gap(14);
    col.child(v_flex().gap(6)
      .child(label(t, "HANDOFF"))
      .child(lead ? this.handoffCard(t, lead) : div().text_size(12).text_color(t.muted).child(h ? "No handoff written by an agent" : "…"))
      .when(more.length > 0, (el) => el.children(more.map((x) => this.handoffCard(t, x))))
      .when(auto.length > 0, (el) => el
        .child(div().id("auto-toggle").text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.showAuto = !this.showAuto; cx.notify(); })
          .child(`${this.showAuto ? "▾" : "▸"} ${auto.length} from session hooks`))
        .when(this.showAuto, (el) => el.children(auto.map((x) => this.handoffCard(t, x))))));
    const pins = b?.pinned ?? [];
    col.child(v_flex().gap(6).child(label(t, "PINNED RULES"))
      .child(pins.length ? v_flex().gap(6).children(pins.map((o) => this.objectRow(t, o, { pin: true }))) : div().text_size(12).text_color(t.muted).child(b ? "None pinned" : "…")));
    if (b?.counts) col.child(v_flex().gap(4).child(label(t, "COUNTS"))
      .child(div().text_size(12).text_color(t.muted).child(Object.entries(b.counts).map(([k, n]) => `${n} ${k}`).join(" · "))));
    if (b?.review_due?.length) col.child(v_flex().gap(6).child(label(t, "REVIEW DUE"))
      .children(b.review_due.map((o) => this.objectRow(t, o, {}))));
    return col;
  }

  handoffCard(t, h) {
    const open = this.expanded.has(h.id), long = (h.summary ?? "").length > CLAMP;
    const summary = open || !long ? h.summary : `${h.summary.slice(0, CLAMP)}…`;
    const stale = Date.now() - (h.created_at ?? 0) > 7 * 864e5;
    const target = handTarget(focused(), agents(), this.lastAgent);
    return v_flex().id(`h-${h.id}`).gap(8).p(10).rounded(8).bg(t.surface).border(1).border_color(t.border)
      .child(h_flex().gap(6).items_center()
        .child(label(t, `${ago(h.created_at ?? 0, Date.now())} · ${h.auto ? "auto (session hook)" : "written by agent"}`))
        .when(stale, (el) => el.child(div().px(5).rounded(4).bg(t.selected).text_size(10).text_color(t.blocked).child("stale"))))
      .child(div().text_size(13).text_color(t.foreground).child(summary ?? ""))
      .when(long, (el) => el.child(div().id(`more-${h.id}`).text_size(11).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { open ? this.expanded.delete(h.id) : this.expanded.add(h.id); cx.notify(); })
        .child(open ? "less" : "more")))
      .when((h.next_steps ?? []).length > 0, (el) => el.child(v_flex().gap(2).child(label(t, "Next steps"))
        .children(h.next_steps.map((s, i) => div().id(`s-${h.id}-${i}`).text_size(12).text_color(t.muted).child(`• ${s.length > CLAMP && !open ? `${s.slice(0, CLAMP)}…` : s}`)))))
      .child(h_flex().gap(6).flex_wrap()
        .child(button(t, `hand-${h.id}`, "Hand to agent", (cx) => later(cx, (cx) => this.hand(cx, { kind: "handoff", ...h })),
          { disabled: Boolean(target.error), tip: target.error ?? "Pastes via the clipboard; you press Enter" }))
        .child(button(t, `accept-${h.id}`, "Accept", (cx) => later(cx, (cx) => this.act(cx, "Handoff accepted", () => aqlOn(this.on).accept(this.scope.project, h.id)))))
        .child(button(t, `cancel-${h.id}`, "Cancel…", () => this.confirm("cancel", h), { danger: true })));
  }

  // A knowledge object row. o: { pin: show Unpin, decay: show retention, Pin and Archive }.
  objectRow(t, o, opts) {
    const open = this.expanded.has(o.id), text = o.content ?? "";
    const target = handTarget(focused(), agents(), this.lastAgent);
    const P = this.scope.project;
    return v_flex().id(`o-${o.id}`).gap(6).p(8).rounded(6).bg(t.surface).border(1).border_color(t.border)
      .child(h_flex().gap(6).items_center()
        .child(label(t, o.ko_type ?? o.type ?? "object"))
        .when(opts.decay, (el) => el.child(label(t, `· ${Math.round((o.retention ?? 0) * 100)}% retention`)))
        .when(opts.score != null, (el) => el.child(label(t, `· score ${Number(opts.score).toFixed(2)}`))))
      .child(div().id(`c-${o.id}`).text_size(12).text_color(t.foreground).cursor_pointer()
        .on_click((_e, cx) => { open ? this.expanded.delete(o.id) : this.expanded.add(o.id); cx.notify(); })
        .child(open || text.length <= 160 ? text : `${text.slice(0, 160)}…`))
      .child(h_flex().gap(6).flex_wrap()
        .child(button(t, `oh-${o.id}`, "Hand to agent", (cx) => later(cx, (cx) => this.hand(cx, { kind: "object", id: o.id, content: text })),
          { disabled: Boolean(target.error), tip: target.error ?? "Pastes via the clipboard; you press Enter" }))
        .child(opts.pin || o.pinned
          ? button(t, `up-${o.id}`, "Unpin", (cx) => later(cx, (cx) => this.act(cx, "Unpinned", () => aqlOn(this.on).unpin(P, o.id))))
          : button(t, `p-${o.id}`, "Pin", (cx) => later(cx, (cx) => this.act(cx, "Pinned", () => aqlOn(this.on).pin(P, o.id)))))
        .when(Boolean(opts.decay), (el) => el.child(button(t, `ar-${o.id}`, "Archive…", () => this.confirm("archive", o), { danger: true }))));
  }

  // ---- The confirm dialog ----

  renderConfirm(t) {
    const p = blockProps() ?? {};
    const what = p.action === "cancel" ? "Cancel this handoff?" : "Archive this?";
    const note = p.action === "cancel" ? "It stays in AQL's history but no agent will pick it up." : "It leaves search and briefings now.";
    const close = () => closeOverlay(p.overlay);
    // The task's own cx, not the click's: a click's cx is stale after an await.
    const go = (cx) => {
      if (this.busy) return;
      this.busy = true; this.failed = null; cx.notify();
      later(cx, async (cx) => {
        const aql = aqlOn(p.on ?? null);
        const r = p.action === "cancel" ? await aql.cancel(p.project, p.id) : await aql.archive(p.project, p.id);
        this.busy = false;
        if (r.ok) { setShared(BUMP, Date.now()); close(); } else { this.failed = r.error; cx.notify(); }
      });
    };
    return v_flex().id("aql-confirm").size_full().p(16).gap(10).bg(t.popover)
      .child(div().text_size(14).text_color(t.foreground).child(what))
      .child(div().id("confirm-text").flex_1().min_h(0).overflow_y_scrollbar().p(8).rounded(6).bg(t.surface).text_size(12).text_color(t.muted)
        .child(String(p.text ?? "")))
      .child(label(t, note))
      .when(Boolean(this.failed), (el) => el.child(banner(t, this.failed)))
      .child(h_flex().gap(8).justify_end()
        .child(button(t, "keep", "Keep it", () => close()))
        .child(button(t, "go", this.busy ? "Working…" : p.action === "cancel" ? "Cancel handoff" : "Archive", go, { danger: true, disabled: Boolean(this.busy) })));
  }
}


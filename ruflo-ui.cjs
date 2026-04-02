#!/usr/bin/env node
const http = require("http");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let PORT = 3737;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--port" && process.argv[i + 1]) PORT = parseInt(process.argv[i + 1], 10);
}

const CWD = process.cwd();
const CLI = path.join(CWD, "bin", "cli.js");
const IS_WIN = os.platform() === "win32";
const ROOT_VERSION = (readJson(path.join(CWD, "package.json")) || {}).version || "3.5.15";
const TIMEOUT = 180000;
const PRESETS = [
  { id: "queen", title: "Queen Swarm", text: "Bind a coordinator-led UI crew, register a concrete task, then refresh the room.", steps: ["init check", "swarm init --topology hierarchical-mesh --max-agents 6", "agent spawn --type coordinator --name queen-ui", "agent spawn --type coder --name builder-ui", "agent spawn --type researcher --name scout-ui", "agent spawn --type tester --name verify-ui", "task create --type implementation --description \"Build RuFlo UI control room\"", "swarm status", "agent list", "task list"] },
  { id: "systems", title: "Systems Sweep", text: "Validate runtime, swarm, agents, and the task lane without relying on the broken aggregate status path.", steps: ["init check", "swarm status", "agent list", "task list", "doctor"] },
  { id: "memory", title: "Memory Atlas", text: "Inspect local memory presence and try a cautious read path before deeper semantic search.", steps: ["init check", "memory list --namespace patterns --limit 5", "memory list --namespace results --limit 5", "swarm status"] },
  { id: "hive", title: "Hive Lens", text: "Inspect hive, MCP, providers, and the live task lane together.", steps: ["swarm status", "agent list", "task list", "mcp status", "providers list"] }
];

const runtime = detectRuntime();
const procs = {};
let pid = 0;
let activity = [];
let agentCache = { at: 0, data: [] };

function quote(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }
function env() {
  return Object.assign({}, process.env, {
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    npm_config_yes: "true",
    RUFLO_ENABLE_AGENTDB_BRIDGE: "0",
    RUFLO_ENABLE_HEAVY_EMBEDDINGS: "0"
  });
}
function clean(cmd) {
  return String(cmd || "").trim()
    .replace(/^\$\s*/, "")
    .replace(/^npx\s+(-y\s+)?claude-flow\s+/i, "")
    .replace(/^npx\s+(-y\s+)?ruflo\s+/i, "")
    .replace(/^claude-flow\s+/i, "")
    .replace(/^ruflo\s+/i, "")
    .replace(/\s+--no-update\b/gi, "")
    .trim();
}
function detectRuntime() {
  if (fs.existsSync(CLI)) return { label: "local wrapper", cmd: `${quote(process.execPath)} ${quote(CLI)} --no-update`, version: versionOf(`${quote(process.execPath)} ${quote(CLI)} --no-update`) };
  const local = path.join(CWD, "node_modules", ".bin", IS_WIN ? "ruflo.cmd" : "ruflo");
  if (fs.existsSync(local)) return { label: "local binary", cmd: `${quote(local)} --no-update`, version: versionOf(`${quote(local)} --no-update`) };
  try { cp.execSync("claude-flow --version", { stdio: "pipe", timeout: 6000 }); return { label: "global claude-flow", cmd: "claude-flow --no-update", version: versionOf("claude-flow --no-update") }; } catch (e) {}
  return { label: "published fallback", cmd: `npx -y @claude-flow/cli@${ROOT_VERSION} --no-update`, version: versionOf(`npx -y @claude-flow/cli@${ROOT_VERSION} --no-update`) };
}
function versionOf(base) {
  try { return cp.execSync(`${base} --version`, { cwd: CWD, stdio: "pipe", timeout: 8000, env: env() }).toString().trim(); }
  catch (e) { return "unknown"; }
}
function pushActivity(entry) {
  activity = [entry].concat(activity.filter((x) => x.id !== entry.id)).slice(0, 16);
}
function updateActivity(id, patch) {
  const item = activity.find((x) => x.id === id);
  if (!item) return;
  Object.assign(item, patch);
  pushActivity(item);
}
function meta(file) {
  try {
    const s = fs.statSync(file);
    return { exists: true, size: s.size, updatedAt: new Date(s.mtimeMs).toISOString() };
  } catch (e) {
    return { exists: false, size: 0, updatedAt: null };
  }
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; } }
function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  try { return fs.readdirSync(dir).filter((n) => /\.json$/i.test(n)).map((n) => readJson(path.join(dir, n))).filter(Boolean); }
  catch (e) { return []; }
}
function cliAgents() {
  if (Date.now() - agentCache.at < 3000) return agentCache.data;
  try {
    const out = cp.execSync(`${runtime.cmd} agent list`, { cwd: CWD, stdio: "pipe", timeout: 5000, env: env() }).toString();
    const rows = out.split(/\r?\n/).filter((line) => /^\|/.test(line));
    const agents = rows.map((line) => line.split("|").slice(1, -1).map((part) => part.trim()))
      .filter((cols) => cols.length >= 5 && cols[1] !== "Type" && cols[1] !== "----")
      .map((cols, index) => ({ name: cols[0] || `${cols[1]}-${index + 1}`, type: cols[1], status: cols[2], created: cols[3] }));
    agentCache = { at: Date.now(), data: agents };
    return agents;
  } catch (e) {
    return agentCache.data;
  }
}
function swarmState() {
  const root = path.join(CWD, ".swarm");
  const state = readJson(path.join(root, "state.json")) || {};
  const fileAgents = listJson(path.join(root, "agents"));
  const agents = cliAgents().length ? cliAgents() : fileAgents;
  const tasks = listJson(path.join(root, "tasks"));
  return {
    id: state.id || "no-active-swarm",
    topology: state.topology || "standby",
    status: state.status || (agents.length ? "running" : "idle"),
    objective: state.objective || "No objective recorded",
    totalAgents: agents.length,
    activeAgents: agents.filter((a) => ["active", "running", "spawned"].includes(a.status)).length,
    coordinators: agents.filter((a) => a.type === "coordinator").length,
    totalTasks: tasks.length,
    runningTasks: tasks.filter((t) => ["running", "in_progress"].includes(t.status)).length,
    agents: agents.slice(0, 10).map((a) => ({ name: a.name || a.id || "unnamed", type: a.type || "worker", status: a.status || "idle" })),
    tasks: tasks.slice(0, 8).map((t) => ({
      title: t.description || t.title || t.id || "Untitled task",
      type: t.type || "task",
      status: t.status || "pending",
      assigned: t.assignedTo || t.assigned_to || t.agent || ""
    }))
  };
}
function overview() {
  return {
    now: new Date().toISOString(),
    cwd: CWD,
    runtime: { label: runtime.label, version: runtime.version, running: Object.keys(procs).length, cmd: runtime.cmd },
    swarm: swarmState(),
    memory: { swarmDb: meta(path.join(CWD, ".swarm", "memory.db")), claudeDb: meta(path.join(CWD, ".claude", "memory.db")) },
    activity,
    presets: PRESETS
  };
}
function quick(command, cb) {
  cp.exec(`${runtime.cmd} ${clean(command)}`, { cwd: CWD, timeout: 15000, env: env() }, (err, out, stderr) => cb(err, String(out || "") + String(stderr || "")));
}
function run(command, res) {
  const id = ++pid;
  const cmd = clean(command);
  const full = `${runtime.cmd} ${cmd}`;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });
  const send = (t, d) => { try { res.write(`data:${JSON.stringify({ id, t, d })}\n\n`); } catch (e) {} };
  pushActivity({ id, command: cmd, status: "running", excerpt: "", startedAt: new Date().toISOString() });
  send("hi", { command: cmd, full });
  let child;
  try { child = cp.spawn(full, { cwd: CWD, shell: true, stdio: ["pipe", "pipe", "pipe"], env: env() }); }
  catch (e) { send("e", "Spawn failed: " + e.message); send("x", 1); res.end(); return; }
  procs[id] = { id, cmd, child, startedAt: Date.now() };
  try { child.stdin.write("y\n"); setTimeout(() => { try { child.stdin.end(); } catch (e) {} }, 1000); } catch (e) {}
  const timer = setTimeout(() => {
    if (!procs[id]) return;
    send("e", "\n[TIMEOUT after 3 minutes]\n");
    try { child.kill("SIGKILL"); } catch (e) {}
  }, TIMEOUT);
  const finish = (code) => {
    if (!procs[id]) return;
    clearTimeout(timer);
    delete procs[id];
    updateActivity(id, { status: code === 0 ? "ok" : code === -9 ? "killed" : "error", exitCode: code, finishedAt: new Date().toISOString() });
    send("x", code);
    try { res.end(); } catch (e) {}
  };
  const onChunk = (type, chunk) => {
    const text = chunk.toString();
    const excerpt = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(" | ").slice(0, 240);
    if (excerpt) updateActivity(id, { excerpt });
    send(type, text);
  };
  child.stdout.on("data", (c) => onChunk("o", c));
  child.stderr.on("data", (c) => onChunk("w", c));
  child.on("close", (code) => finish(code == null ? -1 : code));
  child.on("error", (e) => { send("e", e.message); finish(1); });
  res.on("close", () => { if (procs[id]) { try { child.kill(); } catch (e) {} delete procs[id]; updateActivity(id, { status: "killed", exitCode: -9 }); clearTimeout(timer); } });
}

http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); } catch (e) { res.writeHead(400); res.end(); return; }
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname === "/api/run") { const c = url.searchParams.get("c"); if (!c) { res.writeHead(400); res.end("missing"); return; } run(c, res); return; }
  if (url.pathname === "/api/kill") { const id = parseInt(url.searchParams.get("id"), 10); if (procs[id]) { try { procs[id].child.kill("SIGKILL"); } catch (e) {} delete procs[id]; updateActivity(id, { status: "killed", exitCode: -9 }); } res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
  if (url.pathname === "/api/info") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ cwd: CWD, runtime, running: Object.values(procs).map((p) => ({ id: p.id, cmd: p.cmd, ageMs: Date.now() - p.startedAt })) })); return; }
  if (url.pathname === "/api/overview") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(overview())); return; }
  if (url.pathname === "/api/check") { quick(url.searchParams.get("w") || "status", (err, out) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: !err, out: out.slice(0, 4000) })); }); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page());
}).listen(PORT, () => {
  console.log("");
  console.log("  +------------------------------------------------------+");
  console.log("  |  RuFlo Control Surface                               |");
  console.log(`  |  http://localhost:${PORT}`);
  console.log(`  |  Runtime: ${runtime.label}`);
  console.log(`  |  Version: ${runtime.version}`);
  console.log(`  |  Workspace: ${CWD}`);
  console.log("  +------------------------------------------------------+");
  console.log("");
});

function page() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RuFlo Control Surface</title>
<style>
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap");
:root{--bg:#071015;--panel:rgba(14,23,31,.78);--line:rgba(168,193,214,.18);--text:#edf5fc;--muted:#90a4b5;--gold:#f5a524;--cyan:#54d6d5;--lime:#9ae27f;--red:#ff7e7e;--mono:"IBM Plex Mono",monospace;--sans:"Space Grotesk",system-ui,sans-serif}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{font-family:var(--sans);color:var(--text);background:radial-gradient(circle at 16% 18%,rgba(245,165,36,.18),transparent 30%),radial-gradient(circle at 82% 10%,rgba(84,214,213,.18),transparent 26%),linear-gradient(160deg,#04080b,#0b141a 45%,#061118);overflow:hidden}
body:before{content:"";position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:42px 42px;mask-image:radial-gradient(circle at center,rgba(0,0,0,.9),transparent 92%);pointer-events:none}
.app{display:grid;grid-template-columns:290px minmax(0,1fr) 340px;gap:18px;height:100vh;padding:18px}.col{display:flex;flex-direction:column;gap:16px;min-height:0}.panel{background:var(--panel);border:1px solid var(--line);border-radius:24px;backdrop-filter:blur(20px);box-shadow:0 24px 80px rgba(0,0,0,.44);overflow:hidden}.pad{padding:18px}.hero{padding:22px;display:flex;flex-direction:column;gap:18px;min-height:220px}.k{font:11px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--gold)}.brand{font-size:64px;line-height:.92;letter-spacing:-.06em}.muted{color:var(--muted);font-size:13px;line-height:1.6}
.marks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.mark{padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.03)}.mark small{display:block;font:10px var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:6px}.mark strong{display:block;font-size:23px}
h2,h3,h1{margin:0;letter-spacing:-.04em}.preset{width:100%;text-align:left;border:1px solid var(--line);background:linear-gradient(135deg,rgba(255,255,255,.04),rgba(255,255,255,.01)),linear-gradient(135deg,rgba(245,165,36,.12),transparent 42%);color:inherit;border-radius:18px;padding:14px;cursor:pointer;font:inherit;transition:transform .16s ease,border-color .16s ease}.preset:hover,.chip:hover,.ghost:hover,.mini:hover,.run-btn:hover{transform:translateY(-1px);border-color:rgba(168,193,214,.32)}.preset strong{display:block;font-size:14px;margin-bottom:6px}.preset span,.item span,.feed span{display:block;color:var(--muted);font-size:12px;line-height:1.5}
.stage{display:grid;grid-template-rows:auto auto minmax(0,1fr);min-height:0}.mast{padding:24px 26px 14px}.mast-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.title{font-size:50px;line-height:.95}.pills{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.pill{min-width:112px;padding:9px 12px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.03);font:11px var(--mono)}.pill b{display:block;font-size:12px;color:var(--text);margin-top:4px}
.composer{padding:0 26px 20px;display:grid;gap:12px}.row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px}.row input{height:56px;padding:0 16px;border-radius:18px;border:1px solid var(--line);background:rgba(4,8,11,.84);color:var(--text);font:13px var(--mono);outline:none}.run-btn,.ghost{height:56px;padding:0 18px;border-radius:18px;font:600 13px var(--sans);cursor:pointer}.run-btn{border:none;background:linear-gradient(135deg,var(--gold),#ef7848);color:#081016}.ghost,.mini{border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--text)}.chips{display:flex;flex-wrap:wrap;gap:10px}.chip{padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);font:11px var(--mono);cursor:pointer}
.deck{padding:0 26px 26px;display:flex;flex-direction:column;gap:16px;overflow:auto;min-height:0}.empty{min-height:280px;border:1px dashed var(--line);border-radius:24px;background:rgba(255,255,255,.02);display:grid;place-items:center;text-align:center;padding:30px;color:var(--muted);line-height:1.65}.run{border:1px solid var(--line);border-radius:22px;background:rgba(12,21,28,.92);overflow:hidden}.head{padding:15px 16px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.head strong{display:block;font:12px var(--mono);line-height:1.6;word-break:break-word}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.tag{padding:6px 8px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);font:10px var(--mono);color:var(--muted)}.actions{display:flex;gap:8px}.mini{height:36px;padding:0 12px;border-radius:12px;cursor:pointer;font:11px var(--mono)}.kill{color:#ffb4b4;border-color:rgba(255,126,126,.32)}.body{padding:16px;background:rgba(4,8,11,.88);color:#dae7f2;font:12px/1.65 var(--mono);white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto}.stream{color:var(--gold);animation:pulse 1.2s ease-in-out infinite}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metric{padding:14px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.03)}.metric small{display:block;font:10px var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:6px}.metric strong{display:block;font-size:24px}.list,.feed{display:flex;flex-direction:column;gap:10px;overflow:auto;min-height:0;padding-right:4px}.item,.feed-item{padding:12px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.03)}.item strong,.feed-item strong{display:block;font-size:13px;margin-bottom:4px}.note{font:11px/1.6 var(--mono);color:var(--muted)}
.toast-wrap{position:fixed;top:18px;right:18px;display:flex;flex-direction:column;gap:10px;z-index:9}.toast{padding:12px 14px;border-radius:16px;border:1px solid var(--line);background:rgba(8,12,16,.95);box-shadow:0 24px 80px rgba(0,0,0,.44);font-size:12px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.38}}
@keyframes drift{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-8px,0)}}
@keyframes sweep{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
.hero{position:relative;background:
  radial-gradient(circle at top right,rgba(84,214,213,.18),transparent 38%),
  radial-gradient(circle at bottom left,rgba(245,165,36,.18),transparent 42%),
  linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.02))}
.hero:after{content:"";position:absolute;inset:auto -12% 12% 22%;height:1px;background:linear-gradient(90deg,transparent,rgba(84,214,213,.6),transparent);opacity:.8;animation:sweep 8s linear infinite}
.hero-stack{display:grid;gap:14px;position:relative;z-index:1}
.hero-orbit{position:relative;height:96px;border-radius:22px;border:1px solid rgba(255,255,255,.08);background:
  radial-gradient(circle at center,rgba(84,214,213,.22),transparent 36%),
  linear-gradient(135deg,rgba(255,255,255,.05),rgba(255,255,255,.01));overflow:hidden}
.hero-orbit:before,.hero-orbit:after{content:"";position:absolute;border-radius:999px;border:1px solid rgba(255,255,255,.12);inset:18px 34px;animation:drift 6s ease-in-out infinite}
.hero-orbit:after{inset:28px 72px;border-color:rgba(245,165,36,.28);animation-duration:7.5s}
.hero-core{position:absolute;inset:50% auto auto 50%;width:14px;height:14px;border-radius:50%;transform:translate(-50%,-50%);background:linear-gradient(135deg,var(--gold),#fff4d5);box-shadow:0 0 30px rgba(245,165,36,.7)}
.signal-board{position:relative;display:grid;grid-template-columns:minmax(0,1.35fr) 300px;gap:14px;margin-top:18px;min-height:240px}
.signal-stage{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.08);border-radius:26px;background:
  radial-gradient(circle at 25% 24%,rgba(245,165,36,.16),transparent 34%),
  radial-gradient(circle at 78% 18%,rgba(84,214,213,.18),transparent 28%),
  linear-gradient(160deg,rgba(4,8,11,.96),rgba(9,18,24,.92))}
.signal-stage:before{content:"";position:absolute;inset:18px;border:1px solid rgba(255,255,255,.06);border-radius:18px;pointer-events:none}
.mesh{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:.95}
.signal-copy{position:relative;z-index:1;display:grid;gap:16px;padding:24px;min-height:240px}
.signal-copy h2{font-size:42px;line-height:.96;max-width:9ch}
.signal-copy p{max-width:52ch}
.signal-rail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.rail-card{padding:12px 14px;border-radius:18px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
.rail-card small{display:block;font:10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.rail-card strong{display:block;font-size:18px;line-height:1.25}
.inspector{display:grid;gap:12px}
.inspector-card{padding:16px;border-radius:22px;border:1px solid rgba(255,255,255,.08);background:
  linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02)),
  rgba(9,15,21,.78)}
.inspector-card strong{display:block;font-size:15px;margin-bottom:8px}
.inspector-code{font:11px/1.7 var(--mono);color:#d3e0ea;word-break:break-word}
.deck-tools{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;padding:0 0 4px}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.filter{padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);font:11px var(--mono);cursor:pointer;transition:all .18s ease}
.filter.active{color:#081016;background:linear-gradient(135deg,var(--cyan),#b4fff6);border-color:transparent}
.transcripts{display:flex;flex-direction:column;gap:16px}
.run{position:relative;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.run:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.16);box-shadow:0 24px 60px rgba(0,0,0,.28)}
.run[data-status="error"]{border-color:rgba(255,126,126,.34)}
.run[data-status="ok"]{border-color:rgba(154,226,127,.28)}
.run[data-status="running"]{border-color:rgba(84,214,213,.34)}
.task-list{display:flex;flex-direction:column;gap:10px;overflow:auto;min-height:0;padding-right:4px}
.task{padding:13px;border-radius:16px;border:1px solid var(--line);background:rgba(255,255,255,.03)}
.task strong{display:block;font-size:13px;margin-bottom:6px}
.task span{display:block;color:var(--muted);font-size:12px;line-height:1.55}
.task[data-status="running"],.task[data-status="in_progress"]{border-color:rgba(84,214,213,.34)}
.task[data-status="completed"],.task[data-status="ok"]{border-color:rgba(154,226,127,.28)}
.task[data-status="pending"]{border-color:rgba(245,165,36,.22)}
.feed-item{transition:transform .16s ease,border-color .16s ease}
.feed-item[data-status="error"]{border-color:rgba(255,126,126,.34)}
.feed-item[data-status="ok"]{border-color:rgba(154,226,127,.28)}
.feed-item[data-status="running"]{border-color:rgba(84,214,213,.34)}
.stack{display:grid;gap:16px;min-height:0}
@media(max-width:1320px){.signal-board{grid-template-columns:1fr}.inspector{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1160px){body{overflow:auto}.app{grid-template-columns:1fr;height:auto}.mast-top{flex-direction:column}.pills{justify-content:flex-start}.row{grid-template-columns:1fr}.run-btn,.ghost{width:100%}.signal-rail{grid-template-columns:1fr}.inspector{grid-template-columns:1fr}}
</style></head><body>
<div class="app">
  <aside class="col">
    <section class="panel hero">
      <div class="hero-stack">
        <div><div class="k">Queen-led surface</div><div class="brand">RuFlo</div><div class="muted">A two-way control room for swarms, memory, tasks, MCP, and runtime health. Commands go out through the local wrapper and the real responses stream straight back into the chamber.</div></div>
        <div class="hero-orbit"><div class="hero-core"></div></div>
        <div class="marks">
          <div class="mark"><small>Runtime</small><strong id="mVer">unknown</strong></div>
          <div class="mark"><small>Runs</small><strong id="mRun">0</strong></div>
          <div class="mark"><small>Topology</small><strong id="mTop">standby</strong></div>
          <div class="mark"><small>Queens</small><strong id="mQueen">0</strong></div>
        </div>
      </div>
    </section>
    <section class="panel pad"><h2>Launch Routines</h2><p class="muted">Each routine calls the local CLI wrapper. The queen preset is tuned for a coordinator-led UI build crew.</p><div id="presetBox" style="display:grid;gap:12px;margin-top:14px"></div></section>
    <section class="panel pad"><h3>Suggested Commands</h3><div class="chips" style="margin-top:12px">
      <button class="chip" data-fill="init check">init check</button><button class="chip" data-fill="swarm status">swarm status</button><button class="chip" data-fill="agent list">agent list</button><button class="chip" data-fill="task list">task list</button><button class="chip" data-fill="memory list --namespace patterns --limit 5">memory list</button><button class="chip" data-fill="mcp status">mcp status</button>
    </div><div class="note" style="margin-top:14px">The local wrapper is preferred, and if the V3 build is missing it falls back to the published CLI. Heavy memory routines can still stall on this filesystem, so the deck keeps kill controls close.</div></section>
  </aside>
  <main class="panel stage">
    <section class="mast">
      <div class="mast-top">
        <div><div class="k">Two-way command deck</div><h1 class="title">Run RuFlo as a live control system.</h1><div class="muted">Type any RuFlo command, launch curated sequences, or keep a queen-led swarm live while the transcript, task lane, and observatory refresh from the real local runtime.</div></div>
        <div class="pills">
          <div class="pill">Workspace<b id="pWorkspace">loading</b></div>
          <div class="pill">Swarm<b id="pSwarm">loading</b></div>
          <div class="pill">Memory<b id="pMemory">loading</b></div>
        </div>
      </div>
      <div class="signal-board">
        <div class="signal-stage">
          <canvas id="mesh" class="mesh"></canvas>
          <div class="signal-copy">
            <div><div class="k">Signal chamber</div><h2>Command the local queen without losing the transcript.</h2></div>
            <p class="muted">This center stage stays tethered to the actual wrapper, task files, and runtime status. The motion is there to surface activity, not hide the plumbing.</p>
            <div class="signal-rail">
              <div class="rail-card"><small>Runtime path</small><strong id="signalRuntime">loading</strong></div>
              <div class="rail-card"><small>Objective</small><strong id="signalObjective">No objective recorded</strong></div>
              <div class="rail-card"><small>Task pulse</small><strong id="signalTaskPulse">0 tracked</strong></div>
            </div>
          </div>
        </div>
        <div class="inspector">
          <div class="inspector-card"><strong>Execution path</strong><div class="inspector-code" id="runtimeCmd">loading</div></div>
          <div class="inspector-card"><strong>Swarm memory</strong><div class="inspector-code" id="dbPath">waiting for refresh</div></div>
          <div class="inspector-card"><strong>Live objective</strong><div class="inspector-code" id="objectiveNote">No objective recorded</div></div>
        </div>
      </div>
    </section>
    <section class="composer">
      <div class="row"><input id="ci" autocomplete="off" placeholder="swarm init --topology hierarchical-mesh --max-agents 6"><button class="run-btn" id="runBtn">Run command</button><button class="ghost" id="clearBtn">Clear deck</button></div>
      <div class="chips"><button class="chip" data-fill="memory search --query &quot;ruflo ui control room&quot; --namespace patterns">Search memory</button><button class="chip" data-fill="agent spawn --type coordinator --name queen-live">Spawn queen</button><button class="chip" data-fill="agent spawn --type coder --name builder-live">Spawn builder</button><button class="chip" data-fill="task create --type implementation --description &quot;Refine RuFlo UI control room&quot;">Create task</button><button class="chip" data-fill="providers list">Providers</button></div>
    </section>
    <section class="deck" id="deck">
      <div class="deck-tools">
        <div class="filters">
          <button class="filter active" data-feed-filter="all">All runs</button>
          <button class="filter" data-feed-filter="running">Running</button>
          <button class="filter" data-feed-filter="error">Errors</button>
        </div>
        <div class="actions">
          <button class="mini" id="copyLastBtn">Copy latest</button>
          <button class="mini kill" id="stopAllBtn">Stop all</button>
        </div>
      </div>
      <div class="transcripts" id="transcriptList"><div class="empty" id="empty"><div><div class="k">No active transcript</div><h2 style="font-size:34px;margin:10px 0 12px">Use the command deck or launch a preset.</h2><div>Input flows through the local wrapper, output streams back into this deck, and the observatory refreshes from live swarm, task, and memory state.</div></div></div></div>
    </section>
  </main>
  <aside class="col">
    <section class="panel pad"><h2>Runtime Observatory</h2><div class="grid" style="margin-top:14px"><div class="metric"><small>Detected runtime</small><strong id="oRuntime">-</strong></div><div class="metric"><small>Running commands</small><strong id="oProcs">0</strong></div><div class="metric"><small>Total agents</small><strong id="oAgents">0</strong></div><div class="metric"><small>Tasks tracked</small><strong id="oTasks">0</strong></div></div><div class="stack" style="margin-top:14px"><div class="inspector-card"><strong>Objective</strong><div class="inspector-code" id="oObjective">-</div></div><div class="inspector-card"><strong>Runtime command</strong><div class="inspector-code" id="oCmd">-</div></div></div></section>
    <section class="panel pad" style="min-height:0;display:flex;flex-direction:column"><h3>Swarm Task Lane</h3><p class="muted">Live task records from the swarm folder and CLI-visible state.</p><div class="task-list" id="taskList"></div></section>
    <section class="panel pad" style="min-height:0;display:flex;flex-direction:column"><h3>Agent Roster</h3><p class="muted">Pulled from the local swarm state on disk.</p><div class="list" id="agentList"></div></section>
    <section class="panel pad" style="min-height:0;display:flex;flex-direction:column"><h3>Command Feed</h3><p class="muted">Recent actions, filtered by the same status chips driving the deck.</p><div class="feed" id="feed"></div></section>
  </aside>
</div><div class="toast-wrap" id="toasts"></div>
<script>
const PRESETS=${JSON.stringify(PRESETS).replace(/</g,"\\\\u003c")};
const deck=document.getElementById("deck"),empty=document.getElementById("empty"),transcriptList=document.getElementById("transcriptList"),ci=document.getElementById("ci"),taskList=document.getElementById("taskList"),agentList=document.getElementById("agentList"),feed=document.getElementById("feed"),toasts=document.getElementById("toasts"),copyLastBtn=document.getElementById("copyLastBtn"),stopAllBtn=document.getElementById("stopAllBtn"),filters=[].slice.call(document.querySelectorAll("[data-feed-filter]"));
let hist=[],hx=-1,feedFilter="all",lastOverview=null,meshState=null;
function esc(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function toast(msg){const n=document.createElement("div");n.className="toast";n.textContent=msg;toasts.appendChild(n);setTimeout(()=>n.remove(),2600)}
function normalize(v){return String(v||"").trim().replace(/^\\$\\s*/,"").replace(/^npx\\s+(-y\\s+)?claude-flow\\s+/i,"").replace(/^npx\\s+(-y\\s+)?ruflo\\s+/i,"").replace(/^claude-flow\\s+/i,"").replace(/^ruflo\\s+/i,"")}
function matchesFilter(status){return feedFilter==="all"||String(status||"").toLowerCase()===feedFilter}
function toggleEmpty(){const hasRuns=!!transcriptList.querySelector(".run:not([hidden])");empty.style.display=hasRuns?"none":"grid"}
function setFilterState(next){feedFilter=next;filters.forEach((btn)=>btn.classList.toggle("active",btn.getAttribute("data-feed-filter")===next));applyTranscriptFilter();renderFeed((lastOverview&&lastOverview.activity)||[])}
function fillPresets(){const box=document.getElementById("presetBox");PRESETS.forEach((p)=>{const b=document.createElement("button");b.className="preset";b.innerHTML="<strong>"+esc(p.title)+"</strong><span>"+esc(p.text)+"</span>";b.onclick=()=>runSeq(p);box.appendChild(b);});}
function setOverview(d){lastOverview=d;document.getElementById("mVer").textContent=d.runtime.version||d.runtime.label;document.getElementById("mRun").textContent=String(d.runtime.running);document.getElementById("mTop").textContent=d.swarm.topology;document.getElementById("mQueen").textContent=String(d.swarm.coordinators);document.getElementById("pWorkspace").textContent=d.cwd.split(/[\\\\/]/).pop();document.getElementById("pSwarm").textContent=d.swarm.status+" / "+d.swarm.topology;document.getElementById("pMemory").textContent=d.memory.swarmDb.exists?"online":"offline";document.getElementById("oRuntime").textContent=d.runtime.label;document.getElementById("oProcs").textContent=String(d.runtime.running);document.getElementById("oAgents").textContent=String(d.swarm.totalAgents);document.getElementById("oTasks").textContent=String(d.swarm.totalTasks);document.getElementById("signalRuntime").textContent=d.runtime.label+" / "+(d.runtime.version||"unknown");document.getElementById("signalObjective").textContent=d.swarm.objective||"No objective recorded";document.getElementById("signalTaskPulse").textContent=String(d.swarm.runningTasks||0)+" live / "+String(d.swarm.totalTasks||0)+" tracked";document.getElementById("runtimeCmd").textContent=d.runtime.cmd;document.getElementById("dbPath").textContent=d.memory.swarmDb.exists?".swarm/memory.db | "+(d.memory.swarmDb.updatedAt||"updated unknown"):"swarm memory offline";document.getElementById("objectiveNote").textContent=d.swarm.objective||"No objective recorded";document.getElementById("oObjective").textContent=d.swarm.objective||"-";document.getElementById("oCmd").textContent=d.runtime.cmd;renderAgents(d.swarm.agents||[]);renderTasks(d.swarm.tasks||[]);renderFeed(d.activity||[]);if(meshState){meshState.energy=Math.max(5,(d.runtime.running||0)*18+(d.swarm.activeAgents||0)*10+(d.swarm.runningTasks||0)*12)}}
function renderAgents(items){agentList.innerHTML="";if(!items.length){agentList.innerHTML='<div class="item"><strong>No agents recorded</strong><span>Run the queen preset or spawn workers manually.</span></div>';return;}items.forEach((a)=>{const n=document.createElement("div");n.className="item";n.innerHTML="<strong>"+esc(a.name)+"</strong><span>"+esc(a.type+" | "+a.status)+"</span>";agentList.appendChild(n);});}
function renderTasks(items){taskList.innerHTML="";if(!items.length){taskList.innerHTML='<div class="task"><strong>No tasks tracked</strong><span>Create a task from the command deck or launch the queen routine to populate this lane.</span></div>';return;}items.forEach((t)=>{const n=document.createElement("div");const status=String(t.status||"pending").toLowerCase();n.className="task";n.dataset.status=status;n.innerHTML="<strong>"+esc(t.title)+"</strong><span>"+esc((t.type||"task")+" | "+status+(t.assigned?" | "+t.assigned:""))+"</span>";taskList.appendChild(n);});}
function renderFeed(items){feed.innerHTML="";const filtered=(items||[]).filter((a)=>matchesFilter(a.status||"idle"));if(!filtered.length){feed.innerHTML='<div class="feed-item"><strong>No entries for this filter</strong><span>Try another filter or run a fresh command.</span></div>';return;}filtered.forEach((a)=>{const n=document.createElement("div");const status=String(a.status||"idle").toLowerCase();n.className="feed-item";n.dataset.status=status;n.innerHTML="<strong>"+esc(a.command)+"</strong><span>"+esc(status+" | "+(a.excerpt||"No excerpt yet"))+"</span>";feed.appendChild(n);});}
function applyTranscriptFilter(){[].slice.call(transcriptList.querySelectorAll(".run")).forEach((node)=>{const status=node.dataset.status||"running";node.hidden=!matchesFilter(status)});toggleEmpty()}
function makeCard(cmd,source){const wrap=document.createElement("article");wrap.className="run";wrap.dataset.status="running";const head=document.createElement("div");head.className="head";const left=document.createElement("div");left.innerHTML='<strong>'+esc("ruflo "+cmd)+'</strong><div class="meta"><span class="tag">source: '+esc(source||"manual")+'</span><span class="tag">'+new Date().toLocaleTimeString()+'</span><span class="tag" data-status>running</span></div>';const actions=document.createElement("div");actions.className="actions";const copy=document.createElement("button");copy.className="mini";copy.textContent="Copy";const kill=document.createElement("button");kill.className="mini kill";kill.textContent="Kill";actions.append(copy,kill);head.append(left,actions);const body=document.createElement("div");body.className="body";body.innerHTML='<span class="stream">Streaming live response...</span>';wrap.append(head,body);transcriptList.prepend(wrap);copy.onclick=()=>{navigator.clipboard.writeText(body.textContent||"");toast("Transcript copied")};toggleEmpty();applyTranscriptFilter();return{wrap:wrap,body:body,kill:kill,status:left.querySelector("[data-status]")};}
function finalize(card,code){const label=code===0?"ok":code===-9?"killed":"exit "+code;card.status.textContent=label;card.wrap.dataset.status=code===0?"ok":code===-9?"killed":"error";applyTranscriptFilter()}
function runCmd(raw,source){const cmd=normalize(raw);if(!cmd)return Promise.resolve();hist=[cmd].concat(hist.filter((x)=>x!==cmd)).slice(0,60);hx=-1;const card=makeCard(cmd,source);const es=new EventSource("/api/run?c="+encodeURIComponent(cmd));let sid=null,first=true;toast("Running "+cmd);return new Promise((resolve)=>{es.onmessage=(ev)=>{let m;try{m=JSON.parse(ev.data)}catch(e){return}sid=m.id;if(m.t==="o"||m.t==="w"||m.t==="e"){if(first){first=false;card.body.textContent=""}card.body.textContent+=m.d;card.body.scrollTop=card.body.scrollHeight}if(m.t==="x"){es.close();finalize(card,m.d);refresh();resolve(m.d)}};es.onerror=()=>{es.close();finalize(card,-1);refresh();resolve(-1)};card.kill.onclick=()=>{if(sid!=null)fetch("/api/kill?id="+sid);es.close();finalize(card,-9);card.body.textContent+="\\n[Killed by user]\\n";refresh();resolve(-9)}})}
async function runSeq(p){toast("Launching "+p.title);for(const step of p.steps)await runCmd(step,p.title);refresh()}
async function stopAll(){try{const r=await fetch("/api/info");const data=await r.json();const running=data.running||[];if(!running.length){toast("No live commands to stop");return;}await Promise.all(running.map((p)=>fetch("/api/kill?id="+p.id)));toast("Stopped "+running.length+" live command"+(running.length===1?"":"s"));refresh()}catch(e){toast("Stop-all failed")}}
function bootMesh(){const canvas=document.getElementById("mesh");if(!canvas)return;const ctx=canvas.getContext("2d");if(!ctx)return;const state={energy:10,nodes:[]};meshState=state;const seed=()=>{const rect=canvas.getBoundingClientRect();canvas.width=Math.max(320,Math.floor(rect.width*window.devicePixelRatio));canvas.height=Math.max(220,Math.floor(rect.height*window.devicePixelRatio));ctx.setTransform(1,0,0,1,0,0);ctx.scale(window.devicePixelRatio,window.devicePixelRatio);const w=rect.width,h=rect.height;state.nodes=Array.from({length:18},(_,i)=>({x:(i%6+1)/7*w,y:(Math.floor(i/6)+1)/4*h,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.24}));};seed();window.addEventListener("resize",seed);const tick=()=>{const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);ctx.fillStyle="rgba(6,14,19,.12)";ctx.fillRect(0,0,w,h);for(let i=0;i<state.nodes.length;i++){const a=state.nodes[i];a.x+=a.vx*(1+state.energy/120);a.y+=a.vy*(1+state.energy/140);if(a.x<18||a.x>w-18)a.vx*=-1;if(a.y<18||a.y>h-18)a.vy*=-1;for(let j=i+1;j<state.nodes.length;j++){const b=state.nodes[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist<150){ctx.strokeStyle="rgba(84,214,213,"+(0.32-dist/520)+")";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}ctx.fillStyle=i%4===0?"rgba(245,165,36,.95)":"rgba(84,214,213,.88)";ctx.beginPath();ctx.arc(a.x,a.y,2.2+state.energy/120,0,Math.PI*2);ctx.fill()}ctx.fillStyle="rgba(245,165,36,.08)";ctx.beginPath();ctx.arc(w*.5,h*.5,44+Math.sin(Date.now()/500)*8+state.energy/30,0,Math.PI*2);ctx.fill();requestAnimationFrame(tick)};tick()}
async function refresh(){try{const r=await fetch("/api/overview");setOverview(await r.json())}catch(e){}}
document.getElementById("runBtn").onclick=()=>{if(ci.value.trim()){runCmd(ci.value,"manual");ci.value=""}};
document.getElementById("clearBtn").onclick=()=>{[].slice.call(transcriptList.querySelectorAll(".run")).forEach((node)=>node.remove());toggleEmpty();toast("Deck cleared")};
document.querySelectorAll("[data-fill]").forEach((n)=>n.onclick=()=>{ci.value=n.getAttribute("data-fill");ci.focus()});
filters.forEach((btn)=>btn.onclick=()=>setFilterState(btn.getAttribute("data-feed-filter")));
copyLastBtn.onclick=()=>{const latest=transcriptList.querySelector(".run .body");if(!latest){toast("No transcript to copy");return;}navigator.clipboard.writeText(latest.textContent||"");toast("Latest transcript copied")};
stopAllBtn.onclick=()=>stopAll();
ci.addEventListener("keydown",(ev)=>{if(ev.key==="Enter"){ev.preventDefault();document.getElementById("runBtn").click()}if(ev.key==="ArrowUp"&&hist.length){ev.preventDefault();hx=Math.min(hx+1,hist.length-1);ci.value=hist[hx]}if(ev.key==="ArrowDown"){ev.preventDefault();hx=Math.max(hx-1,-1);ci.value=hx>=0?hist[hx]:""}});
fillPresets();bootMesh();setFilterState("all");refresh();setInterval(refresh,4000);
</script></body></html>`}

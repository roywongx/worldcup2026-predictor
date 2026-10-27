#!/usr/bin/env node
'use strict';
// 用法：
//   node engine/cli.js fetch                       下载/更新历史比赛数据到 data/history/
//   node engine/cli.js backtest [--from 2017] [--to 2026] [--mode rolling|pre] [--json out.json]
//   node engine/cli.js tune [--train-to 2016]      网格调参（只用训练届次）
//   node engine/cli.js simulate <event-id> [--sims 20000] [--as-of YYYY-MM-DD] [--out web/data/<id>.json]
//   node engine/cli.js events                      列出 engine/events/ 下的赛事
//   node engine/cli.js fetch-clubs [--from 2005]   下载俱乐部联赛 CSV（含当季 fixtures.csv）
//   node engine/cli.js club-tune                   俱乐部网格调参（只用 1314–1617），参数写入 engine/clubmodel.json
//   node engine/cli.js club-backtest [--from 1718 --to 2526]  测试赛季回测，指标写入 engine/clubmodel.json
//   node engine/cli.js simulate-league <league-id> [--sims 20000] [--as-of YYYY-MM-DD] [--out <file>]
const fs = require('fs');
const path = require('path');
const data = require('./data');

const ROOT = path.join(__dirname, '..');
const EVENTS = path.join(__dirname, 'events');
const LEAGUES = path.join(__dirname, 'leagues');
const MODEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));
const CLUB_MODEL_FILE = path.join(__dirname, 'clubmodel.json');
const clubModel = () => (fs.existsSync(CLUB_MODEL_FILE) ? JSON.parse(fs.readFileSync(CLUB_MODEL_FILE, 'utf8')) : { params: {}, tuning: null });

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else out._.push(argv[i]);
  }
  return out;
}

const fmt = s => `n=${s.n} RPS=${s.rps.toFixed(4)} logloss=${s.logLoss.toFixed(4)} brier=${s.brier.toFixed(4)} 命中=${(s.accuracy * 100).toFixed(1)}%`;

async function fetchData() {
  fs.mkdirSync(data.HISTORY_DIR, { recursive: true });
  for (const f of data.FILES) {
    const res = await fetch(`${data.SOURCE}/${f}`);
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(path.join(data.HISTORY_DIR, f), text);
    console.log(`${f}: ${text.split('\n').length - 1} 行`);
  }
  const ms = data.loadMatches();
  console.log(`共 ${ms.length} 场，最新 ${ms[ms.length - 1].date}`);
}

function loadEvent(id) {
  const file = path.join(EVENTS, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`没有赛事 ${id}（engine/events/ 下：${listEvents().join(', ')}）`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// web/data/index.json：页面据此列出已有模拟结果（按开赛日期倒序）
function writeIndex(dir) {
  const items = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const kind = d.kind === 'league' ? 'league' : 'tournament';
    const meta = kind === 'league' ? d.league : d.event;
    return { id: meta.id, name: meta.name, nameZh: meta.nameZh, start: meta.start, end: meta.end, kind, generatedAt: d.generatedAt };
  }).sort((x, y) => (x.start < y.start ? 1 : -1));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(items, null, 1));
}
const listEvents = () => fs.readdirSync(EVENTS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const listLeagues = () => fs.readdirSync(LEAGUES).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

function loadLeague(id) {
  const file = path.join(LEAGUES, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`没有联赛 ${id}（engine/leagues/ 下：${listLeagues().join(', ')}）`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveClubModel(patch) {
  const cur = fs.existsSync(CLUB_MODEL_FILE) ? JSON.parse(fs.readFileSync(CLUB_MODEL_FILE, 'utf8')) : {};
  fs.writeFileSync(CLUB_MODEL_FILE, JSON.stringify({ ...cur, ...patch }, null, 2) + '\n');
}

async function fetchClubsCmd(from) {
  const { fetchClubs, CLUB_DIR } = require('./clubdata');
  await fetchClubs({ from });
  const res = await fetch('https://www.football-data.co.uk/fixtures.csv');
  if (!res.ok) { console.log(`fixtures.csv: HTTP ${res.status}`); return; }
  fs.mkdirSync(CLUB_DIR, { recursive: true });
  fs.writeFileSync(path.join(CLUB_DIR, 'fixtures.csv'), Buffer.from(await res.arrayBuffer()));
  console.log('fixtures.csv ok');
}

function clubTuneCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const { clubTune } = require('./clubbacktest');
  const ms = loadClubMatches();
  const r = clubTune(ms, { log: (o, s) => console.log(JSON.stringify(o), s.rps.toFixed(4)) });
  console.log(`最优 ${JSON.stringify(r.best.opts)} RPS ${r.best.rps.toFixed(4)} n=${r.best.n}（训练 ${r.trainFrom}–${r.trainTo}）`);
  saveClubModel({
    params: r.best.opts,
    tuning: {
      how: `node engine/cli.js club-tune —— 只在训练赛季 ${r.trainFrom}–${r.trainTo}（五大联赛顶级，每 ${r.refitEveryDays} 天重拟合）上网格搜索，选 RPS 最低；测试赛季 1718–2526 只用来报告`,
      train: { fromSeason: r.trainFrom, toSeason: r.trainTo, matches: r.best.n, rps: +r.best.rps.toFixed(4), logLoss: +r.best.logLoss.toFixed(4) },
      grid: require('./clubbacktest').CLUB_GRID,
      candidates: r.results.length,
      refitEveryDays: r.refitEveryDays,
    },
  });
  console.log('参数已写入 engine/clubmodel.json（tuning.train）');
}

function clubBacktestCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const { clubBacktest, summarize } = require('./clubbacktest');
  const ms = loadClubMatches();
  const from = String(a.from || '1718'), to = String(a.to || '2526');
  const params = clubModel().params;
  const rows = clubBacktest(ms, { fromSeason: from, toSeason: to, opts: params });
  const s = summarize(rows);
  const line = (k, x) => `${k.padEnd(18)} n=${String(x.n).padStart(6)} RPS=${x.rps.toFixed(4)} logloss=${x.logLoss.toFixed(4)} brier=${x.brier.toFixed(4)} 命中=${(x.accuracy * 100).toFixed(1)}% ECE=${x.ece == null ? '—' : x.ece.toFixed(4)}`;
  console.log(`赛季 ${from}–${to}，${rows.length} 场，有市场概率 ${s.overall.market.n} 场，数据截至 ${ms[ms.length - 1].date}`);
  console.log(line('模型（全部）', s.overall.model));
  console.log(line('Elo（全部）', s.overall.elo));
  console.log(line('市场（有赔率）', s.overall.market));
  console.log(line('模型（有赔率）', s.overall.modelOnMarketRows));
  console.log(line('Elo（有赔率）', s.overall.eloOnMarketRows));
  for (const d of s.byDivision) console.log('  ', d.key.padEnd(4), '模型', d.model.rps.toFixed(4), '市场', d.market.rps.toFixed(4), 'Elo', d.elo.rps.toFixed(4), 'n', d.model.n);
  const prev = clubModel();
  saveClubModel({
    params: prev.params,
    tuning: {
      ...(prev.tuning || {}),
      test: {
        note: `测试赛季 ${from}–${to}（五大联赛顶级，未参与调参），每 7 天用当天之前的全部俱乐部比赛重拟合`,
        seasons: { from, to },
        model: s.overall.model,
        market: s.overall.market,
        eloBaseline: s.overall.elo,
        modelOnMarketRows: s.overall.modelOnMarketRows,
        eloOnMarketRows: s.overall.eloOnMarketRows,
        byDivision: s.byDivision.map(d => ({ division: d.key, model: d.model.rps, market: d.market.rps, elo: d.elo.rps, n: d.model.n })),
      },
      date: new Date().toISOString().slice(0, 10),
      dataThrough: ms[ms.length - 1].date,
    },
  });
  console.log(`已写入 engine/clubmodel.json（tuning.test，含 ${rows.length} 场的实测指标）`);
}

function simulateLeagueCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const { simulateLeague } = require('./league');
  const id = a._[1];
  if (!id) throw new Error(`用法：simulate-league <league-id>（engine/leagues/ 下：${listLeagues().join(', ')}）`);
  const cfg = loadLeague(id);
  const ms = loadClubMatches();
  const cm = clubModel();
  const out = simulateLeague(ms, cfg, { sims: +(a.sims || 20000), asOf: a['as-of'] || null, modelOpts: cm.params || {} });
  if (cm.tuning && cm.tuning.test) out.validation = cm.tuning.test;
  const file = a.out || path.join(ROOT, 'web', 'data', `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  if (!a.out) writeIndex(path.dirname(file));
  const n = t => (cfg.names && cfg.names[t]) || t;
  console.log(`${cfg.nameZh || cfg.name} ${cfg.season}：${out.sims} 次模拟，模型截至 ${out.asOf}，已赛 ${out.played} 场，剩余 ${out.remaining} 场 → ${path.relative(ROOT, file)}`);
  for (const t of out.teams.slice(0, 6)) {
    console.log(`  ${String(t.position).padStart(2)} ${n(t.team).padEnd(8)} 当前 ${String(t.current.pts).padStart(3)} 分 期望 ${t.expectedPts.toFixed(1)}  夺冠 ${(t.zones.title * 100).toFixed(1)}%  欧冠 ${(t.zones.ucl * 100).toFixed(1)}%  降级 ${((t.zones.relegation || 0) * 100).toFixed(1)}%`);
  }
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'fetch') return fetchData();
  if (cmd === 'fetch-clubs') return fetchClubsCmd(+(a.from || 2005));
  if (cmd === 'club-tune') return clubTuneCmd(a);
  if (cmd === 'club-backtest') return clubBacktestCmd(a);
  if (cmd === 'simulate-league') return simulateLeagueCmd(a);
  if (cmd === 'events') return listEvents().forEach(id => { const e = loadEvent(id); console.log(`${id}\t${e.nameZh || e.name}\t${e.start} ~ ${e.end}`); });

  const matches = data.loadMatches();
  if (cmd === 'backtest') {
    const bt = require('./backtest');
    const eds = bt.selectEditions(matches, { from: +(a.from || 2017), to: +(a.to || 9999) });
    const rows = bt.backtest(matches, eds, MODEL.params, { mode: a.mode || 'rolling' });
    const s = bt.summarize(rows);
    console.log(`届次 ${eds.length}，数据截至 ${matches[matches.length - 1].date}`);
    console.log('模型    ', fmt(s.overall.model));
    console.log('Elo 基线', fmt(s.overall.elo));
    console.log('频率基线', fmt(s.overall.base));
    console.log('校准 ECE', s.calibration.ece.toFixed(4));
    for (const t of s.byTournament) console.log('  ', t.key.padEnd(24), '模型', t.model.rps.toFixed(4), 'Elo', t.elo.rps.toFixed(4), 'n', t.model.n);
    if (a.json) fs.writeFileSync(a.json, JSON.stringify({ params: MODEL.params, summary: s }, null, 1));
    return;
  }
  if (cmd === 'tune') {
    const { tune } = require('./tune');
    const r = tune(matches, { trainTo: +(a['train-to'] || 2016), log: (o, s) => console.log(JSON.stringify(o), s.rps.toFixed(4)) });
    console.log('最优', JSON.stringify(r.best.opts), r.best.rps.toFixed(4), '（写入 engine/model.json 前请先跑 backtest 看测试集）');
    return;
  }
  if (cmd === 'simulate') {
    const { simulate } = require('./simulate');
    const id = a._[1];
    if (!id) throw new Error('用法：simulate <event-id>');
    const ev = loadEvent(id);
    const out = simulate(matches, ev, { sims: +(a.sims || 20000), asOf: a['as-of'] || null, modelOpts: MODEL.params });
    out.validation = MODEL.tuning.test;
    const file = a.out || path.join(ROOT, 'web', 'data', `${id}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
    if (!a.out) writeIndex(path.dirname(file));
    const n = t => (ev.names && ev.names[t]) || t;
    console.log(`${ev.nameZh || ev.name}：${out.sims} 次模拟，模型截至 ${out.asOf}，已赛 ${out.playedMatches} 场 → ${path.relative(ROOT, file)}`);
    for (const t of out.teams.slice(0, 10)) console.log(`  ${n(t.team).padEnd(8)} 夺冠 ${(t.champion * 100).toFixed(1)}%  决赛 ${(t.reach.F * 100).toFixed(1)}%  出线 ${(t.advance * 100).toFixed(1)}%`);
    return;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).join('\n'));
}

main().catch(e => { console.error(e.message); process.exit(1); });

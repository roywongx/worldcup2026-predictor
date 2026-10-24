#!/usr/bin/env node
'use strict';
// 用法：
//   node engine/cli.js fetch                       下载/更新历史比赛数据到 data/history/
//   node engine/cli.js backtest [--from 2017] [--to 2026] [--mode rolling|pre] [--json out.json]
//   node engine/cli.js tune [--train-to 2016]      网格调参（只用训练届次）
//   node engine/cli.js simulate <event-id> [--sims 20000] [--as-of YYYY-MM-DD] [--out web/data/<id>.json]
//   node engine/cli.js events                      列出 engine/events/ 下的赛事
const fs = require('fs');
const path = require('path');
const data = require('./data');

const ROOT = path.join(__dirname, '..');
const EVENTS = path.join(__dirname, 'events');
const MODEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));

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
    return { id: d.event.id, name: d.event.name, nameZh: d.event.nameZh, start: d.event.start, end: d.event.end, generatedAt: d.generatedAt };
  }).sort((x, y) => (x.start < y.start ? 1 : -1));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(items, null, 1));
}
const listEvents = () => fs.readdirSync(EVENTS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'fetch') return fetchData();
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
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 8).join('\n'));
}

main().catch(e => { console.error(e.message); process.exit(1); });

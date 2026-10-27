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
//   node engine/cli.js season-tune                 赛季级调参（σ，只用 1314–1617），写入 clubmodel.json 的 season.train
//   node engine/cli.js season-backtest [--from 1718 --to 2526] [--sims 5000]  赛季级测试赛季回测，写入 season.test
//   node engine/cli.js simulate-league <league-id> [--sims 20000] [--as-of YYYY-MM-DD] [--sigma 0.15] [--out <file>]
//   node engine/cli.js new-season [--season 2728] [--force]  按当季数据生成下赛季联赛配置
//   node engine/cli.js fetch-euro <CL|CLI> [--force]        下载欧战原始数据到 data/uefa/（6 小时缓存）
//   node engine/cli.js simulate-euro <event-id> [--sims 20000] [--as-of YYYY-MM-DD] [--out <file>]
//   node engine/cli.js refresh [--sims 20000]               国家队 + 俱乐部 + 欧战一键刷新（scripts/refresh.sh）
const fs = require('fs');
const path = require('path');
const data = require('./data');
const seasonLib = require('./season');

const ROOT = path.join(__dirname, '..');
const EVENTS = path.join(__dirname, 'events');
// 欧战（欧冠/解放者杯）的赛事配置单独放 events/euro/：events/*.json 是通用「小组+淘汰」赛制，
// 由 engine.test.js 逐个校验（分组、第三名表、首轮槽位），欧战赛制不同，不能混在一起。
const EURO_EVENTS = path.join(EVENTS, 'euro');
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
  const candidates = [path.join(EVENTS, `${id}.json`), path.join(EURO_EVENTS, `${id}.json`)];
  const file = candidates.find(f => fs.existsSync(f));
  if (!file) throw new Error(`没有赛事 ${id}（${[...listEvents(), ...listEuroEvents()].join(', ')}）`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// web/data/index.json：页面据此列出已有模拟结果（按开赛日期倒序）
function writeIndex(dir) {
  const kinds = new Set(['league', 'swiss', 'groups2leg']);
  const items = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const kind = kinds.has(d.kind) ? d.kind : 'tournament';
    const meta = kind === 'tournament' ? d.event : d.league;
    return { id: meta.id, name: meta.name, nameZh: meta.nameZh, start: meta.start, end: meta.end, kind, generatedAt: d.generatedAt };
  }).sort((x, y) => (x.start < y.start ? 1 : -1));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(items, null, 1));
}
const listEvents = () => fs.readdirSync(EVENTS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const listEuroEvents = () => (fs.existsSync(EURO_EVENTS) ? fs.readdirSync(EURO_EVENTS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : []);
const listAllEvents = () => [...listEvents(), ...listEuroEvents()];
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

/** 联赛模拟结果（σ 默认取 clubmodel 的 params.seasonSigma）；不落盘。 */
function buildLeagueOut(cfg, ms, { sims = 20000, asOf = null, sigma = null } = {}) {
  const { simulateLeague } = require('./league');
  const cm = clubModel();
  const s = sigma != null ? +sigma : (cm.params && cm.params.seasonSigma != null ? +cm.params.seasonSigma : 0);
  const out = simulateLeague(ms, cfg, { sims, asOf, modelOpts: cm.params || {}, sigma: s });
  if (cm.tuning && cm.tuning.test) out.validation = { ...cm.tuning.test, ...(cm.season && cm.season.test ? { season: cm.season.test } : {}) };
  return out;
}

/** 写页面数据并重建 index.json。 */
function writePageData(out, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  writeIndex(path.dirname(file));
}

function simulateLeagueCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const id = a._[1];
  if (!id) throw new Error(`用法：simulate-league <league-id>（engine/leagues/ 下：${listLeagues().join(', ')}）`);
  const cfg = loadLeague(id);
  const ms = loadClubMatches();
  const out = buildLeagueOut(cfg, ms, { sims: +(a.sims || 20000), asOf: a['as-of'] || null, sigma: a.sigma != null ? +a.sigma : null });
  const file = a.out || path.join(ROOT, 'web', 'data', `${id}.json`);
  if (a.out) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
  } else writePageData(out, file);
  const n = t => (cfg.names && cfg.names[t]) || t;
  console.log(`${cfg.nameZh || cfg.name} ${cfg.season}：${out.sims} 次模拟，σ=${out.sigma}，模型截至 ${out.asOf}，已赛 ${out.played} 场，剩余 ${out.remaining} 场 → ${path.relative(ROOT, file)}`);
  for (const t of out.teams.slice(0, 6)) {
    console.log(`  ${String(t.position).padStart(2)} ${n(t.team).padEnd(8)} 当前 ${String(t.current.pts).padStart(3)} 分 期望 ${t.expectedPts.toFixed(1)}  夺冠 ${(t.zones.title * 100).toFixed(1)}%  欧冠 ${(t.zones.ucl * 100).toFixed(1)}%  降级 ${((t.zones.relegation || 0) * 100).toFixed(1)}%`);
  }
}

/**
 * 拟合池：2026-10-28 实测加入葡超/荷甲/比甲/苏超两级/土超/希超后，五大联赛测试集 RPS 0.200181 → 0.200218
 * （+0.000037）、log-loss 0.985091 → 0.985190，远小于 0.002 的判定线 → 单池（全部级别一起拟合）。
 * 若以后要改回双池，把 SINGLE_POOL 改成 false：欧战仍用全部级别，国内联赛只用原有级别。
 */
const SINGLE_POOL = true;
const LEGACY_DIVISIONS = ['E0', 'E1', 'SP1', 'SP2', 'D1', 'D2', 'I1', 'I2', 'F1', 'F2'];
const poolDivisions = () => (SINGLE_POOL ? null : LEGACY_DIVISIONS);

/** 按 code（CL / CLI）找赛事配置：取它的 apiSeason 与内部 season 代码。 */
function euroCfgForCode(code) {
  for (const id of listEuroEvents()) {
    const c = loadEvent(id);
    if (c.code === code) return c;
  }
  throw new Error(`engine/events/ 里没有 code=${code} 的赛事（现有：${listEvents().join(', ')}）`);
}

async function fetchEuroCmd(a) {
  const { fetchEuro, readEuro, parseEuro, upcomingEuro } = require('./eurodata');
  const code = a._[1] || a.code;
  if (!code) throw new Error('用法：fetch-euro <CL|CLI> [--force]');
  const cfg = euroCfgForCode(String(code).toUpperCase());
  const apiSeason = +(a.season || cfg.apiSeason);
  const r = await fetchEuro(cfg.code, { apiSeason, force: !!a.force });
  const raw = readEuro(cfg.code, apiSeason);
  const ms = parseEuro(raw, cfg.code, cfg.season);
  const up = upcomingEuro(raw);
  const last = ms.length ? ms[ms.length - 1].date : '—';
  console.log(`${cfg.nameZh || cfg.name}：已赛 ${ms.length} 场（最新 ${last}），未开赛 ${up.length} 场${r.cached ? '（缓存）' : ''}`);
  return { cfg, apiSeason };
}

/** 欧战模拟结果（σ 默认取 clubmodel 的 params.seasonSigma）；不落盘。 */
function buildEuroOut(cfg, domestic, { sims = 20000, asOf = null, sigma = null } = {}) {
  const { readEuro, parseEuro, upcomingEuro } = require('./eurodata');
  const { simulateSwiss, simulateGroups2leg, euroPool } = require('./euro');
  const cm = clubModel();
  const s = sigma != null ? +sigma : (cm.params && cm.params.seasonSigma != null ? +cm.params.seasonSigma : 0);
  const raw = readEuro(cfg.code, cfg.apiSeason);
  const euroMs = parseEuro(raw, cfg.code, cfg.season);
  const upcoming = upcomingEuro(raw);
  const pool = euroPool(domestic, euroMs, cfg, { divisions: poolDivisions() });
  const run = cfg.kind === 'swiss' ? simulateSwiss : simulateGroups2leg;
  const out = run(euroMs, upcoming, cfg, { sims, asOf, modelOpts: cm.params || {}, sigma: s, pool });
  out.marketAvailable = false;
  if (cm.tuning && cm.tuning.test) out.validation = { ...cm.tuning.test, ...(cm.season && cm.season.test ? { season: cm.season.test } : {}) };
  return out;
}

function simulateEuroCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const id = a._[1];
  if (!id) throw new Error(`用法：simulate-euro <event-id>（engine/events/ 下：${listEvents().join(', ')}）`);
  const cfg = loadEvent(id);
  if (cfg.kind !== 'swiss' && cfg.kind !== 'groups2leg') throw new Error(`${id} 不是欧战赛事（kind=${cfg.kind || 'tournament'}）`);
  const ms = loadClubMatches();
  const out = buildEuroOut(cfg, ms, { sims: +(a.sims || 20000), asOf: a['as-of'] || null, sigma: a.sigma != null ? +a.sigma : null });
  const file = a.out || path.join(ROOT, 'web', 'data', `${id}.json`);
  if (a.out) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
  } else writePageData(out, file);
  const n = t => (cfg.names && cfg.names[t]) || t;
  console.log(`${cfg.nameZh || cfg.name} ${cfg.season}：${out.sims} 次模拟，σ=${out.sigma}，模型截至 ${out.asOf}，已赛 ${out.played} 场，剩余 ${out.remaining} 场 → ${path.relative(ROOT, file)}`);
  if (out.kind === 'swiss') {
    for (const t of out.teams.slice(0, 8)) {
      console.log(`  ${String(t.position).padStart(2)} ${n(t.team).padEnd(10)} ${String(t.current.pts).padStart(3)} 分 期望 ${t.expectedPts.toFixed(1)}  直接16强 ${(t.bands.r16 * 100).toFixed(1)}%  附加赛 ${(t.bands.playoff * 100).toFixed(1)}%  夺冠 ${(t.knockout.title * 100).toFixed(1)}%`);
    }
    const top = out.teams.slice().sort((x, y) => y.knockout.title - x.knockout.title).slice(0, 5);
    console.log('  夺冠前 5：' + top.map(t => `${n(t.team)} ${(t.knockout.title * 100).toFixed(1)}%`).join('，'));
  } else {
    for (const g of Object.keys(out.groups)) {
      const rows = out.teams.filter(t => t.group === g).sort((x, y) => x.position - y.position).slice(0, 2);
      console.log(`  ${g} 组：${rows.map(t => `${n(t.team)} ${t.current.pts} 分（出线 ${(t.advance * 100).toFixed(0)}%）`).join('，')}`);
    }
    // 淘汰赛已经踢到只剩少数几队时，只列真正还有夺冠概率的球队
    const alive = out.teams.filter(t => t.champion > 0.0005).sort((x, y) => y.champion - x.champion);
    const top = (alive.length ? alive : out.teams.slice().sort((x, y) => y.champion - x.champion)).slice(0, 5);
    console.log('  夺冠前 5：' + top.map(t => `${n(t.team)} ${(t.champion * 100).toFixed(1)}%`).join('，'));
  }
}

/** engine/leagues/*.json 按 division 建立 { tiebreak }；历史赛季的队名用当季数据。 */function seasonCfg() {
  const out = {};
  for (const id of listLeagues()) { const c = loadLeague(id); out[c.division] = { tiebreak: c.tiebreak }; }
  return out;
}

function seasonTuneCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const { seasonTune } = require('./seasonbacktest');
  const ms = loadClubMatches();
  const cm = clubModel();
  const grid = a.grid ? String(a.grid).split(',').map(Number) : undefined;
  const r = seasonTune(ms, seasonCfg(), {
    trainFrom: String(a['train-from'] || '1314'), trainTo: String(a['train-to'] || '1617'),
    sims: +(a.sims || 2000), grid, modelOpts: cm.params || {},
    log: x => console.log(`σ=${x.sigma.toFixed(2)} 目标(Brier 均值)=${x.objective.toFixed(5)} title=${x.title.toFixed(5)} top4=${x.top4.toFixed(5)} bottom3=${x.bottom3.toFixed(5)} logloss=${x.logLoss.toFixed(4)} RMSE积分=${x.rmsePts.toFixed(3)} n=${x.n}`),
  });
  console.log(`最优 σ=${r.best.sigma}（训练 ${r.trainFrom}–${r.trainTo}，${r.sims} 次模拟，目标 ${r.best.objective.toFixed(5)}）`);
  saveClubModel({
    params: { ...cm.params, seasonSigma: r.best.sigma },
    season: {
      ...(cm.season || {}),
      train: {
        how: `node engine/cli.js season-tune —— 只在训练赛季 ${r.trainFrom}–${r.trainTo}（五大联赛顶级，检查点 ${r.checkpoints.join('/')}）上选 σ；目标 = title / top4 / bottom3 三个区间 Brier 的平均（检查点合并），测试赛季 1718–2526 只用来报告`,
        fromSeason: r.trainFrom, toSeason: r.trainTo,
        checkpoints: r.checkpoints, sims: r.sims, n: r.n,
        objective: 'mean Brier (title/top4/bottom3, checkpoints pooled)',
        candidates: r.results.map(x => ({ sigma: x.sigma, objective: x.objective, title: x.title, top4: x.top4, bottom3: x.bottom3, logLoss: x.logLoss, rmsePts: x.rmsePts })),
        best: { sigma: r.best.sigma, objective: r.best.objective },
        skippedSeasons: r.skipped.length,
      },
    },
  });
  console.log('σ 已写入 engine/clubmodel.json（params.seasonSigma 与 season.train）');
}

function seasonBacktestCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const { seasonBacktest } = require('./seasonbacktest');
  const ms = loadClubMatches();
  const cm = clubModel();
  const from = String(a.from || '1718'), to = String(a.to || '2526'), sims = +(a.sims || 5000);
  const sigma = cm.params && cm.params.seasonSigma != null ? +cm.params.seasonSigma : 0;
  const sigmas = sigma > 0 ? [0, sigma] : [0];
  console.log(`赛季级测试 ${from}–${to}：σ ∈ ${sigmas.join(', ')}，每个检查点 ${sims} 次模拟，数据截至 ${ms[ms.length - 1].date}`);
  let k = 0;
  const r = seasonBacktest(ms, seasonCfg(), {
    fromSeason: from, toSeason: to, sigmas, sims, modelOpts: cm.params || {},
    log: x => { if (++k % 20 === 0) console.log(`  已拟合 ${k} 个联赛×赛季×检查点（最新 ${x.division} ${x.season} ${x.asOf}）`); },
  });

  const pct = x => (x * 100).toFixed(1) + '%';
  const row = x => `${('σ=' + x.sigma).padEnd(8)} title ${x.title.brier.toFixed(4)} / ${x.title.logLoss.toFixed(4)}  top4 ${x.top4.brier.toFixed(4)} / ${x.top4.logLoss.toFixed(4)}  bottom3 ${x.bottom3.brier.toFixed(4)} / ${x.bottom3.logLoss.toFixed(4)}  平均 ${x.meanBrier.toFixed(4)}  RMSE积分 ${x.rmsePts.toFixed(3)}`;
  console.log(`\n区间 Brier / log-loss（n=${r.n} 个球队-赛季-检查点，${r.checkpoints.join('/')}，跳过 ${r.skipped.length} 个不完整赛季）：`);
  for (const x of r.bySigma) console.log('  ' + row(x));
  for (const x of r.bySigma) {
    console.log(`\ntitle 校准（σ=${x.sigma}）：区间 n 平均预测 实际频率`);
    for (const b of x.calibration.title) {
      if (!b.n) continue;
      console.log(`  ${(b.lo * 100).toFixed(0)}–${(b.hi * 100).toFixed(0)}%  ${String(b.n).padStart(4)}  ${pct(b.pred)}  ${pct(b.freq)}`);
    }
  }
  for (const x of r.bySigma) console.log(`\nσ=${x.sigma} 分检查点：` + x.byCheckpoint.map(c => `${c.checkpoint} n=${c.n} title ${c.title.brier.toFixed(4)} top4 ${c.top4.brier.toFixed(4)} bottom3 ${c.bottom3.brier.toFixed(4)}`).join(' | '));
  if (r.skipped.length) console.log(`\n跳过：` + r.skipped.map(s => `${s.division} ${s.season}（${s.matches}/${s.expected} 场，${s.teams} 队）`).join('，'));

  const group = x => ({
    sigma: x.sigma, n: x.n, title: x.title, top4: x.top4, bottom3: x.bottom3,
    meanBrier: x.meanBrier, rmsePts: x.rmsePts, calibration: x.calibration, byCheckpoint: x.byCheckpoint,
  });
  saveClubModel({
    season: {
      ...(cm.season || {}),
      test: {
        note: `测试赛季 ${from}–${to}（五大联赛顶级，未参与调参）；每赛季 3 个检查点，检查点之前只用真实比分，之后只用于评分`,
        seasons: { from, to }, seasonCount: r.seasonCount, divisionSeasons: r.divisionSeasons,
        checkpoints: r.checkpoints, n: r.n, sims: r.sims,
        fixed: group(r.bySigma[0]),
        withSigma: group(r.bySigma[r.bySigma.length - 1]),
        skipped: r.skipped, notes: r.notes,
        date: new Date().toISOString().slice(0, 10),
        dataThrough: ms[ms.length - 1].date,
      },
    },
  });
  console.log(`\n已写入 engine/clubmodel.json（season.test）`);
}

/** 新赛季：按数据里已出现的当季球队生成下赛季配置（每个 division 取赛季代码最大的配置当模板）。 */
function newSeasonCmd(a) {
  const { loadClubMatches } = require('./clubdata');
  const templates = new Map();
  for (const id of listLeagues()) {
    const c = loadLeague(id);
    const cur = templates.get(c.division);
    if (!cur || c.season > cur.season) templates.set(c.division, c);
  }
  const latest = [...templates.values()].map(c => c.season).sort().pop();
  const code = a.season ? String(a.season) : seasonLib.nextSeasonCode(latest);
  seasonLib.seasonYears(code); // 格式不对直接抛错，不做半成品
  let ms;
  try { ms = loadClubMatches(); } catch (e) { throw new Error(`${e.message}（新赛季配置必须基于已下载的比赛数据）`); }

  const failures = [];
  const warnings = [];
  const wrote = [];
  for (const tpl of templates.values()) {
    try {
      const teams = seasonLib.teamsForSeason(ms, tpl.division, code);
      const plan = seasonLib.newSeasonPlan(tpl, { season: code, teams, force: !!a.force });
      if (plan.block) { failures.push(plan.message); continue; }
      if (!plan.write) { warnings.push(plan.message); continue; }
      const cfg = plan.cfg;
      if (plan.level === 'warn') console.warn(`⚠ ${plan.message}`);
      const file = seasonLib.writeSeasonConfig(LEAGUES, cfg, { force: !!a.force });
      const missing = seasonLib.missingNames(teams, tpl.names);
      console.log(`${path.relative(ROOT, file)}：${cfg.teams} 队，${cfg.zones.map(z => `${z.key} ${z.from}–${z.to}`).join('，')}`);
      if (missing.length) console.log(`  ⚠ ${cfg.division}：这些队名没有中文名（不阻断，页面回落英文）：${missing.join('、')}`);
      wrote.push(`${cfg.id}（${cfg.teams} 队）`);
    } catch (e) {
      failures.push(`${tpl.division}：${e.message}`);
    }
  }
  for (const w of warnings) console.warn(`⚠ 未写入：${w}`);
  if (failures.length || warnings.length) {
    for (const f of failures) console.error(`✗ ${f}`);
    console.error(`新赛季 ${code}：写入 ${wrote.length} 份，失败 ${failures.length} 个、待确认 ${warnings.length} 个 division`);
    if (failures.length) process.exitCode = 1;
    return;
  }
  console.log(`新赛季 ${code}：写入 ${wrote.length} 份配置 —— ${wrote.join('，')}；下一步 node engine/cli.js refresh`);
}

/**
 * 一键刷新：国家队赛事数据 → 在赛赛事模拟；俱乐部数据 → 在赛联赛模拟；欧战数据 → 在赛欧战模拟。
 * 「今天」用上海日期；单个赛事/联赛失败只记录，最后非零退出。scripts/refresh.sh 只调这一条。
 */
async function refreshCmd(a) {
  const sims = +(a.sims || 20000);
  const today = seasonLib.shanghaiToday();
  const failures = [];
  const tours = [], leagues = [], euros = [];

  try { await fetchData(); } catch (e) {
    // 下载失败但本地已有历史数据：不当作致命错误（否则一次网络抖动会让联赛/欧战都不刷新），
    // 但要大声说出来，并在结尾的汇总里带上数据截止日。
    let local = [];
    try { local = data.loadMatches(); } catch (e2) { local = []; }
    if (local.length) console.warn(`⚠ 国家队数据下载失败（${e.message}），沿用本地 data/history 的历史数据（截至 ${local[local.length - 1].date}）`);
    else failures.push(`国家队数据：${e.message}`);
  }
  let matches = [];
  try { matches = data.loadMatches(); } catch (e) { failures.push(`国家队数据：${e.message}`); }
  const nationalThrough = matches.length ? matches[matches.length - 1].date : null;

  const { simulate } = require('./simulate');
  const euroEvents = new Set();
  for (const id of listAllEvents()) {
    const ev = loadEvent(id);
    // 欧战赛事（欧冠/解放者杯）在俱乐部数据下载之后再处理，拟合池要含国内联赛
    if (ev.kind === 'swiss' || ev.kind === 'groups2leg') { euroEvents.add(id); continue; }
    if (!seasonLib.isEventActive(ev, today)) { console.log(`跳过 ${id}：赛事 ${ev.end} 已结束`); continue; }
    try {
      const out = simulate(matches, ev, { sims, asOf: null, modelOpts: MODEL.params });
      out.validation = MODEL.tuning.test;
      writePageData(out, path.join(ROOT, 'web', 'data', `${id}.json`));
      tours.push(`${ev.nameZh || ev.name} 已赛 ${out.playedMatches} 场`);
    } catch (e) { failures.push(`${id}：${e.message}`); }
  }

  try { await fetchClubsCmd(); } catch (e) { failures.push(`俱乐部数据：${e.message}`); }
  let clubMs = [];
  try {
    const { loadClubMatches } = require('./clubdata');
    clubMs = loadClubMatches();
  } catch (e) { failures.push(`俱乐部数据：${e.message}`); }
  const clubThrough = clubMs.length ? clubMs[clubMs.length - 1].date : null;

  for (const id of listLeagues()) {
    const cfg = loadLeague(id);
    const st = seasonLib.leagueSeasonState(cfg, clubMs, today);
    if (!st.hasMatches) { console.log(`跳过 ${id}：数据里还没有 ${cfg.season} 的比赛`); continue; }
    if (st.ended) { console.log(`跳过 ${id}：赛季已于 ${st.end} 结束`); continue; }
    try {
      const out = buildLeagueOut(cfg, clubMs, { sims });
      writePageData(out, path.join(ROOT, 'web', 'data', `${id}.json`));
      leagues.push(`${cfg.nameZh || cfg.name} 已赛 ${out.played} 场`);
    } catch (e) { failures.push(`${id}：${e.message}`); }
  }

  // 欧战：先 fetch-euro 再 simulate-euro（同一赛事一个 code）
  for (const id of euroEvents) {
    const cfg = loadEvent(id);
    if (!seasonLib.isEventActive(cfg, today)) { console.log(`跳过 ${id}：赛事 ${cfg.end} 已结束`); continue; }
    try {
      await fetchEuroCmd({ _: ['fetch-euro', cfg.code], force: true });
      const out = buildEuroOut(cfg, clubMs, { sims });
      writePageData(out, path.join(ROOT, 'web', 'data', `${id}.json`));
      euros.push(`${cfg.nameZh || cfg.name} 已赛 ${out.played} 场`);
    } catch (e) { failures.push(`${id}：${e.message}`); }
  }

  if (failures.length) {
    for (const f of failures) console.error(`✗ ${f}`);
    console.error(`刷新失败 ${failures.length} 项（已完成的部分已写入），今天=${today}`);
    process.exitCode = 1;
    return;
  }
  console.log(`刷新完成（${today}）：国家队赛事 ${tours.length} 个、联赛 ${leagues.length} 个、欧洲 ${euros.length} 个 —— ${[...tours, ...leagues, ...euros].join('；')}；数据截至 国家队 ${nationalThrough} / 俱乐部 ${clubThrough}`);
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'fetch') return fetchData();
  if (cmd === 'fetch-clubs') return fetchClubsCmd(+(a.from || 2005));
  if (cmd === 'club-tune') return clubTuneCmd(a);
  if (cmd === 'club-backtest') return clubBacktestCmd(a);
  if (cmd === 'season-tune') return seasonTuneCmd(a);
  if (cmd === 'season-backtest') return seasonBacktestCmd(a);
  if (cmd === 'simulate-league') return simulateLeagueCmd(a);
  if (cmd === 'fetch-euro') return fetchEuroCmd(a);
  if (cmd === 'simulate-euro') return simulateEuroCmd(a);
  if (cmd === 'new-season') return newSeasonCmd(a);
  if (cmd === 'refresh') return refreshCmd(a);
  if (cmd === 'events') return listAllEvents().forEach(id => { const e = loadEvent(id); console.log(`${id}\t${e.nameZh || e.name}\t${e.start} ~ ${e.end}`); });

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
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 16).join('\n'));
}

main().catch(e => { console.error(e.message); if (process.env.DEBUG) console.error(e.stack); process.exit(1); });

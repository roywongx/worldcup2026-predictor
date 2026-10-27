'use strict';
// 欧战数据：football-data.org v4（免费档，只有比赛与比分，没有赔率）。
// 欧冠（CL，联赛阶段）与解放者杯（CLI，小组赛 + 两回合淘汰赛）的原始响应缓存到 data/uefa/<code>-<season>.json，
// 该目录不入库；缓存 6 小时内不联网；请求间隔 ≥1.2 秒；429 等 60 秒重试一次，仍失败就报错（不拿旧缓存冒充新数据）。
const fs = require('fs');
const path = require('path');
const { toDay } = require('./data');

const EURO_DIR = path.join(__dirname, '..', 'data', 'uefa');
const KEY_FILE = path.join(__dirname, '..', 'data', 'api-keys.json');
const BASE = 'https://api.football-data.org/v4/competitions';
const CODES = { CL: 'UEFA Champions League', CLI: 'Copa Libertadores' };

const CACHE_MS = 6 * 3600 * 1000;
const MIN_GAP_MS = 1200;
const RETRY_AFTER_MS = 60 * 1000;

const STATUS_FINISHED = new Set(['FINISHED', 'AWARDED']);
const STATUS_UPCOMING = new Set(['SCHEDULED', 'TIMED']);
const NO_GROUP = new Set(['GROUP_STAGE', 'LEAGUE_STAGE']);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** data/api-keys.json 里的 football-data key（文件已 gitignore，绝不打印内容）。 */
function apiKey(file = KEY_FILE) {
  if (!fs.existsSync(file)) {
    throw new Error(`缺少 ${path.relative(path.join(__dirname, '..'), file)}（football-data.org v4 的 X-Auth-Token）；` +
      `把 {"football-data": "<key>"} 写进该文件，它已被 .gitignore 忽略，不要提交`);
  }
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${path.basename(file)} 不是合法 JSON：${e.message}`); }
  const key = json['football-data'] || json.footballData || json.football_data;
  if (!key || typeof key !== 'string') throw new Error(`${path.basename(file)} 里没有 football-data 字段（football-data.org 的 X-Auth-Token）`);
  return key;
}

const cachePath = (code, apiSeason, dir = EURO_DIR) => path.join(dir, `${code}-${apiSeason}.json`);

/** 缓存年龄（毫秒）；没有缓存返回 null。 */
function cacheAge(code, apiSeason, { dir = EURO_DIR } = {}) {
  const file = cachePath(code, apiSeason, dir);
  if (!fs.existsSync(file)) return null;
  return Date.now() - fs.statSync(file).mtimeMs;
}

let lastRequestAt = 0;
async function throttle() {
  const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * 下载并缓存某赛事某赛季的原始响应。返回 { file, cached }。
 * 有缓存且不足 6 小时 → 直接返回（不联网）；force 忽略缓存新鲜度。
 */
async function fetchEuro(code, { apiSeason = 2026, force = false, retryMs = RETRY_AFTER_MS, log = console.log } = {}) {
  if (!CODES[code]) throw new Error(`不支持的赛事代码 ${code}（${Object.keys(CODES).join(' / ')}）`);
  if (!Number.isInteger(+apiSeason)) throw new Error(`season 应是整数年份（football-data.org 的赛季起点年），收到 ${apiSeason}`);
  const file = cachePath(code, apiSeason);
  const age = cacheAge(code, apiSeason);
  if (!force && age != null && age < CACHE_MS) {
    log(`${code} ${apiSeason}: 缓存 ${Math.round(age / 60000)} 分钟内，跳过网络请求（${path.relative(path.join(__dirname, '..'), file)}）`);
    return { file, cached: true };
  }
  const token = apiKey();
  const url = `${BASE}/${code}/matches?season=${apiSeason}`;
  const get = async () => {
    await throttle();
    const res = await fetch(url, { headers: { 'X-Auth-Token': token } });
    return res;
  };
  let res = await get();
  if (res.status === 429) {
    log(`${code}: HTTP 429（限流），等 ${Math.round(retryMs / 1000)} 秒后重试一次`);
    await sleep(retryMs);
    res = await get();
  }
  if (!res.ok) throw new Error(`${code} ${apiSeason}: HTTP ${res.status}${res.status === 429 ? '（重试后仍被限流）' : ''}`);
  const text = await res.text();
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`${code} ${apiSeason}: 响应不是 JSON（${e.message}）`); }
  if (!Array.isArray(raw.matches)) throw new Error(`${code} ${apiSeason}: 响应里没有 matches 数组`);
  fs.mkdirSync(EURO_DIR, { recursive: true });
  fs.writeFileSync(file, text);
  log(`${code} ${apiSeason}: ${raw.matches.length} 场 → ${path.relative(path.join(__dirname, '..'), file)}`);
  return { file, cached: false };
}

/** 读缓存（不上网）。 */
function readEuro(code, apiSeason, { dir = EURO_DIR } = {}) {
  const file = cachePath(code, apiSeason, dir);
  if (!fs.existsSync(file)) throw new Error(`缺少 ${path.relative(path.join(__dirname, '..'), file)}，先运行 node engine/cli.js fetch-euro ${code}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 去掉点球大战的比分：fullTime 在 duration=PENALTY_SHOOTOUT 时包含点球（已用 2026 解放者杯数据核对）。 */
function goals(score) {
  const ft = score && score.fullTime;
  if (!ft || ft.home == null || ft.away == null) return null;
  const p = score.penalties;
  return [ft.home - (p && p.home != null ? p.home : 0), ft.away - (p && p.away != null ? p.away : 0)];
}

const utcDate = m => String(m.utcDate || '').slice(0, 10);

/** 淘汰赛两回合：同一阶段里同一对球队按日期排序，leg 记 1/2…；小组赛/联赛阶段为 null，单场决赛为 null。 */
function assignLegs(list) {
  const seen = new Map();
  const sorted = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const m of sorted) {
    if (NO_GROUP.has(m.stage) || m.stage === 'FINAL') { m.leg = null; continue; }
    const key = m.stage + '|' + [m.home, m.away].sort().join('|');
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    m.leg = n;
  }
  return list;
}

/**
 * 原始响应 → 比赛数组（字段与 clubdata.loadClubMatches 一致，另加 stage/leg）。
 * 比分含加时、不含点球；点球单独记在 pens / shootoutWinner（不参与比分）。
 */
function parseEuro(raw, code, season) {
  const out = [];
  for (const m of (raw && raw.matches) || []) {
    if (!STATUS_FINISHED.has(m.status)) continue;
    if (!m.homeTeam || !m.awayTeam || !m.homeTeam.name || !m.awayTeam.name) continue;
    const g = goals(m.score);
    if (!g) continue;
    const date = utcDate(m);
    out.push({
      date, day: toDay(date), home: m.homeTeam.name, away: m.awayTeam.name, hg: g[0], ag: g[1],
      tournament: code, division: code, season: String(season), neutral: m.stage === 'FINAL',
      market: null, stage: m.stage || null, leg: null,
      pens: m.score && m.score.penalties && m.score.penalties.home != null
        ? [m.score.penalties.home, m.score.penalties.away] : null,
    });
  }
  out.sort((a, b) => a.day - b.day || String(a.home).localeCompare(String(b.home)));
  return assignLegs(out);
}

/** 未开赛（SCHEDULED / TIMED）：赛程只信 API，不自己造。 */
function upcomingEuro(raw) {
  const out = [];
  for (const m of (raw && raw.matches) || []) {
    if (!STATUS_UPCOMING.has(m.status)) continue;
    if (!m.homeTeam || !m.awayTeam || !m.homeTeam.name || !m.awayTeam.name) continue;
    const date = utcDate(m);
    out.push({
      date, day: toDay(date), utcDate: m.utcDate, stage: m.stage || null, group: m.group || null,
      matchday: m.matchday == null ? null : m.matchday, home: m.homeTeam.name, away: m.awayTeam.name,
      status: m.status, neutral: m.stage === 'FINAL',
    });
  }
  out.sort((a, b) => a.day - b.day || String(a.home).localeCompare(String(b.home)));
  return out;
}

/** 每队在不同写法的归一：把 matches 里的队名按 alias 替换（配置里的 modelNames）。 */
function applyAliases(matches, alias = {}) {
  if (!alias || !Object.keys(alias).length) return matches;
  return matches.map(m => {
    const home = alias[m.home] || m.home, away = alias[m.away] || m.away;
    return home === m.home && away === m.away ? m : { ...m, home, away };
  });
}

module.exports = {
  EURO_DIR, CODES, CACHE_MS, MIN_GAP_MS, STATUS_FINISHED, STATUS_UPCOMING,
  apiKey, cachePath, cacheAge, fetchEuro, readEuro, parseEuro, upcomingEuro, applyAliases, goals, assignLegs,
};

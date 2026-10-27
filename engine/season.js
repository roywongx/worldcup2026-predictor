'use strict';
// 新赛季推导 + 每日刷新的判定规则。这里只做纯计算（除了 writeSeasonConfig 落盘），
// 供 engine/cli.js 与 tests/refresh.test.js 共用：测试不 eval cli.js。
const fs = require('fs');
const path = require('path');
const { seasonBounds } = require('./league');
const { seasonTeams } = require('./clubdata');

const CODE = /^\d{4}$/;

/** '2627' → { start: 2026, end: 2027 }；只接受「起始年后两位 + 次年两位」。 */
function seasonYears(season) {
  const code = String(season);
  if (!CODE.test(code)) throw new Error(`赛季代码应是 4 位（如 2728），收到「${code}」`);
  const start = 2000 + +code.slice(0, 2);
  if (+code.slice(2) !== (start + 1) % 100) throw new Error(`赛季代码「${code}」不是连续两年（第二段应是 ${String((start + 1) % 100).padStart(2, '0')}）`);
  return { start, end: start + 1 };
}

const pad2 = n => String(n % 100).padStart(2, '0');

/** '2627' → '2728' */
function nextSeasonCode(season) {
  const { end } = seasonYears(season);
  return pad2(end) + pad2(end + 1);
}

/** '2728' → '2027-28' */
function seasonLabel(season) {
  const { start, end } = seasonYears(season);
  return `${start}-${pad2(end)}`;
}

/** 'premier-league-2026-27' + '2728' → 'premier-league-2027-28' */
function leagueIdFor(templateId, season) {
  const m = /^(.*)-(\d{4})-(\d{2})$/.exec(String(templateId));
  if (!m) throw new Error(`无法从 id「${templateId}」推导新赛季（期望 <name>-<yyyy>-<yy>）`);
  return `${m[1]}-${seasonLabel(season)}`;
}

/**
 * 按新赛季球队数重算区间，其余键（label/labelEn/未知键）原样保留：
 *   title 恒 1–1；ucl 恒 1–4；relegation 倒数 3 名（N−2..N）；
 *   relegation_playoff 若模板有，取倒数第 3（N−2：18 队→16，20 队→18），此时直接降级只有倒数 2 名
 *   （N−1..N），否则同一名次会被「附加赛」与「降级」重复计入。
 * 这与现有 2627 配置一致（德甲/法甲 18 队：16 打附加赛，17–18 降级），也符合「倒数第 3 名打附加赛」的说法；
 * 任务书里「N−3（20 队时是 17）」与「18 队时是 16」两者不能同时成立，这里取后者。
 */
function deriveZones(zones = [], n) {
  if (!Number.isInteger(n) || n < 4) throw new Error(`球队数应是 ≥ 4 的整数，收到 ${n}`);
  const hasPlayoff = zones.some(z => z.key === 'relegation_playoff');
  return zones.map(z => {
    let from, to;
    if (z.key === 'title') [from, to] = [1, 1];
    else if (z.key === 'ucl') [from, to] = [1, 4];
    else if (z.key === 'relegation') [from, to] = hasPlayoff ? [n - 1, n] : [n - 2, n];
    else if (z.key === 'relegation_playoff') [from, to] = [n - 2, n - 2];
    else [from, to] = [z.from, z.to];
    return { ...z, from, to };
  });
}

/** notes 里写死的队数与降级名次跟着新队数改写（sources 是引用，不动）。 */
function rewriteNotes(notes, { oldTeams, newTeams, zones = [] } = {}) {
  if (typeof notes !== 'string' || !notes) return notes;
  let out = notes;
  if (oldTeams && oldTeams !== newTeams) {
    out = out.replace(new RegExp(`(^|[^\\d])${oldTeams}(?=\\s*队)`, 'g'), `$1${newTeams}`);
  }
  const playoff = zones.find(z => z.key === 'relegation_playoff');
  const rel = zones.find(z => z.key === 'relegation');
  if (playoff) out = out.replace(/第\s*\d+\s*名打保级附加赛/g, `第 ${playoff.from} 名打保级附加赛`);
  if (rel) out = out.replace(/\d+\s*[–-]\s*\d+\s*名直接降级/g, `${rel.from}–${rel.to} 名直接降级`);
  return out;
}

/** 当季出现但 names 里没有的队名（不阻断，页面回落英文）。 */
function missingNames(teams = [], names = {}) {
  return teams.filter(t => !names[t]);
}

/** 当季参赛队；数据里还没有该赛季比赛时给出明确提示（不生成半成品配置）。 */
function teamsForSeason(matches, division, season) {
  const teams = seasonTeams(matches, division, season);
  if (!teams.length) {
    throw new Error(`数据里还没有 ${division} ${season} 赛季的比赛，先跑 node engine/cli.js fetch-clubs（等新赛季踢过一轮再生成配置）`);
  }
  return teams;
}

/** 由模板配置推导新赛季配置（不落盘）。 */
function buildSeasonConfig(template, { season, teams }) {
  const list = teams || [];
  if (!list.length) {
    throw new Error(`数据里还没有 ${template.division} ${season} 赛季的比赛，先跑 node engine/cli.js fetch-clubs（等新赛季踢过一轮再生成配置）`);
  }
  const n = list.length;
  const zones = deriveZones(template.zones, n);
  return {
    ...template,
    id: leagueIdFor(template.id, season),
    season: String(season),
    teams: n,
    zones,
    notes: rewriteNotes(template.notes, { oldTeams: template.teams, newTeams: n, zones }),
  };
}

/** 写 engine/leagues/<id>.json；已存在且没有 --force 时不覆盖。返回路径。 */
function writeSeasonConfig(dir, cfg, { force = false } = {}) {
  const file = path.join(dir, `${cfg.id}.json`);
  if (fs.existsSync(file) && !force) throw new Error(`${cfg.id}.json 已存在，不覆盖（确认要重写加 --force）`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}

/** 上海日期（YYYY-MM-DD）；不用 UTC 日期，「今天」以本地业务日为准。 */
function shanghaiToday(now = new Date()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

/** 国家队赛事是否还没结束（end 当天仍算在赛）。 */
function isEventActive(ev, today) {
  return !!ev && typeof ev.end === 'string' && ev.end >= today;
}

/**
 * 联赛是否该刷新：赛季有比赛、且没到赛季结束日（按 5 月 31 日判断，含当天）。
 * 返回 { played, hasMatches, end, ended, run }。
 */
function leagueSeasonState(cfg, matches = [], today) {
  const played = matches.filter(m => m.division === cfg.division && m.season === cfg.season).length;
  const { end } = seasonBounds(cfg.season);
  const ended = today > end;
  return { played, hasMatches: played > 0, end, ended, run: played > 0 && !ended };
}

module.exports = {
  seasonYears, nextSeasonCode, seasonLabel, leagueIdFor,
  deriveZones, rewriteNotes, missingNames, teamsForSeason, buildSeasonConfig, writeSeasonConfig,
  shanghaiToday, isEventActive, leagueSeasonState,
};

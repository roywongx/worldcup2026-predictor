'use strict';
// 历史比赛数据：martj42/international_results（CC0），1872 年至今全部国家队 A 级赛。
// 文件由 `node engine/cli.js fetch` 下载到 data/history/（不入库）。
const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');
const SOURCE = 'https://raw.githubusercontent.com/martj42/international_results/master';
const FILES = ['results.csv', 'shootouts.csv', 'former_names.csv'];

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const DAY = 86400000;
const toDay = s => Math.floor(Date.parse(s + 'T00:00:00Z') / DAY);

function loadFormerNames(dir) {
  const file = path.join(dir, 'former_names.csv');
  if (!fs.existsSync(file)) return {};
  const map = {};
  for (const r of parseCSV(fs.readFileSync(file, 'utf8'))) map[r.former] = r.current;
  return map;
}

/** 读取全部比赛，按日期升序。比分含加时、不含点球；点球胜者来自 shootouts.csv。 */
function loadMatches(dir = HISTORY_DIR) {
  const file = path.join(dir, 'results.csv');
  if (!fs.existsSync(file)) throw new Error(`缺少 ${file}，先运行 node engine/cli.js fetch`);
  const rename = loadFormerNames(dir);
  const name = t => rename[t] || t;
  const shoot = {};
  const sfile = path.join(dir, 'shootouts.csv');
  if (fs.existsSync(sfile)) {
    for (const r of parseCSV(fs.readFileSync(sfile, 'utf8'))) shoot[`${r.date}|${name(r.home_team)}|${name(r.away_team)}`] = name(r.winner);
  }
  const out = [];
  for (const r of parseCSV(fs.readFileSync(file, 'utf8'))) {
    if (r.home_score === 'NA' || r.home_score === '' || r.away_score === 'NA' || r.away_score === '') continue;
    const home = name(r.home_team), away = name(r.away_team);
    out.push({
      date: r.date, day: toDay(r.date), home, away,
      hg: +r.home_score, ag: +r.away_score,
      tournament: r.tournament, country: r.country,
      neutral: r.neutral === 'TRUE',
      shootoutWinner: shoot[`${r.date}|${home}|${away}`] || null,
    });
  }
  out.sort((a, b) => a.day - b.day);
  return out;
}

/** 把同名赛事按时间断档（>150 天）切成届次：AFCON 2021 在 2022 年踢、Euro 2020 在 2021 年踢也能正确归届。 */
function editions(matches, tournament) {
  const ms = matches.filter(m => m.tournament === tournament);
  const eds = [];
  for (const m of ms) {
    const cur = eds[eds.length - 1];
    if (cur && m.day - cur.end <= 150) { cur.matches.push(m); cur.end = m.day; }
    else eds.push({ tournament, start: m.day, end: m.day, matches: [m] });
  }
  for (const e of eds) {
    e.startDate = e.matches[0].date;
    e.year = +e.startDate.slice(0, 4);
    e.teams = [...new Set(e.matches.flatMap(m => [m.home, m.away]))];
  }
  return eds;
}

module.exports = { HISTORY_DIR, SOURCE, FILES, parseCSV, loadMatches, editions, toDay, DAY };

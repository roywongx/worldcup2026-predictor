'use strict';
// 俱乐部联赛数据：football-data.co.uk（比分 + 赔率，含 Pinnacle 收盘价），按赛季×级别一个 CSV。
// 下载到 data/clubs/<赛季>/<级别>.csv（不入库）。次级联赛只用于给升班马定级。
const fs = require('fs');
const path = require('path');
const { parseCSV, toDay } = require('./data');

const CLUB_DIR = path.join(__dirname, '..', 'data', 'clubs');
const BASE = 'https://www.football-data.co.uk/mmz4281';
const DIVISIONS = {
  E0: 'Premier League', E1: 'Championship', SP1: 'La Liga', SP2: 'Segunda División',
  D1: 'Bundesliga', D2: '2. Bundesliga', I1: 'Serie A', I2: 'Serie B', F1: 'Ligue 1', F2: 'Ligue 2',
};

/** 赛季代码：2005 → '0506' */
const seasonCode = y => String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');

function currentSeasonStart(now = new Date()) {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

async function fetchClubs({ from = 2005, to = currentSeasonStart(), divisions = Object.keys(DIVISIONS), force = false, log = console.log } = {}) {
  for (let y = from; y <= to; y++) {
    const code = seasonCode(y);
    const dir = path.join(CLUB_DIR, code);
    fs.mkdirSync(dir, { recursive: true });
    for (const d of divisions) {
      const file = path.join(dir, `${d}.csv`);
      // 往季数据不再变化：已有就跳过；当季每次都更新
      if (!force && y < to && fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
      const res = await fetch(`${BASE}/${code}/${d}.csv`);
      if (!res.ok) { log(`${code}/${d}: HTTP ${res.status}`); continue; }
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    log(`${code} ok`);
  }
}

function parseDate(s) {
  const [d, m, y] = s.split('/');
  const yyyy = y.length === 2 ? (+y < 50 ? '20' + y : '19' + y) : y;
  return `${yyyy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const num = v => (v === undefined || v === '' ? null : +v);

/** 去掉庄家抽水的三项概率（按比例归一）。 */
function implied(h, d, a) {
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const s = 1 / h + 1 / d + 1 / a;
  return [1 / h / s, 1 / d / s, 1 / a / s];
}

/** 读取全部已下载的俱乐部比赛（按日期升序）。每场带 season、division、市场概率（收盘优先）。 */
function loadClubMatches(dir = CLUB_DIR) {
  if (!fs.existsSync(dir)) throw new Error(`缺少 ${dir}，先运行 node engine/cli.js fetch-clubs`);
  const out = [];
  for (const season of fs.readdirSync(dir).sort()) {
    for (const f of fs.readdirSync(path.join(dir, season)).filter(x => x.endsWith('.csv'))) {
      const text = fs.readFileSync(path.join(dir, season, f), 'latin1').replace(/^﻿|^ï»¿/, '');
      for (const r of parseCSV(text)) {
        if (!r.Date || !r.HomeTeam || r.FTHG === '' || r.FTHG === undefined || r.FTAG === '') continue;
        const date = parseDate(r.Date);
        out.push({
          date, day: toDay(date), home: r.HomeTeam, away: r.AwayTeam, hg: +r.FTHG, ag: +r.FTAG,
          tournament: r.Div || f.slice(0, -4), division: r.Div || f.slice(0, -4), season, neutral: false,
          market: implied(num(r.PSCH), num(r.PSCD), num(r.PSCA)) || implied(num(r.AvgCH), num(r.AvgCD), num(r.AvgCA))
            || implied(num(r.PSH), num(r.PSD), num(r.PSA)) || implied(num(r.AvgH), num(r.AvgD), num(r.AvgA)),
        });
      }
    }
  }
  out.sort((a, b) => a.day - b.day);
  return out;
}

/** 当季某级别的参赛队（来自当季 CSV 里出现过的所有队）。 */
function seasonTeams(matches, division, season) {
  return [...new Set(matches.filter(m => m.division === division && m.season === season).flatMap(m => [m.home, m.away]))].sort();
}

module.exports = { CLUB_DIR, DIVISIONS, seasonCode, currentSeasonStart, fetchClubs, loadClubMatches, seasonTeams, implied, parseDate };

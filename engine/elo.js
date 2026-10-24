'use strict';
// World Football Elo（eloratings.net 公式）：K 按赛事级别，净胜球放大，主场 +100。

const MAJOR_FINALS = new Set([
  'FIFA World Cup', 'UEFA Euro', 'Copa América', 'African Cup of Nations',
  'AFC Asian Cup', 'Gold Cup', 'Confederations Cup', 'Oceania Nations Cup',
]);

function kFactor(tournament) {
  if (tournament === 'FIFA World Cup') return 60;
  if (MAJOR_FINALS.has(tournament)) return 50;
  if (/qualification|Nations League/.test(tournament)) return 40;
  if (tournament === 'Friendly') return 20;
  return 30;
}

function goalMultiplier(diff) {
  const d = Math.abs(diff);
  if (d <= 1) return 1;
  if (d === 2) return 1.5;
  return (11 + d) / 8;
}

const HOME_ADV = 100;
const INITIAL = 1500;

function expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }

/**
 * 按时间顺序滚动计算 Elo。onBefore(m, ratings) 在每场比赛更新前回调（回测用来取赛前评分）。
 * 返回 Map(team → rating)。
 */
function runElo(matches, { onBefore, until } = {}) {
  const r = new Map();
  const get = t => (r.has(t) ? r.get(t) : INITIAL);
  for (const m of matches) {
    if (until != null && m.day >= until) break;
    if (onBefore) onBefore(m, r);
    const ra = get(m.home), rb = get(m.away);
    const adv = m.neutral ? 0 : HOME_ADV;
    const we = expected(ra + adv, rb);
    const w = m.hg > m.ag ? 1 : m.hg < m.ag ? 0 : 0.5;
    const delta = kFactor(m.tournament) * goalMultiplier(m.hg - m.ag) * (w - we);
    r.set(m.home, ra + delta);
    r.set(m.away, rb - delta);
  }
  return r;
}

module.exports = { runElo, expected, kFactor, goalMultiplier, HOME_ADV, INITIAL, MAJOR_FINALS };

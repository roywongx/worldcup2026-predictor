// World Cup 2026 Predictor — extracted module
// model/monte-carlo.js — Monte Carlo simulation engine
window.WC26 = window.WC26 || {};

/** Apply a match result to group standings (mutates st in place) */
WC26.applyGroupResult = function(st, grp, team1, team2, score1, score2) {
  const a = st[grp][team1], b = st[grp][team2];
  a.p++; b.p++;
  a.gf += score1; a.ga += score2; b.gf += score2; b.ga += score1;
  a.gd = a.gf - a.ga; b.gd = b.gf - b.ga;
  if (score1 > score2) { a.w++; a.pts += 3; b.l++; }
  else if (score1 < score2) { b.w++; b.pts += 3; a.l++; }
  else { a.d++; a.pts++; b.d++; b.pts++; }
};

/** Find the 8 best third-place teams across all groups */
WC26.findBestThirds = function(groupStandings) {
  const thirds = [];
  for (const g of WC26.GROUPS) {
    const t = groupStandings[g][2];
    thirds.push({ team: t.team, group: g, pts: t.pts, gd: t.gd, gf: t.gf });
  }
  thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  return thirds.slice(0, 8).map(t => t.team);
};

/** Get sorted group letters of the 8 qualifying third-place teams */
WC26.getThirdPlaceGroups = function(bestThirdTeams, rankings) {
  const groups = [];
  for (const g of WC26.GROUPS) {
    if (rankings[g] && rankings[g].length >= 3) {
      const thirdTeam = rankings[g][2];
      if (bestThirdTeams.includes(thirdTeam)) {
        groups.push(g);
      }
    }
  }
  return groups.sort();
};

/** Build R32 bracket using FIFA Annex C 495-combination matrix */
WC26.buildKOBracket = function(rankings, bestThirds, thirdPlaceGroups) {
  const comboKey = thirdPlaceGroups ? thirdPlaceGroups.slice().sort().join("") : "";
  const matrixEntry = WC26.TPM[comboKey];

  const thirdMap = {};
  for (const g of WC26.GROUPS) {
    if (rankings[g] && rankings[g].length >= 3) thirdMap[g] = rankings[g][2];
  }

  const W_SLOTS = ['A','B','D','E','G','I','K','L'];
  const bracket = [];
  const usedGroups = new Set();

  function assignThirdGroupsToWinners() {
    if (matrixEntry && matrixEntry.length >= 8) {
      const mapped = matrixEntry.slice(0, 8).split('');
      if (mapped.every((tg, i) => thirdMap[tg] && tg !== W_SLOTS[i]) && new Set(mapped).size === 8) {
        return mapped;
      }
    }

    const qualified = (thirdPlaceGroups || []).filter(g => thirdMap[g]);
    const assigned = Array(W_SLOTS.length).fill(null);
    const used = new Set();

    function backtrack(slot) {
      if (slot === W_SLOTS.length) return true;
      const wg = W_SLOTS[slot];
      for (const tg of qualified) {
        if (tg === wg || used.has(tg)) continue;
        assigned[slot] = tg;
        used.add(tg);
        if (backtrack(slot + 1)) return true;
        used.delete(tg);
        assigned[slot] = null;
      }
      return false;
    }

    return backtrack(0) ? assigned : [];
  }
  const thirdAssignments = assignThirdGroupsToWinners();

  // 8 matches: group winners vs third-place teams
  for (let i = 0; i < 8; i++) {
    const wg = W_SLOTS[i];
    bracket.push(rankings[wg][0]);
    usedGroups.add(wg + 'W');

    const tg = thirdAssignments[i];
    const thirdTeam = tg ? thirdMap[tg] : null;
    if (thirdTeam && tg !== wg) {
      bracket.push(thirdTeam);
    } else {
      bracket.push(rankings[wg][1]);
      usedGroups.add(wg + 'R');
    }
  }

  // 4 matches: remaining group winners vs runners-up (cross-group)
  const remainingWinners = WC26.GROUPS.filter(g => !usedGroups.has(g + 'W'));
  const usedRunners = new Set();
  for (const g of [...usedGroups].filter(x => x.endsWith('R')).map(x => x[0])) usedRunners.add(g);

  for (const wg of remainingWinners) {
    let assigned = false;
    for (const rg of WC26.GROUPS) {
      if (rg === wg || usedRunners.has(rg)) continue;
      bracket.push(rankings[wg][0], rankings[rg][1]);
      usedRunners.add(rg);
      assigned = true;
      break;
    }
    if (!assigned) {
      for (const rg of WC26.GROUPS) {
        if (!usedRunners.has(rg)) {
          bracket.push(rankings[wg][0], rankings[rg][1]);
          usedRunners.add(rg);
          break;
        }
      }
    }
  }

  // 4 matches: remaining runners-up vs runners-up (cross-group)
  const ruLeft = WC26.GROUPS.filter(g => !usedRunners.has(g));
  for (let i = 0; i < ruLeft.length - 1; i += 2) {
    bracket.push(rankings[ruLeft[i]][1], rankings[ruLeft[i+1]][1]);
  }

  if (bracket.length !== 32 || new Set(bracket).size !== 32) {
    console.warn('Invalid KO bracket generated', { length: bracket.length, unique: new Set(bracket).size, comboKey });
  }
  return bracket;
};

/** Simulate one full tournament (group stage + knockouts) */
WC26.simulateOneTournament = function(actualMap, formMap, marketOddsMap) {
  const st = {};
  for (const g of WC26.GROUPS) {
    st[g] = {};
    for (const t of WC26.GROUP_TEAMS[g]) {
      st[g][t] = { team: t, p:0, w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0 };
    }
  }

  const MD3_DATE = '2026-06-24';
  for (const [utcDate, bjTime, home, away, grp] of WC26.MATCHES) {
    let sa, sb;
    const actual = actualMap[`${home}|${away}|`] || actualMap[`${home}|${away}|${utcDate}`];
    if (actual) {
      sa = actual.score1; sb = actual.score2;
    } else {
      let incentive = 1.0;
      if (utcDate >= MD3_DATE) {
        // MD3 incentive: analyze each team's qualification scenario
        const sH = st[grp][home], sA = st[grp][away];
        const grpTeams = WC26.GROUP_TEAMS[grp];
        // Find other teams' current points in this group
        const otherPts = grpTeams.filter(t => t !== home && t !== away).map(t => st[grp][t].pts);
        // For each team, compute: pts if win / pts if draw / pts if loss
        // Then check how many OTHER teams could finish above them
        function teamScenarios(pts) {
          const winPts = pts + 3, drawPts = pts + 1, lossPts = pts;
          // 2026 WC: top 2 advance + 8 best 3rd-place teams
          // 3rd place qualification thresholds: 3pts ~30%, 4pts ~80%, 5pts ~99%
          const canAdvanceWithWin = (() => {
            const maxOther = Math.max(...otherPts, 0);
            // Top 2: winPts beats or ties the max other
            if (winPts > maxOther) return true;
            // Best 3rd: 4+ pts has ~80% chance, 5+ pts ~99%
            if (winPts >= 5) return true;
            if (winPts === 4 && otherPts.filter(p => p >= 4).length < 3) return true;
            return false;
          })();
          const eliminated = !canAdvanceWithWin;
          const canAdvanceWithDraw = (() => {
            if (drawPts >= 5) return true;
            if (drawPts === 4 && otherPts.filter(p => p >= 4).length < 3) return true;
            const maxOther = Math.max(...otherPts, 0);
            return drawPts > maxOther;
          })();
          const needsWin = !canAdvanceWithDraw && !eliminated;
          return { eliminated, needsWin };
        }
        const hSc = teamScenarios(sH.pts);
        const aSc = teamScenarios(sA.pts);

        if (hSc.eliminated && aSc.eliminated) {
          incentive = 0.85;  // Dead rubber
        } else if (hSc.needsWin && aSc.needsWin) {
          incentive = 1.15;  // Both must win
        } else if (hSc.eliminated || aSc.eliminated) {
          incentive = 0.90;  // One team has nothing to play for
        }
      }
      [sa, sb] = WC26.simMatch(home, away, formMap, utcDate, marketOddsMap, incentive);
    }
    WC26.applyGroupResult(st, grp, home, away, sa, sb);
  }

  const rankings = {};
  for (const g of WC26.GROUPS) {
    rankings[g] = WC26.GROUP_TEAMS[g].slice().sort((a, b) => {
      const sa = st[g][a], sb = st[g][b];
      return sb.pts - sa.pts || sb.gd - sa.gd || sb.gf - sa.gf;
    });
  }

  const statRankings = {};
  for (const g of WC26.GROUPS) {
    statRankings[g] = rankings[g].map(t => st[g][t]);
  }
  const bestThirds = WC26.findBestThirds(statRankings);
  const thirdPlaceGroups = WC26.getThirdPlaceGroups(bestThirds, rankings);
  const bracket = WC26.buildKOBracket(rankings, bestThirds, thirdPlaceGroups);

  let currentRound = bracket;
  const rounds = [];
  const koDates = ['2026-06-28','2026-07-02','2026-07-05','2026-07-09','2026-07-14','2026-07-19'];
  let koRoundIdx = 0;

  while (currentRound.length > 1) {
    const nextRound = [];
    const roundResults = [];
    const koDate = koDates[Math.min(koRoundIdx, koDates.length - 1)];
    for (let i = 0; i < currentRound.length; i += 2) {
      const home = currentRound[i];
      const away = currentRound[i + 1];

      const actual = actualMap[`${home}|${away}|`] || actualMap[`${away}|${home}|`];
      let ga, gb, method;
      if (actual) {
        ga = actual.score1; gb = actual.score2;
        method = "90'";
        if (ga === gb) { method = 'PSO'; ga++; }
      } else {
        [ga, gb, method] = WC26.simKO(home, away, formMap, koDate, marketOddsMap);
      }

      const winner = ga > gb ? home : away;
      nextRound.push(winner);
      roundResults.push({ a: home, ga, gb, b: away, method });
    }
    rounds.push(roundResults);
    currentRound = nextRound;
    koRoundIdx++;
  }

  return { champion: currentRound[0], rounds, rankings, bestThirds };
};

/** Full simulation history for conditional MC filtering */
WC26.simulationHistory = [];

/** Run N tournament simulations and aggregate results */
WC26.runMonteCarlo = function(actualMap, N, formMap, marketOddsMap) {
  const champ = {}, finalist = {}, semi = {}, quarter = {}, r16 = {};
  WC26.simulationHistory = [];

  for (let i = 0; i < N; i++) {
    const result = WC26.simulateOneTournament(actualMap, formMap, marketOddsMap);
    champ[result.champion] = (champ[result.champion] || 0) + 1;

    const matchResults = {};
    for (const round of result.rounds) {
      for (const m of round) {
        matchResults[`${m.a}|${m.b}`] = { winner: m.ga > m.gb ? m.a : m.b, ga: m.ga, gb: m.gb };
      }
    }
    WC26.simulationHistory.push({
      champion: result.champion,
      matchResults
    });

    if (result.rounds.length >= 4) {
      for (const m of result.rounds[3]) {
        finalist[m.a] = (finalist[m.a] || 0) + 1;
        finalist[m.b] = (finalist[m.b] || 0) + 1;
      }
    }
    if (result.rounds.length >= 3) {
      for (const m of result.rounds[2]) {
        semi[m.a] = (semi[m.a] || 0) + 1;
        semi[m.b] = (semi[m.b] || 0) + 1;
      }
    }
    if (result.rounds.length >= 2) {
      for (const m of result.rounds[1]) {
        quarter[m.a] = (quarter[m.a] || 0) + 1;
        quarter[m.b] = (quarter[m.b] || 0) + 1;
      }
    }
    if (result.rounds.length >= 1) {
      for (const m of result.rounds[0]) {
        r16[m.a] = (r16[m.a] || 0) + 1;
        r16[m.b] = (r16[m.b] || 0) + 1;
      }
    }
  }

  return { champ, finalist, semi, quarter, r16, N };
};

/** Build lookup map from actual results array, with caching */
WC26._cachedActualMap = null;
WC26._cachedActualResultsHash = '';

WC26.buildActualResultsMap = function(actualResults) {
  const results = actualResults || [];
  const hash = results.map(r => `${r.team1}|${r.score1}-${r.score2}|${r.team2}|${r.date||''}`).join(';');
  if (WC26._cachedActualResultsHash === hash && WC26._cachedActualMap) return WC26._cachedActualMap;

  const map = {};
  for (const r of actualResults || []) {
    const dateStr = r.date ? r.date.substring(0, 10) : '';
    const key1 = `${r.team1}|${r.team2}|${dateStr}`;
    const key2 = `${r.team2}|${r.team1}|${dateStr}`;
    const val = { score1: r.score1, score2: r.score2, team1: r.team1, team2: r.team2 };
    map[key1] = val;
    map[key2] = { score1: r.score2, score2: r.score1, team1: r.team2, team2: r.team1 };

    const ndKey1 = `${r.team1}|${r.team2}|`;
    const ndKey2 = `${r.team2}|${r.team1}|`;
    if (!map[ndKey1]) map[ndKey1] = val;
    if (!map[ndKey2]) map[ndKey2] = { score1: r.score2, score2: r.score1, team1: r.team2, team2: r.team1 };
  }

  WC26._cachedActualMap = map;
  WC26._cachedActualResultsHash = hash;
  return map;
};

/** Get stored market odds with fallback lookups */
WC26.getStoredMarketOdds = function(marketOddsMap, home, away, matchDate) {
  if (!marketOddsMap) return null;
  const date = matchDate ? String(matchDate).substring(0, 10) : '';
  const direct = marketOddsMap[`${home}|${away}|${matchDate}`] ||
                 marketOddsMap[`${home}|${away}|${date}`] ||
                 marketOddsMap[`${home}|${away}|`] ||
                 marketOddsMap[`${home}|${away}`] ||
                 Object.entries(marketOddsMap).find(([k]) => k.startsWith(`${home}|${away}|${date}`))?.[1];
  if (direct) return direct;

  const reverse = marketOddsMap[`${away}|${home}|${matchDate}`] ||
                  marketOddsMap[`${away}|${home}|${date}`] ||
                  marketOddsMap[`${away}|${home}|`] ||
                  marketOddsMap[`${away}|${home}`] ||
                  Object.entries(marketOddsMap).find(([k]) => k.startsWith(`${away}|${home}|${date}`))?.[1];
  if (!reverse) return null;
  return { ...reverse, win: reverse.loss, loss: reverse.win };
};

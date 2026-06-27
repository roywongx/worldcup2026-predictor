// World Cup 2026 Predictor — extracted module
// model/monte-carlo.js — Monte Carlo simulation engine
globalThis.WC26 = globalThis.WC26 || {};

/** Apply a match result to group standings (mutates st in place) */
WC26.applyGroupResult = function(st, grp, team1, team2, score1, score2) {
  const a = st[grp][team1], b = st[grp][team2];
  a.p++; b.p++;
  a.gf += score1; a.ga += score2; b.gf += score2; b.ga += score1;
  a.gd = a.gf - a.ga; b.gd = b.gf - b.ga;
  if (score1 > score2) { a.w++; a.pts += 3; b.l++; }
  else if (score1 < score2) { b.w++; b.pts += 3; a.l++; }
  else { a.d++; a.pts++; b.d++; b.pts++; }
  // H2H tracking
  if (!a.h2h) a.h2h = {}; if (!b.h2h) b.h2h = {};
  a.h2h[team2] = { gf: score1, ga: score2, pts: score1 > score2 ? 3 : score1 < score2 ? 0 : 1 };
  b.h2h[team1] = { gf: score2, ga: score1, pts: score2 > score1 ? 3 : score2 < score1 ? 0 : 1 };
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
  // FIFA Official 2026 Bracket Structure
  // Based on: https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/knockout-stage-match-schedule-bracket
  //
  // Top Half (Matches 73-80):
  //   M73: A2 vs B1    M74: E1 vs 3rd(D/F)    M75: F1 vs C2    M76: C1 vs F2
  //   M77: I1 vs F3    M78: E2 vs I2           M79: A1 vs 3rd(E) M80: L1 vs 3rd(I)
  //
  // Bottom Half (Matches 81-88):
  //   M81: D1 vs 3rd(B) M82: G1 vs 3rd(A)    M83: K2 vs L2    M84: H1 vs J2
  //   M85: B2 vs G2     M86: J1 vs 3rd(H)     M87: K1 vs 3rd   M88: D2 vs 3rd(G)

  const comboKey = thirdPlaceGroups ? thirdPlaceGroups.slice().sort().join("") : "";
  const matrixEntry = WC26.TPM[comboKey];

  // Build third-place team map
  const thirdMap = {};
  for (const g of WC26.GROUPS) {
    if (rankings[g] && rankings[g].length >= 3) thirdMap[g] = rankings[g][2];
  }

  // Assign third-place groups to winner slots using FIFA matrix
  const W_SLOTS = ['A','B','D','E','G','I','K','L'];
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
  const thirdFor = (slotIdx) => {
    const tg = thirdAssignments[slotIdx];
    return tg && thirdMap[tg] ? thirdMap[tg] : null;
  };

  // Helper: get team by group position (0=winner, 1=runner-up, 2=third)
  const W = (g) => rankings[g][0];
  const R = (g) => rankings[g][1];
  const T = (g) => rankings[g][2];

  // FIFA official bracket order (32 teams, 16 matches)
  // Each pair is [home, away] for one R32 match
  const bracket = [];

  // ── TOP HALF ──
  // M73: A2 vs B1
  bracket.push(R('A'), W('B'));
  // M74: E1 vs 3rd (assigned to slot 3=D)
  bracket.push(W('E'), thirdFor(3) || R('E'));
  // M75: F1 vs C2
  bracket.push(W('F'), R('C'));
  // M76: C1 vs F2
  bracket.push(W('C'), R('F'));
  // M77: I1 vs F3
  bracket.push(W('I'), T('F') || R('I'));
  // M78: E2 vs I2
  bracket.push(R('E'), R('I'));
  // M79: A1 vs 3rd (assigned to slot 3=E)
  bracket.push(W('A'), thirdFor(3) || R('A'));
  // M80: L1 vs 3rd (assigned to slot 7=I)
  bracket.push(W('L'), thirdFor(7) || R('L'));

  // ── BOTTOM HALF ──
  // M81: D1 vs 3rd (assigned to slot 1=B)
  bracket.push(W('D'), thirdFor(1) || R('D'));
  // M82: G1 vs 3rd (assigned to slot 4=A)
  bracket.push(W('G'), thirdFor(4) || R('G'));
  // M83: K2 vs L2
  bracket.push(R('K'), R('L'));
  // M84: H1 vs J2
  bracket.push(W('H'), R('J'));
  // M85: B2 vs G2
  bracket.push(R('B'), R('G'));
  // M86: J1 vs 3rd (assigned to slot 5=H)
  bracket.push(W('J'), thirdFor(5) || R('J'));
  // M87: K1 vs 3rd (assigned to slot 6=K or fallback)
  bracket.push(W('K'), thirdFor(6) || R('K'));
  // M88: D2 vs 3rd (assigned to slot 2=G or fallback)
  bracket.push(R('D'), thirdFor(2) || R('D'));

  if (bracket.length !== 32 || new Set(bracket).size !== 32) {
    throw new Error(`Invalid KO bracket: ${bracket.length} teams, ${new Set(bracket).size} unique (comboKey=${comboKey})`);
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
  // FIFA 7-step group ranking with recursive H2H tiebreaker
  const rankGroup = (g) => {
    const teams = WC26.GROUP_TEAMS[g];
    const s = st[g];
    // Step 1: Sort by overall points (descending)
    const sorted = teams.slice().sort((a, b) => s[b].pts - s[a].pts);

    // Resolve ties with FIFA H2H rules
    const resolve = (list) => {
      if (list.length <= 1) return list;
      const pts = s[list[0]].pts;
      const tied = list.filter(t => s[t].pts === pts);
      const rest = list.filter(t => s[t].pts !== pts);

      if (tied.length === 1) return [...tied, ...resolve(rest)];

      // Compute H2H stats among tied teams
      const h2h = {};
      for (const t of tied) {
        let hPts=0, hGf=0, hGa=0;
        for (const opp of tied) {
          if (opp === t) continue;
          const r = s[t].h2h?.[opp];
          if (r) { hPts += r.pts; hGf += r.gf; hGa += r.ga; }
        }
        h2h[t] = { pts: hPts, gf: hGf, ga: hGa, gd: hGf - hGa };
      }

      // Sort tied teams by H2H: pts → gd → gf → overall gd → overall gf
      tied.sort((a, b) => {
        const ha = h2h[a], hb = h2h[b];
        if (ha.pts !== hb.pts) return hb.pts - ha.pts;
        if (ha.gd !== hb.gd) return hb.gd - ha.gd;
        if (ha.gf !== hb.gf) return hb.gf - ha.gf;
        if (s[b].gd !== s[a].gd) return s[b].gd - s[a].gd;
        return s[b].gf - s[a].gf;
      });

      // Find subgroups still tied after H2H (recursive narrowing)
      const result = [];
      let i = 0;
      while (i < tied.length) {
        const h = h2h[tied[i]];
        const sub = [tied[i]];
        while (i + sub.length < tied.length &&
               h2h[tied[i + sub.length]].pts === h.pts &&
               h2h[tied[i + sub.length]].gd === h.gd &&
               h2h[tied[i + sub.length]].gf === h.gf) {
          sub.push(tied[i + sub.length]);
        }
        // If still tied after H2H, fall back to overall gd → gf
        if (sub.length > 1) {
          sub.sort((a, b) => s[b].gd - s[a].gd || s[b].gf - s[a].gf);
        }
        result.push(...sub);
        i += sub.length;
      }
      return [...result, ...resolve(rest)];
    };

    return resolve(sorted);
  };

  for (const g of WC26.GROUPS) {
    rankings[g] = rankGroup(g);
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
        if (ga === gb) {
          method = 'PSO';
          if(actual.winner){if(actual.winner===home)ga++;else gb++;}
          else ga++; // fallback: home team advances
        }
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
    if(r.winner)val.winner=r.winner;
    map[key1] = val;
    map[key2] = { score1: r.score2, score2: r.score1, team1: r.team2, team2: r.team1 };
    if(r.winner)map[key2].winner=r.winner;

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

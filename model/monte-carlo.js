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
  // FIFA 2026 Official R32 Bracket (from Annex C)
  // 8 group winners (A,B,D,E,G,I,K,L) face third-place teams
  // 4 group winners (C,F,H,J) face runner-ups
  // 4 runner-ups (A,B,D,E,I,J,K,L) face each other
  // Assignment uses backtracking to avoid same-group matchups.

  const thirdMap = {};
  for (const g of WC26.GROUPS) {
    if (rankings[g] && rankings[g].length >= 3) thirdMap[g] = rankings[g][2];
  }
  const W = g => rankings[g][0], R = g => rankings[g][1];

  // Array index = bracket position (0-15). R16 cross-pairing uses these indices.
  // FIFA R32 third-place assignments (Annex C)
  // 8 slots where group winners face 3rd-place teams.
  // Slot mapping: winner group → bracket match index
  //   1E→M75(2), 1I→M77(4), 1A→M79(6), 1L→M80(7),
  //   1D→M81(8), 1G→M82(9), 1B→M85(12), 1K→M87(14), leftover→M88(15)
  const qualified3 = (thirdPlaceGroups || []).filter(g => thirdMap[g]);
  const T3 = {};
  const used3 = new Set();
  // 8 third-place slots. M88 = R(D) vs R(G) (no third-place team).
  // Preferred groups from FIFA Annex C. Greedy assignment with preferred-first.
  const slots3 = [
    {m:2,  pref:'D', ex:['E','C','F']},     // M75: 1E vs 3rd (adj M76: W-F,R-C)
    {m:4,  pref:'F', ex:['I','E']},          // M77: 1I vs 3rd (adj M78: R-E,R-I)
    {m:6,  pref:'E', ex:['A','L']},          // M79: 1A vs 3rd (adj M80: W-L,3rd)
    {m:7,  pref:'K', ex:['L','A']},          // M80: 1L vs 3rd (adj M79: W-A,3rd)
    {m:8,  pref:'B', ex:['D','G']},          // M81: 1D vs 3rd (adj M82: W-G,3rd)
    {m:9,  pref:'I', ex:['G','D']},          // M82: 1G vs 3rd (adj M81: W-D,3rd)
    {m:12, pref:'J', ex:['B','J','H']},      // M85: 1B vs 3rd (adj M86: W-J,R-H)
    {m:14, pref:'L', ex:['K','D']},          // M87: 1K vs 3rd (adj M88: R-D,R-G)
  ];
  for (const s of slots3) {
    const adjMatch = s.m ^ 1;
    const adj3Group = T3[adjMatch] ? T3[adjMatch] : null;
    // Try preferred group first
    let assigned = false;
    if (s.pref && qualified3.includes(s.pref) && !used3.has(s.pref) && !s.ex.includes(s.pref)) {
      if (!adj3Group || adj3Group !== thirdMap[s.pref]) {
        T3[s.m] = thirdMap[s.pref]; used3.add(s.pref); assigned = true;
      }
    }
    // Fallback: first available
    if (!assigned) {
      for (const g of qualified3) {
        if (used3.has(g) || s.ex.includes(g)) continue;
        if (adj3Group && adj3Group === thirdMap[g]) continue;
        T3[s.m] = thirdMap[g]; used3.add(g); assigned = true;
        break;
      }
    }
    if (!assigned) console.warn(`[Bracket] No third-place team for slot M${73+s.m}`);
  }
  function getThirdAt(idx) { return T3[idx] || null; }

  // FIFA R32 bracket — ordered so sequential pairing produces correct R16
  // Source: https://zh.wikipedia.org/wiki/2026年國際足協世界盃
  // R16: [0]+[1]→M89, [2]+[3]→M90, [4]+[5]→M91, [6]+[7]→M92
  //      [8]+[9]→M93, [10]+[11]→M94, [12]+[13]→M95, [14]+[15]→M96
  return [
    W('E'), getThirdAt(2),                // [0]  M74: Germany vs Paraguay
    W('I'), getThirdAt(4),                // [1]  M77: France vs Sweden
    R('A'), R('B'),                       // [2]  M73: South Africa vs Canada
    W('F'), R('C'),                       // [3]  M75: Netherlands vs Morocco
    W('C'), R('F'),                       // [4]  M76: Brazil vs Japan
    R('E'), R('I'),                       // [5]  M78: Ivory Coast vs Norway
    W('A'), getThirdAt(6),                // [6]  M79: Mexico vs Ecuador
    W('L'), getThirdAt(7),                // [7]  M80: England vs DR Congo
    R('K'), R('L'),                       // [8]  M83: Portugal vs Croatia
    W('H'), R('J'),                       // [9]  M84: Spain vs Austria
    W('D'), getThirdAt(8),                // [10] M81: USA vs Bosnia
    W('G'), getThirdAt(9),                // [11] M82: Belgium vs Senegal
    W('J'), R('H'),                       // [12] M86: Argentina vs Cape Verde
    R('D'), R('G'),                       // [13] M88: Australia vs Egypt
    W('B'), getThirdAt(12),               // [14] M85: Switzerland vs Algeria
    W('K'), getThirdAt(14),               // [15] M87: Colombia vs Ghana
  ];
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
    const actual = actualMap[`${home}|${away}|${utcDate}`] || actualMap[`${home}|${away}|`];
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

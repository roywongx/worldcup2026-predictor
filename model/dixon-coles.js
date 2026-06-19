// World Cup 2026 Predictor — extracted module
// model/dixon-coles.js — Core Dixon-Coles prediction model
window.WC26 = window.WC26 || {};

/** All market volumes for percentile computation */
WC26._allMarketVolumes = [];

/** Get dynamic form for a team (0-1) */
WC26.getForm = function(team, formMap) {
  if (formMap && formMap[team] !== undefined) return formMap[team];
  if (typeof currentResults !== 'undefined' && currentResults && currentResults.formMap && currentResults.formMap[team] !== undefined) {
    return currentResults.formMap[team];
  }
  return WC26.TEAMS[team] ? WC26.TEAMS[team].form : 0.5;
};

/** Convert Elo ratings to Poisson lambda (expected goals) */
WC26.getLambdas = function(eloH, eloA, hostBonusH, hostBonusA, atkH, defA, atkA, defH, isKnockout) {
  const base = 1.25;
  const stageFactor = isKnockout ? 0.92 : 1.0;

  const eloScale = isKnockout ? 1.10 : 0.90;
  const eloDiff = eloH - eloA;
  const expectedWinH = 1 / (1 + Math.pow(10, -eloDiff * eloScale / 400));

  const eloModH = 0.3 + 1.4 * expectedWinH;
  const eloModA = 0.3 + 1.4 * (1 - expectedWinH);

  const atkModH = Math.pow((atkH || 1.0) / (defA || 1.0), 0.35);
  const atkModA = Math.pow((atkA || 1.0) / (defH || 1.0), 0.35);

  const lh = Math.max(0.18, base * stageFactor * atkModH * eloModH * (1 + hostBonusH));
  const la = Math.max(0.18, base * stageFactor * atkModA * eloModA * (1 + hostBonusA));
  return [lh, la];
};

/** Get form-adjusted lambdas for a match */
WC26.getFormAdjustedLambdas = function(home, away, formMap, matchDate, marketProbs) {
  const hBonus = WC26.getHomeBonus(home);
  const aBonus = WC26.getHomeBonus(away);
  const eloH = WC26.getEffectiveElo(home);
  const eloA = WC26.getEffectiveElo(away);
  const isKnockout = matchDate && matchDate.substring(0, 10) >= '2026-06-28';
  const effHome = WC26.SQUADS[home] ? WC26.getEffectiveAtkDef(home) : null;
  const effAway = WC26.SQUADS[away] ? WC26.getEffectiveAtkDef(away) : null;
  const atkH = effHome ? effHome.atk : (WC26.TEAMS[home] ? WC26.getTeamAtk(home) : 1.0);
  const defH = effHome ? effHome.def : (WC26.TEAMS[home] ? WC26.TEAMS[home].def : 1.0);
  const atkA = effAway ? effAway.atk : (WC26.TEAMS[away] ? WC26.getTeamAtk(away) : 1.0);
  const defA = effAway ? effAway.def : (WC26.TEAMS[away] ? WC26.TEAMS[away].def : 1.0);
  const [lh, la] = WC26.getLambdas(eloH, eloA, hBonus, aBonus, atkH, defA, atkA, defH, isKnockout);

  const formH = WC26.getForm(home, formMap);
  const formA = WC26.getForm(away, formMap);
  const adjH = 1 + (formH - 0.5) * 0.30;
  const adjA = 1 + (formA - 0.5) * 0.30;

  let finalH = Math.max(0.05, lh * adjH);
  let finalA = Math.max(0.05, la * adjA);

  if (marketProbs && marketProbs.win > 0 && marketProbs.loss > 0) {
    const MARKET_BLEND = WC26.getMarketBlend(matchDate, marketProbs.volume);

    const mktWL = marketProbs.win / marketProbs.loss;
    const modelWL = finalH / finalA;
    const ratioAdj = Math.pow(mktWL / modelWL, MARKET_BLEND);
    let mktAdjH = finalH * Math.sqrt(ratioAdj);
    let mktAdjA = finalA / Math.sqrt(ratioAdj);

    if (marketProbs.draw > 0) {
      const adjTotal = mktAdjH + mktAdjA;
      const approxDraw = 2 * Math.sqrt(mktAdjH * mktAdjA) / adjTotal * 0.40;
      const drawRatio = marketProbs.draw / Math.max(approxDraw, 0.01);
      const drawAdj = Math.pow(drawRatio, MARKET_BLEND);
      const mid = adjTotal / 2;
      mktAdjH = mid + (mktAdjH - mid) / drawAdj;
      mktAdjA = mid + (mktAdjA - mid) / drawAdj;
    }

    finalH = Math.max(0.05, mktAdjH);
    finalA = Math.max(0.05, mktAdjA);
  }
  return [finalH, finalA];
};

/** Get home advantage bonus for a team */
WC26.getHomeBonus = function(team) {
  const host = WC26.TEAMS[team] ? WC26.TEAMS[team].host : 0;
  if (host >= 0.10) return WC26.HOME_HOST;
  return 0;
};

/** Predict match outcome — highest probability wins */
WC26.predictOutcome = function(probs, team1, team2) {
  if (probs.draw >= probs.win && probs.draw >= probs.loss) return 'draw';
  return probs.win >= probs.loss ? team1 : team2;
};

/** Compute win/draw/loss probabilities using Dixon-Coles model */
WC26.matchProbs = function(home, away, formMap, matchDate, marketProbs) {
  const [lh, la] = WC26.getFormAdjustedLambdas(home, away, formMap, matchDate, marketProbs);

  let pW = 0, pD = 0, pL = 0;
  const useNB = WC26.NB_R > 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const pi = useNB ? WC26.negBinPMF(i, lh, WC26.NB_R) : WC26.poissonPMF(i, lh);
      const pj = useNB ? WC26.negBinPMF(j, la, WC26.NB_R) : WC26.poissonPMF(j, la);
      const p = pi * pj * WC26.dixonColesTau(i, j, lh, la, WC26.getRho(matchDate));
      if (i > j) pW += p;
      else if (i === j) pD += p;
      else pL += p;
    }
  }
  const total = pW + pD + pL;
  const raw = { win: pW/total, draw: pD/total, loss: pL/total };

  let probs = WC26.calibrateProbs(raw.win, raw.draw, raw.loss);
  if (!WC26.isotonicCalibration) {
    probs = WC26.temperatureScale(raw.win, raw.draw, raw.loss, 1.15);
  }

  if (WC26.gbdt && WC26.gbdt.trained) {
    const gbdtProbs = WC26.gbdt.predict(home, away);
    if (gbdtProbs) {
      const BLEND = 0.20;
      probs = {
        win: (1 - BLEND) * probs.win + BLEND * gbdtProbs.win,
        draw: (1 - BLEND) * probs.draw + BLEND * gbdtProbs.draw,
        loss: (1 - BLEND) * probs.loss + BLEND * gbdtProbs.loss,
      };
    }
  }
  return probs;
};

/** Convert American moneyline odds to implied probability */
WC26.oddsToProb = function(usOdds) {
  if (usOdds > 0) return 100 / (usOdds + 100);
  return Math.abs(usOdds) / (Math.abs(usOdds) + 100);
};

/** 交易量排名百分位 */
WC26.getVolumePercentile = function(volume, allVolumes) {
  if (!volume || !allVolumes || allVolumes.length === 0) return 0.5;
  const sorted = [...allVolumes].sort((a, b) => a - b);
  let rank = 0;
  for (const v of sorted) { if (v <= volume) rank++; }
  return rank / sorted.length;
};

/** Polymarket blend weight (time decay: 7d before 20% → match day 50%) */
WC26.getMarketBlend = function(matchDate, volume) {
  if (!matchDate) return 0.20;
  const now = new Date();
  const match = new Date(matchDate);
  const hoursUntil = (match - now) / (1000 * 60 * 60);
  if (hoursUntil < 0) return 0;
  let blend;
  if (hoursUntil <= 1) blend = 0.50;
  else if (hoursUntil <= 24) blend = 0.20 + 0.30 * (1 - (hoursUntil - 1) / 23);
  else if (hoursUntil <= 168) blend = 0.20 + 0.15 * (1 - (hoursUntil - 24) / 144);
  else blend = 0.20;

  if (volume && volume > 0 && WC26._allMarketVolumes.length > 0) {
    const pct = WC26.getVolumePercentile(volume, WC26._allMarketVolumes);
    const volumeFactor = 0.7 + 0.6 * pct;
    blend *= volumeFactor;
  }
  return Math.min(0.60, Math.max(0.10, blend));
};

/** Simulate a single match score using Poisson sampling */
WC26.simMatch = function(home, away, formMap, matchDate, marketOddsMap, incentiveFactor) {
  const marketProbs = marketOddsMap ? (marketOddsMap[`${home}|${away}|${matchDate}`] || marketOddsMap[`${home}|${away}|`]) : null;
  const [lh, la] = WC26.getFormAdjustedLambdas(home, away, formMap, matchDate, marketProbs);
  const f = incentiveFactor || 1.0;
  return [WC26.poissonSample(lh * f), WC26.poissonSample(la * f)];
};

/** Simulate a knockout match with extra time and penalties if needed */
WC26.simKO = function(home, away, formMap, matchDate, marketOddsMap) {
  const marketProbs = marketOddsMap ? (marketOddsMap[`${home}|${away}|${matchDate}`] || marketOddsMap[`${home}|${away}|`]) : null;
  const [lh90, la90] = WC26.getFormAdjustedLambdas(home, away, formMap, matchDate, marketProbs);

  const ga90 = WC26.poissonSample(lh90), gb90 = WC26.poissonSample(la90);
  let ga = ga90, gb = gb90, method;

  if (ga !== gb) {
    method = "90'";
  } else {
    const eloH = WC26.getEffectiveElo(home), eloA = WC26.getEffectiveElo(away);
    const eloDiff = eloH - eloA;
    const gammaH = Math.max(0.10, 0.70 + 0.05 * (eloDiff / 400));
    const gammaA = Math.max(0.10, 0.70 - 0.05 * (eloDiff / 400));
    const lhET = lh90 * (30 / 90) * gammaH;
    const laET = la90 * (30 / 90) * gammaA;
    const etH = WC26.poissonSample(lhET), etA = WC26.poissonSample(laET);
    ga += etH; gb += etA;
    if (ga !== gb) {
      method = 'AET';
    } else {
      const pHome = Math.max(0.40, Math.min(0.60, 0.50 + 0.05 * (eloDiff / 400)));
      if (Math.random() < pHome) ga++; else gb++;
      method = 'PSO';
    }
  }
  return [ga, gb, method];
};

/** Analytical knockout advance probabilities (3-stage: 90min + ET + PK) */
WC26.koAdvanceProbs = function(home, away, formMap, matchDate, marketOddsMap) {
  const rho = WC26.getRho(matchDate);
  const marketProbs = marketOddsMap ? (marketOddsMap[`${home}|${away}|${matchDate}`] || marketOddsMap[`${home}|${away}|`]) : null;
  const [lh90, la90] = WC26.getFormAdjustedLambdas(home, away, formMap, matchDate, marketProbs);

  let pW90=0, pD90=0, pL90=0;
  const useNB = WC26.NB_R > 0;
  for (let i=0;i<=10;i++) for (let j=0;j<=10;j++) {
    const pi = useNB ? WC26.negBinPMF(i, lh90, WC26.NB_R) : WC26.poissonPMF(i, lh90);
    const pj = useNB ? WC26.negBinPMF(j, la90, WC26.NB_R) : WC26.poissonPMF(j, la90);
    const p=pi*pj*WC26.dixonColesTau(i,j,lh90,la90,rho);
    if(i>j)pW90+=p;else if(i===j)pD90+=p;else pL90+=p;
  }
  const t90=pW90+pD90+pL90; pW90/=t90; pD90/=t90; pL90/=t90;

  const eloH=WC26.getEffectiveElo(home), eloA=WC26.getEffectiveElo(away), eloDiff=eloH-eloA;
  const gammaH=Math.max(0.10,0.70+0.05*(eloDiff/400)), gammaA=Math.max(0.10,0.70-0.05*(eloDiff/400));
  const lhET=lh90*(30/90)*gammaH, laET=la90*(30/90)*gammaA;

  let pW_ET=0,pD_ET=0,pL_ET=0;
  for(let i=0;i<=5;i++)for(let j=0;j<=5;j++){
    const pi = useNB ? WC26.negBinPMF(i, lhET, WC26.NB_R) : WC26.poissonPMF(i, lhET);
    const pj = useNB ? WC26.negBinPMF(j, laET, WC26.NB_R) : WC26.poissonPMF(j, laET);
    const p=pi*pj*WC26.dixonColesTau(i,j,lhET,laET,rho);
    if(i>j)pW_ET+=p;else if(i===j)pD_ET+=p;else pL_ET+=p;
  }
  const tET=pW_ET+pD_ET+pL_ET; pW_ET/=tET; pD_ET/=tET; pL_ET/=tET;

  const pPK_home=Math.max(0.40,Math.min(0.60,0.50+0.05*(eloDiff/400)));

  const pGoesET=pD90, pGoesPK=pD90*pD_ET;
  const pAdvance_home=pW90+pD90*(pW_ET+pD_ET*pPK_home);
  const pAdvance_away=pL90+pD90*(pL_ET+pD_ET*(1-pPK_home));

  const cal90 = WC26.calibrateProbs(pW90, pD90, pL90);
  const calAdv = { win: pAdvance_home, draw: 0, loss: pAdvance_away };
  return {
    p90: cal90,
    pET:{w:pW_ET,d:pD_ET,l:pL_ET},
    pPK:{home:pPK_home,away:1-pPK_home},
    pAdvance: calAdv,
    pGoesET, pGoesPK
  };
};

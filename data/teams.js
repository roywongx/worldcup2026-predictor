// World Cup 2026 Predictor — extracted module
// data/teams.js — Team data, squads, and injury system
window.WC26 = window.WC26 || {};

/** Pre-computed factorial table for Poisson PMF (0-15) */
WC26.FACT = [1,1,2,6,24,120,720,5040,40320,362880,3628800,39916800,479001600,6227020800,87178291200,1307674368000];

/** Dixon-Coles correlation parameter */
WC26.RHO_GROUP = -0.20;
WC26.RHO_KNOCKOUT = -0.15;

/** Match importance multipliers (PELE 2026) */
WC26.IMPORTANCE_FRIENDLY = 0.60;
WC26.IMPORTANCE_QUALIFIER = 1.50;
WC26.IMPORTANCE_WC_GROUP = 1.00;
WC26.IMPORTANCE_WC_KNOCKOUT = 1.10;

/** Negative Binomial overdispersion parameter */
WC26.NB_R = 8.5;

/** Home advantage in expected goals */
WC26.HOME_HOST = 0.30;

/** Monte Carlo default */
WC26.MC_DEFAULT = 50000;

/** Model tuning constants (named for readability) */
WC26.CONFIG = {
  BASE_LAMBDA: 1.25,          // baseline expected goals before modifiers
  KNOCKOUT_FACTOR: 0.92,      // goals reduced in knockout stage
  ATKDEF_DAMPING: 0.35,       // exponent for ATK/DEF ratio adjustment
  FORM_AMP: 0.30,             // form deviation → lambda multiplier amplitude
  TILT_ATK: 0.10,             // tilt weight: attack-minded → more goals scored
  TILT_DEF: 0.05,             // tilt weight: attack-minded → more goals conceded
  MIN_LAMBDA: 0.18,           // floor for raw lambda from getLambdas
  MIN_FINAL: 0.05,            // floor for final adjusted lambda
  DRAW_APPROX: 0.40,          // Poisson draw approximation scaling factor
};

/** UEFA club teams for 30% valuation correction */
WC26.UEFA_TEAMS = new Set([
  'Germany','Spain','France','England','Portugal','Netherlands','Belgium',
  'Croatia','Switzerland','Denmark','Poland','Serbia','Czech Republic',
  'Austria','Sweden','Norway','Turkey','Scotland','Wales','Ukraine',
  'Ireland','Romania','Hungary','Greece','Slovakia','Slovenia',
  'Bosnia Herzegovina','Albania','North Macedonia',
  'Iceland','Finland','Northern Ireland','Bulgaria',
  'Montenegro','Georgia','Armenia','Azerbaijan','Kazakhstan',
  'Luxembourg','Malta','Cyprus','Estonia','Latvia','Lithuania',
  'Moldova','Kosovo','Faroe Islands','Gibraltar','Liechtenstein',
  'San Marino','Andorra'
]);

/** Squad composition data */
WC26.SQUADS = {};

/** Active injuries/suspensions per team */
WC26.INJURIES = {};

/** Pre-tournament Elo ratings
 *  Array: [elo, fifa, marketValueMillion, wcApps, form(0-1), hostBonus, americanOdds, attack, defense] */
WC26.TEAMS = {
  "Mexico":{elo:1701,fifa:1681,mv:192,wc:17,form:0.65,host:0.15,odds:5000,atk:0.89,def:0.86},
  "South Africa":{elo:1415,fifa:1070,mv:55,wc:3,form:0.45,host:0,odds:75000,atk:0.86,def:0.92},
  "South Korea":{elo:1613,fifa:1538,mv:139,wc:11,form:0.60,host:0,odds:15000,atk:0.91,def:0.93},
  "Czech Republic":{elo:1485,fifa:1480,mv:180,wc:2,form:0.50,host:0,odds:18000,atk:1.04,def:0.86},
  "Canada":{elo:1552,fifa:1673,mv:80,wc:2,form:0.55,host:0.10,odds:20000,atk:0.96,def:0.94},
  "Bosnia Herzegovina":{elo:1395,fifa:1376,mv:85,wc:0,form:0.45,host:0,odds:30000,atk:0.96,def:0.83},
  "Qatar":{elo:1459,fifa:1588,mv:45,wc:2,form:0.50,host:0,odds:35000,atk:0.85,def:0.89},
  "Switzerland":{elo:1641,fifa:1649,mv:333,wc:12,form:0.60,host:0,odds:6500,atk:0.93,def:1.00},
  "Brazil":{elo:1765,fifa:1761,mv:928,wc:22,form:0.60,host:0,odds:950,atk:0.93,def:0.95},
  "Morocco":{elo:1756,fifa:1756,mv:448,wc:7,form:0.70,host:0,odds:2800,atk:0.96,def:1.05},
  "Haiti":{elo:1293,fifa:1238,mv:15,wc:1,form:0.35,host:0,odds:250000,atk:0.89,def:0.85},
  "Scotland":{elo:1503,fifa:1480,mv:165,wc:9,form:0.50,host:0,odds:15000,atk:0.93,def:0.83},
  "United States":{elo:1689,fifa:1673,mv:386,wc:12,form:0.60,host:0.10,odds:6000,atk:0.94,def:0.94},
  "Paraguay":{elo:1488,fifa:1542,mv:85,wc:9,form:0.45,host:0,odds:15000,atk:0.89,def:0.85},
  "Australia":{elo:1579,fifa:1539,mv:120,wc:7,form:0.55,host:0,odds:12000,atk:0.88,def:0.90},
  "Turkey":{elo:1606,fifa:1599,mv:474,wc:3,form:0.65,host:0,odds:6500,atk:0.96,def:0.91},
  "Germany":{elo:1736,fifa:1730,mv:947,wc:21,form:0.60,host:0,odds:1100,atk:1.07,def:1.00},
  "Curaçao":{elo:1295,fifa:1046,mv:15,wc:0,form:0.35,host:0,odds:250000,atk:0.88,def:0.84},
  "Ivory Coast":{elo:1541,fifa:1554,mv:155,wc:4,form:0.55,host:0,odds:15000,atk:0.93,def:0.99},
  "Ecuador":{elo:1599,fifa:1595,mv:369,wc:4,form:0.60,host:0,odds:8000,atk:0.89,def:0.89},
  "Netherlands":{elo:1754,fifa:1758,mv:754,wc:11,form:0.65,host:0,odds:1400,atk:1.07,def:1.00},
  "Japan":{elo:1662,fifa:1660,mv:271,wc:7,form:0.70,host:0,odds:5000,atk:0.89,def:1.01},
  "Sweden":{elo:1510,fifa:1430,mv:195,wc:12,form:0.50,host:0,odds:20000,atk:0.85,def:0.80},
  "Tunisia":{elo:1476,fifa:1504,mv:75,wc:7,form:0.50,host:0,odds:20000,atk:0.90,def:0.99},
  "Belgium":{elo:1742,fifa:1735,mv:548,wc:14,form:0.55,host:0,odds:2500,atk:1.10,def:0.99},
  "Egypt":{elo:1562,fifa:1550,mv:85,wc:3,form:0.50,host:0,odds:15000,atk:0.95,def:1.01},
  "Iran":{elo:1620,fifa:1615,mv:55,wc:7,form:0.55,host:0,odds:18000,atk:0.88,def:0.87},
  "New Zealand":{elo:1276,fifa:1420,mv:35,wc:2,form:0.40,host:0,odds:50000,atk:0.80,def:0.91},
  "Spain":{elo:1875,fifa:1876,mv:1220,wc:16,form:0.75,host:0,odds:450,atk:1.15,def:1.05},
  "Cape Verde":{elo:1371,fifa:1310,mv:20,wc:0,form:0.45,host:0,odds:75000,atk:0.85,def:0.91},
  "Saudi Arabia":{elo:1424,fifa:1590,mv:45,wc:7,form:0.50,host:0,odds:20000,atk:0.87,def:0.90},
  "Uruguay":{elo:1673,fifa:1673,mv:359,wc:14,form:0.60,host:0,odds:3500,atk:0.93,def:0.92},
  "France":{elo:1871,fifa:1877,mv:1520,wc:16,form:0.70,host:0,odds:500,atk:1.11,def:1.02},
  "Senegal":{elo:1684,fifa:1689,mv:478,wc:4,form:0.60,host:0,odds:8000,atk:0.91,def:0.92},
  "Iraq":{elo:1446,fifa:1400,mv:20,wc:2,form:0.45,host:0,odds:50000,atk:0.86,def:0.90},
  "Norway":{elo:1557,fifa:1490,mv:250,wc:4,form:0.55,host:0,odds:10000,atk:1.12,def:0.99},
  "Argentina":{elo:1877,fifa:1875,mv:783,wc:18,form:0.70,host:0,odds:950,atk:0.92,def:0.98},
  "Algeria":{elo:1571,fifa:1508,mv:95,wc:5,form:0.50,host:0,odds:30000,atk:0.91,def:0.97},
  "Austria":{elo:1597,fifa:1593,mv:245,wc:8,form:0.55,host:0,odds:10000,atk:1.05,def:0.95},
  "Jordan":{elo:1388,fifa:1380,mv:25,wc:1,form:0.45,host:0,odds:50000,atk:0.86,def:0.90},
  "Portugal":{elo:1768,fifa:1764,mv:1010,wc:9,form:0.65,host:0,odds:800,atk:1.17,def:0.95},
  "DR Congo":{elo:1474,fifa:1410,mv:85,wc:2,form:0.45,host:0,odds:100000,atk:0.86,def:0.93},
  "Uzbekistan":{elo:1459,fifa:1410,mv:40,wc:0,form:0.50,host:0,odds:50000,atk:0.87,def:0.90},
  "Colombia":{elo:1698,fifa:1693,mv:303,wc:7,form:0.60,host:0,odds:2000,atk:0.96,def:0.93},
  "England":{elo:1828,fifa:1826,mv:1360,wc:17,form:0.65,host:0,odds:700,atk:1.07,def:1.17},
  "Croatia":{elo:1715,fifa:1717,mv:387,wc:7,form:0.60,host:0,odds:3300,atk:1.12,def:0.98},
  "Ghana":{elo:1347,fifa:1460,mv:70,wc:4,form:0.45,host:0,odds:25000,atk:0.88,def:0.95},
  "Panama":{elo:1539,fifa:1555,mv:30,wc:2,form:0.50,host:0,odds:25000,atk:0.93,def:0.89},
};

WC26.FLAGS = {
  "Mexico":"mx","South Africa":"za","South Korea":"kr","Czech Republic":"cz",
  "Canada":"ca","Bosnia Herzegovina":"ba","Qatar":"qa","Switzerland":"ch",
  "Brazil":"br","Morocco":"ma","Haiti":"ht","Scotland":"gb-sct",
  "United States":"us","Paraguay":"py","Australia":"au","Turkey":"tr",
  "Germany":"de","Curaçao":"cw","Ivory Coast":"ci","Ecuador":"ec",
  "Netherlands":"nl","Japan":"jp","Sweden":"se","Tunisia":"tn",
  "Belgium":"be","Egypt":"eg","Iran":"ir","New Zealand":"nz",
  "Spain":"es","Cape Verde":"cv","Saudi Arabia":"sa","Uruguay":"uy",
  "France":"fr","Senegal":"sn","Iraq":"iq","Norway":"no",
  "Argentina":"ar","Algeria":"dz","Austria":"at","Jordan":"jo",
  "Portugal":"pt","DR Congo":"cd","Uzbekistan":"uz","Colombia":"co",
  "England":"gb-eng","Croatia":"hr","Ghana":"gh","Panama":"pa"
};

WC26.TEAM_NAMES_ZH = {
  "Mexico":"墨西哥","South Africa":"南非","South Korea":"韩国","Czech Republic":"捷克",
  "Canada":"加拿大","Bosnia Herzegovina":"波黑","Qatar":"卡塔尔","Switzerland":"瑞士",
  "Brazil":"巴西","Morocco":"摩洛哥","Haiti":"海地","Scotland":"苏格兰",
  "United States":"美国","Paraguay":"巴拉圭","Australia":"澳大利亚","Turkey":"土耳其",
  "Germany":"德国","Curaçao":"库拉索","Ivory Coast":"科特迪瓦","Ecuador":"厄瓜多尔",
  "Netherlands":"荷兰","Japan":"日本","Sweden":"瑞典","Tunisia":"突尼斯",
  "Belgium":"比利时","Egypt":"埃及","Iran":"伊朗","New Zealand":"新西兰",
  "Spain":"西班牙","Cape Verde":"佛得角","Saudi Arabia":"沙特","Uruguay":"乌拉圭",
  "France":"法国","Senegal":"塞内加尔","Iraq":"伊拉克","Norway":"挪威",
  "Argentina":"阿根廷","Algeria":"阿尔及利亚","Austria":"奥地利","Jordan":"约旦",
  "Portugal":"葡萄牙","DR Congo":"刚果(金)","Uzbekistan":"乌兹别克斯坦","Colombia":"哥伦比亚",
  "England":"英格兰","Croatia":"克罗地亚","Ghana":"加纳","Panama":"巴拿马"
};

WC26.GROUPS = "ABCDEFGHIJKL".split('');

WC26.GROUP_TEAMS = {
  A:["Mexico","South Africa","South Korea","Czech Republic"],
  B:["Canada","Bosnia Herzegovina","Qatar","Switzerland"],
  C:["Brazil","Morocco","Haiti","Scotland"],
  D:["United States","Paraguay","Australia","Turkey"],
  E:["Germany","Curaçao","Ivory Coast","Ecuador"],
  F:["Netherlands","Japan","Sweden","Tunisia"],
  G:["Belgium","Egypt","Iran","New Zealand"],
  H:["Spain","Cape Verde","Saudi Arabia","Uruguay"],
  I:["France","Senegal","Iraq","Norway"],
  J:["Argentina","Algeria","Austria","Jordan"],
  K:["Portugal","DR Congo","Uzbekistan","Colombia"],
  L:["England","Croatia","Ghana","Panama"]
};

WC26.teamToGroup = {};
for (const g of WC26.GROUPS) for (const t of WC26.GROUP_TEAMS[g]) WC26.teamToGroup[t] = g;

/** 2022-era Elo ratings for backtesting */
WC26.WC2022_TEAMS = {
  'Wales': {elo:1771,fifa:1570,mv:160,wc:2,form:0.50,host:0,odds:15000,atk:0.92,def:0.95},
  'Costa Rica': {elo:1584,fifa:1500,mv:45,wc:6,form:0.45,host:0,odds:25000,atk:0.85,def:0.90},
  'Cameroon': {elo:1554,fifa:1485,mv:90,wc:8,form:0.45,host:0,odds:25000,atk:0.90,def:0.85},
  'Serbia': {elo:1726,fifa:1550,mv:200,wc:4,form:0.50,host:0,odds:15000,atk:0.95,def:0.92},
  'Denmark': {elo:1832,fifa:1670,mv:310,wc:6,form:0.55,host:0,odds:8000,atk:1.00,def:1.05},
  'Poland': {elo:1722,fifa:1548,mv:180,wc:9,form:0.50,host:0,odds:15000,atk:0.92,def:0.95},
};

/** Get team ATK from TEAMS */
WC26.getTeamAtk = function(team) {
  return WC26.TEAMS[team] ? WC26.TEAMS[team].atk : 1.0;
};

/** Get translated team name */
WC26.getTeamName = function(team) {
  if (typeof currentLang !== 'undefined' && currentLang === 'zh' && WC26.TEAM_NAMES_ZH[team]) return WC26.TEAM_NAMES_ZH[team];
  return team;
};

/** Get market value with UEFA correction (30% discount for European clubs) */
WC26.getCorrectedMV = function(team) {
  const raw = WC26.TEAMS[team] ? WC26.TEAMS[team].mv : 50;
  return WC26.UEFA_TEAMS.has(team) ? raw * 0.70 : raw;
};

/** Compute effective squad market value considering position weights and bench depth */
WC26.getEffectiveMV = function(team) {
  const squad = WC26.SQUADS[team];
  if (!squad || squad.length === 0) return WC26.getCorrectedMV(team);

  const POS_WEIGHT = { GK: 1.0, DEF: 1.0, MID: 1.0, FWD: 1.0 };
  const BENCH_DECAY = (i) => Math.max(0.1, 1.0 - 0.1 * (i - 11));

  const injured = new Set((WC26.INJURIES[team] || []).map(x => x.player));

  let totalValue = 0;
  let starterValue = 0;
  let starterCount = 0;

  for (let i = 0; i < squad.length && i < 23; i++) {
    const p = squad[i];
    if (injured.has(p.name)) continue;
    const weight = i < 11 ? 1.0 : BENCH_DECAY(i);
    const posWeight = POS_WEIGHT[p.pos] || 1.0;
    const effectiveValue = p.value * weight * posWeight;
    totalValue += effectiveValue;
    if (i < 11) { starterValue += effectiveValue; starterCount++; }
  }

  const starterConcentration = starterCount > 0 ? starterValue / totalValue : 0.5;
  const concentrationBonus = 1 + 0.15 * (starterConcentration - 0.5);

  return Math.round(totalValue * concentrationBonus);
};

/** Get effective attack/defense ratings accounting for injuries */
WC26.getEffectiveAtkDef = function(team) {
  const base = WC26.TEAMS[team] || {};
  let atk = base.atk || 1.0;
  let def = base.def || 1.0;

  const squad = WC26.SQUADS[team];
  const injured = WC26.INJURIES[team] || [];
  if (!squad || squad.length === 0 || injured.length === 0) return { atk, def };

  const injuredNames = new Set(injured.map(x => x.player));
  // Compute total squad value for weight calculation
  const totalSquadValue = squad.reduce((s, p) => s + (p.value || 1), 0);
  let injuredAtkWeight = 0, injuredDefWeight = 0;
  let totalAtkWeight = 0, totalDefWeight = 0;

  for (let i = 0; i < Math.min(squad.length, 11); i++) {
    const p = squad[i];
    const valueWeight = (p.value || 1) / totalSquadValue;
    // Position-based attack/defense contribution
    const atkContrib = p.pos === 'FWD' ? valueWeight * 2.5 :
                       p.pos === 'MID' ? valueWeight * 1.5 :
                       p.pos === 'DEF' ? valueWeight * 0.5 : valueWeight * 0.2;
    const defContrib = (p.pos === 'DEF' || p.pos === 'GK') ? valueWeight * 2.0 : valueWeight * 0.3;
    totalAtkWeight += atkContrib;
    totalDefWeight += defContrib;
    if (injuredNames.has(p.name)) {
      injuredAtkWeight += atkContrib;
      injuredDefWeight += defContrib;
    }
  }

  if (totalAtkWeight > 0) {
    const atkPenalty = injuredAtkWeight / totalAtkWeight;
    atk *= (1 - atkPenalty * 0.4);
  }
  if (totalDefWeight > 0) {
    const defPenalty = injuredDefWeight / totalDefWeight;
    def *= (1 - defPenalty * 0.3);
  }

  return { atk: Math.max(0.7, atk), def: Math.max(0.7, def) };
};

/** Load squads and injuries from localStorage */
WC26.loadSquadData = function() {
  try {
    const raw = localStorage.getItem('wc2026_squads');
    if (raw) WC26.SQUADS = JSON.parse(raw);
    const rawInj = localStorage.getItem('wc2026_injuries');
    if (rawInj) WC26.INJURIES = JSON.parse(rawInj);
  } catch(e) {}
};

/** Save squads and injuries to localStorage */
WC26.saveSquadData = function() {
  try {
    localStorage.setItem('wc2026_squads', JSON.stringify(WC26.SQUADS));
    localStorage.setItem('wc2026_injuries', JSON.stringify(WC26.INJURIES));
  } catch(e) {}
};

// Initialize on load
WC26.loadSquadData();

// ── Tilt system (B1): offensive/defensive tendency ─────────────────────────

/**
 * Tilt (-1 to +1): positive = attack-minded, negative = defensive.
 * Two components:
 * 1. Squad Tilt: positional distribution of squad (FWD-heavy → positive)
 * 2. Tactical Tilt: goals scored vs xG residual (requires match history)
 *
 * Applied in getFormAdjustedLambdas:
 *   lh *= (1 + 0.10 * tilt)   — attack-minded teams score more
 *   la *= (1 - 0.05 * tilt)   — but also concede slightly more
 */
/** Tilt (-1 to +1): offensive/defensive tendency.
 *  Uses form as proxy for tactical tendency (attack-minded = high form).
 *  NOT derived from atk/def to avoid double-counting (atk/def already
 *  used in getLambdas via atkMod). When squad data is available, blends
 *  with positional distribution. */
WC26.getTilt = function(team) {
  const t = WC26.TEAMS[team];
  if (!t) return 0;

  // Tactical tilt: form correlates with attack-minded play
  // High form → positive tilt (team is playing attacking football)
  const tacticalTilt = (t.form - 0.5) * 0.8; // range: -0.4 to +0.4

  // Squad tilt: if squad data available, blend with positional distribution
  const squad = WC26.SQUADS[team];
  if (squad && squad.length >= 11) {
    let fwdCount = 0, defCount = 0;
    for (let i = 0; i < Math.min(squad.length, 11); i++) {
      if (squad[i].pos === 'FWD') fwdCount++;
      if (squad[i].pos === 'DEF' || squad[i].pos === 'GK') defCount++;
    }
    const squadTilt = Math.max(-1, Math.min(1, (fwdCount - defCount) / 5));
    return squadTilt * 0.5 + tacticalTilt * 0.5;
  }

  // No squad data: use only tactical tilt (form-based)
  return Math.max(-1, Math.min(1, tacticalTilt));
};

// ── Altitude effect (B3) ──────────────────────────────────────────────────

/** Altitude penalties:客队 lambda reduction at high-altitude venues.
 *  Mexico City (2240m) and Toluca (2680m) significantly affect performance.
 *  Values represent客队 lambda multiplier deficit (e.g., 0.15 = 15% reduction). */
WC26.ALTITUDE_EFFECT = {
  'Mexico City': 0.15,
  'Guadalajara': 0.08,
  'Toluca': 0.20,
};

/** Get altitude penalty for a venue. Returns客队 lambda multiplier (0.80-1.0). */
WC26.getAltitudePenalty = function(venue) {
  if (!venue) return 1.0;
  for (const [city, penalty] of Object.entries(WC26.ALTITUDE_EFFECT)) {
    if (venue.includes(city)) return 1 - penalty;
  }
  return 1.0;
};

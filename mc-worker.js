// mc-worker.js — Monte Carlo worker for parallel simulation
// Runs a batch of tournament simulations and returns aggregated results

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// Load model files (same as compute-server.js)
const dir = __dirname;
globalThis.WC26 = {};
eval(fs.readFileSync(path.join(dir, 'data/teams.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'data/matches.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/stats.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/elo.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/dixon-coles.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/gbdt.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/monte-carlo.js'), 'utf8'));

const TEAMS = globalThis.TEAMS || WC26.TEAMS;

const { batchSize, actualResults, marketOdds, savedElo } = workerData;

// Setup
WC26.rebuildDynamicElo(actualResults);
WC26.trainAndBlendGBDT(actualResults);
const actualMap = WC26.buildActualResultsMap(actualResults);
const preFormMap = {};
for (const t of Object.keys(TEAMS)) preFormMap[t] = TEAMS[t].form;

// Run batch
const champ = {}, finalist = {}, semi = {}, quarter = {}, r16 = {};
let successCount = 0;
const history = [];

for (let i = 0; i < batchSize; i++) {
  Object.assign(WC26.dynamicElo, savedElo);
  try {
    const result = WC26.simulateOneTournament(actualMap, preFormMap, marketOdds);
    if (!result || !result.champion) continue;
    champ[result.champion] = (champ[result.champion] || 0) + 1;
    if (result.rounds && result.rounds.length >= 4) for (const m of result.rounds[3]) { finalist[m.a] = (finalist[m.a] || 0) + 1; finalist[m.b] = (finalist[m.b] || 0) + 1; }
    if (result.rounds && result.rounds.length >= 3) for (const m of result.rounds[2]) { semi[m.a] = (semi[m.a] || 0) + 1; semi[m.b] = (semi[m.b] || 0) + 1; }
    if (result.rounds && result.rounds.length >= 2) for (const m of result.rounds[1]) { quarter[m.a] = (quarter[m.a] || 0) + 1; quarter[m.b] = (quarter[m.b] || 0) + 1; }
    if (result.rounds && result.rounds.length >= 1) for (const m of result.rounds[0]) { r16[m.a] = (r16[m.a] || 0) + 1; r16[m.b] = (r16[m.b] || 0) + 1; }
    const mr = {};
    result.rounds.slice(0, 4).forEach((round, ri) => {
      for (const m of round) mr[m.a + '|' + m.b] = { ga: m.ga, gb: m.gb, round: ri + 1 };
    });
    history.push({ champion: result.champion, matchResults: mr });
    successCount++;
  } catch (e) { console.warn('[MC Worker] Simulation failed:', e.message); }
}

parentPort.postMessage({ champ, finalist, semi, quarter, r16, successCount, history });

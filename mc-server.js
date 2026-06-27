#!/usr/bin/env node
// Server-side Monte Carlo simulation
// Usage: echo '{"actualResults":[],"N":10000}' | node mc-server.js

const fs = require('fs');
const path = require('path');

const dir = __dirname;

// Load all model files
globalThis.WC26 = {};
eval(fs.readFileSync(path.join(dir, 'data/teams.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'data/matches.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/stats.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/elo.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/dixon-coles.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/gbdt.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'model/monte-carlo.js'), 'utf8'));

const TEAMS = globalThis.TEAMS;

async function runMC(input) {
  const { actualResults, N } = input;
  const n = N || 10000;
  const results = actualResults || [];

  try {
    WC26.initDynamicElo();
    WC26.rebuildDynamicElo(results);
    WC26.trainAndBlendGBDT(results);
  } catch (e) {
    console.error('Init error:', e.message);
  }
  const savedElo = { ...WC26.dynamicElo };

  const actualMap = WC26.buildActualResultsMap(results);
  const preFormMap = {};
  const teamKeys = Object.keys(TEAMS || {});
  for (const t of teamKeys) preFormMap[t] = TEAMS[t].form;

  const champ = {}, finalist = {}, semi = {}, quarter = {}, r16 = {};
  let successCount = 0;

  for (let i = 0; i < n; i++) {
    Object.assign(WC26.dynamicElo, savedElo);
    try {
      const result = WC26.simulateOneTournament(actualMap, preFormMap, {});
      if (!result || !result.champion) continue;
      champ[result.champion] = (champ[result.champion] || 0) + 1;
      if (result.rounds && result.rounds.length >= 4) for (const m of result.rounds[3]) { finalist[m.a] = (finalist[m.a]||0)+1; finalist[m.b] = (finalist[m.b]||0)+1; }
      if (result.rounds && result.rounds.length >= 3) for (const m of result.rounds[2]) { semi[m.a] = (semi[m.a]||0)+1; semi[m.b] = (semi[m.b]||0)+1; }
      if (result.rounds && result.rounds.length >= 2) for (const m of result.rounds[1]) { quarter[m.a] = (quarter[m.a]||0)+1; quarter[m.b] = (quarter[m.b]||0)+1; }
      if (result.rounds && result.rounds.length >= 1) for (const m of result.rounds[0]) { r16[m.a] = (r16[m.a]||0)+1; r16[m.b] = (r16[m.b]||0)+1; }
      successCount++;
    } catch (e) {
      // Skip failed simulations
    }
  }

  return { champ, finalist, semi, quarter, r16, N: successCount };
}

// Read input from stdin
let inputData = '';
process.stdin.on('data', chunk => inputData += chunk);
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(inputData);
    const result = await runMC(input);
    process.stdout.write(JSON.stringify(result));
  } catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
  }
});

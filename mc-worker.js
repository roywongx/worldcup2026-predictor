// MC Web Worker — runs tournament simulations off the main thread
// Make WC26 available as both self.WC26 and window.WC26 for module compatibility
self.WC26 = {};
self.window = self;  // Must be AFTER WC26 is defined so modules can find it

importScripts(
  'data/teams.js',
  'data/matches.js',
  'model/stats.js',
  'model/elo.js',
  'model/dixon-coles.js',
  'model/gbdt.js',
  'model/monte-carlo.js'
);

self.onmessage = function(e) {
  const { type, actualMap, formMap, marketOddsMap, actualResults, N, chunkSize } = e.data;

  if (type === 'simulate') {
    try {
      // Initialize dynamic Elo and rebuild from actual results
      self.WC26.initDynamicElo();
      self.WC26.rebuildDynamicElo(actualResults || []);
      const savedElo = { ...self.WC26.dynamicElo };
      self.WC26.initDynamicElo();

      const champ = {}, finalist = {}, semi = {}, quarter = {}, r16 = {};
      const history = [];
      const cs = chunkSize || 500;
      let done = 0;

      function processChunk() {
        try {
          const end = Math.min(done + cs, N);
          for (let i = done; i < end; i++) {
            const result = self.WC26.simulateOneTournament(actualMap, formMap, marketOddsMap);
            champ[result.champion] = (champ[result.champion] || 0) + 1;
            if (result.rounds.length >= 4) for (const m of result.rounds[3]) { finalist[m.a] = (finalist[m.a]||0)+1; finalist[m.b] = (finalist[m.b]||0)+1; }
            if (result.rounds.length >= 3) for (const m of result.rounds[2]) { semi[m.a] = (semi[m.a]||0)+1; semi[m.b] = (semi[m.b]||0)+1; }
            if (result.rounds.length >= 2) for (const m of result.rounds[1]) { quarter[m.a] = (quarter[m.a]||0)+1; quarter[m.b] = (quarter[m.b]||0)+1; }
            if (result.rounds.length >= 1) for (const m of result.rounds[0]) { r16[m.a] = (r16[m.a]||0)+1; r16[m.b] = (r16[m.b]||0)+1; }
            const mr = {};
            result.rounds.slice(0, 4).forEach((round, ri) => {
              for (const m of round) mr[`${m.a}|${m.b}`] = { ga: m.ga, gb: m.gb, round: ri + 1 };
            });
            history.push({ champion: result.champion, matchResults: mr });
          }
          done = end;
          self.postMessage({ type: 'progress', done, total: N });
          if (done < N) {
            setTimeout(processChunk, 0);
          } else {
            self.postMessage({ type: 'done', champ, finalist, semi, quarter, r16, N, history });
          }
        } catch(err) {
          self.postMessage({ type: 'error', message: err.message, stack: err.stack });
        }
      }
      processChunk();
    } catch(err) {
      self.postMessage({ type: 'error', message: err.message, stack: err.stack });
    }
  }
};

'use strict';
// 新赛季生成与每日刷新的验收契约（合成数据、不联网、不读 data/clubs/）。
// 纯函数都在 engine/season.js：这里直接 require，不 eval cli.js。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const seasonLib = require('../engine/season');

const teams = n => Array.from({ length: n }, (_, i) => `Club${String(i).padStart(2, '0')}`);

// 英超式模板（20 队、无附加赛）
const TPL20 = {
  id: 'premier-league-2026-27',
  division: 'E0',
  season: '2627',
  name: 'Premier League',
  nameZh: '英格兰足球超级联赛',
  teams: 20,
  tiebreak: ['pts', 'gd', 'gf'],
  zones: [
    { key: 'title', from: 1, to: 1, label: '冠军', labelEn: 'Title' },
    { key: 'ucl', from: 1, to: 4, label: '欧冠', labelEn: 'Champions League' },
    { key: 'relegation', from: 18, to: 20, label: '降级', labelEn: 'Relegation' },
  ],
  names: { Club00: '零队', Club01: '一队' },
  sources: ['https://example.com/table'],
  notes: '同分规则按官方顺序，最后随机。',
};

// 德甲/法甲式模板（18 队、有保级附加赛）
const TPL18 = {
  id: 'ligue-1-2026-27',
  division: 'F1',
  season: '2627',
  name: 'Ligue 1',
  nameZh: '法国足球甲级联赛',
  teams: 18,
  tiebreak: ['pts', 'gd', 'gf'],
  zones: [
    { key: 'title', from: 1, to: 1, label: '冠军', labelEn: 'Title' },
    { key: 'ucl', from: 1, to: 4, label: '欧冠', labelEn: 'Champions League' },
    { key: 'relegation_playoff', from: 16, to: 16, label: '保级附加赛', labelEn: 'Relegation play-off' },
    { key: 'relegation', from: 17, to: 18, label: '降级', labelEn: 'Relegation' },
  ],
  names: {},
  sources: ['https://example.com/ligue1'],
  notes: '18 队。第 16 名打保级附加赛，17–18 名直接降级。同分规则为近似。',
};

const zoneMap = cfg => Object.fromEntries(cfg.zones.map(z => [z.key, [z.from, z.to]]));
const match = (division, s, home, away) => ({
  date: '2027-08-15', day: 1, home, away, hg: 1, ag: 0,
  tournament: division, division, season: s, neutral: false, market: null,
});

test('赛季代码：下赛季、标签、联赛 id', () => {
  assert.equal(seasonLib.nextSeasonCode('2627'), '2728');
  assert.equal(seasonLib.nextSeasonCode('2526'), '2627');
  assert.equal(seasonLib.nextSeasonCode('9900'), '0001');
  assert.equal(seasonLib.seasonLabel('2728'), '2027-28');
  assert.equal(seasonLib.leagueIdFor('premier-league-2026-27', '2728'), 'premier-league-2027-28');
  assert.equal(seasonLib.leagueIdFor('ligue-1-2026-27', '2728'), 'ligue-1-2027-28');
  assert.throws(() => seasonLib.nextSeasonCode('2729'), /连续两年/);
  assert.throws(() => seasonLib.seasonYears('2027'), /连续两年/);
  assert.throws(() => seasonLib.seasonYears('272'), /4 位/);
  assert.throws(() => seasonLib.leagueIdFor('premier-league', '2728'), /无法从 id/);
});

test('区间：20 队无附加赛 → relegation 18–20；18 队有附加赛 → 附加赛 16、降级 17–18', () => {
  const a = seasonLib.deriveZones(TPL20.zones, 20);
  assert.deepEqual(zoneMap({ zones: a }), { title: [1, 1], ucl: [1, 4], relegation: [18, 20] });
  assert.deepEqual(a[2], { key: 'relegation', from: 18, to: 20, label: '降级', labelEn: 'Relegation' }, 'label 等字段原样保留');

  const b = seasonLib.deriveZones(TPL18.zones, 18);
  assert.deepEqual(zoneMap({ zones: b }), {
    title: [1, 1], ucl: [1, 4], relegation_playoff: [16, 16], relegation: [17, 18],
  });
  assert.deepEqual(TPL18.zones[2], { key: 'relegation_playoff', from: 16, to: 16, label: '保级附加赛', labelEn: 'Relegation play-off' }, '不修改模板');
  assert.deepEqual(TPL18.zones[3], { key: 'relegation', from: 17, to: 18, label: '降级', labelEn: 'Relegation' });
});

test('区间：队数变化时重算——18→20 队附加赛 18、降级 19–20；20→18 队降级 16–18', () => {
  assert.deepEqual(zoneMap({ zones: seasonLib.deriveZones(TPL18.zones, 20) }), {
    title: [1, 1], ucl: [1, 4], relegation_playoff: [18, 18], relegation: [19, 20],
  });
  assert.deepEqual(zoneMap({ zones: seasonLib.deriveZones(TPL20.zones, 18) }), {
    title: [1, 1], ucl: [1, 4], relegation: [16, 18],
  });
  // 未知键原样保留
  const extra = [...TPL20.zones, { key: 'europa', from: 5, to: 6, label: '欧联' }];
  assert.deepEqual(zoneMap({ zones: seasonLib.deriveZones(extra, 18) }).europa, [5, 6]);
  assert.throws(() => seasonLib.deriveZones(TPL20.zones, 0), /≥ 4/);
});

test('区间不重叠：附加赛与直接降级不会落在同一名次上', () => {
  for (const n of [18, 20]) {
    const z = zoneMap({ zones: seasonLib.deriveZones(TPL18.zones, n) });
    const [pFrom, pTo] = z.relegation_playoff, [rFrom, rTo] = z.relegation;
    assert.equal(pFrom, pTo, '附加赛只占一个名次');
    assert.equal(pFrom, n - 2, `${n} 队：附加赛是倒数第 3`);
    assert.deepEqual([rFrom, rTo], [n - 1, n], `${n} 队：直接降级是倒数 2 名`);
    assert.ok(pTo < rFrom, '两个区间不能交叠');
  }
});

test('notes：写死的队数与降级名次跟着新队数改写，sources 不动', () => {
  const cfg = seasonLib.buildSeasonConfig(TPL18, { season: '2728', teams: teams(20) });
  assert.equal(cfg.notes, '20 队。第 18 名打保级附加赛，19–20 名直接降级。同分规则为近似。');
  assert.deepEqual(cfg.sources, TPL18.sources);
  assert.equal(seasonLib.rewriteNotes(TPL20.notes, { oldTeams: 20, newTeams: 18, zones: TPL20.zones }), TPL20.notes, '没有写死队数的 notes 原样保留');
  // 「前 3 名」「第 4 名」这类非队数的名次不能被误改
  const note = '18 队。前 3 名直接进联赛阶段，第 4 名打资格赛。';
  assert.equal(seasonLib.rewriteNotes(note, { oldTeams: 18, newTeams: 20, zones: TPL18.zones }), '20 队。前 3 名直接进联赛阶段，第 4 名打资格赛。');
});

test('新配置：id / season / teams / zones 由新赛季推导，names 与其它字段沿用模板', () => {
  const list = teams(20);
  const cfg = seasonLib.buildSeasonConfig(TPL20, { season: '2728', teams: list });
  assert.equal(cfg.id, 'premier-league-2027-28');
  assert.equal(cfg.season, '2728');
  assert.equal(cfg.teams, 20);
  assert.equal(cfg.division, 'E0');
  assert.deepEqual(cfg.tiebreak, TPL20.tiebreak);
  assert.deepEqual(cfg.names, TPL20.names);
  assert.deepEqual(zoneMap(cfg), { title: [1, 1], ucl: [1, 4], relegation: [18, 20] });

  const missing = seasonLib.missingNames(list, cfg.names);
  assert.equal(missing.length, 18);
  assert.ok(missing.includes('Club19') && !missing.includes('Club00'), '模板里已有的名字不算缺');
});

test('未开赛赛季：没有比赛数据就报错（提示先 fetch-clubs），不写任何文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-newseason-'));
  try {
    const matches = [match('E0', '2627', 'Club00', 'Club01')];
    assert.throws(() => seasonLib.teamsForSeason(matches, 'E0', '2728'), /fetch-clubs/);
    assert.throws(() => seasonLib.buildSeasonConfig(TPL20, { season: '2728', teams: [] }), /fetch-clubs/);
    assert.deepEqual(fs.readdirSync(dir), [], '不得写出半成品配置');
    assert.equal(seasonLib.teamsForSeason(matches, 'E0', '2627').length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('同名文件：默认不覆盖，且原文件内容不变；--force 才覆盖', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-newseason-'));
  try {
    const file = path.join(dir, 'premier-league-2027-28.json');
    fs.writeFileSync(file, '{"sentinel":true}\n');
    const cfg = seasonLib.buildSeasonConfig(TPL20, { season: '2728', teams: teams(20) });
    assert.throws(() => seasonLib.writeSeasonConfig(dir, cfg), /已存在/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"sentinel":true}\n', '被拒绝时不得改动原文件');
    const written = seasonLib.writeSeasonConfig(dir, cfg, { force: true });
    assert.equal(written, file);
    const back = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(back.season, '2728');
    assert.equal(back.teams, 20);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refresh 判定：已结束的国家队赛事跳过，进行中的照跑', () => {
  assert.equal(seasonLib.isEventActive({ end: '2027-02-05' }, '2026-10-28'), true);
  assert.equal(seasonLib.isEventActive({ end: '2026-10-28' }, '2026-10-28'), true, '结束当天仍算在赛');
  assert.equal(seasonLib.isEventActive({ end: '2026-06-11' }, '2026-10-28'), false);
  assert.equal(seasonLib.isEventActive({}, '2026-10-28'), false);
});

test('refresh 判定：联赛有比赛且未到 5 月 31 日才刷新，已结束的跳过', () => {
  const cfg = { division: 'E0', season: '2627' };
  const ms = [match('E0', '2627', 'A', 'B'), match('E0', '2627', 'B', 'C'), match('SP1', '2627', 'D', 'E')];
  const live = seasonLib.leagueSeasonState(cfg, ms, '2026-10-28');
  assert.deepEqual(live, { played: 2, hasMatches: true, end: '2027-05-31', ended: false, run: true });
  assert.equal(seasonLib.leagueSeasonState(cfg, ms, '2027-05-31').run, true, '结束日当天仍刷');
  const ended = seasonLib.leagueSeasonState(cfg, ms, '2027-06-01');
  assert.equal(ended.ended, true);
  assert.equal(ended.run, false);
  const notStarted = seasonLib.leagueSeasonState({ division: 'E0', season: '2728' }, ms, '2027-06-01');
  assert.deepEqual([notStarted.played, notStarted.hasMatches, notStarted.run], [0, false, false]);
});

test('今天用上海日期：UTC 还是前一天时也按上海算', () => {
  assert.equal(seasonLib.shanghaiToday(new Date('2026-10-27T20:00:00Z')), '2026-10-28');
  assert.equal(seasonLib.shanghaiToday(new Date('2026-10-27T15:59:59Z')), '2026-10-27');
  assert.equal(seasonLib.shanghaiToday(new Date('2027-01-01T00:30:00Z')), '2027-01-01');
});

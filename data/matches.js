// World Cup 2026 Predictor — extracted module
// data/matches.js — Match schedule, venues, and third-place matrix
window.WC26 = window.WC26 || {};

/** Match schedule: [date, BJTime, home, away, group] */
WC26.MATCHES = [
  // MD1
  ["2026-06-11","03:00","Mexico","South Africa","A"],
  ["2026-06-11","09:00","South Korea","Czech Republic","A"],
  ["2026-06-12","03:00","Canada","Bosnia Herzegovina","B"],
  ["2026-06-12","09:00","United States","Paraguay","D"],
  ["2026-06-13","12:00","Australia","Turkey","D"],
  ["2026-06-13","03:00","Qatar","Switzerland","B"],
  ["2026-06-13","06:00","Brazil","Morocco","C"],
  ["2026-06-13","09:00","Haiti","Scotland","C"],
  ["2026-06-14","01:00","Germany","Curaçao","E"],
  ["2026-06-14","04:00","Netherlands","Japan","F"],
  ["2026-06-14","07:00","Ivory Coast","Ecuador","E"],
  ["2026-06-14","09:00","Sweden","Tunisia","F"],
  ["2026-06-15","00:00","Spain","Cape Verde","H"],
  ["2026-06-15","03:00","Belgium","Egypt","G"],
  ["2026-06-15","06:00","Saudi Arabia","Uruguay","H"],
  ["2026-06-15","09:00","Iran","New Zealand","G"],
  ["2026-06-16","03:00","France","Senegal","I"],
  ["2026-06-16","06:00","Iraq","Norway","I"],
  ["2026-06-16","09:00","Argentina","Algeria","J"],
  ["2026-06-17","12:00","Austria","Jordan","J"],
  ["2026-06-17","01:00","Portugal","DR Congo","K"],
  ["2026-06-17","04:00","England","Croatia","L"],
  ["2026-06-17","07:00","Ghana","Panama","L"],
  ["2026-06-17","10:00","Uzbekistan","Colombia","K"],
  // MD2
  ["2026-06-18","00:00","Czech Republic","South Africa","A"],
  ["2026-06-18","03:00","Switzerland","Bosnia Herzegovina","B"],
  ["2026-06-18","09:00","Mexico","South Korea","A"],
  ["2026-06-18","09:00","Canada","Qatar","B"],
  ["2026-06-19","03:00","United States","Australia","D"],
  ["2026-06-19","06:00","Scotland","Morocco","C"],
  ["2026-06-19","09:00","Brazil","Haiti","C"],
  ["2026-06-19","09:00","Turkey","Paraguay","D"],
  ["2026-06-20","01:00","Netherlands","Sweden","F"],
  ["2026-06-20","04:00","Germany","Ivory Coast","E"],
  ["2026-06-20","08:00","Ecuador","Curaçao","E"],
  ["2026-06-21","12:00","Tunisia","Japan","F"],
  ["2026-06-22","00:00","Spain","Saudi Arabia","H"],
  ["2026-06-22","03:00","Belgium","Iran","G"],
  ["2026-06-22","06:00","Uruguay","Cape Verde","H"],
  ["2026-06-22","09:00","New Zealand","Egypt","G"],
  ["2026-06-23","01:00","Argentina","Austria","J"],
  ["2026-06-23","05:00","France","Iraq","I"],
  ["2026-06-23","08:00","Norway","Senegal","I"],
  ["2026-06-23","11:00","Jordan","Algeria","J"],
  ["2026-06-24","01:00","Portugal","Uzbekistan","K"],
  ["2026-06-24","04:00","England","Ghana","L"],
  ["2026-06-24","07:00","Panama","Croatia","L"],
  ["2026-06-24","10:00","Colombia","DR Congo","K"],
  // MD3
  ["2026-06-25","03:00","Bosnia Herzegovina","Qatar","B"],
  ["2026-06-25","06:00","Scotland","Brazil","C"],
  ["2026-06-25","06:00","Morocco","Haiti","C"],
  ["2026-06-25","09:00","Czech Republic","Mexico","A"],
  ["2026-06-25","09:00","South Africa","South Korea","A"],
  ["2026-06-25","09:00","Switzerland","Canada","B"],
  ["2026-06-26","04:00","Ecuador","Germany","E"],
  ["2026-06-26","04:00","Curaçao","Ivory Coast","E"],
  ["2026-06-26","07:00","Japan","Sweden","F"],
  ["2026-06-26","07:00","Tunisia","Netherlands","F"],
  ["2026-06-26","10:00","Turkey","United States","D"],
  ["2026-06-26","10:00","Paraguay","Australia","D"],
  ["2026-06-27","03:00","Norway","France","I"],
  ["2026-06-27","03:00","Senegal","Iraq","I"],
  ["2026-06-27","08:00","Cape Verde","Saudi Arabia","H"],
  ["2026-06-27","08:00","Uruguay","Spain","H"],
  ["2026-06-27","11:00","Egypt","Iran","G"],
  ["2026-06-27","11:00","New Zealand","Belgium","G"],
  ["2026-06-28","05:00","Panama","England","L"],
  ["2026-06-28","05:00","Croatia","Ghana","L"],
  ["2026-06-28","07:00","Colombia","Portugal","K"],
  ["2026-06-28","07:00","DR Congo","Uzbekistan","K"],
  ["2026-06-28","10:00","Algeria","Austria","J"],
  ["2026-06-28","10:00","Jordan","Argentina","J"]
];

/** Match venues (by MATCHES order) */
WC26.VENUES = [
  // MD1 (0-23)
  "Mexico City 🇲🇽","Guadalajara 🇲🇽",
  "Toronto 🇨🇦","Los Angeles 🇺🇸",
  "Vancouver 🇨🇦","San Francisco 🇺🇸","New York 🇺🇸","Boston 🇺🇸",
  "Houston 🇺🇸","Dallas 🇺🇸","Philadelphia 🇺🇸","Monterrey 🇲🇽",
  "Atlanta 🇺🇸","Seattle 🇺🇸","Miami 🇺🇸","Los Angeles 🇺🇸",
  "New York 🇺🇸","Boston 🇺🇸","Kansas City 🇺🇸","San Francisco 🇺🇸",
  "Houston 🇺🇸","Dallas 🇺🇸","Toronto 🇨🇦","Mexico City 🇲🇽",
  // MD2 (24-47)
  "Atlanta 🇺🇸","Guadalajara 🇲🇽","Los Angeles 🇺🇸","Vancouver 🇨🇦",
  "Seattle 🇺🇸","Boston 🇺🇸","San Francisco 🇺🇸","Philadelphia 🇺🇸",
  "Houston 🇺🇸","Toronto 🇨🇦","Kansas City 🇺🇸","Guadalajara 🇲🇽",
  "Atlanta 🇺🇸","Los Angeles 🇺🇸","Miami 🇺🇸","Vancouver 🇨🇦",
  "Dallas 🇺🇸","Philadelphia 🇺🇸","New York 🇺🇸","San Francisco 🇺🇸",
  "Houston 🇺🇸","Boston 🇺🇸","Toronto 🇨🇦","Guadalajara 🇲🇽",
  // MD3 (48-71)
  "Vancouver 🇨🇦","Miami 🇺🇸","Seattle 🇺🇸","Mexico City 🇲🇽","Monterrey 🇲🇽","Atlanta 🇺🇸",
  "Philadelphia 🇺🇸","New York 🇺🇸","Dallas 🇺🇸","Kansas City 🇺🇸","Los Angeles 🇺🇸","San Francisco 🇺🇸",
  "Boston 🇺🇸","Toronto 🇨🇦","Houston 🇺🇸","Guadalajara 🇲🇽","Seattle 🇺🇸","Vancouver 🇨🇦",
  "New York 🇺🇸","Philadelphia 🇺🇸","Miami 🇺🇸","Atlanta 🇺🇸","Dallas 🇺🇸","Kansas City 🇺🇸"
];

/** Match Beijing times lookup */
WC26.MATCH_TIMES = {};
WC26.MATCHES.forEach(([utcDate,bjTime,home,away]) => {
  WC26.MATCH_TIMES[`${home}|${away}|${utcDate}`] = bjTime;
});

/** FIFA Annex C: third-place combination matrix */
WC26.TPM={"ABCDEFGH":"HGBCAFDE","ABCDEFGI":"CGBDAFEI","ABCDEFGJ":"CGBDAFEJ","ABCDEFGK":"CGBDAFEK","ABCDEFGL":"CGBDAFLE","ABCDEFHI":"HEBCAFDI","ABCDEFHJ":"HJBCAFDE","ABCDEFHK":"HEBCAFDK","ABCDEFHL":"HFBCADLE","ABCDEFIJ":"CJBDAFEI","ABCDEFIK":"CEBDAFIK","ABCDEFIL":"CEBDAFLI","ABCDEFJK":"CJBDAFEK","ABCDEFJL":"CJBDAFLE","ABCDEFKL":"CEBDAFLK","ABCDEGHI":"HGBCADEI","ABCDEGHJ":"HGBCADEJ","ABCDEGHK":"HGBCADEK","ABCDEGHL":"HGBCADLE","ABCDEGIJ":"EGBCADIJ","ABCDEGIK":"EGBCADIK","ABCDEGIL":"EGBCADLI","ABCDEGJK":"EGBCADJK","ABCDEGJL":"EGBCADLJ","ABCDEGKL":"EGBCADLK","ABCDEHIJ":"HJBCADEI","ABCDEHIK":"HEBCADIK","ABCDEHIL":"HEBCADLI","ABCDEHJK":"HJBCADEK","ABCDEHJL":"HJBCADLE","ABCDEHKL":"HEBCADLK","ABCDEIJK":"EJBCADIK","ABCDEIJL":"EJBCADLI","ABCDEIKL":"EIBCADLK","ABCDEJKL":"EJBCADLK"};

/** Pre-built venue lookup: key="date|home|away" → venue */
WC26.VENUE_MAP = {};
WC26.MATCHES.forEach((m, i) => { WC26.VENUE_MAP[`${m[0]}|${m[2]}|${m[3]}`] = WC26.VENUES[i] || ''; });
WC26.getVenue = function(ta, tb, date) { return WC26.VENUE_MAP[`${date}|${ta}|${tb}`] || ''; };

/** 2022 World Cup Results (for backtesting) */
WC26.WC2022_RESULTS = [
  {t1:'Qatar',t2:'Ecuador',s1:0,s2:2},{t1:'Senegal',t2:'Netherlands',s1:0,s2:2},
  {t1:'Qatar',t2:'Senegal',s1:1,s2:3},{t1:'Netherlands',t2:'Ecuador',s1:1,s2:1},
  {t1:'Ecuador',t2:'Senegal',s1:1,s2:2},{t1:'Netherlands',t2:'Qatar',s1:2,s2:0},
  {t1:'England',t2:'Iran',s1:6,s2:2},{t1:'United States',t2:'Wales',s1:1,s2:1},
  {t1:'Wales',t2:'Iran',s1:0,s2:2},{t1:'England',t2:'United States',s1:0,s2:0},
  {t1:'Wales',t2:'England',s1:0,s2:3},{t1:'Iran',t2:'United States',s1:0,s2:1},
  {t1:'Argentina',t2:'Saudi Arabia',s1:1,s2:2},{t1:'Mexico',t2:'Poland',s1:0,s2:0},
  {t1:'Poland',t2:'Saudi Arabia',s1:2,s2:0},{t1:'Argentina',t2:'Mexico',s1:2,s2:0},
  {t1:'Poland',t2:'Argentina',s1:0,s2:2},{t1:'Saudi Arabia',t2:'Mexico',s1:1,s2:2},
  {t1:'France',t2:'Australia',s1:4,s2:1},{t1:'Denmark',t2:'Tunisia',s1:0,s2:0},
  {t1:'Tunisia',t2:'Australia',s1:0,s2:1},{t1:'France',t2:'Denmark',s1:2,s2:1},
  {t1:'Tunisia',t2:'France',s1:1,s2:0},{t1:'Australia',t2:'Denmark',s1:1,s2:0},
  {t1:'Germany',t2:'Japan',s1:1,s2:2},{t1:'Spain',t2:'Costa Rica',s1:7,s2:0},
  {t1:'Japan',t2:'Costa Rica',s1:0,s2:1},{t1:'Spain',t2:'Germany',s1:1,s2:1},
  {t1:'Japan',t2:'Spain',s1:2,s2:1},{t1:'Costa Rica',t2:'Germany',s1:2,s2:4},
  {t1:'Morocco',t2:'Croatia',s1:0,s2:0},{t1:'Belgium',t2:'Canada',s1:1,s2:0},
  {t1:'Belgium',t2:'Morocco',s1:0,s2:2},{t1:'Croatia',t2:'Canada',s1:4,s2:1},
  {t1:'Croatia',t2:'Belgium',s1:0,s2:0},{t1:'Canada',t2:'Morocco',s1:2,s2:1},
  {t1:'Switzerland',t2:'Cameroon',s1:1,s2:0},{t1:'Brazil',t2:'Serbia',s1:2,s2:0},
  {t1:'Cameroon',t2:'Serbia',s1:3,s2:3},{t1:'Brazil',t2:'Switzerland',s1:1,s2:0},
  {t1:'Cameroon',t2:'Brazil',s1:1,s2:0},{t1:'Serbia',t2:'Switzerland',s1:2,s2:3},
  {t1:'Uruguay',t2:'South Korea',s1:0,s2:0},{t1:'Portugal',t2:'Ghana',s1:3,s2:2},
  {t1:'South Korea',t2:'Ghana',s1:2,s2:3},{t1:'Portugal',t2:'Uruguay',s1:2,s2:0},
  {t1:'South Korea',t2:'Portugal',s1:2,s2:1},{t1:'Ghana',t2:'Uruguay',s1:0,s2:2},
];

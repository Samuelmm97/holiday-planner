const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: no inline script found'); process.exit(1); }
const src = m[1];

// 1) syntax check happens implicitly when we compile below, but write it too
fs.writeFileSync(path.join(__dirname, '_check.js'), src);

// 2) run with NO document so initUI never fires
const ctx = { console, Math, JSON, Date, Set, Map, Array, Object, String, Number, RegExp, Intl, isNaN, parseInt, parseFloat, setTimeout: () => {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'inline.js' });

const C = ctx.Core;
let fails = 0;
function ok(cond, label, extra) {
  if (cond) { console.log('  ok   ' + label); }
  else { fails++; console.log('  FAIL ' + label + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra))); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b }); }

console.log('Core shape');
ok(!!C, 'Core exists');
eq(C.EVENT.days, ['2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28'], '5 days = holiday +/-2');
eq(C.hours.length, 15, 'hour slots count (8..22 inclusive)');
eq(C.allSlots().length, 75, 'total slots = 5 days x 15 hours');

console.log('\nSlot keys');
const k = C.slotKey('2026-11-26', 14);
eq(k, '2026-11-26T14', 'slotKey pads and joins');
ok(C.isSlotKey(k), 'isSlotKey accepts good key');
ok(!C.isSlotKey('nope') && !C.isSlotKey(null) && !C.isSlotKey('2026-11-26'), 'isSlotKey rejects junk');
eq(C.normName('  Test   Alice '), 'test alice', 'normName collapses whitespace/case');

console.log('\nFormatting');
eq(C.fmtHour(8), '8 AM', 'fmtHour 8');
eq(C.fmtHour(12), '12 PM', 'fmtHour 12');
eq(C.fmtHour(22), '10 PM', 'fmtHour 22');
eq(C.fmtDay('2026-11-26'), 'Thu, Nov 26', 'fmtDay thanksgiving');

console.log('\nRegression: Thanksgiving 2026 really is a Thursday');
eq(new Date('2026-11-26T12:00:00').getDay(), 4, '2026-11-26 is Thursday (day 4)');

console.log('\nrangesOf');
const r1 = C.rangesOf(['2026-11-26T14','2026-11-26T15','2026-11-26T16','2026-11-26T18']);
eq(r1.length, 2, 'two blocks from 1,2,3pm + 6pm');
eq([r1[0].startHour, r1[0].endHour, r1[0].len], [14, 17, 3], 'first block 2pm-5pm = 3h');
eq([r1[1].startHour, r1[1].endHour, r1[1].len], [18, 19, 1], 'second block 1h');
const r2 = C.rangesOf([]);
eq(r2.length, 0, 'empty -> no blocks');
const r3 = C.rangesOf(['2026-11-26T08','2026-11-26T22']);
eq(r3.length, 2, '8am and 10pm are not contiguous');
const r4 = C.rangesOf(['2026-11-26T08','2026-11-26T09','2026-11-27T08']);
eq(r4.length, 2, 'blocks never span midnight');

console.log('\nrankWindows — full overlap');
const people = [
  { name: 'Alice', attending: true,  slots: ['2026-11-26T14','2026-11-26T15','2026-11-26T16','2026-11-27T12'] },
  { name: 'Bob',   attending: true,  slots: ['2026-11-26T16','2026-11-26T17','2026-11-26T18','2026-11-27T12'] },
];
const best = C.rankWindows(people);
eq(best.n, 2, 'n = 2 attending');
eq(best.everyone.length, 2, 'two shared windows (4pm Thu, 12pm Fri)');
eq(C.fmtRange(best.everyone[0]), 'Thu, Nov 26 · 4 PM – 5 PM', 'first shared window is Thu 4pm');
eq(best.everyone[0].len, 1, 'shared window length 1h');
eq(best.total, 2, 'total shared time = 2h');
// ordering: equal length -> earliest day/hour first
ok(best.everyone[0].day <= best.everyone[1].day, 'ties ordered by earliest start');

console.log('\nrankWindows — sorts by longest block first');
const p2 = [
  { name: 'A', attending: true, slots: ['2026-11-25T18','2026-11-25T19','2026-11-25T20','2026-11-26T14','2026-11-26T15'] },
  { name: 'B', attending: true, slots: ['2026-11-25T18','2026-11-25T19','2026-11-25T20','2026-11-26T14','2026-11-26T15','2026-11-26T16'] },
];
const b2 = C.rankWindows(p2);
eq(b2.everyone.map((w) => w.len), [3, 2], 'longest block (3h) ranked before 2h');
eq(C.fmtRange(b2.everyone[0]), 'Wed, Nov 25 · 6 PM – 9 PM', 'top block is Wed 6-9pm');

console.log('\nrankWindows — no overlap for everyone, near-miss ranking');
const p3 = [
  { name: 'A', attending: true, slots: ['2026-11-26T14','2026-11-26T15','2026-11-26T16'] },
  { name: 'B', attending: true, slots: ['2026-11-26T15','2026-11-26T16','2026-11-26T17'] },
  { name: 'C', attending: true, slots: ['2026-11-28T10'] },
];
const b3 = C.rankWindows(p3);
eq(b3.n, 3, 'n = 3');
eq(b3.everyone.length, 0, 'no window fits all three');
eq(b3.near[0].coverage, 2, 'best near-miss covers 2 of 3');
eq(C.fmtRange(b3.near[0]), 'Thu, Nov 26 · 3 PM – 5 PM', 'near-miss window is the 2h 2-person overlap (A ends 5pm, B starts 3pm)');
eq(C.missingFor(b3.near[0], p3), ['C'], 'missing list names the absent person');
eq(C.freeFor(b3.near[0], p3), ['A','B'], 'free list correct');
eq(b3.near[0].len, 2, 'near-miss length 2h');

console.log('\nrankWindows — declining person is excluded');
const p4 = [
  { name: 'A', attending: true,  slots: ['2026-11-26T14'] },
  { name: 'Nope', attending: false, slots: [] },
];
const b4 = C.rankWindows(p4);
eq(b4.n, 1, 'declined person not counted in n');
eq(b4.everyone.length, 1, 'single person gets their block listed');
eq(b4.everyone[0].coverage, 1, 'coverage 1 of 1');

console.log('\nrankWindows — empty input');
const b5 = C.rankWindows([]);
eq([b5.n, b5.everyone.length, b5.near.length], [0, 0, 0], 'no responses -> nothing');

console.log('\nNo duplicate / contained junk windows');
const b6 = C.rankWindows(p2);
const keys = b6.everyone.map((w) => w.day + w.startHour + w.endHour);
eq(new Set(keys).size, keys.length, 'no duplicate windows');
ok(b6.everyone.every((w) => w.len >= 1), 'every window at least 1 hour');

console.log('\ncoverageMap');
const cm = C.coverageMap(people);
eq((cm.get('2026-11-26T16') || []).slice().sort(), ['Alice','Bob'], 'Thu 4pm has both');
eq((cm.get('2026-11-26T14') || []), ['Alice'], 'Thu 2pm only Alice');
eq(cm.get('2026-11-28T20'), undefined, 'unpicked slot absent');

console.log('\nUI gating present in source');
ok(/function nameOk\(\)/.test(src), 'nameOk() exists');
ok(/if \(!nameOk\(\)\) \{ ev\.preventDefault\(\); nudgeName\(\); return; \}/.test(src), 'pointerdown is gated on name');
ok(/grid\.classList\.toggle\('locked', !ok\)/.test(src), 'grid locked when name missing');
ok(/function nudgeName/.test(src), 'nudgeName warns the user');

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL CHECKS PASSED'));
process.exit(fails ? 1 : 0);

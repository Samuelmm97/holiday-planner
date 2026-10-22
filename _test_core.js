const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: no inline script found'); process.exit(1); }
const src = m[1];

// syntax check: the whole script is compiled when the vm runs it below
fs.writeFileSync(path.join(__dirname, '_check.js'), src);

// run with NO document so initUI never fires
const ctx = { console, Math, JSON, Date, Set, Map, Array, Object, String, Number, RegExp, Intl, isNaN, isFinite, parseInt, parseFloat, setTimeout: () => {} };
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
eq(new Date('2026-11-26T12:00:00').getDay(), 4, '2026-11-26 is Thursday (day 4)');

console.log('\nPreset blocks');
eq(C.PRESETS.map((p) => p.key), ['lunch', 'dinner'], 'two blocks per day');
eq(C.PRESETS.map((p) => [p.start, p.end]), [[11, 15], [17, 21]], 'lunch 11-3, dinner 5-9 (4h each)');
eq(C.SPAN, 15, 'track spans 8am -> 11pm');

console.log('\nBlock model');
const def = C.defaultBlocks();
eq(Object.keys(def).length, 10, '5 days x 2 blocks initialised');
ok(Object.keys(def).every((k) => def[k].on === false), 'everything starts unselected');
eq(def['2026-11-26|lunch'], { start: 11, end: 15, on: false }, 'lunch defaults on Thanksgiving day');

const one = C.defaultBlocks();
one['2026-11-26|lunch'].on = true;
eq(C.slotsFromBlocks(one), ['2026-11-26T11','2026-11-26T12','2026-11-26T13','2026-11-26T14'], 'tapping lunch selects 4 hourly slots');
ok(C.slotsFromBlocks(C.defaultBlocks()).length === 0, 'nothing on -> no slots');

const two = C.defaultBlocks();
two['2026-11-26|lunch'].on = true;
two['2026-11-27|dinner'].on = true;
two['2026-11-27|dinner'].start = 18;
eq(C.slotsFromBlocks(two).length, 7, 'lunch 4h + adjusted dinner 3h = 7 slots');

console.log('\nHydrate what the server sends back');
const hy = C.hydrateBlocks([
  { day: '2026-11-26', slot: 'lunch', start: 12, end: 16 },
  { day: '2026-11-27', slot: 'dinner', start: 16, end: 20 },
  { day: 'garbage', slot: 'lunch', start: 1, end: 2 },
  { day: '2026-11-26', slot: 'brunch', start: 9, end: 10 },
  null
]);
eq(hy['2026-11-26|lunch'], { start: 12, end: 16, on: true }, 'custom lunch range restored');
eq(hy['2026-11-27|dinner'], { start: 16, end: 20, on: true }, 'custom dinner range restored');
eq(Object.keys(hy).length, 10, 'junk rows ignored, map still complete');
ok(hy['2026-11-25|lunch'].on === false, 'untouched days stay off');
const hy2 = C.hydrateBlocks([{ day: '2026-11-26', slot: 'lunch', start: 4, end: 99 }]);
eq([hy2['2026-11-26|lunch'].start, hy2['2026-11-26|lunch'].end], [8, 23], 'out-of-range hours clamped to 8..23');
eq(C.hydrateBlocks([])['2026-11-24|lunch'].on, false, 'empty list -> all off');

console.log('\nRound trip blocks -> slots -> blocks');
const rt = C.blocksFromSlots(C.slotsFromBlocks(two));
eq(rt['2026-11-26|lunch'], { start: 11, end: 15, on: true }, 'lunch survives the round trip');
eq(rt['2026-11-27|dinner'], { start: 18, end: 21, on: true }, 'adjusted dinner survives the round trip');
eq(C.blocksFromSlots([])['2026-11-24|lunch'].on, false, 'empty slots -> nothing on');

console.log('\nDragging the edges');
let b = C.defaultBlocks();
C.resizeBlock(b, '2026-11-26', 'lunch', 'r', 17);
eq(b['2026-11-26|lunch'].end, 17, 'lunch right edge can reach dinner start');
C.resizeBlock(b, '2026-11-26', 'lunch', 'r', 20);
eq(b['2026-11-26|lunch'].end, 17, 'lunch cannot swallow dinner');
C.resizeBlock(b, '2026-11-26', 'lunch', 'l', 9);
eq(b['2026-11-26|lunch'].start, 9, 'lunch left edge widens to 9am');
C.resizeBlock(b, '2026-11-26', 'lunch', 'l', 2);
eq(b['2026-11-26|lunch'].start, 8, 'cannot start before 8am');
C.resizeBlock(b, '2026-11-26', 'lunch', 'l', 23);
eq([b['2026-11-26|lunch'].start, b['2026-11-26|lunch'].end], [16, 17], 'left edge cannot pass the right edge (min 1 hour)');

b = C.defaultBlocks();
C.resizeBlock(b, '2026-11-26', 'dinner', 'l', 13);
eq(b['2026-11-26|dinner'].start, 15, 'dinner cannot start before lunch ends');
C.resizeBlock(b, '2026-11-26', 'dinner', 'r', 23);
eq(b['2026-11-26|dinner'].end, 23, 'dinner can stretch to 11pm');
C.resizeBlock(b, '2026-11-26', 'dinner', 'r', 30);
eq(b['2026-11-26|dinner'].end, 23, 'cannot end after 11pm');
C.resizeBlock(b, '2026-11-26', 'dinner', 'r', 8);
eq([b['2026-11-26|dinner'].start, b['2026-11-26|dinner'].end], [15, 16], 'right edge cannot pass the left edge');

console.log('\nPointer -> hour mapping');
eq(C.hourFromRatio(0), 8, 'left edge of track is 8am');
eq(C.hourFromRatio(1), 23, 'right edge of track is 11pm');
eq(C.hourFromRatio(0.5), 16, 'middle of track rounds to 4pm');
eq(C.hourFromRatio(-3), 8, 'off-track left clamps');
eq(C.hourFromRatio(9), 23, 'off-track right clamps');
eq(C.hourFromRatio(4 / 15), 12, 'start of the 4th hour = noon');

console.log('\nSlot keys and formatting');
eq(C.slotKey('2026-11-26', 14), '2026-11-26T14', 'slotKey pads and joins');
ok(C.isSlotKey('2026-11-26T14') && !C.isSlotKey('nope') && !C.isSlotKey(null), 'isSlotKey validates');
eq(C.normName('  Test   Alice '), 'test alice', 'normName collapses whitespace/case');
eq([C.fmtHour(8), C.fmtHour(12), C.fmtHour(22)], ['8 AM', '12 PM', '10 PM'], 'fmtHour');
eq([C.fmtHourTiny(11), C.fmtHourTiny(15), C.fmtHourTiny(12)], ['11a', '3p', '12p'], 'tiny hour labels');
eq(C.fmtDay('2026-11-26'), 'Thu, Nov 26', 'fmtDay');

console.log('\nrangesOf');
const r1 = C.rangesOf(['2026-11-26T14','2026-11-26T15','2026-11-26T16','2026-11-26T18']);
eq(r1.length, 2, 'two blocks from 1,2,3pm + 6pm');
eq([r1[0].startHour, r1[0].endHour, r1[0].len], [14, 17, 3], 'first block 2pm-5pm = 3h');
eq(C.rangesOf([]).length, 0, 'empty -> no blocks');
eq(C.rangesOf(['2026-11-26T08','2026-11-26T09','2026-11-27T08']).length, 2, 'blocks never span midnight');

console.log('\nrankWindows — full overlap');
const people = [
  { name: 'Alice', attending: true,  slots: ['2026-11-26T14','2026-11-26T15','2026-11-26T16','2026-11-27T12'] },
  { name: 'Bob',   attending: true,  slots: ['2026-11-26T16','2026-11-26T17','2026-11-26T18','2026-11-27T12'] },
];
const best = C.rankWindows(people);
eq(best.n, 2, 'n = 2 attending');
eq(best.everyone.length, 2, 'two shared windows (4pm Thu, 12pm Fri)');
eq(C.fmtRange(best.everyone[0]), 'Thu, Nov 26 · 4 PM – 5 PM', 'first shared window is Thu 4pm');
eq(best.total, 2, 'total shared time = 2h');
ok(best.everyone[0].day <= best.everyone[1].day, 'ties ordered by earliest start');

console.log('\nrankWindows — sorts by longest block first');
const p2 = [
  { name: 'A', attending: true, slots: ['2026-11-25T18','2026-11-25T19','2026-11-25T20','2026-11-26T14','2026-11-26T15'] },
  { name: 'B', attending: true, slots: ['2026-11-25T18','2026-11-25T19','2026-11-25T20','2026-11-26T14','2026-11-26T15','2026-11-26T16'] },
];
const b2 = C.rankWindows(p2);
eq(b2.everyone.map((w) => w.len), [3, 2], 'longest block (3h) ranked before 2h');
eq(C.fmtRange(b2.everyone[0]), 'Wed, Nov 25 · 6 PM – 9 PM', 'top block is Wed 6-9pm');

console.log('\nrankWindows — near-miss when nobody fully overlaps');
const p3 = [
  { name: 'A', attending: true, slots: ['2026-11-26T14','2026-11-26T15','2026-11-26T16'] },
  { name: 'B', attending: true, slots: ['2026-11-26T15','2026-11-26T16','2026-11-26T17'] },
  { name: 'C', attending: true, slots: ['2026-11-28T10'] },
];
const b3 = C.rankWindows(p3);
eq(b3.n, 3, 'n = 3');
eq(b3.everyone.length, 0, 'no window fits all three');
eq(b3.near[0].coverage, 2, 'best near-miss covers 2 of 3');
eq(C.fmtRange(b3.near[0]), 'Thu, Nov 26 · 3 PM – 5 PM', 'near-miss is the 2h two-person overlap');
eq(C.missingFor(b3.near[0], p3), ['C'], 'missing list names the absent person');
eq(C.freeFor(b3.near[0], p3), ['A','B'], 'free list correct');

console.log('\nrankWindows — declines and empty input');
const b4 = C.rankWindows([{ name: 'A', attending: true, slots: ['2026-11-26T14'] }, { name: 'Nope', attending: false, slots: [] }]);
eq([b4.n, b4.everyone.length], [1, 1], 'declined person excluded from n');
const b5 = C.rankWindows([]);
eq([b5.n, b5.everyone.length, b5.near.length], [0, 0, 0], 'no responses -> nothing');
const b6 = C.rankWindows(p2);
const keys = b6.everyone.map((w) => w.day + w.startHour + w.endHour);
eq(new Set(keys).size, keys.length, 'no duplicate windows');

console.log('\ncoverageMap');
const cm = C.coverageMap(people);
eq((cm.get('2026-11-26T16') || []).slice().sort(), ['Alice','Bob'], 'Thu 4pm has both');
eq(cm.get('2026-11-28T20'), undefined, 'unpicked slot absent');

console.log('\nIntegration: tapped blocks -> ranked window');
const blocks = C.defaultBlocks();
blocks['2026-11-26|lunch'].on = true;
blocks['2026-11-27|dinner'].on = true;
const me = { name: 'Me', attending: true, slots: C.slotsFromBlocks(blocks) };
const them = { name: 'Them', attending: true, slots: ['2026-11-26T12','2026-11-26T13','2026-11-26T14'] };
const bi = C.rankWindows([me, them]);
eq(bi.everyone.length, 1, 'one shared window from tapped blocks');
eq(C.fmtRange(bi.everyone[0]), 'Thu, Nov 26 · 12 PM – 3 PM', 'shared window is noon-3pm');
eq(bi.everyone[0].len, 3, '3 hours shared');

console.log('\nUI rules present in source');
ok(/function nameOk\(\)/.test(src), 'nameOk() exists');
ok(/if \(!nameOk\(\)\) \{ ev\.preventDefault\(\); nudgeName\(\); return; \}/.test(src), 'pointerdown on a block is gated on the name');
ok(/\$\('pickCards'\)\.classList\.toggle\('locked', !ok\)/.test(src), 'blocks locked when the name is missing');
ok(/function nudgeName/.test(src), 'nudgeName warns the user');
ok(/confirmSingleBlock/.test(src), 'single-block submit opens the warning dialog');
ok(/await confirmSingleBlock\(\)/.test(src), 'save waits for the dialog answer');
ok(/role="dialog" aria-modal="true"/.test(html), 'warning is a real dialog');
ok(/class="modalicon"[^>]*>⚠/.test(html), 'dialog shows a warning icon');
ok(/Let me pick more blocks/.test(html), 'dialog offers the safe choice first');
ok(/Save anyway, just this one/.test(html), 'dialog allows overriding');
ok(/Core\.resizeBlock/.test(src), 'edge dragging wired up');
ok(/blocks: onBlocks/.test(src), 'block layout is sent to the backend');

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL CHECKS PASSED'));
process.exit(fails ? 1 : 0);

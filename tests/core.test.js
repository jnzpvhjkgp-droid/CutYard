import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SETTINGS, DEFAULT_MATERIALS, DEFAULT_PARAMS, sanitizeSettings, sanitizeProject, sanitizeMaterials,
    buildCabinet, buildDrawer, buildShaker, drawerBox, slideById, pickSlideLength,
    hingeCount, hingePositions, collect, optimize, optimizeMaterial, makeItem, buildCsv, shopUrl, exampleProject
} from '../src/core.js';

const M = Object.fromEntries(DEFAULT_MATERIALS.map(m => [m.id, m]));
const S = { ...DEFAULT_SETTINGS };
const part = (res, key) => res.parts.find(p => p.key === key);

test('lådbotten använder innerlängden (längd − 2 × sidtjocklek)', () => {
    const box = drawerBox({ openingW: 564, boxH: 150, depth: 500, sideT: 15, botT: 4, groove: 6, slide: slideById('ball') });
    assert.equal(box.len, 450);                     // längsta skena ≤ 500 − 5
    assert.equal(box.boxW, 564 - 2 * 12.7);
    assert.equal(box.botL, 450 - 30 + 12 - 1);
    assert.equal(box.botW, 564 - 25.4 - 30 + 12 - 1);
});

test('Blum MOVENTO: innerbredd = öppning − 42 mm med 16 mm sidor, lådlängd = NL − 10', () => {
    const box = drawerBox({ openingW: 568, boxH: 150, depth: 503, sideT: 16, botT: 16, groove: 0, slide: slideById('blum-movento') });
    assert.equal(box.inner, 568 - 42);
    assert.equal(box.nl, 500);
    assert.equal(box.len, 490);
});

test('för grunt skåp ger varning', () => {
    assert.equal(pickSlideLength(slideById('blum-tandem'), 200), null);
    const box = drawerBox({ openingW: 500, boxH: 100, depth: 200, sideT: 16, botT: 4, groove: 6, slide: slideById('blum-tandem') });
    assert.ok(box.warnings.some(w => w.includes('för grunt')));
});

test('spår som går igenom sidan ger varning', () => {
    const box = drawerBox({ openingW: 500, boxH: 100, depth: 500, sideT: 12, botT: 4, groove: 12, slide: slideById('ball') });
    assert.ok(box.warnings.some(w => w.includes('går igenom')));
});

test('0 hyllplan och inget bakstycke respekteras', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, shelves: 0, backMat: 'none', fronts: 'none' }, M, S);
    assert.equal(res.parts.filter(p => p.key.startsWith('shelf')).length, 0);
    assert.equal(part(res, 'back'), undefined);
    assert.equal(part(res, 'sideL').w, DEFAULT_PARAMS.cabinet.d); // fullt djup utan bakstycke
});

test('kantlist dras av från djupet, även för låga djupa skåp', () => {
    const item = makeItem('cabinet', 'Lågt', { w: 600, h: 300, d: 560, backMat: 'none', shelves: 0, fronts: 'none', edgeBand: true });
    const col = collect([item], M, S);
    const side = col.rows.find(r => r.names.includes('Vänster sida'));
    // Sida: 300 (höjd) × 560 (djup). Kantlist på framkanten → djupet blir 559.
    assert.deepEqual([side.l, side.w].sort((a, b) => a - b), [300, 559]);
    assert.ok(col.edgeMeters > 0);
});

test('bakstycket krockar inte med stommen: sidornas djup = djup − bakstycke', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, fronts: 'none' }, M, S);
    assert.equal(part(res, 'sideL').w, 560 - M.hdf3.thick);
});

test('hyllplan fördelas jämnt med hyllans tjocklek inräknad', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, h: 800, shelves: 3, fronts: 'none' }, M, S);
    const t = M.melamin16.thick;
    const ys = [part(res, 'bottom'), part(res, 'shelf1'), part(res, 'shelf2'), part(res, 'shelf3'), part(res, 'top')].map(p => p.geo.pos[1]);
    const gaps = ys.slice(1).map((y, i) => round(y - ys[i] - t));
    assert.ok(gaps.every(g => Math.abs(g - gaps[0]) < 0.01), `ojämna fack: ${gaps}`);
});
const round = n => Math.round(n * 1000) / 1000;

test('dörrar: två dörrar över 600 mm, spel och gångjärn', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, w: 800, h: 700, fronts: 'doors', doorCount: 'auto', frontStyle: 'flat', edgeBand: false }, M, S);
    const doors = res.parts.filter(p => p.key.startsWith('door'));
    assert.equal(doors.length, 2);
    assert.equal(doors[0].l, 700 - 2 * S.reveal);
    assert.equal(doors[0].w, (800 - 2 * S.reveal - S.frontGap) / 2);
    assert.equal(res.drillings.length, 2);
    assert.equal(res.hardware.find(h => h.key === 'hinge-cliptop-110').qty, 4);
});

test('lådfronter och lådor genereras i skåp', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, drawerCount: 3 }, M, S);
    assert.equal(res.parts.filter(p => p.key.startsWith('dfront')).length, 3);
    assert.equal(res.parts.filter(p => p.key.endsWith('bottom') && p.key.startsWith('Låda')).length, 3);
    assert.equal(res.hardware.find(h => h.key.startsWith('slide')).qty, 3);
});

test('antal gångjärn och placering', () => {
    assert.equal(hingeCount(800), 2);
    assert.equal(hingeCount(1800), 4);
    assert.deepEqual(hingePositions(800), [100, 700]);
    assert.deepEqual(hingePositions(1500), [100, 750, 1400]);
});

test('shaker-dörr: rail och fyllning inkluderar tapp', () => {
    const res = buildShaker({ ...DEFAULT_PARAMS.shaker }, M);
    assert.equal(part(res, 'railT').l, 400 - 120 + 20);
    assert.equal(part(res, 'panel').l, 800 - 120 + 20 - 2);
    assert.equal(part(res, 'panel').w, 400 - 120 + 20 - 2);
});

test('fristående låda använder skåpets djup', () => {
    const res = buildDrawer({ ...DEFAULT_PARAMS.drawer }, M);
    assert.equal(part(res, 'sideL').l, 450);
    assert.equal(part(res, 'bottom').w, 450 - 30 + 12 - 1);
});

test('collect grupperar identiska delar och numrerar', () => {
    const item = { ...makeItem('cabinet', 'A', { fronts: 'none', shelves: 0 }), qty: 2 };
    const col = collect([item], M, S);
    const sides = col.rows.find(r => r.names.includes('Vänster sida'));
    assert.equal(sides.count, 4);
    assert.deepEqual(col.rows.map(r => r.nr), col.rows.map((_, i) => i + 1));
});

test('uteslutna delar tas inte med', () => {
    const item = makeItem('cabinet', 'A', { fronts: 'none', shelves: 0 });
    item.excluded = { back: true };
    const col = collect([item], M, S);
    assert.ok(!col.rows.some(r => r.names.includes('Bakstycke')));
});

// --- Optimering ---
function assertValidLayout(res, S) {
    for (const r of res.materials) {
        for (const b of r.bins) {
            const rects = b.placements.map(p => ({ x: p.x, y: p.y, w: p.dl, h: p.dw }));
            for (const q of rects) {
                assert.ok(q.x >= b.trim - 1e-6 && q.y >= b.trim - 1e-6, 'utanför putsad kant');
                assert.ok(q.x + q.w <= b.L - b.trim + 1e-6 && q.y + q.h <= b.W - b.trim + 1e-6, 'utanför skivan');
            }
            for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], c = rects[j];
                const sep = a.x + a.w + S.kerf <= c.x + 1e-6 || c.x + c.w + S.kerf <= a.x + 1e-6 || a.y + a.h + S.kerf <= c.y + 1e-6 || c.y + c.h + S.kerf <= a.y + 1e-6;
                assert.ok(sep, 'delar överlappar eller saknar sågspalt');
            }
            assert.ok(isGuillotine(rects, b), 'layouten går inte att såga med raka genomgående snitt');
        }
    }
}

// Rekursiv kontroll: det finns alltid ett rakt snitt som delar mängden utan att skära någon del.
function isGuillotine(rects, b) {
    const rec = (rs, x0, y0, x1, y1) => {
        if (rs.length <= 1) return true;
        for (const axis of ['x', 'y']) {
            const cuts = rs.map(r => axis === 'x' ? r.x + r.w : r.y + r.h);
            for (const c of cuts) {
                const A = rs.filter(r => (axis === 'x' ? r.x + r.w : r.y + r.h) <= c + 1e-6);
                const B = rs.filter(r => (axis === 'x' ? r.x : r.y) >= c - 1e-6);
                if (A.length && B.length && A.length + B.length === rs.length) {
                    return axis === 'x' ? rec(A, x0, y0, c, y1) && rec(B, c, y0, x1, y1) : rec(A, x0, y0, x1, c) && rec(B, x0, c, x1, y1);
                }
            }
        }
        return false;
    };
    return rec(rects, 0, 0, b.L, b.W);
}

test('optimering: hela exempelprojektet ger giltig giljotinlayout', () => {
    const p = exampleProject();
    const col = collect(p.items, M, S);
    const res = optimize(col.rows, M, S);
    assertValidLayout(res, S);
    const placed = res.materials.reduce((a, r) => a + r.bins.reduce((s, b) => s + b.placements.length, 0), 0);
    assert.equal(placed, col.partCount);
    assert.ok(res.totalCost > 0);
});

test('optimering: ådringslåsta delar roteras aldrig', () => {
    const rows = [{ nr: 1, mat: 'bjork18', l: 2000, w: 300, lock: true, count: 6, names: ['X'], items: ['A'] }];
    const r = optimizeMaterial(rows, M.bjork18, S);
    r.bins.forEach(b => b.placements.forEach(p => assert.equal(p.rotated, false)));
});

test('optimering: del som är större än skivan rapporteras', () => {
    const rows = [{ nr: 1, mat: 'mdf19', l: 3000, w: 300, lock: false, count: 1, names: ['Lång'], items: ['A'] }];
    const r = optimizeMaterial(rows, M.mdf19, S);
    assert.equal(r.oversize.length, 1);
    assert.equal(r.sheets, 0);
});

test('optimering: spillbitar används före nya skivor', () => {
    const rows = [{ nr: 1, mat: 'mdf19', l: 400, w: 300, lock: false, count: 2, names: ['Liten'], items: ['A'] }];
    const r = optimizeMaterial(rows, M.mdf19, S, [{ id: 'o1', mat: 'mdf19', l: 900, w: 400 }]);
    assert.equal(r.sheets, 0);
    assert.deepEqual(r.offcutsUsed, ['o1']);
    assert.equal(r.cost, 0);
});

test('optimering: kantputs och sågspalt respekteras', () => {
    // Två delar på 1210 mm ryms inte på 2440 med 10 mm putsning per sida och 2,5 mm spalt.
    const rows = [{ nr: 1, mat: 'mdf19', l: 1210, w: 1200, lock: true, count: 2, names: ['Stor'], items: ['A'] }];
    const r = optimizeMaterial(rows, M.mdf19, { ...S, trim: 10 });
    assert.equal(r.sheets, 2);
    const r0 = optimizeMaterial([{ ...rows[0], l: 1205, w: 1200 }], M.mdf19, { ...S, trim: 10 });
    assert.equal(r0.sheets, 1);
});

// --- Övrigt ---
test('CSV använder decimalkomma och semikolon', () => {
    const col = collect([makeItem('drawer', 'L', {})], M, S);
    const csv = buildCsv(col, M);
    assert.ok(csv.startsWith('﻿Nr;Antal'));
    assert.match(csv, /\d+,\d/);
});

test('sanitizeSettings tillåter 0 och avvisar skräp', () => {
    const s = sanitizeSettings({ kerf: 0, trim: 'abc', grainLock: 1, shop: 'x' });
    assert.equal(s.kerf, 0);
    assert.equal(s.trim, DEFAULT_SETTINGS.trim);
    assert.equal(s.grainLock, true);
    assert.equal(s.shop, DEFAULT_SETTINGS.shop);
});

test('sanitizeProject filtrerar ogiltiga objekt', () => {
    assert.equal(sanitizeProject(null), null);
    assert.equal(sanitizeProject({ items: [{ type: 'hack' }] }), null);
    const p = sanitizeProject({ items: [{ type: 'cabinet', qty: '3', params: { w: '900', evil: 1 } }] });
    assert.equal(p.items[0].qty, 3);
    assert.equal(p.items[0].params.w, 900);
    assert.equal(p.items[0].params.evil, undefined);
});

test('sanitizeMaterials faller tillbaka på standard', () => {
    assert.equal(sanitizeMaterials('x').length, DEFAULT_MATERIALS.length);
});

test('butikslänkar kräver https-mall', () => {
    assert.match(shopUrl(S, 'gångjärn'), /^https:\/\/www\.prisjakt\.nu\/search\?search=g%C3%A5ngj%C3%A4rn$/);
    assert.equal(shopUrl({ shop: 'custom', shopTemplate: 'javascript:alert({q})' }, 'x'), null);
});

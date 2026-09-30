import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SETTINGS, DEFAULT_PARAMS, sanitizeSettings, sanitizeProject, sanitizeParams, sanitizeOffcuts, sheetFor,
    buildCabinet, buildDrawer, buildShaker, drawerBox, slideById, pickSlideLength,
    hingeCount, hingePositions, collect, optimize, optimizeSheets, makeItem, makeListRow, buildList, parsePartsTable, cutSequence, matKey, matLabel, optimizeBoards, boardFor, shelfHolePositions, CABINET_KINDS, buildCsv, shopUrl, exampleProject
} from '../src/core.js';

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
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, shelves: 0, backT: 0, fronts: 'none' }, S);
    assert.equal(res.parts.filter(p => p.key.startsWith('shelf')).length, 0);
    assert.equal(part(res, 'back'), undefined);
    assert.equal(part(res, 'sideL').w, DEFAULT_PARAMS.cabinet.d); // fullt djup utan bakstycke
});

test('kantlist dras av från djupet, även för låga djupa skåp', () => {
    const item = makeItem('cabinet', 'Lågt', { w: 600, h: 300, d: 560, backT: 0, shelves: 0, fronts: 'none', edgeBand: true });
    const col = collect([item], S);
    const side = col.rows.find(r => r.names.includes('Vänster sida'));
    // Sida: 300 (höjd) × 560 (djup). Kantlist på framkanten → djupet blir 559.
    assert.deepEqual([side.l, side.w].sort((a, b) => a - b), [300, 559]);
    assert.ok(col.edgeMeters > 0);
});

test('bakstycket krockar inte med stommen: sidornas djup = djup − bakstycke', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, fronts: 'none' }, S);
    assert.equal(part(res, 'sideL').w, 560 - DEFAULT_PARAMS.cabinet.backT);
});

test('hyllplan fördelas jämnt med hyllans tjocklek inräknad', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, h: 800, shelves: 3, fronts: 'none' }, S);
    const t = DEFAULT_PARAMS.cabinet.carcassT;
    const ys = [part(res, 'bottom'), part(res, 'shelf1'), part(res, 'shelf2'), part(res, 'shelf3'), part(res, 'top')].map(p => p.geo.pos[1]);
    const gaps = ys.slice(1).map((y, i) => round(y - ys[i] - t));
    assert.ok(gaps.every(g => Math.abs(g - gaps[0]) < 0.01), `ojämna fack: ${gaps}`);
});
const round = n => Math.round(n * 1000) / 1000;

test('dörrar: två dörrar över 600 mm, spel och gångjärn', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, w: 800, h: 700, fronts: 'doors', doorCount: 'auto', frontStyle: 'flat' }, S);
    const doors = res.parts.filter(p => p.key.startsWith('door'));
    assert.equal(doors.length, 2);
    assert.equal(doors[0].l, 700 - 2 * S.reveal);
    assert.equal(doors[0].w, (800 - 2 * S.reveal - S.frontGap) / 2);
    assert.equal(res.drillings.length, 2);
    assert.equal(res.hardware.find(h => h.key === 'hinge-cliptop-110').qty, 4);
});

test('lådfronter och lådor genereras i skåp', () => {
    const res = buildCabinet({ ...DEFAULT_PARAMS.cabinet, drawerCount: 3 }, S);
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
    const res = buildShaker({ ...DEFAULT_PARAMS.shaker });
    assert.equal(part(res, 'railT').l, 400 - 120 + 20);
    assert.equal(part(res, 'panel').l, 800 - 120 + 20 - 2);
    assert.equal(part(res, 'panel').w, 400 - 120 + 20 - 2);
});

test('fristående låda använder skåpets djup', () => {
    const res = buildDrawer({ ...DEFAULT_PARAMS.drawer });
    assert.equal(part(res, 'sideL').l, 450);
    assert.equal(part(res, 'bottom').w, 450 - 30 + 12 - 1);
});

test('collect grupperar identiska delar och numrerar', () => {
    const item = { ...makeItem('cabinet', 'A', { fronts: 'none', shelves: 0 }), qty: 2 };
    const col = collect([item], S);
    const sides = col.rows.find(r => r.names.includes('Vänster sida'));
    assert.equal(sides.count, 4);
    assert.deepEqual(col.rows.map(r => r.nr), col.rows.map((_, i) => i + 1));
});

test('delnamn i kaplistan upprepar inte låd- och dörrprefix', () => {
    const col = collect([makeItem('cabinet', 'A', { drawerCount: 3 })], S);
    const sides = col.rows.find(r => r.names.includes('Lådsida vänster'));
    assert.deepEqual(sides.names, ['Lådsida vänster', 'Lådsida höger']);
    assert.equal(sides.count, 6);
});

test('uteslutna delar tas inte med', () => {
    const item = makeItem('cabinet', 'A', { fronts: 'none', shelves: 0 });
    item.excluded = { back: true };
    const col = collect([item], S);
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
    const col = collect(p.items, S);
    const res = optimize(col.rows, S);
    assertValidLayout(res, S);
    const placed = res.materials.reduce((a, r) => a + r.bins.reduce((s, b) => s + b.placements.length, 0), 0);
    assert.equal(placed, col.partCount);
    assert.ok(res.totalCost > 0);
});

test('optimering: ådringslåsta delar roteras aldrig', () => {
    const rows = [{ nr: 1, t: 18, l: 2000, w: 300, lock: true, count: 6, names: ['X'], items: ['A'] }];
    const r = optimizeSheets(rows, sheetFor(S, 18), S);
    r.bins.forEach(b => b.placements.forEach(p => assert.equal(p.rotated, false)));
});

test('optimering: del som är större än skivan rapporteras', () => {
    const rows = [{ nr: 1, t: 19, l: 3000, w: 300, lock: false, count: 1, names: ['Lång'], items: ['A'] }];
    const r = optimizeSheets(rows, sheetFor(S, 19), S);
    assert.equal(r.oversize.length, 1);
    assert.equal(r.sheets, 0);
});

test('optimering: spillbitar används före nya skivor', () => {
    const rows = [{ nr: 1, t: 19, l: 400, w: 300, lock: false, count: 2, names: ['Liten'], items: ['A'] }];
    const r = optimizeSheets(rows, sheetFor(S, 19), S, [{ id: 'o1', t: 19, l: 900, w: 400 }]);
    assert.equal(r.sheets, 0);
    assert.deepEqual(r.offcutsUsed, ['o1']);
    assert.equal(r.cost, 0);
});

test('optimering: kantputs och sågspalt respekteras', () => {
    // Två delar på 1210 mm ryms inte på 2440 med 10 mm putsning per sida och 2,5 mm spalt.
    const rows = [{ nr: 1, t: 19, l: 1210, w: 1200, lock: true, count: 2, names: ['Stor'], items: ['A'] }];
    const r = optimizeSheets(rows, sheetFor(S, 19), { ...S, trim: 10 });
    assert.equal(r.sheets, 2);
    const r0 = optimizeSheets([{ ...rows[0], l: 1205, w: 1200 }], sheetFor(S, 19), { ...S, trim: 10 });
    assert.equal(r0.sheets, 1);
});

// --- Övrigt ---
test('CSV använder decimalkomma och semikolon', () => {
    const col = collect([makeItem('drawer', 'L', {})], S);
    const csv = buildCsv(col);
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
    assert.equal(sanitizeProject({ name: 'x' }), null);
    assert.equal(sanitizeProject({ items: [{ type: 'hack' }] }).items.length, 0); // tomt projekt är giltigt
    const p = sanitizeProject({ items: [{ type: 'cabinet', qty: '3', params: { w: '900', evil: 1 } }] });
    assert.equal(p.items[0].qty, 3);
    assert.equal(p.items[0].params.w, 900);
    assert.equal(p.items[0].params.evil, undefined);
});

test('tjocklekar skrivs in fritt och delar med samma tjocklek hamnar på samma skivor', () => {
    const a = makeItem('cabinet', 'A', { carcassT: 22, backT: 0, fronts: 'none', shelves: 0 });
    const b = makeItem('drawer', 'B', { sideT: 22, botT: 5.5 });
    const col = collect([a, b], S);
    assert.deepEqual([...new Set(col.rows.map(r => r.t))].sort((x, y) => y - x), [22, 5.5]);
    const res = optimize(col.rows, S);
    assert.equal(res.materials.length, 2);
});

test('skivformat och pris per tjocklek ersätter standardvärdena', () => {
    const s = sanitizeSettings({ price: 500, sheets: { '19': { L: 2800, W: 2070, price: 649 }, '-1': { L: 1 }, x: {} } });
    assert.deepEqual(s.sheets, { '19': { L: 2800, W: 2070, price: 649 } });
    assert.deepEqual([sheetFor(s, 19).L, sheetFor(s, 19).W, sheetFor(s, 19).price], [2800, 2070, 649]);
    assert.deepEqual([sheetFor(s, 16).L, sheetFor(s, 16).W, sheetFor(s, 16).price], [2440, 1220, 500]);
    // Ett större format ger färre skivor
    const rows = [{ nr: 1, t: 19, l: 1300, w: 1000, lock: false, count: 4, names: ['X'], items: ['A'] }];
    assert.ok(optimizeSheets(rows, sheetFor(s, 19), s).sheets < optimizeSheets(rows, sheetFor(s, 16), s).sheets);
});

test('äldre pris per tjocklek översätts', () => {
    assert.deepEqual(sanitizeSettings({ prices: { '18': 700 } }).sheets, { '18': { price: 700 } });
});

test('beslag från Blum och Hettich har länk till tillverkaren', () => {
    const col = collect([makeItem('cabinet', 'A', { fronts: 'doors' }), makeItem('cabinet', 'B', { fronts: 'drawers', slideId: 'blum-tandem' }), makeItem('drawer', 'C', { slideId: 'hettich-actro' })], S);
    for (const key of ['hinge-cliptop-110', 'hinge-plate']) assert.match(col.hardware.find(h => h.key === key).link.url, /^https:\/\/www\.blum\.com\/se\/sv\//);
    assert.match(col.hardware.find(h => h.key.startsWith('slide-blum-tandem')).link.url, /tandem/);
    assert.match(col.hardware.find(h => h.key.startsWith('slide-hettich-actro')).link.url, /hettich\.com/);
});

test('profiler ger rätt fräsar och varnar för tunn upphöjd fyllning', () => {
    const flat = buildShaker({ ...DEFAULT_PARAMS.shaker }, S);
    assert.deepEqual(flat.tools.map(t => t.key), ['bit-slot6', 'bit-straight']);
    const raised = buildShaker({ ...DEFAULT_PARAMS.shaker, profile: 'ogee', panelStyle: 'raised-ogee', panelT: 6 }, S);
    assert.deepEqual(raised.tools.map(t => t.key), ['bit-cope-ogee', 'bit-raise-ogee']);
    assert.ok(raised.warnings.some(w => w.includes('minst 15 mm')));
    const col = collect([makeItem('shaker', 'D', {}), { ...makeItem('cabinet', 'E', { fronts: 'doors', frontStyle: 'shaker' }), qty: 2 }], S);
    assert.deepEqual(col.tools.find(t => t.key === 'bit-slot6').items, ['D', 'E']);
});

test('ådringslås: synliga delar låses, dolda delar får roteras', () => {
    const item = makeItem('drawer', 'L', {});
    const col = collect([item], { ...S, grainLock: true });
    assert.equal(col.rows.find(r => r.names.includes('Lådsida vänster')).lock, true);
    assert.equal(col.rows.find(r => r.names.includes('Lådbotten')).lock, false);
});

test('äldre projekt med materialval översätts till tjocklekar', () => {
    const p = sanitizeParams('cabinet', { carcassMat: 'bjork18', backMat: 'none', frontMat: 'mdf19' });
    assert.equal(p.carcassT, 18);
    assert.equal(p.backT, 0);
    assert.equal(p.frontT, 19);
});

test('spillbitar kräver tjocklek', () => {
    assert.equal(sanitizeOffcuts([{ t: 18, l: 500, w: 200 }, { mat: 'x', l: 1, w: 1 }]).length, 1);
});

test('butikslänkar kräver https-mall', () => {
    assert.match(shopUrl(S, 'gångjärn'), /^https:\/\/www\.prisjakt\.nu\/search\?search=g%C3%A5ngj%C3%A4rn$/);
    assert.equal(shopUrl({ shop: 'custom', shopTemplate: 'javascript:alert({q})' }, 'x'), null);
});

// --- Steg 1: egen kaplista, skivtyper, kantlist per kant, ådring per del, sågordning ---
test('egen kaplista: antal per rad, kantlist per kant och ådring per del', () => {
    const item = makeItem('list', 'Hylla', { rows: [
        makeListRow({ name: 'Sida', qty: 2, l: 1800, w: 300, t: 18, edges: { l1: true, w1: true }, grain: true }),
        makeListRow({ name: 'Hyllplan', qty: 4, l: 300, w: 764, t: 18 })
    ] });
    item.qty = 2;
    const col = collect([item], S);
    const side = col.rows.find(r => r.names.includes('Sida'));
    assert.equal(side.count, 4);                          // 2 per hylla × 2 hyllor
    assert.deepEqual([side.l, side.w], [1799, 299]);      // en kant längs vardera sidan
    assert.equal(side.lock, true);
    const shelf = col.rows.find(r => r.names.includes('Hyllplan'));
    assert.deepEqual([shelf.l, shelf.w, shelf.lock], [764, 300, false]); // får vridas: längsta sidan först
    assert.equal(round(col.edgeMeters), round((1800 + 300) * 4 / 1000));
});

test('ny egen kaplista får en första rad', () => {
    assert.equal(makeItem('list').params.rows.length, 1);
    assert.equal(sanitizeProject({ items: [{ type: 'list', params: { rows: [{ l: 'x' }, { l: 500, w: 200, t: 12, mn: ' Björk ' }] } }] }).items[0].params.rows[1].mn, 'Björk');
});

test('skivtyp skiljer skivor med samma tjocklek åt', () => {
    const a = makeItem('cabinet', 'A', { carcassT: 18, carcassName: 'Vit melamin', fronts: 'doors', frontT: 18, frontName: 'Björkplywood', backT: 0, shelves: 0 });
    const col = collect([a], S);
    assert.deepEqual([...new Set(col.rows.map(r => matKey(r.t, r.mn)))].sort(), ['18|björkplywood', '18|vit melamin']);
    const res = optimize(col.rows, S);
    assert.equal(res.materials.length, 2);
    assert.equal(matLabel(18, 'Björkplywood'), '18 mm Björkplywood');
    // Skärschemana kommer i kaplistans ordning, tjockast först
    const mixed = optimize(collect(exampleProject().items, S).rows, S).materials.map(m => m.sheet.t);
    assert.deepEqual(mixed, [...mixed].sort((a, b) => b - a));
});

test('namngiven skiva ärver tjocklekens format men kan ha eget', () => {
    const s = sanitizeSettings({ sheets: { '18': { L: 2500 }, '18|björk': { price: 900 } } });
    const f = sheetFor(s, 18, 'Björk');
    assert.deepEqual([f.L, f.W, f.price], [2500, 1220, 900]);
});

test('ådring per objekt låser synliga delar men inte dolda', () => {
    const col = collect([makeItem('drawer', 'L', { grain: true })], S);
    assert.equal(col.rows.find(r => r.names.includes('Lådsida vänster')).lock, true);
    assert.equal(col.rows.find(r => r.names.includes('Lådbotten')).lock, false);
});

test('inklistring: rubrikrad, tabbar och decimalkomma', () => {
    const txt = 'Antal\tLängd\tBredd\tTjocklek\tNamn\tSkivtyp\n2\t720,5\t560\t16\tSida\tMelamin\n1\t500\tx\t16\tFel\n\n';
    const r = parsePartsTable(txt);
    assert.equal(r.rows.length, 1);
    assert.deepEqual([r.rows[0].qty, r.rows[0].l, r.rows[0].w, r.rows[0].t, r.rows[0].name, r.rows[0].mn], [2, 720.5, 560, 16, 'Sida', 'Melamin']);
    assert.equal(r.errors.length, 1);
});

test('inklistring utan rubrik och från CutYards egen CSV', () => {
    assert.deepEqual(parsePartsTable('3;800;400;18;Hylla').rows.map(r => [r.qty, r.l, r.w, r.t, r.name]), [[3, 800, 400, 18, 'Hylla']]);
    const csv = buildCsv(collect([makeItem('shaker', 'D', {})], S));
    const back = parsePartsTable(csv.split('\n\nBESLAGSLISTA')[0]);
    assert.ok(back.rows.length >= 3);
    assert.ok(back.rows.every(r => r.t > 0 && r.l > 0));
});

test('sågordning: varje del blir klar exakt en gång och får rätt mått', () => {
    const col = collect(exampleProject().items, S);
    const res = optimize(col.rows, S);
    for (const m of res.materials) for (const b of m.bins) {
        const steps = cutSequence(b, S.kerf);
        const done = steps.filter(x => x.kind === 'done');
        assert.equal(done.length, b.placements.length);
        assert.deepEqual([...new Set(done.map(d => d.piece))].sort((x, y) => x - y), b.placements.map((_, i) => i));
        for (const d of done) {
            const p = b.placements[d.piece];
            assert.ok(Math.abs((d.region.x1 - d.region.x0) - p.dl) < 1e-6 && Math.abs((d.region.y1 - d.region.y0) - p.dw) < 1e-6, 'fel mått på färdig del');
        }
        assert.ok(steps.filter(x => x.kind === 'cut').every(c => c.dist > 0 && c.len > 0));
    }
});

// --- Steg 2: virke, skåptyper, hyllhål, spår ---
test('virke: shaker-ramar kan sågas ur brädor och optimeras på längden', () => {
    const col = collect([makeItem('shaker', 'D', { frameStock: 'board' })], S);
    const boards = col.rows.filter(r => r.board);
    assert.equal(boards.length, 2);                       // stiles 800 och rails 300, båda 19 × 60
    assert.ok(boards.every(r => r.t === 19 && r.w === 60 && !r.lock));
    const res = optimize(col.rows, S);
    assert.equal(res.linear.length, 1);
    assert.equal(res.boards, 1);                          // 2×800 + 2×300 + snitt ryms på 2400
    assert.equal(res.materials.length, 1);                // fyllningen på skiva
    assert.ok(res.totalCost > res.materials[0].cost);
});

test('virke: delar som inte ryms på brädan och korrekt sågspalt', () => {
    const s2 = sanitizeSettings({ boardL: 1000, trim: 0, kerf: 3 });
    const rows = [{ nr: 1, t: 20, w: 50, mn: '', l: 497, count: 2, names: ['A'], board: true }, { nr: 2, t: 20, w: 50, mn: '', l: 1200, count: 1, names: ['B'], board: true }];
    const r = optimizeBoards(rows, boardFor(s2, 20, 50), s2);
    assert.equal(r.count, 1);                             // 497 + 3 + 497 = 997 ≤ 1000
    assert.equal(r.oversize.length, 1);
    assert.deepEqual(r.bars[0].cuts.map(c => c.x), [0, 500]);
    const r2 = optimizeBoards([{ ...rows[0], l: 499 }], boardFor(s2, 20, 50), s2);
    assert.equal(r2.count, 2);                            // 499 + 3 + 499 = 1001 > 1000
    const r3 = optimizeBoards([{ ...rows[0], l: 500, count: 1 }, { ...rows[0], l: 497, count: 1 }], boardFor(s2, 20, 50), s2);
    assert.equal(r3.count, 1);                            // 500 + 3 + 497 = 1000, sista delen går ända ut
});

test('egen kaplista: rad markerad som virke', () => {
    const col = collect([makeItem('list', 'L', { rows: [makeListRow({ l: 300, w: 900, t: 22, board: true })] })], S);
    assert.deepEqual([col.rows[0].board, col.rows[0].l, col.rows[0].w], [true, 300, 900]); // vrids inte
});

test('skåptyper, sockel, mellanväggar och garderobsstång', () => {
    assert.equal(CABINET_KINDS.tall.preset.h, 2100);
    const r = buildCabinet({ ...DEFAULT_PARAMS.cabinet, kind: 'tall', h: 2100, fronts: 'doors', shelves: 3, dividers: 1, plinthH: 100, rail: true }, S);
    assert.equal(r.parts.filter(p => p.key.startsWith('shelf')).length, 6);
    assert.ok(r.parts.some(p => p.key === 'div1'));
    assert.equal(r.parts.filter(p => p.key.startsWith('plinth')).length, 4);
    assert.equal(r.hardware.find(h => h.key === 'rail').qty, 2);
    const withDrawers = buildCabinet({ ...DEFAULT_PARAMS.cabinet, dividers: 2 }, S);
    assert.ok(!withDrawers.parts.some(p => p.key.startsWith('div')));
});

test('hyllhål enligt 32-mm-systemet', () => {
    const holes = shelfHolePositions(720, 16);
    assert.ok(holes.length > 5);
    assert.ok(holes.every((h, i) => i === 0 || Math.abs(h - holes[i - 1] - 32) < 1e-9));
    assert.ok(Math.abs(holes[0] + holes[holes.length - 1] - 720) < 0.2);      // symmetriskt
    const col = collect([makeItem('cabinet', 'A', { fronts: 'doors', shelves: 2 })], S);
    assert.equal(col.processing.filter(p => p.kind === 'shelf').length, 1);
});

test('bakstycke i spår ger större bakstycke, fullt stomdjup och spår i bearbetningslistan', () => {
    const p = { ...DEFAULT_PARAMS.cabinet, fronts: 'none', backMount: 'groove' };
    const r = buildCabinet(p, S);
    const back = r.parts.find(x => x.key === 'back');
    assert.deepEqual([back.l, back.w], [720 - 32 + 16 - 1, 600 - 32 + 16 - 1]);
    assert.equal(r.parts.find(x => x.key === 'sideL').w, 560);
    assert.ok(r.processing.some(x => x.kind === 'groove'));
    assert.ok(!r.hardware.some(h => h.key === 'backscrew'));
});

test('äldre skåp utan typ: grunda blir väggskåp', () => {
    const pr = sanitizeProject({ items: [{ type: 'cabinet', params: { d: 350 } }, { type: 'cabinet', params: { d: 560 } }, { type: 'cabinet', params: {} }] });
    assert.deepEqual(pr.items.map(i => i.params.kind), ['wall', 'base', 'base']);
});

// --- Steg 3: offert, kapservice, delningslänk ---
import { buildQuote, sanitizeQuote, orderText, edgeText } from '../src/core.js';
import { encodeProject, decodeProject } from '../src/share.js';

test('kantlist per kant följer med raden och vrids med delen', () => {
    const col = collect([makeItem('list', 'L', { rows: [makeListRow({ l: 300, w: 800, t: 18, edges: { l1: true } })] })], S);
    const r = col.rows[0];
    assert.deepEqual([r.l, r.w, r.bl, r.bw], [799, 300, 0, 1]);   // kantlist längs 300-sidan drar av från 800; vriden blir den kortsidan
    assert.equal(edgeText(r), '1 kortsida');
});

test('offert: påslag på material och beslag, inte på arbete, och moms på allt', () => {
    const col = collect([makeItem('cabinet', 'A', { fronts: 'doors', shelves: 1 })], S);
    const opt = optimize(col.rows, S);
    const q = sanitizeQuote({ hours: 4, rate: 500, markup: 10, vat: 25, edgePrice: 0, hwPrices: { 'hinge-cliptop-110': 100 } });
    const r = buildQuote(col, opt, q);
    const hinge = r.lines.find(l => l.key === 'hinge-cliptop-110');
    assert.equal(hinge.sum, 200);
    assert.ok(r.missingPrices > 0);                      // t.ex. monteringsplattor saknar pris
    assert.equal(r.labor, 2000);
    assert.ok(Math.abs(r.markup - r.goods * 0.1) < 1e-9);
    assert.ok(Math.abs(r.total - (r.goods * 1.1 + 2000) * 1.25) < 1e-6);
});

test('offert saneras och sparas med projektet', () => {
    const q = sanitizeQuote({ hours: -2, rate: 'x', vat: 300, customer: '  Anna  ', hwPrices: { ok: 5, 'bad key!': 3, neg: -1 } });
    assert.deepEqual([q.hours, q.rate, q.vat, q.customer, q.hwPrices], [0, 550, 100, 'Anna', { ok: 5 }]);
    assert.equal(sanitizeProject({ items: [], quote: { hours: 3 } }).quote.hours, 3);
});

test('beställningstext innehåller skivor, kaplista och kantlist', () => {
    const col = collect([makeItem('cabinet', 'A', { fronts: 'none', carcassName: 'Vit melamin' })], S);
    const txt = orderText(col, optimize(col.rows, S), { project: 'Kök', name: 'Kim', delivery: 'pickup' });
    assert.match(txt, /16 mm Vit melamin/);
    assert.match(txt, /kantlist: 1 långsida/);
    assert.match(txt, /Hämtas i butik/);
});

test('delningslänk: projektet kommer tillbaka oförändrat', async () => {
    const data = { project: exampleProject(), settings: S };
    const hash = await encodeProject(data);
    assert.match(hash, /^p=[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeProject('#' + hash), JSON.parse(JSON.stringify(data)));
    assert.equal(await decodeProject('#p=inte-giltigt'), null);
    assert.equal(await decodeProject('#annat'), null);
});

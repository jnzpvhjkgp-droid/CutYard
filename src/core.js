// CutYard – beräkningskärna.
// Ren logik utan DOM-beroenden så att allt kan testas med `node --test`.
// Konvention för delar: `l` är måttet längs ådringen/skivans längdriktning, `w` är det andra måttet.

export const round1 = n => Math.round(n * 10) / 10;
export const fmt = n => round1(n).toLocaleString('sv-SE', { maximumFractionDigits: 1 });
export const fmtKr = n => Math.round(n).toLocaleString('sv-SE') + ' kr';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
let uidCounter = 0;
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Inställningar
// ---------------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
    kerf: 2.5,          // sågspalt (mm)
    edgeThick: 1.0,     // kantlistens tjocklek (mm)
    trim: 10,           // kantputs runt nya skivor (mm per sida)
    grainLock: false,   // förbjud all rotation
    reveal: 1.5,        // spel mellan front och stommens ytterkant (mm)
    frontGap: 3,        // spel mellan två fronter (mm)
    minOffcutL: 400,    // minsta spillbit som sparas (mm)
    minOffcutW: 150,
    shop: 'prisjakt',   // butikssökning för beslag
    shopTemplate: ''    // egen URL-mall med {q}
};

export const SHOPS = {
    prisjakt: { name: 'Prisjakt', template: 'https://www.prisjakt.nu/search?search={q}' },
    google: { name: 'Google Shopping', template: 'https://www.google.com/search?tbm=shop&q={q}' },
    custom: { name: 'Egen länkmall', template: '' }
};

export function sanitizeSettings(s) {
    const out = { ...DEFAULT_SETTINGS };
    if (!isObj(s)) return out;
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
        if (typeof def === 'boolean') out[k] = !!s[k];
        else if (typeof def === 'number') { const v = +s[k]; if (s[k] !== '' && s[k] != null && Number.isFinite(v) && v >= 0) out[k] = v; }
        else if (typeof s[k] === 'string') out[k] = s[k];
    }
    if (!SHOPS[out.shop]) out.shop = DEFAULT_SETTINGS.shop;
    out.kerf = clamp(out.kerf, 0, 10);
    out.trim = clamp(out.trim, 0, 50);
    return out;
}

export function shopUrl(settings, query) {
    const tpl = settings.shop === 'custom' ? settings.shopTemplate : SHOPS[settings.shop]?.template;
    if (!tpl || !tpl.includes('{q}') || !/^https:\/\//.test(tpl)) return null;
    return tpl.replace('{q}', encodeURIComponent(query));
}

// ---------------------------------------------------------------------------
// Materialbibliotek (exempelpriser – redigeras av användaren)
// ---------------------------------------------------------------------------
export const DEFAULT_MATERIALS = [
    { id: 'melamin16', name: 'Melaminspånskiva vit', thick: 16, L: 2800, W: 2070, price: 649, grain: false, edgeable: true },
    { id: 'bjork18', name: 'Björkplywood', thick: 18, L: 2440, W: 1220, price: 1290, grain: true, edgeable: true },
    { id: 'bjork15', name: 'Björkplywood', thick: 15, L: 2440, W: 1220, price: 1090, grain: true, edgeable: true },
    { id: 'mdf19', name: 'MDF', thick: 19, L: 2440, W: 1220, price: 549, grain: false, edgeable: false },
    { id: 'mdf6', name: 'MDF', thick: 6, L: 2440, W: 1220, price: 229, grain: false, edgeable: false },
    { id: 'hdf3', name: 'HDF vitlackad', thick: 3, L: 2440, W: 1220, price: 179, grain: false, edgeable: false },
    { id: 'bjork4', name: 'Björkplywood', thick: 4, L: 1525, W: 1525, price: 259, grain: true, edgeable: false }
];

export const materialLabel = m => m ? `${fmt(m.thick)} mm ${m.name}` : 'Okänt material';

export function sanitizeMaterial(m) {
    if (!isObj(m)) return null;
    const num = (v, def, lo, hi) => { const n = +v; return Number.isFinite(n) ? clamp(n, lo, hi) : def; };
    return {
        id: typeof m.id === 'string' && m.id ? m.id.slice(0, 40) : uid('mat'),
        name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 60) : 'Nytt material',
        thick: num(m.thick, 18, 1, 100),
        L: num(m.L, 2440, 100, 6000),
        W: num(m.W, 1220, 100, 3000),
        price: num(m.price, 0, 0, 1e6),
        grain: !!m.grain,
        edgeable: !!m.edgeable
    };
}

export function sanitizeMaterials(list) {
    if (!Array.isArray(list)) return DEFAULT_MATERIALS.map(m => ({ ...m }));
    const seen = new Set();
    const out = list.map(sanitizeMaterial).filter(m => m && !seen.has(m.id) && seen.add(m.id));
    return out.length ? out : DEFAULT_MATERIALS.map(m => ({ ...m }));
}

export function sanitizeOffcuts(list, materials) {
    if (!Array.isArray(list)) return [];
    const ids = new Set(materials.map(m => m.id));
    return list.filter(o => isObj(o) && ids.has(o.mat) && +o.l > 0 && +o.w > 0)
        .map(o => ({ id: typeof o.id === 'string' ? o.id : uid('off'), mat: o.mat, l: round1(+o.l), w: round1(+o.w) }));
}

// ---------------------------------------------------------------------------
// Lådskenor. Riktvärden – kontrollera alltid mot tillverkarens monteringsanvisning.
// clearance = spel per sida mellan skåpsida och lådsida.
// ---------------------------------------------------------------------------
const range = (a, b, step) => { const r = []; for (let x = a; x <= b; x += step) r.push(x); return r; };

export const SLIDES = [
    { id: 'ball', name: 'Kullagerskenor, sidomonterade', clearance: 12.7, mount: 'side', lengths: range(250, 650, 50), lengthOffset: 0, depthMargin: 5, bottomRecess: 12, maxSide: null,
      note: 'Lådlängd = skenans längd. 12,7 mm spel per sida.' },
    { id: 'blum-movento', name: 'Blum MOVENTO', clearance: 5, mount: 'under', lengths: [250, 270, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750], lengthOffset: -10, depthMargin: 3, bottomRecess: 13, maxSide: 16,
      note: 'Lådans innerbredd = öppning − 42 mm vid 16 mm sidor. Lådlängd = NL − 10 mm. Bakstycket behöver urtag för skenan.' },
    { id: 'blum-tandem', name: 'Blum TANDEM', clearance: 5, mount: 'under', lengths: [250, 270, 300, 350, 400, 450, 500, 550, 600], lengthOffset: -10, depthMargin: 3, bottomRecess: 13, maxSide: 16,
      note: 'Lådans innerbredd = öppning − 42 mm vid 16 mm sidor. Lådlängd = NL − 10 mm. Bakstycket behöver urtag för skenan.' },
    { id: 'hettich-actro', name: 'Hettich Actro 5D', clearance: 5, mount: 'under', lengths: [270, 300, 350, 400, 450, 500, 550, 600], lengthOffset: -10, depthMargin: 3, bottomRecess: 13, maxSide: 16,
      note: 'Lådans innerbredd = öppning − 42 mm vid 16 mm sidor. Kontrollera lådlängd mot Hettichs anvisning.' },
    { id: 'custom', name: 'Egen skena (ange spel)', clearance: null, mount: 'side', lengths: null, lengthOffset: 0, depthMargin: 10, bottomRecess: 12, maxSide: null,
      note: 'Lådlängd = skåpets innerdjup − 10 mm.' }
];
export const slideById = id => SLIDES.find(s => s.id === id) || SLIDES[0];

export function pickSlideLength(slide, depth) {
    if (!slide.lengths) return null;
    const ok = slide.lengths.filter(L => L + slide.depthMargin <= depth);
    return ok.length ? Math.max(...ok) : null;
}

/**
 * Räknar ut en lådlåda för en skåpsöppning.
 * @param {object} o openingW (öppningens innerbredd), boxH, depth (skåpets innerdjup),
 *                   sideT, botT, groove, slide, clearance (för egen skena)
 */
export function drawerBox(o) {
    const slide = o.slide;
    const warnings = [];
    const clr = slide.clearance ?? clamp(+o.clearance || 0, 0, 50);
    const nl = pickSlideLength(slide, o.depth);
    let len;
    if (slide.lengths) {
        if (nl == null) {
            warnings.push(`Skåpet är för grunt för ${slide.name}. Kortaste skenan är ${slide.lengths[0]} mm och kräver ${slide.lengths[0] + slide.depthMargin} mm innerdjup.`);
            len = Math.max(50, o.depth - slide.depthMargin);
        } else len = nl + slide.lengthOffset;
    } else len = Math.max(50, Math.floor(o.depth - slide.depthMargin));

    const boxW = o.openingW - 2 * clr;
    const inner = boxW - 2 * o.sideT;
    const innerLen = len - 2 * o.sideT;
    const g = o.groove;
    if (inner < 40) warnings.push('Lådan blir för smal. Kontrollera öppningens bredd, skenspel och sidtjocklek.');
    if (slide.maxSide && o.sideT > slide.maxSide) warnings.push(`${slide.name} är avsedd för lådsidor upp till ${slide.maxSide} mm (valt: ${fmt(o.sideT)} mm).`);
    if (g >= o.sideT) warnings.push(`Spårdjupet (${fmt(g)} mm) går igenom lådsidan (${fmt(o.sideT)} mm).`);
    else if (g > o.sideT * 0.6) warnings.push('Spårdjupet är mer än 60 % av sidtjockleken och försvagar sidorna.');
    if (o.boxH < 50) warnings.push('Lådhöjden är mycket låg.');
    return {
        clr, nl, len, boxW, inner, innerLen,
        botW: inner + 2 * g - 1,       // botten i spår: innermått + spårdjup på båda sidor − 1 mm spel
        botL: innerLen + 2 * g - 1,
        bottomRecess: slide.bottomRecess,
        warnings
    };
}

// ---------------------------------------------------------------------------
// Gångjärn (35 mm kopp). Kopphålets centrum 22,5 mm från dörrkanten (K = 5 mm).
// ---------------------------------------------------------------------------
export const HINGE = { cupDia: 35, cupDepth: 13, edgeDist: 22.5 };
export const hingeCount = h => h <= 900 ? 2 : h <= 1600 ? 3 : h <= 2000 ? 4 : 5;
export function hingePositions(h, n = hingeCount(h)) {
    const edge = Math.min(100, h / 4);
    if (n <= 1) return [round1(h / 2)];
    const step = (h - 2 * edge) / (n - 1);
    return Array.from({ length: n }, (_, i) => round1(edge + i * step));
}

// ---------------------------------------------------------------------------
// Byggare. Varje byggare returnerar { parts, hardware, warnings, drillings }.
// part: { key, name, l, w, mat, grain, band:{l,w}, geo:{size,pos,role} }
//   grain=false: orienteringen spelar ingen roll (dolda delar) – får roteras även i ådrat material.
//   band.l = antal kantlistade kanter som löper längs l (minskar w), band.w likadant.
// ---------------------------------------------------------------------------
const NO_BAND = { l: 0, w: 0 };

function hw(key, name, qty, unit, query) { return { key, name, qty, unit, query: query || name }; }

function matOf(M, id, fallback) { return M[id] || M[fallback] || Object.values(M)[0]; }

export function shakerDoorParts({ w, h, frame, tenon, frameMat, panelMat, prefix = '', origin = [0, 0, 0] }) {
    const f = frame, tF = frameMat.thick, tP = panelMat.thick;
    const [ox, oy, oz] = origin;
    const p = prefix ? prefix + ': ' : '';
    const warnings = [];
    if (w <= 2 * f + 20 || h <= 2 * f + 20) warnings.push(`${prefix || 'Dörren'}: ramen är för bred för dörrens mått.`);
    if (tP >= tF) warnings.push(`${prefix || 'Dörren'}: fyllningen är lika tjock som ramen.`);
    const railL = w - 2 * f + 2 * tenon;
    const pw = Math.max(1, w - 2 * f), ph = Math.max(1, h - 2 * f);
    const common = { mat: frameMat.id, grain: true, band: NO_BAND };
    const parts = [
        { ...common, key: `${p}stileL`, name: `${p}Stile vänster`, l: h, w: f, geo: { size: [f, h, tF], pos: [ox - w / 2 + f / 2, oy, oz], role: 'frame' } },
        { ...common, key: `${p}stileR`, name: `${p}Stile höger`, l: h, w: f, geo: { size: [f, h, tF], pos: [ox + w / 2 - f / 2, oy, oz], role: 'frame' } },
        { ...common, key: `${p}railT`, name: `${p}Rail topp`, l: railL, w: f, geo: { size: [pw, f, tF], pos: [ox, oy + h / 2 - f / 2, oz], role: 'frame' } },
        { ...common, key: `${p}railB`, name: `${p}Rail botten`, l: railL, w: f, geo: { size: [pw, f, tF], pos: [ox, oy - h / 2 + f / 2, oz], role: 'frame' } },
        { key: `${p}panel`, name: `${p}Spegelfyllning`, l: h - 2 * f + 2 * tenon - 2, w: w - 2 * f + 2 * tenon - 2, mat: panelMat.id, grain: true, band: NO_BAND,
          geo: { size: [pw, ph, tP], pos: [ox, oy, oz], role: 'panel' } }
    ];
    return { parts, warnings, thick: tF };
}

function drawerBoxParts(box, { h, sideMat, botMat, prefix, origin }) {
    const [ox, oy, oz] = origin;
    const t = sideMat.thick, tb = botMat.thick;
    const p = prefix ? prefix + ': ' : '';
    const common = { mat: sideMat.id, grain: true, band: NO_BAND };
    const inner = Math.max(1, box.inner), len = box.len;
    return [
        { ...common, key: `${p}sideL`, name: `${p}Lådsida vänster`, l: len, w: h, geo: { size: [t, h, len], pos: [ox - box.boxW / 2 + t / 2, oy, oz], role: 'drawer' } },
        { ...common, key: `${p}sideR`, name: `${p}Lådsida höger`, l: len, w: h, geo: { size: [t, h, len], pos: [ox + box.boxW / 2 - t / 2, oy, oz], role: 'drawer' } },
        { ...common, key: `${p}front`, name: `${p}Lådstycke fram`, l: inner, w: h, geo: { size: [inner, h, t], pos: [ox, oy, oz + len / 2 - t / 2], role: 'drawer' } },
        { ...common, key: `${p}back`, name: `${p}Lådstycke bak`, l: inner, w: h, geo: { size: [inner, h, t], pos: [ox, oy, oz - len / 2 + t / 2], role: 'drawer' } },
        { key: `${p}bottom`, name: `${p}Lådbotten`, l: box.botW, w: box.botL, mat: botMat.id, grain: false, band: NO_BAND,
          geo: { size: [Math.max(1, box.botW), tb, Math.max(1, box.botL)], pos: [ox, oy - h / 2 + box.bottomRecess + tb / 2, oz], role: 'bottom' } }
    ];
}

function slideHardware(slide, nl, pairs, clr) {
    if (slide.id === 'custom' || nl == null) return hw('slide-custom', `Lådskenor (${fmt(clr)} mm spel/sida)`, pairs, 'par', 'lådskenor');
    const name = slide.id === 'ball' ? `Kullagerskenor fullt utdrag ${nl} mm` : `${slide.name} ${nl} mm`;
    return hw(`slide-${slide.id}-${nl}`, name, pairs, 'par', name);
}

export const DEFAULT_PARAMS = {
    cabinet: { w: 600, h: 720, d: 560, carcassMat: 'melamin16', backMat: 'hdf3', shelves: 1, edgeBand: true,
               fronts: 'drawers', doorCount: 'auto', drawerCount: 3, frontMat: 'mdf19', frontStyle: 'flat',
               frame: 60, tenon: 10, panelMat: 'mdf6', slideId: 'blum-movento', clearance: 12.7,
               drawerSideMat: 'bjork15', drawerBotMat: 'hdf3', groove: 6 },
    drawer: { w: 564, h: 150, d: 500, sideMat: 'bjork15', botMat: 'bjork4', slideId: 'ball', clearance: 12.7, groove: 6 },
    shaker: { w: 400, h: 800, frame: 60, tenon: 10, frameMat: 'mdf19', panelMat: 'mdf6', hinges: true }
};

export function buildCabinet(p, M, S) {
    const carc = matOf(M, p.carcassMat, 'melamin16');
    const back = p.backMat === 'none' ? null : matOf(M, p.backMat, 'hdf3');
    const t = carc.thick, tB = back ? back.thick : 0;
    const { w, h, d } = p;
    const warnings = [], hardware = [], drillings = [], parts = [];
    if (w <= 2 * t + 20) warnings.push('Bredden är för liten i förhållande till stomtjockleken.');
    if (d - tB <= 60) warnings.push('Djupet är för litet.');

    const inner = Math.max(1, w - 2 * t);
    const dc = Math.max(1, d - tB);   // stommens djup; bakstycket läggs på baksidan
    const zc = tB / 2;
    const band = p.edgeBand ? { l: 1, w: 0 } : NO_BAND; // framkanten löper längs l
    const c = { mat: carc.id, grain: true, band };
    parts.push(
        { ...c, key: 'sideL', name: 'Vänster sida', l: h, w: dc, geo: { size: [t, h, dc], pos: [-w / 2 + t / 2, 0, zc], role: 'carcass' } },
        { ...c, key: 'sideR', name: 'Höger sida', l: h, w: dc, geo: { size: [t, h, dc], pos: [w / 2 - t / 2, 0, zc], role: 'carcass' } },
        { ...c, key: 'top', name: 'Topp', l: inner, w: dc, geo: { size: [inner, t, dc], pos: [0, h / 2 - t / 2, zc], role: 'carcass' } },
        { ...c, key: 'bottom', name: 'Botten', l: inner, w: dc, geo: { size: [inner, t, dc], pos: [0, -h / 2 + t / 2, zc], role: 'carcass' } }
    );

    const shelves = p.fronts === 'drawers' ? 0 : clamp(Math.round(p.shelves), 0, 20);
    if (shelves > 0) {
        if (h <= 2 * t + shelves * t + 20) warnings.push('Höjden räcker inte för alla hyllplan.');
        const sd = Math.max(1, dc - 20);                          // 20 mm indrag från framkant
        const gap = Math.max(0, (h - 2 * t - shelves * t) / (shelves + 1));
        for (let i = 1; i <= shelves; i++) {
            const y = -h / 2 + t + i * gap + (i - 1) * t + t / 2;
            parts.push({ ...c, key: `shelf${i}`, name: `Hyllplan ${i}`, l: inner - 1, w: sd, geo: { size: [inner - 1, t, sd], pos: [0, y, zc - 10], role: 'shelf' } });
        }
        hardware.push(hw('shelfpin5', 'Hyllbärare 5 mm', shelves * 4, 'st'));
    }
    if (back) {
        parts.push({ key: 'back', name: 'Bakstycke', l: h - 2, w: w - 2, mat: back.id, grain: false, band: NO_BAND,
                     geo: { size: [w - 2, h - 2, tB], pos: [0, 0, -d / 2 + tB / 2], role: 'back' } });
        hardware.push(hw('backscrew', 'Skruv 3,0×16 för bakstycke', Math.ceil(2 * (w + h) / 150), 'st', 'skruv 3,0x16'));
    }

    // Fronter
    const R = S.reveal, G = S.frontGap;
    const front = matOf(M, p.frontMat, 'mdf19');
    const frontBand = p.edgeBand && front.edgeable ? { l: 2, w: 2 } : NO_BAND;
    const fz = d / 2 + front.thick / 2 + 1;

    const addFront = (key, name, fw, fh, x, y, grainAlongWidth) => {
        if (p.frontStyle === 'shaker') {
            const res = shakerDoorParts({ w: fw, h: fh, frame: p.frame, tenon: p.tenon, frameMat: front, panelMat: matOf(M, p.panelMat, 'mdf6'), prefix: name, origin: [x, y, fz] });
            res.parts.forEach(pt => { pt.geo.role = pt.geo.role === 'panel' ? 'frontPanel' : 'front'; });
            parts.push(...res.parts);
            warnings.push(...res.warnings);
        } else {
            const [l, ww] = grainAlongWidth ? [fw, fh] : [fh, fw];
            parts.push({ key, name, l, w: ww, mat: front.id, grain: true, band: frontBand, geo: { size: [fw, fh, front.thick], pos: [x, y, fz], role: 'front' } });
        }
    };

    if (p.fronts === 'doors') {
        const n = p.doorCount === 'auto' ? (w > 600 ? 2 : 1) : clamp(+p.doorCount || 1, 1, 2);
        const dh = h - 2 * R;
        const dw = (w - 2 * R - (n - 1) * G) / n;
        const count = hingeCount(dh);
        for (let i = 0; i < n; i++) {
            const name = n === 1 ? 'Dörr' : `Dörr ${i === 0 ? 'vänster' : 'höger'}`;
            addFront(`door${i}`, name, dw, dh, -w / 2 + R + dw / 2 + i * (dw + G), 0, false);
            drillings.push({ door: name, w: dw, h: dh, side: n === 2 && i === 1 ? 'höger' : 'vänster', holes: hingePositions(dh, count), ...HINGE });
        }
        if (p.frontStyle === 'shaker' && p.frame < HINGE.edgeDist + HINGE.cupDia / 2 + 5) warnings.push(`Rambredden (${fmt(p.frame)} mm) är för smal för 35 mm gångjärnskopp. Välj minst ${HINGE.edgeDist + HINGE.cupDia / 2 + 5} mm.`);
        hardware.push(hw('hinge-cliptop-110', 'Blum CLIP top BLUMOTION 110° gångjärn', count * n, 'st'));
        hardware.push(hw('hinge-plate', 'Monteringsplatta för gångjärn', count * n, 'st', 'Blum CLIP monteringsplatta'));
        hardware.push(hw('handle', 'Handtag eller knopp', n, 'st', 'möbelhandtag'));
    } else if (p.fronts === 'drawers') {
        const n = clamp(Math.round(p.drawerCount) || 1, 1, 8);
        const fw = w - 2 * R;
        const fh = (h - 2 * R - (n - 1) * G) / n;
        const slide = slideById(p.slideId);
        const sideMat = matOf(M, p.drawerSideMat, 'bjork15');
        const botMat = matOf(M, p.drawerBotMat, 'hdf3');
        const openingH = (h - 2 * t) / n;
        const boxH = clamp(Math.floor(Math.min(fh - 40, openingH - 30) / 10) * 10, 40, 400);
        let nl = null, clr = 0;
        for (let i = 0; i < n; i++) {
            const y = h / 2 - R - fh / 2 - i * (fh + G);
            addFront(`dfront${i}`, `Lådfront ${i + 1}`, fw, fh, 0, y, true);
            const box = drawerBox({ openingW: inner, boxH, depth: dc, sideT: sideMat.thick, botT: botMat.thick, groove: p.groove, slide, clearance: p.clearance });
            nl = box.nl; clr = box.clr;
            if (i === 0) warnings.push(...box.warnings);
            const by = clamp(y, -h / 2 + t + boxH / 2 + 2, h / 2 - t - boxH / 2 - 2);
            parts.push(...drawerBoxParts(box, { h: boxH, sideMat, botMat, prefix: `Låda ${i + 1}`, origin: [0, by, zc + dc / 2 - box.len / 2 - 2] }));
        }
        hardware.push(slideHardware(slide, nl, n, clr));
        hardware.push(hw('handle', 'Handtag eller knopp', n, 'st', 'möbelhandtag'));
    }
    return { parts, hardware, warnings, drillings };
}

export function buildDrawer(p, M) {
    const slide = slideById(p.slideId);
    const sideMat = matOf(M, p.sideMat, 'bjork15');
    const botMat = matOf(M, p.botMat, 'bjork4');
    const box = drawerBox({ openingW: p.w, boxH: p.h, depth: p.d, sideT: sideMat.thick, botT: botMat.thick, groove: p.groove, slide, clearance: p.clearance });
    const parts = drawerBoxParts(box, { h: p.h, sideMat, botMat, prefix: '', origin: [0, 0, 0] });
    return {
        parts,
        hardware: [slideHardware(slide, box.nl, 1, box.clr)],
        warnings: box.warnings,
        drillings: [],
        info: [`Lådlängd ${fmt(box.len)} mm`, `Ytterbredd ${fmt(box.boxW)} mm`, `Innerbredd ${fmt(box.inner)} mm`, box.nl ? `Skena ${box.nl} mm` : null].filter(Boolean)
    };
}

export function buildShaker(p, M) {
    const frameMat = matOf(M, p.frameMat, 'mdf19');
    const panelMat = matOf(M, p.panelMat, 'mdf6');
    const res = shakerDoorParts({ w: p.w, h: p.h, frame: p.frame, tenon: p.tenon, frameMat, panelMat });
    const hardware = [], drillings = [];
    if (p.hinges) {
        const n = hingeCount(p.h);
        hardware.push(hw('hinge-cliptop-110', 'Blum CLIP top BLUMOTION 110° gångjärn', n, 'st'));
        hardware.push(hw('hinge-plate', 'Monteringsplatta för gångjärn', n, 'st', 'Blum CLIP monteringsplatta'));
        drillings.push({ door: 'Dörr', w: p.w, h: p.h, side: 'vänster', holes: hingePositions(p.h, n), ...HINGE });
        if (p.frame < HINGE.edgeDist + HINGE.cupDia / 2 + 5) res.warnings.push(`Rambredden (${fmt(p.frame)} mm) är för smal för 35 mm gångjärnskopp. Välj minst ${HINGE.edgeDist + HINGE.cupDia / 2 + 5} mm.`);
    }
    return { parts: res.parts, hardware, warnings: res.warnings, drillings };
}

export const ITEM_TYPES = {
    cabinet: { label: 'Skåp', build: buildCabinet },
    drawer: { label: 'Lådor', build: buildDrawer },
    shaker: { label: 'Shaker-dörrar', build: buildShaker }
};

// ---------------------------------------------------------------------------
// Projekt
// ---------------------------------------------------------------------------
export function sanitizeParams(type, params) {
    const def = DEFAULT_PARAMS[type];
    const out = { ...def };
    if (!isObj(params)) return out;
    for (const [k, v] of Object.entries(def)) {
        if (!(k in params)) continue;
        if (typeof v === 'number') { const n = +params[k]; if (params[k] !== '' && Number.isFinite(n)) out[k] = n; }
        else if (typeof v === 'boolean') out[k] = !!params[k];
        else if (typeof params[k] === 'string' || typeof params[k] === 'number') out[k] = String(params[k]);
    }
    return out;
}

export function makeItem(type, name, params) {
    return { id: uid('it'), type, name: name || ITEM_TYPES[type].label, qty: 1, params: sanitizeParams(type, params), excluded: {} };
}

export function sanitizeProject(p) {
    if (!isObj(p)) return null;
    const items = (Array.isArray(p.items) ? p.items : [])
        .filter(it => isObj(it) && ITEM_TYPES[it.type])
        .map(it => ({
            id: typeof it.id === 'string' ? it.id : uid('it'),
            type: it.type,
            name: typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 60) : ITEM_TYPES[it.type].label,
            qty: clamp(Math.round(+it.qty) || 1, 1, 999),
            params: sanitizeParams(it.type, it.params),
            excluded: isObj(it.excluded) ? Object.fromEntries(Object.entries(it.excluded).filter(([, v]) => v === true)) : {}
        }));
    if (!items.length) return null;
    return { name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 80) : 'Mitt projekt', items };
}

export function exampleProject() {
    return {
        name: 'Exempel: kök',
        items: [
            makeItem('cabinet', 'Bänkskåp med lådor', {}),
            { ...makeItem('cabinet', 'Väggskåp', { w: 800, h: 700, d: 350, shelves: 2, fronts: 'doors', frontStyle: 'shaker', frontMat: 'mdf19' }), qty: 2 },
            makeItem('cabinet', 'Bänkskåp med dörr', { w: 400, h: 720, d: 560, shelves: 1, fronts: 'doors' })
        ]
    };
}

export function buildItem(item, M, S) {
    return ITEM_TYPES[item.type].build(item.params, M, S);
}

/**
 * Samlar alla delar i projektet (eller ett objekt) till en grupperad, numrerad kaplista.
 */
export function collect(items, M, S) {
    const pieces = [], hwMap = new Map(), warnings = [], drillings = [];
    for (const item of items) {
        const res = buildItem(item, M, S);
        res.warnings.forEach(w => warnings.push(`${item.name}: ${w}`));
        res.hardware.forEach(h => {
            const ex = hwMap.get(h.key);
            if (ex) ex.qty += h.qty * item.qty; else hwMap.set(h.key, { ...h, qty: h.qty * item.qty });
        });
        res.drillings.forEach(dr => drillings.push({ ...dr, item: item.name, count: item.qty }));
        for (const part of res.parts) {
            if (item.excluded[part.key]) continue;
            const mat = M[part.mat];
            const band = part.band || NO_BAND;
            let l = part.l - band.w * S.edgeThick;
            let w = part.w - band.l * S.edgeThick;
            const edgeLen = band.l * part.l + band.w * part.w;
            const lock = S.grainLock || (mat.grain && part.grain !== false);
            if (!lock && w > l) [l, w] = [w, l];
            pieces.push({ name: part.name, item: item.name, mat: mat.id, l: round1(l), w: round1(w), lock, edgeLen, count: item.qty });
        }
    }
    const rows = [];
    for (const p of pieces) {
        const ex = rows.find(r => r.mat === p.mat && r.l === p.l && r.w === p.w && r.lock === p.lock);
        if (ex) {
            ex.count += p.count; ex.edgeLen += p.edgeLen * p.count;
            if (!ex.names.includes(p.name)) ex.names.push(p.name);
            if (!ex.items.includes(p.item)) ex.items.push(p.item);
        } else rows.push({ mat: p.mat, l: p.l, w: p.w, lock: p.lock, count: p.count, edgeLen: p.edgeLen * p.count, names: [p.name], items: [p.item] });
    }
    rows.sort((a, b) => M[b.mat].thick - M[a.mat].thick || a.mat.localeCompare(b.mat) || b.l - a.l || b.w - a.w);
    rows.forEach((r, i) => { r.nr = i + 1; });
    return {
        rows,
        hardware: [...hwMap.values()],
        warnings,
        drillings,
        edgeMeters: rows.reduce((a, r) => a + r.edgeLen, 0) / 1000,
        partCount: rows.reduce((a, r) => a + r.count, 0)
    };
}

// ---------------------------------------------------------------------------
// Giljotinoptimering. Varje placering delar en fri rektangel med ett rakt snitt
// genom hela rektangeln, så att schemat alltid går att såga på en skivsåg.
// ---------------------------------------------------------------------------
const SORTS = {
    area: (a, b) => b.l * b.w - a.l * a.w,
    longest: (a, b) => Math.max(b.l, b.w) - Math.max(a.l, a.w) || b.l * b.w - a.l * a.w,
    length: (a, b) => b.l - a.l || b.w - a.w,
    width: (a, b) => b.w - a.w || b.l - a.l,
    perimeter: (a, b) => (b.l + b.w) - (a.l + a.w)
};
const SPLITS = ['shorterLeftover', 'longerLeftover', 'maxArea', 'minArea'];

function newBin(kind, L, W, trim, kerf, extra) {
    // Delar tar upp l+kerf × w+kerf. Ytan får +kerf så att en del kan gå ända ut i (putsade) kanten.
    const uw = L - 2 * trim + kerf, uh = W - 2 * trim + kerf;
    return { kind, L, W, trim, free: uw > 0 && uh > 0 ? [{ x: trim, y: trim, w: uw, h: uh }] : [], placements: [], ...extra };
}

function findSpot(bin, pw, ph, allowRot) {
    let best = null;
    for (let i = 0; i < bin.free.length; i++) {
        const f = bin.free[i];
        for (const rot of allowRot ? [false, true] : [false]) {
            const w = rot ? ph : pw, h = rot ? pw : ph;
            if (w <= f.w + 1e-6 && h <= f.h + 1e-6) {
                const score = Math.min(f.w - w, f.h - h);     // best short side fit
                const score2 = f.w * f.h - w * h;
                if (!best || score < best.score || (score === best.score && score2 < best.score2)) best = { i, rot, w, h, score, score2 };
            }
        }
    }
    return best;
}

function place(bin, spot, piece, split, kerf) {
    const f = bin.free[spot.i];
    const lw = f.w - spot.w, lh = f.h - spot.h;
    let horizontal;
    if (split === 'shorterLeftover') horizontal = lw <= lh;
    else if (split === 'longerLeftover') horizontal = lw > lh;
    else if (split === 'maxArea') horizontal = lw * f.h < f.w * lh;
    else horizontal = lw * f.h >= f.w * lh;
    const right = horizontal ? { x: f.x + spot.w, y: f.y, w: lw, h: spot.h } : { x: f.x + spot.w, y: f.y, w: lw, h: f.h };
    const down = horizontal ? { x: f.x, y: f.y + spot.h, w: f.w, h: lh } : { x: f.x, y: f.y + spot.h, w: spot.w, h: lh };
    bin.free.splice(spot.i, 1);
    for (const r of [right, down]) if (r.w > kerf + 1 && r.h > kerf + 1) bin.free.push(r);
    // Ritade mått (utan sågspalt), x längs skivans längd
    const dl = spot.rot ? piece.w : piece.l, dw = spot.rot ? piece.l : piece.w;
    bin.placements.push({ x: f.x, y: f.y, dl, dw, rotated: spot.rot, piece });
}

function packRun(pieces, mat, S, offcuts, sortKey, split) {
    const kerf = S.kerf;
    const order = [...pieces].sort(SORTS[sortKey]);
    const bins = [];
    const spare = offcuts.map(o => ({ ...o })).sort((a, b) => a.l * a.w - b.l * b.w); // minsta spillbit först
    const oversize = [];
    for (const piece of order) {
        const allowRot = !piece.lock;
        const pw = piece.l + kerf, ph = piece.w + kerf;
        let done = false;
        for (const bin of bins) {
            const spot = findSpot(bin, pw, ph, allowRot);
            if (spot) { place(bin, spot, piece, split, kerf); done = true; break; }
        }
        if (done) continue;
        // Försök med en ny spillbit innan en ny skiva öppnas
        const oi = spare.findIndex(o => findSpot(newBin('offcut', o.l, o.w, 0, kerf), pw, ph, allowRot));
        let bin;
        if (oi >= 0) { const o = spare.splice(oi, 1)[0]; bin = newBin('offcut', o.l, o.w, 0, kerf, { offcutId: o.id }); }
        else bin = newBin('sheet', mat.L, mat.W, S.trim, kerf);
        const spot = findSpot(bin, pw, ph, allowRot);
        if (!spot) { oversize.push(piece); continue; }
        place(bin, spot, piece, split, kerf);
        bins.push(bin);
    }
    return { bins, oversize };
}

export function optimizeMaterial(rows, mat, S, offcuts = []) {
    const pieces = [];
    rows.forEach(r => { for (let k = 0; k < r.count; k++) pieces.push({ nr: r.nr, name: r.names[0], l: r.l, w: r.w, lock: r.lock, mat: r.mat }); });
    let best = null;
    for (const sortKey of Object.keys(SORTS)) {
        for (const split of SPLITS) {
            const run = packRun(pieces, mat, S, offcuts, sortKey, split);
            const sheets = run.bins.filter(b => b.kind === 'sheet');
            const lastUtil = sheets.length ? util(sheets[sheets.length - 1]) : 0;
            const score = [run.oversize.length, sheets.length, run.bins.length, lastUtil];
            if (!best || better(score, best.score)) best = { ...run, score };
        }
    }
    const kerf = S.kerf;
    const newOffcuts = [];
    best.bins.forEach(b => {
        b.util = util(b);
        b.leftovers = b.free
            .map(f => ({ x: f.x, y: f.y, l: round1(Math.floor(f.w - kerf)), w: round1(Math.floor(f.h - kerf)) }))
            .map(f => f.l >= f.w ? f : { ...f, l: f.w, w: f.l, swapped: true })
            .filter(f => f.l >= S.minOffcutL && f.w >= S.minOffcutW);
        b.leftovers.forEach(f => newOffcuts.push({ mat: mat.id, l: f.l, w: f.w }));
    });
    const sheets = best.bins.filter(b => b.kind === 'sheet').length;
    return {
        mat, bins: best.bins, oversize: best.oversize, sheets,
        offcutsUsed: best.bins.filter(b => b.kind === 'offcut').map(b => b.offcutId),
        newOffcuts, cost: sheets * mat.price
    };
}

function util(bin) { return bin.placements.reduce((a, p) => a + p.dl * p.dw, 0) / (bin.L * bin.W); }
// Lägre är bättre i alla led. Vid lika antal skivor vinner lägst nyttjande på sista skivan,
// eftersom de andra skivorna då är fullare och restbiten blir större.
function better(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return a[3] < b[3];
}

export function optimize(rows, M, S, offcuts = []) {
    const byMat = {};
    rows.forEach(r => { (byMat[r.mat] = byMat[r.mat] || []).push(r); });
    const results = Object.entries(byMat).map(([id, list]) => optimizeMaterial(list, M[id], S, offcuts.filter(o => o.mat === id)));
    const sheetArea = results.reduce((a, r) => a + r.bins.filter(b => b.kind === 'sheet').reduce((s, b) => s + b.L * b.W, 0), 0);
    const usedArea = results.reduce((a, r) => a + r.bins.filter(b => b.kind === 'sheet').reduce((s, b) => s + b.util * b.L * b.W, 0), 0);
    return {
        materials: results,
        totalCost: results.reduce((a, r) => a + r.cost, 0),
        sheets: results.reduce((a, r) => a + r.sheets, 0),
        offcutsUsed: results.flatMap(r => r.offcutsUsed),
        newOffcuts: results.flatMap(r => r.newOffcuts),
        utilization: sheetArea ? usedArea / sheetArea : 0
    };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export function buildCsv(col, M, { sep = ';', bom = true } = {}) {
    const n = x => String(round1(x)).replace('.', ',');
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const L = [];
    L.push(['Nr', 'Antal', 'Längd (mm)', 'Bredd (mm)', 'Material', 'Komponent', 'Objekt', 'Ådring låst', 'Kantlist (m)'].join(sep));
    col.rows.forEach(r => L.push([r.nr, r.count, n(r.l), n(r.w), q(materialLabel(M[r.mat])), q(r.names.join(', ')), q(r.items.join(', ')), r.lock ? 'Ja' : 'Nej', n(r.edgeLen / 1000)].join(sep)));
    if (col.hardware.length) {
        L.push('', 'BESLAGSLISTA', ['Produkt', 'Antal', 'Enhet'].join(sep));
        col.hardware.forEach(h => L.push([q(h.name), h.qty, q(h.unit)].join(sep)));
    }
    return (bom ? '﻿' : '') + L.join('\n') + '\n';
}

export function labelText(row, M) {
    return `CutYard #${row.nr} | ${fmt(row.l)}x${fmt(row.w)} mm | ${materialLabel(M[row.mat])} | ${row.names.join(', ')}`;
}

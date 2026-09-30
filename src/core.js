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
    grainLock: false,   // rotera inte synliga delar (ådring)
    sheetL: 2440,       // skivformat (mm)
    sheetW: 1220,
    price: 495,         // pris per skiva (kr)
    sheets: {},         // eget format/pris per tjocklek, t.ex. { "19": { L: 2800, W: 2070, price: 649 } }
    reveal: 1.5,        // spel mellan front och stommens ytterkant (mm)
    frontGap: 3,        // spel mellan två fronter (mm)
    boardL: 2400,       // standardlängd på virke (mm)
    boardPrice: 40,     // pris per meter virke (kr)
    boards: {},         // egen längd/pris per virkesdimension, t.ex. { "19x60|ek": { L: 3000, price: 85 } }
    minOffcutL: 400,    // minsta spillbit som sparas (mm)
    minOffcutW: 150,
    shop: 'prisjakt',   // butikssökning för beslag
    shopTemplate: '',   // egen URL-mall med {q}
    company: '',        // företagsuppgifter överst på offerten (fritext, flera rader)
    cutServiceName: '', // kapservice som beställningar skickas till
    cutServiceEmail: ''
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
        if (k === 'sheets' || k === 'boards') continue;
        if (typeof def === 'boolean') out[k] = !!s[k];
        else if (typeof def === 'number') { const v = +s[k]; if (s[k] !== '' && s[k] != null && Number.isFinite(v) && v >= 0) out[k] = v; }
        else if (typeof s[k] === 'string') out[k] = s[k];
    }
    if (!SHOPS[out.shop]) out.shop = DEFAULT_SETTINGS.shop;
    out.company = out.company.slice(0, 400);
    out.cutServiceName = out.cutServiceName.trim().slice(0, 80);
    out.cutServiceEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.cutServiceEmail.trim()) ? out.cutServiceEmail.trim() : '';
    out.kerf = clamp(out.kerf, 0, 10);
    out.trim = clamp(out.trim, 0, 50);
    if (out.sheetL < 300) out.sheetL = DEFAULT_SETTINGS.sheetL;
    if (out.sheetW < 300) out.sheetW = DEFAULT_SETTINGS.sheetW;
    out.sheets = {};
    const okNum = (v, min) => v !== '' && v != null && Number.isFinite(+v) && +v >= min;
    const put = (k, field, v, min) => {
        const { t, name } = parseMatKey(k);
        if (!(Number.isFinite(t) && t > 0) || !okNum(v, min)) return;
        (out.sheets[matKey(t, name)] ??= {})[field] = +v;
    };
    if (isObj(s.sheets)) for (const [k, o] of Object.entries(s.sheets)) if (isObj(o)) { put(k, 'L', o.L, 300); put(k, 'W', o.W, 300); put(k, 'price', o.price, 0); }
    if (isObj(s.prices)) for (const [k, v] of Object.entries(s.prices)) if (out.sheets[thickKey(+k)]?.price == null) put(k, 'price', v, 0); // äldre format
    if (out.boardL < 300) out.boardL = DEFAULT_SETTINGS.boardL;
    out.boards = {};
    if (isObj(s.boards)) for (const [k, o] of Object.entries(s.boards)) {
        if (!/^\d+(\.\d)?x\d+(\.\d)?(\|.{1,40})?$/.test(k) || !isObj(o)) continue;
        const e = {};
        if (okNum(o.L, 300)) e.L = +o.L;
        if (okNum(o.price, 0)) e.price = +o.price;
        if (Object.keys(e).length) out.boards[k] = e;
    }
    return out;
}

export function shopUrl(settings, query) {
    const tpl = settings.shop === 'custom' ? settings.shopTemplate : SHOPS[settings.shop]?.template;
    if (!tpl || !tpl.includes('{q}') || !/^https:\/\//.test(tpl)) return null;
    return tpl.replace('{q}', encodeURIComponent(query));
}

// ---------------------------------------------------------------------------
// En skiva identifieras av tjocklek och ett frivilligt namn (skivtyp), t.ex. "Björkplywood".
// Delar med samma tjocklek men olika skivtyp hamnar på olika skivor.
// Skivformat och pris kommer från inställningarna och kan ändras per skiva.
// ---------------------------------------------------------------------------
export const thickKey = t => String(round1(t));
export const thickLabel = t => `${fmt(t)} mm`;
export const normName = s => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 40) : '');
export const matKey = (t, name = '') => { const n = normName(name).toLowerCase(); return n ? `${thickKey(t)}|${n}` : thickKey(t); };
export const matLabel = (t, name = '') => (normName(name) ? `${fmt(t)} mm ${normName(name)}` : `${fmt(t)} mm`);
export function parseMatKey(k) {
    const i = String(k).indexOf('|');
    return i < 0 ? { t: +k, name: '' } : { t: +String(k).slice(0, i), name: String(k).slice(i + 1) };
}
export function sheetFor(S, t, name = '') {
    const own = S.sheets?.[matKey(t, name)] || {};
    const base = normName(name) ? (S.sheets?.[thickKey(t)] || {}) : {}; // en namngiven skiva ärver tjocklekens värden
    return { t, name: normName(name), key: matKey(t, name), L: own.L ?? base.L ?? S.sheetL, W: own.W ?? base.W ?? S.sheetW, price: own.price ?? base.price ?? S.price, custom: own };
}

// Virke identifieras av tjocklek × bredd och skivtyp (träslag), t.ex. "19x60|ek".
export const boardKey = (t, w, name = '') => { const n = normName(name).toLowerCase(); return `${thickKey(t)}x${String(round1(w))}${n ? `|${n}` : ''}`; };
export const boardLabel = (t, w, name = '') => `${fmt(t)} × ${fmt(w)} mm${normName(name) ? ` ${normName(name)}` : ''}`;
export function boardFor(S, t, w, name = '') {
    const key = boardKey(t, w, name);
    const own = S.boards?.[key] || {};
    return { t, w, name: normName(name), key, L: own.L ?? S.boardL, price: own.price ?? S.boardPrice, custom: own };
}

export function sanitizeOffcuts(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(o => isObj(o) && +o.t > 0 && +o.l > 0 && +o.w > 0)
        .map(o => ({ id: typeof o.id === 'string' ? o.id : uid('off'), t: round1(+o.t), mn: normName(o.mn), l: round1(+o.l), w: round1(+o.w) }));
}

// ---------------------------------------------------------------------------
// Lådskenor. Riktvärden – kontrollera alltid mot tillverkarens monteringsanvisning.
// clearance = spel per sida mellan skåpsida och lådsida.
// ---------------------------------------------------------------------------
const range = (a, b, step) => { const r = []; for (let x = a; x <= b; x += step) r.push(x); return r; };

// Produktsidor hos tillverkarna (kontrollerade adresser).
export const MAKER_LINKS = {
    movento: { label: 'Blum', url: 'https://www.blum.com/se/sv/products/runnersystems/movento/overview/', mount: 'https://www.blum.com/se/sv/products/runnersystems/movento/assembly/' },
    tandem: { label: 'Blum', url: 'https://www.blum.com/se/sv/products/runnersystems/tandem/overview/', mount: 'https://www.blum.com/se/sv/products/runnersystems/tandem/assembly/' },
    actro: { label: 'Hettich', url: 'https://www.hettich.com/en-us/products/runner-systems/actro-5d' },
    clipTopBlumotion: { label: 'Blum', url: 'https://www.blum.com/se/sv/products/hingesystems/clip-top-blumotion/assembly/' },
    clipTop: { label: 'Blum', url: 'https://www.blum.com/se/sv/products/hingesystems/clip-top/overview/' }
};

export const SLIDES = [
    { id: 'ball', name: 'Kullagerskenor, sidomonterade', clearance: 12.7, mount: 'side', lengths: range(250, 650, 50), lengthOffset: 0, depthMargin: 5, bottomRecess: 12, maxSide: null,
      note: 'Skruvas på lådans sidor. Kräver 12,7 mm fritt utrymme på var sida mellan skåpsida och lådsida. Lådan blir lika lång som skenan.' },
    { id: 'blum-movento', name: 'Blum MOVENTO', clearance: 5, mount: 'under', lengths: [250, 270, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750], lengthOffset: -10, depthMargin: 3, bottomRecess: 13, maxSide: 16, link: MAKER_LINKS.movento,
      note: 'Döljs under lådan. Kräver 5 mm spel på var sida och lådsidor på högst 16 mm, så lådan blir invändigt 42 mm smalare än öppningen. Lådan görs 10 mm kortare än skenan. Bakstycket behöver ett urtag för skenans låsning, se Blums monteringsanvisning.' },
    { id: 'blum-tandem', name: 'Blum TANDEM', clearance: 5, mount: 'under', lengths: [250, 270, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750], lengthOffset: -10, depthMargin: 3, bottomRecess: 13, maxSide: 16, link: MAKER_LINKS.tandem,
      note: 'Döljs under lådan. Kräver 5 mm spel på var sida och lådsidor på högst 16 mm, så lådan blir invändigt 42 mm smalare än öppningen. Lådan görs 10 mm kortare än skenan. Bakstycket behöver ett urtag för skenans låsning, se Blums monteringsanvisning.' },
    { id: 'hettich-actro', name: 'Hettich Actro 5D', clearance: 5, mount: 'under', lengths: [270, 300, 350, 400, 450, 500, 550, 600], lengthOffset: -10, depthMargin: 3, bottomRecess: 13, maxSide: 16, link: MAKER_LINKS.actro,
      note: 'Döljs under lådan. Kräver 5 mm spel på var sida och lådsidor på högst 16 mm, så lådan blir invändigt 42 mm smalare än öppningen. Kontrollera lådans längd mot Hettichs monteringsanvisning.' },
    { id: 'custom', name: 'Egen skena (ange spel)', clearance: null, mount: 'side', lengths: null, lengthOffset: 0, depthMargin: 10, bottomRecess: 12, maxSide: null,
      note: 'Ange hur mycket spel skenan kräver på var sida (står i skenans anvisning). Lådan görs 10 mm kortare än skåpets innerdjup.' }
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
            warnings.push(`Skåpet är för grunt för ${slide.name}. Den kortaste skenan är ${slide.lengths[0]} mm och behöver minst ${slide.lengths[0] + slide.depthMargin} mm innerdjup. Öka djupet eller välj en annan skena.`);
            len = Math.max(50, o.depth - slide.depthMargin);
        } else len = nl + slide.lengthOffset;
    } else len = Math.max(50, Math.floor(o.depth - slide.depthMargin));

    const boxW = o.openingW - 2 * clr;
    const inner = boxW - 2 * o.sideT;
    const innerLen = len - 2 * o.sideT;
    const g = o.groove;
    if (inner < 40) warnings.push('Lådan blir för smal. Öppningen räcker inte till skenornas spel och lådsidornas tjocklek. Öka bredden eller välj tunnare lådsidor.');
    if (slide.maxSide && o.sideT > slide.maxSide) warnings.push(`${slide.name} kräver lådsidor på högst ${slide.maxSide} mm. Du har angett ${fmt(o.sideT)} mm.`);
    if (g >= o.sideT) warnings.push(`Spåret för lådbottnen (${fmt(g)} mm) är lika djupt som lådsidan är tjock (${fmt(o.sideT)} mm) och går igenom sidan. Minska spårdjupet.`);
    else if (g > o.sideT * 0.6) warnings.push('Spåret för lådbottnen är djupare än 60 % av lådsidans tjocklek och försvagar sidan. Välj ett grundare spår.');
    if (o.boxH < 50) warnings.push('Lådan är lägre än 50 mm och rymmer mycket lite. Kontrollera lådhöjden.');
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
// part: { key, name, l, w, t (tjocklek), grain, band:{l,w}, geo:{size,pos,role} }
//   grain=false: orienteringen spelar ingen roll (dolda delar) – får roteras även i ådrat material.
//   band.l = antal kantlistade kanter som löper längs l (minskar w), band.w likadant.
// ---------------------------------------------------------------------------
const NO_BAND = { l: 0, w: 0 };

function hw(key, name, qty, unit, query, link = null) { return { key, name, qty, unit, query: query || name, link }; }

// ---------------------------------------------------------------------------
// Profiler för ram och fyllning, och vilka fräsar som ger dem.
// Måtten varierar mellan fabrikat – tapp/spårdjup ska stämma med den fräsats man har.
// ---------------------------------------------------------------------------
const bit = (key, name, use, query) => ({ key, name, use, query });
export const FRAME_PROFILES = {
    square: { name: 'Rak (klassisk shaker)', joint: 'Not och tapp',
        desc: 'Rak innerkant utan profil. Fyllningen sitter i ett spår i ramen. De liggande delarna (rails) har tappar som går in i spåret på de stående delarna (stiles).',
        bits: [bit('bit-slot6', 'Skivnotfräs 6 mm med kullager', 'Spår för fyllningen i stiles och rails', 'skivnotfräs 6 mm'),
               bit('bit-straight', 'Rak fräs, Ø 12–19 mm', 'Tappar på railsens ändar (kan också sågas på bordsåg)', 'rak fräs 12 mm')] },
    'shaker-cope': { name: 'Rak med kontraprofil', joint: 'Kontraprofil (cope & stick)',
        desc: 'Samma raka utseende, men fogen fräses med en kontraprofilsats. Ändarna på de liggande delarna får en motprofil som griper in i spåret, så det behövs inga separata tappar.',
        bits: [bit('bit-cope-shaker', 'Kontraprofilsats, rak shaker-profil', 'Spår längs kanterna och motprofil på railsens ändar', 'kontraprofilfräs shaker')] },
    ogee: { name: 'Ogee', joint: 'Kontraprofil (cope & stick)',
        desc: 'S-formad profil längs ramens innerkant. Klassisk och dekorativ.',
        bits: [bit('bit-cope-ogee', 'Kontraprofilsats, ogee', 'Profil och spår längs kanterna, motprofil på railsens ändar', 'kontraprofilfräs ogee')] },
    roundover: { name: 'Rundad kant', joint: 'Kontraprofil (cope & stick)',
        desc: 'Mjukt rundad innerkant. Diskret och tålig mot slag.',
        bits: [bit('bit-cope-round', 'Kontraprofilsats, rundad (kvartsrund)', 'Profil och spår längs kanterna, motprofil på railsens ändar', 'kontraprofilfräs rundad')] },
    bevel: { name: 'Fas', joint: 'Kontraprofil (cope & stick)',
        desc: 'Rak fas längs innerkanten. Enkel och modern.',
        bits: [bit('bit-cope-bevel', 'Kontraprofilsats, fas', 'Profil och spår längs kanterna, motprofil på railsens ändar', 'kontraprofilfräs fas')] }
};
export const PANEL_STYLES = {
    flat: { name: 'Platt', minT: 3, maxT: 12,
        desc: 'Tunn skiva, t.ex. 6 mm MDF eller plywood, som sätts direkt i spåret. Ingen fräsning.', bits: [] },
    'raised-bevel': { name: 'Upphöjd, rak fas', minT: 15, maxT: 25,
        desc: 'Tjockare fyllning där kanten fasas ned till en tunga som passar i spåret.',
        bits: [bit('bit-raise-bevel', 'Fältfräs (spegelfräs), rak fas', 'Fasar fyllningens kanter ned till spårets bredd', 'fältfräs rak fas')] },
    'raised-cove': { name: 'Upphöjd, hålkäl', minT: 15, maxT: 25,
        desc: 'Upphöjd fyllning med konkav, mjuk övergång mot kanten.',
        bits: [bit('bit-raise-cove', 'Fältfräs (spegelfräs), hålkäl', 'Fräser en hålkäl ned till spårets bredd', 'fältfräs hålkäl')] },
    'raised-ogee': { name: 'Upphöjd, ogee', minT: 15, maxT: 25,
        desc: 'Upphöjd fyllning med S-formad kant. Passar ihop med ogee-ram.',
        bits: [bit('bit-raise-ogee', 'Fältfräs (spegelfräs), ogee', 'Fräser en S-profil ned till spårets bredd', 'fältfräs ogee')] }
};
export const RAISED_PANEL_NOTE = 'Säkerhet: fältfräsar är stora, ofta 80–90 mm i diameter. Använd dem bara i bordsfräs och med det varvtal tillverkaren anger.';

export function profileTools(profileId, panelId) {
    const fp = FRAME_PROFILES[profileId] || FRAME_PROFILES.square;
    const ps = PANEL_STYLES[panelId] || PANEL_STYLES.flat;
    return [...fp.bits, ...ps.bits];
}

export function shakerDoorParts({ w, h, frame, tenon, frameT, panelT, profile = 'square', panelStyle = 'flat', frameName = '', panelName = '', frameStock = 'sheet', prefix = '', origin = [0, 0, 0] }) {
    const f = frame, tF = frameT, tP = panelT;
    const [ox, oy, oz] = origin;
    const p = prefix ? prefix + ': ' : '';
    const warnings = [];
    if (w <= 2 * f + 20 || h <= 2 * f + 20) warnings.push(`${prefix || 'Dörren'}: ramen tar upp nästan hela dörren. Minska rambredden eller öka dörrens mått.`);
    const ps = PANEL_STYLES[panelStyle] || PANEL_STYLES.flat;
    if (tP < ps.minT) warnings.push(`${prefix || 'Dörren'}: en ${ps.name.toLowerCase()} fyllning behöver vara minst ${ps.minT} mm tjock${panelStyle === 'flat' ? '' : ' för att kanten ska kunna fräsas ned till en tunga'}.`);
    else if (tP > ps.maxT) warnings.push(`${prefix || 'Dörren'}: ${fmt(tP)} mm är tjockt för en ${ps.name.toLowerCase()} fyllning. Vanligt är ${ps.minT}–${ps.maxT} mm.`);
    if (panelStyle === 'flat' && tP >= tF) warnings.push(`${prefix || 'Dörren'}: fyllningen är lika tjock som ramen eller tjockare och får inte plats i spåret.`);
    const railL = w - 2 * f + 2 * tenon;
    const pw = Math.max(1, w - 2 * f), ph = Math.max(1, h - 2 * f);
    const common = { t: tF, mn: frameName, grain: 'visible', band: NO_BAND, stock: frameStock === 'board' ? 'board' : 'sheet' };
    const parts = [
        { ...common, key: `${p}stileL`, name: `${p}Stile vänster`, l: h, w: f, geo: { size: [f, h, tF], pos: [ox - w / 2 + f / 2, oy, oz], role: 'frame' } },
        { ...common, key: `${p}stileR`, name: `${p}Stile höger`, l: h, w: f, geo: { size: [f, h, tF], pos: [ox + w / 2 - f / 2, oy, oz], role: 'frame' } },
        { ...common, key: `${p}railT`, name: `${p}Rail topp`, l: railL, w: f, geo: { size: [pw, f, tF], pos: [ox, oy + h / 2 - f / 2, oz], role: 'frame' } },
        { ...common, key: `${p}railB`, name: `${p}Rail botten`, l: railL, w: f, geo: { size: [pw, f, tF], pos: [ox, oy - h / 2 + f / 2, oz], role: 'frame' } },
        { key: `${p}panel`, name: `${p}Spegelfyllning`, l: h - 2 * f + 2 * tenon - 2, w: w - 2 * f + 2 * tenon - 2, t: tP, mn: panelName, grain: 'visible', band: NO_BAND,
          geo: { size: [pw, ph, tP], pos: [ox, oy, oz], role: 'panel' } }
    ];
    return { parts, warnings, thick: tF, tools: profileTools(profile, panelStyle) };
}

function drawerBoxParts(box, { h, sideT, botT, sideName = '', botName = '', prefix, origin }) {
    const [ox, oy, oz] = origin;
    const t = sideT, tb = botT;
    const p = prefix ? prefix + ': ' : '';
    const common = { t, mn: sideName, grain: 'visible', band: NO_BAND };
    const inner = Math.max(1, box.inner), len = box.len;
    return [
        { ...common, key: `${p}sideL`, name: `${p}Lådsida vänster`, l: len, w: h, geo: { size: [t, h, len], pos: [ox - box.boxW / 2 + t / 2, oy, oz], role: 'drawer' } },
        { ...common, key: `${p}sideR`, name: `${p}Lådsida höger`, l: len, w: h, geo: { size: [t, h, len], pos: [ox + box.boxW / 2 - t / 2, oy, oz], role: 'drawer' } },
        { ...common, key: `${p}front`, name: `${p}Lådstycke fram`, l: inner, w: h, geo: { size: [inner, h, t], pos: [ox, oy, oz + len / 2 - t / 2], role: 'drawer' } },
        { ...common, key: `${p}back`, name: `${p}Lådstycke bak`, l: inner, w: h, geo: { size: [inner, h, t], pos: [ox, oy, oz - len / 2 + t / 2], role: 'drawer' } },
        { key: `${p}bottom`, name: `${p}Lådbotten`, l: box.botW, w: box.botL, t: tb, mn: botName, grain: false, band: NO_BAND,
          geo: { size: [Math.max(1, box.botW), tb, Math.max(1, box.botL)], pos: [ox, oy - h / 2 + box.bottomRecess + tb / 2, oz], role: 'bottom' } }
    ];
}

function slideHardware(slide, nl, pairs, clr) {
    if (slide.id === 'custom' || nl == null) return hw('slide-custom', `Lådskenor (${fmt(clr)} mm spel/sida)`, pairs, 'par', 'lådskenor');
    const name = slide.id === 'ball' ? `Kullagerskenor fullt utdrag ${nl} mm` : `${slide.name} ${nl} mm`;
    return hw(`slide-${slide.id}-${nl}`, name, pairs, 'par', name, slide.link || null);
}

export const DEFAULT_PARAMS = {
    // Tjocklekar i mm. backT = 0 betyder inget bakstycke.
    cabinet: { kind: 'base', w: 600, h: 720, d: 560, carcassT: 16, backT: 3, backMount: 'surface', shelves: 1, shelfHoles: true, dividers: 0, plinthH: 0, rail: false, edgeBand: true,
               fronts: 'drawers', doorCount: 'auto', drawerCount: 3, frontT: 19, frontStyle: 'flat', frontBand: false,
               frame: 60, tenon: 10, panelT: 6, profile: 'square', panelStyle: 'flat', frameStock: 'sheet', slideId: 'blum-movento', clearance: 12.7,
               drawerSideT: 15, drawerBotT: 4, groove: 6, grain: false,
               carcassName: '', backName: '', frontName: '', panelName: '', drawerName: '', drawerBotName: '' },
    drawer: { w: 564, h: 150, d: 500, sideT: 15, botT: 4, slideId: 'ball', clearance: 12.7, groove: 6, grain: false, sideName: '', botName: '' },
    shaker: { w: 400, h: 800, frame: 60, tenon: 10, frameT: 19, panelT: 6, profile: 'square', panelStyle: 'flat', frameStock: 'sheet', hinges: true, grain: false, frameName: '', panelName: '' },
    // Egen kaplista: fria delar. rows = [{ id, name, qty, l, w, t, mn, grain, edges: { l1, l2, w1, w2 } }]
    list: { rows: [] }
};

// ---------------------------------------------------------------------------
// Egen kaplista
// ---------------------------------------------------------------------------
const EDGE_KEYS = ['l1', 'l2', 'w1', 'w2'];
export function makeListRow(o = {}) {
    return sanitizeListRow({ id: uid('row'), name: '', qty: 1, l: 600, w: 300, t: 16, mn: '', grain: false, board: false, edges: {}, ...o });
}
export function sanitizeListRow(r) {
    if (!isObj(r)) return null;
    const num = (v, def, lo, hi) => { const n = +v; return v !== '' && v != null && Number.isFinite(n) ? clamp(n, lo, hi) : def; };
    const edges = isObj(r.edges) ? r.edges : {};
    return {
        id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : uid('row'),
        name: typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '',
        qty: Math.round(num(r.qty, 1, 1, 999)),
        l: round1(num(r.l, 600, 1, 10000)),
        w: round1(num(r.w, 300, 1, 10000)),
        t: round1(num(r.t, 16, 0.5, 100)),
        mn: normName(r.mn),
        grain: !!r.grain,
        board: !!r.board,
        edges: Object.fromEntries(EDGE_KEYS.map(k => [k, !!edges[k]]))
    };
}

export function buildList(p) {
    const parts = [];
    let x = 0;
    const gap = 40;
    p.rows.forEach((r, i) => {
        const band = { l: (r.edges.l1 ? 1 : 0) + (r.edges.l2 ? 1 : 0), w: (r.edges.w1 ? 1 : 0) + (r.edges.w2 ? 1 : 0) };
        parts.push({ key: `row_${r.id}`, name: r.name || `Del ${i + 1}`, l: r.l, w: r.w, t: r.t, mn: r.mn, qty: r.qty,
                     grain: r.grain ? 'fixed' : false, band, stock: r.board ? 'board' : 'sheet',
                     geo: { size: [r.w, r.l, r.t], pos: [x + r.w / 2, r.l / 2, 0], role: 'carcass' } });
        x += r.w + gap;
    });
    // Centrera delarna i 3D-vyn
    const shift = x > 0 ? (x - gap) / 2 : 0;
    const maxL = Math.max(0, ...p.rows.map(r => r.l));
    parts.forEach(pt => { pt.geo.pos[0] -= shift; pt.geo.pos[1] -= maxL / 2; });
    const warnings = p.rows.length ? [] : ['Listan är tom. Lägg till delar eller klistra in en lista från Excel.'];
    return { parts, hardware: [], warnings, drillings: [], tools: [] };
}

// Förinställda mått per skåptyp. Väljs i formuläret; användaren kan ändra allt efteråt.
export const CABINET_KINDS = {
    base: { label: 'Bänkskåp', preset: { w: 600, h: 720, d: 560, shelves: 1, plinthH: 100, fronts: 'drawers' } },
    wall: { label: 'Väggskåp', preset: { w: 600, h: 700, d: 350, shelves: 2, plinthH: 0, fronts: 'doors' } },
    tall: { label: 'Högskåp', preset: { w: 600, h: 2100, d: 560, shelves: 4, plinthH: 100, fronts: 'doors' } }
};

// 32-mm-systemet: hål Ø5 mm, 37 mm från fram- och bakkant, 32 mm mellan hålen.
export const SHELF_HOLE = { dia: 5, depth: 12, edge: 37, pitch: 32, margin: 64 };
export function shelfHolePositions(sideH, t) {
    const span = sideH - 2 * t - 2 * SHELF_HOLE.margin;
    if (span < 0) return [];
    const n = Math.floor(span / SHELF_HOLE.pitch) + 1;
    const start = (sideH - (n - 1) * SHELF_HOLE.pitch) / 2; // symmetriskt, räknat från sidans underkant
    return Array.from({ length: n }, (_, i) => round1(start + i * SHELF_HOLE.pitch));
}
export const BACK_GROOVE = { inset: 10, depth: 8 }; // spårets avstånd från bakkant och djup

export function buildCabinet(p, S) {
    const t = p.carcassT, tB = Math.max(0, p.backT);
    const back = tB > 0;
    const grooved = back && p.backMount === 'groove';
    const { w, h, d } = p;
    const warnings = [], hardware = [], drillings = [], processing = [], parts = [];
    if (w <= 2 * t + 20) warnings.push(`Skåpet är för smalt. Bredden måste vara större än två sidor (2 × ${fmt(t)} mm). Öka bredden eller välj tunnare skivor.`);
    if (d - tB <= 60) warnings.push('Skåpet är för grunt. Öka djupet.');
    if (grooved && tB + 2 > t - 4) warnings.push(`Bakstycket (${fmt(tB)} mm) är för tjockt för ett spår i ${fmt(t)} mm skivor. Välj ett tunnare bakstycke eller skruva fast det på baksidan.`);

    const inner = Math.max(1, w - 2 * t);
    // Utanpåliggande bakstycke: stommen blir d − tB djup. I spår: stommen är hela djupet och bakstycket sitter en bit in.
    const dc = grooved ? d : Math.max(1, d - tB);
    const zc = grooved ? 0 : tB / 2;
    const frontZ = d / 2;
    const innerD = grooved ? d - BACK_GROOVE.inset - tB : dc;   // fritt djup framför bakstycket
    const band = p.edgeBand ? { l: 1, w: 0 } : NO_BAND; // framkanten löper längs l
    const c = { t, mn: p.carcassName, grain: 'visible', band };
    parts.push(
        { ...c, key: 'sideL', name: 'Vänster sida', l: h, w: dc, geo: { size: [t, h, dc], pos: [-w / 2 + t / 2, 0, zc], role: 'carcass' } },
        { ...c, key: 'sideR', name: 'Höger sida', l: h, w: dc, geo: { size: [t, h, dc], pos: [w / 2 - t / 2, 0, zc], role: 'carcass' } },
        { ...c, key: 'top', name: 'Topp', l: inner, w: dc, geo: { size: [inner, t, dc], pos: [0, h / 2 - t / 2, zc], role: 'carcass' } },
        { ...c, key: 'bottom', name: 'Botten', l: inner, w: dc, geo: { size: [inner, t, dc], pos: [0, -h / 2 + t / 2, zc], role: 'carcass' } }
    );

    // Mellanväggar delar skåpet i sektioner (inte med lådor)
    const drawers = p.fronts === 'drawers';
    const nDiv = drawers ? 0 : clamp(Math.round(p.dividers) || 0, 0, 4);
    if (drawers && p.dividers > 0) warnings.push('Mellanväggar används inte i skåp med lådor och räknas inte med.');
    const secW = (inner - nDiv * t) / (nDiv + 1);
    if (nDiv && secW < 100) warnings.push('Sektionerna mellan mellanväggarna blir smalare än 100 mm. Minska antalet mellanväggar.');
    const divD = innerD - 2; // mellanväggen går från bakstycket till framkanten
    for (let i = 1; i <= nDiv; i++) {
        const x = -inner / 2 + i * secW + (i - 1) * t + t / 2;
        parts.push({ ...c, key: `div${i}`, name: nDiv === 1 ? 'Mellanvägg' : `Mellanvägg ${i}`, l: h - 2 * t, w: divD,
                     geo: { size: [t, h - 2 * t, divD], pos: [x, 0, frontZ - divD / 2], role: 'carcass' } });
    }

    // Hyllplan: antal per sektion
    const shelves = drawers ? 0 : clamp(Math.round(p.shelves), 0, 20);
    if (shelves > 0) {
        if (h <= 2 * t + shelves * t + 20) warnings.push('Hyllplanen får inte plats på höjden. Minska antalet hyllplan eller öka höjden.');
        const sd = Math.max(1, innerD - 20);                       // 20 mm indrag från framkant
        const gap = Math.max(0, (h - 2 * t - shelves * t) / (shelves + 1));
        const sl = Math.max(1, secW - 1);
        for (let sec = 0; sec <= nDiv; sec++) {
            const x = -inner / 2 + sec * (secW + t) + secW / 2;
            for (let i = 1; i <= shelves; i++) {
                const y = -h / 2 + t + i * gap + (i - 1) * t + t / 2;
                const key = nDiv ? `shelf${sec + 1}_${i}` : `shelf${i}`;
                const name = nDiv ? `Hyllplan ${sec + 1}.${i}` : `Hyllplan ${i}`;
                parts.push({ ...c, key, name, l: sl, w: sd, geo: { size: [sl, t, sd], pos: [x, y, frontZ - 20 - sd / 2], role: 'shelf' } });
            }
        }
        const nShelves = shelves * (nDiv + 1);
        hardware.push(hw('shelfpin5', 'Hyllbärare 5 mm', nShelves * 4, 'st'));
        if (p.shelfHoles) {
            const holes = shelfHolePositions(h, t);
            const rearEdge = grooved ? BACK_GROOVE.inset + tB + SHELF_HOLE.edge : SHELF_HOLE.edge;
            const faces = 2 + 2 * nDiv; // insidan av båda sidorna + båda sidor av varje mellanvägg
            processing.push({ kind: 'shelf', part: nDiv ? 'Sidor och mellanväggar' : 'Sidor', faces,
                              front: SHELF_HOLE.edge, rear: rearEdge, holes, ...SHELF_HOLE });
        }
    }
    if (p.kind === 'tall' && p.rail && !drawers) {
        hardware.push(hw('rail', `Garderobsstång, kapas till ${fmt(secW - 2)} mm`, nDiv + 1, 'st', 'garderobsstång'));
        hardware.push(hw('railholder', 'Fäste för garderobsstång', 2 * (nDiv + 1), 'st', 'fäste garderobsstång'));
    }

    if (back) {
        if (grooved) {
            const gd = BACK_GROOVE.depth;
            const bh = h - 2 * t + 2 * gd - 1, bw = w - 2 * t + 2 * gd - 1;
            parts.push({ key: 'back', name: 'Bakstycke', l: bh, w: bw, t: tB, mn: p.backName, grain: false, band: NO_BAND,
                         geo: { size: [bw, bh, tB], pos: [0, 0, -d / 2 + BACK_GROOVE.inset + tB / 2], role: 'back' } });
            processing.push({ kind: 'groove', part: 'Sidor, topp och botten', faces: 4, width: round1(tB + 0.5), depth: gd, inset: BACK_GROOVE.inset });
        } else {
            parts.push({ key: 'back', name: 'Bakstycke', l: h - 2, w: w - 2, t: tB, mn: p.backName, grain: false, band: NO_BAND,
                         geo: { size: [w - 2, h - 2, tB], pos: [0, 0, -d / 2 + tB / 2], role: 'back' } });
            hardware.push(hw('backscrew', 'Skruv 3,0×16 för bakstycke', Math.ceil(2 * (w + h) / 150), 'st', 'skruv 3,0x16'));
        }
    }

    // Sockel under skåpet: framstycke, bakstycke och två tvärslåar, indragen 50 mm från framkanten
    const pH = clamp(Math.round(p.plinthH) || 0, 0, 300);
    if (pH > 0) {
        const recess = 50;
        const pd = Math.max(1, d - recess);
        const py = -h / 2 - pH / 2;
        const pc = { t, mn: p.carcassName, grain: 'visible', band: NO_BAND };
        parts.push(
            { ...pc, key: 'plinthF', name: 'Sockel fram', l: w, w: pH, geo: { size: [w, pH, t], pos: [0, py, d / 2 - recess - t / 2], role: 'carcass' } },
            { ...pc, key: 'plinthB', name: 'Sockel bak', l: w, w: pH, grain: false, geo: { size: [w, pH, t], pos: [0, py, -d / 2 + t / 2], role: 'carcass' } }
        );
        const sl = Math.max(1, pd - 2 * t);
        for (const [key, x] of [['plinthL', -w / 2 + t / 2], ['plinthR', w / 2 - t / 2]]) {
            parts.push({ ...pc, key, name: 'Sockel sida', l: sl, w: pH, grain: false, geo: { size: [t, pH, sl], pos: [x, py, -d / 2 + t + sl / 2], role: 'carcass' } });
        }
    }

    // Fronter
    const R = S.reveal, G = S.frontGap;
    const tF = p.frontT;
    const frontBand = p.frontBand ? { l: 2, w: 2 } : NO_BAND;
    const fz = d / 2 + tF / 2 + 1;

    const addFront = (key, name, fw, fh, x, y, grainAlongWidth) => {
        if (p.frontStyle === 'shaker') {
            const res = shakerDoorParts({ w: fw, h: fh, frame: p.frame, tenon: p.tenon, frameT: tF, panelT: p.panelT, profile: p.profile, panelStyle: p.panelStyle,
                                          frameName: p.frontName, panelName: p.panelName, frameStock: p.frameStock, prefix: name, origin: [x, y, fz] });
            res.parts.forEach(pt => { pt.geo.role = pt.geo.role === 'panel' ? 'frontPanel' : 'front'; });
            parts.push(...res.parts);
            warnings.push(...res.warnings);
        } else {
            const [l, ww] = grainAlongWidth ? [fw, fh] : [fh, fw];
            parts.push({ key, name, l, w: ww, t: tF, mn: p.frontName, grain: 'visible', band: frontBand, geo: { size: [fw, fh, tF], pos: [x, y, fz], role: 'front' } });
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
        if (p.frontStyle === 'shaker' && p.frame < HINGE.edgeDist + HINGE.cupDia / 2 + 5) warnings.push(`Rambredden ${fmt(p.frame)} mm är för smal för gångjärnen. Gångjärnets kopphål (Ø35 mm) behöver en ram på minst ${HINGE.edgeDist + HINGE.cupDia / 2 + 5} mm.`);
        hardware.push(hw('hinge-cliptop-110', 'Blum CLIP top BLUMOTION 110° gångjärn', count * n, 'st', null, MAKER_LINKS.clipTopBlumotion));
        hardware.push(hw('hinge-plate', 'Blum CLIP monteringsplatta', count * n, 'st', null, MAKER_LINKS.clipTop));
        hardware.push(hw('handle', 'Handtag eller knopp', n, 'st', 'möbelhandtag'));
    } else if (drawers) {
        const n = clamp(Math.round(p.drawerCount) || 1, 1, 8);
        const fw = w - 2 * R;
        const fh = (h - 2 * R - (n - 1) * G) / n;
        const slide = slideById(p.slideId);
        const sideT = p.drawerSideT, botT = p.drawerBotT;
        const openingH = (h - 2 * t) / n;
        const boxH = clamp(Math.floor(Math.min(fh - 40, openingH - 30) / 10) * 10, 40, 400);
        let nl = null, clr = 0;
        for (let i = 0; i < n; i++) {
            const y = h / 2 - R - fh / 2 - i * (fh + G);
            addFront(`dfront${i}`, `Lådfront ${i + 1}`, fw, fh, 0, y, true);
            const box = drawerBox({ openingW: inner, boxH, depth: innerD, sideT, botT, groove: p.groove, slide, clearance: p.clearance });
            nl = box.nl; clr = box.clr;
            if (i === 0) warnings.push(...box.warnings);
            const by = clamp(y, -h / 2 + t + boxH / 2 + 2, h / 2 - t - boxH / 2 - 2);
            parts.push(...drawerBoxParts(box, { h: boxH, sideT, botT, sideName: p.drawerName, botName: p.drawerBotName, prefix: `Låda ${i + 1}`, origin: [0, by, frontZ - box.len / 2 - 2] }));
        }
        hardware.push(slideHardware(slide, nl, n, clr));
        hardware.push(hw('handle', 'Handtag eller knopp', n, 'st', 'möbelhandtag'));
    }
    const tools = p.fronts !== 'none' && p.frontStyle === 'shaker' ? profileTools(p.profile, p.panelStyle) : [];
    return { parts, hardware, warnings, drillings, processing, tools };
}

export function buildDrawer(p) {
    const slide = slideById(p.slideId);
    const box = drawerBox({ openingW: p.w, boxH: p.h, depth: p.d, sideT: p.sideT, botT: p.botT, groove: p.groove, slide, clearance: p.clearance });
    const parts = drawerBoxParts(box, { h: p.h, sideT: p.sideT, botT: p.botT, sideName: p.sideName, botName: p.botName, prefix: '', origin: [0, 0, 0] });
    return {
        parts,
        hardware: [slideHardware(slide, box.nl, 1, box.clr)],
        warnings: box.warnings,
        drillings: [],
        info: [`Lådan blir ${fmt(box.len)} mm lång och ${fmt(box.boxW)} mm bred utvändigt (${fmt(box.inner)} mm invändigt).`, box.nl ? `Skenlängd: ${box.nl} mm.` : null].filter(Boolean)
    };
}

export function buildShaker(p) {
    const res = shakerDoorParts({ w: p.w, h: p.h, frame: p.frame, tenon: p.tenon, frameT: p.frameT, panelT: p.panelT, profile: p.profile, panelStyle: p.panelStyle, frameName: p.frameName, panelName: p.panelName, frameStock: p.frameStock });
    const hardware = [], drillings = [];
    if (p.hinges) {
        const n = hingeCount(p.h);
        hardware.push(hw('hinge-cliptop-110', 'Blum CLIP top BLUMOTION 110° gångjärn', n, 'st', null, MAKER_LINKS.clipTopBlumotion));
        hardware.push(hw('hinge-plate', 'Blum CLIP monteringsplatta', n, 'st', null, MAKER_LINKS.clipTop));
        drillings.push({ door: 'Dörr', w: p.w, h: p.h, side: 'vänster', holes: hingePositions(p.h, n), ...HINGE });
        if (p.frame < HINGE.edgeDist + HINGE.cupDia / 2 + 5) res.warnings.push(`Rambredden ${fmt(p.frame)} mm är för smal för gångjärnen. Gångjärnets kopphål (Ø35 mm) behöver en ram på minst ${HINGE.edgeDist + HINGE.cupDia / 2 + 5} mm.`);
    }
    return { parts: res.parts, hardware, warnings: res.warnings, drillings, tools: res.tools };
}

export const ITEM_TYPES = {
    cabinet: { label: 'Skåp', build: buildCabinet },
    drawer: { label: 'Lådor', build: buildDrawer },
    shaker: { label: 'Shaker-dörrar', build: buildShaker },
    list: { label: 'Egen kaplista', build: buildList }
};

// ---------------------------------------------------------------------------
// Projekt
// ---------------------------------------------------------------------------
// Äldre projekt valde material ur ett bibliotek. Översätt de kända standardmaterialen till tjocklekar.
const LEGACY_THICK = { melamin16: 16, bjork18: 18, bjork15: 15, mdf19: 19, mdf6: 6, hdf3: 3, bjork4: 4 };
const LEGACY_KEYS = { carcassMat: 'carcassT', frontMat: 'frontT', panelMat: 'panelT', drawerSideMat: 'drawerSideT', drawerBotMat: 'drawerBotT',
                      sideMat: 'sideT', botMat: 'botT', frameMat: 'frameT' };

export function sanitizeParams(type, params) {
    const def = DEFAULT_PARAMS[type];
    const out = { ...def };
    if (!isObj(params)) return out;
    params = { ...params };
    for (const [oldK, newK] of Object.entries(LEGACY_KEYS)) {
        if (newK in def && !(newK in params) && LEGACY_THICK[params[oldK]]) params[newK] = LEGACY_THICK[params[oldK]];
    }
    // Skåp från före skåptyperna: grunda skåp är nästan alltid väggskåp
    if (type === 'cabinet' && !('kind' in params)) params.kind = +params.d > 0 && +params.d <= 400 ? 'wall' : 'base';
    if (type === 'cabinet' && !('backT' in params) && 'backMat' in params) params.backT = params.backMat === 'none' ? 0 : (LEGACY_THICK[params.backMat] ?? def.backT);
    for (const [k, v] of Object.entries(def)) {
        if (!(k in params)) continue;
        if (k === 'rows') { out.rows = (Array.isArray(params.rows) ? params.rows : []).slice(0, 500).map(sanitizeListRow).filter(Boolean); continue; }
        if (typeof v === 'number') { const n = +params[k]; if (params[k] !== '' && Number.isFinite(n)) out[k] = n; }
        else if (typeof v === 'boolean') out[k] = !!params[k];
        else if (k.endsWith('Name')) out[k] = normName(params[k]);
        else if (typeof params[k] === 'string' || typeof params[k] === 'number') out[k] = String(params[k]);
    }
    return out;
}

export function makeItem(type, name, params) {
    const out = { id: uid('it'), type, name: name || ITEM_TYPES[type].label, qty: 1, params: sanitizeParams(type, params), excluded: {} };
    if (type === 'list' && !out.params.rows.length && !params?.rows) out.params.rows = [makeListRow({ name: 'Del 1' })];
    return out;
}

export function sanitizeProject(p) {
    if (!isObj(p) || !Array.isArray(p.items)) return null;
    const items = p.items
        .filter(it => isObj(it) && ITEM_TYPES[it.type])
        .map(it => ({
            id: typeof it.id === 'string' ? it.id : uid('it'),
            type: it.type,
            name: typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 60) : ITEM_TYPES[it.type].label,
            qty: clamp(Math.round(+it.qty) || 1, 1, 999),
            params: sanitizeParams(it.type, it.params),
            excluded: isObj(it.excluded) ? Object.fromEntries(Object.entries(it.excluded).filter(([, v]) => v === true)) : {}
        }));
    return { name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 80) : 'Mitt projekt', items, quote: sanitizeQuote(p.quote) };
}

// ---------------------------------------------------------------------------
// Offert och kalkyl
// ---------------------------------------------------------------------------
export const DEFAULT_QUOTE = {
    customer: '', reference: '', validDays: 30,
    hours: 0, rate: 550,        // arbetstid (h) och timpris (kr, exkl. moms)
    markup: 15,                 // påslag på material och beslag (%)
    edgePrice: 8,               // kantlist (kr per meter)
    extra: 0, extraText: '',    // övrigt, t.ex. ytbehandling eller frakt
    vat: 25,                    // moms (%)
    hwPrices: {}                // pris per beslag (kr/st eller kr/par), nyckel = beslagets nyckel
};
export function sanitizeQuote(q) {
    const out = { ...DEFAULT_QUOTE, hwPrices: {} };
    if (!isObj(q)) return out;
    for (const [k, def] of Object.entries(DEFAULT_QUOTE)) {
        if (k === 'hwPrices') continue;
        if (typeof def === 'number') { const v = +q[k]; if (q[k] !== '' && q[k] != null && Number.isFinite(v) && v >= 0) out[k] = Math.min(v, 1e7); }
        else if (typeof q[k] === 'string') out[k] = q[k].trim().slice(0, k === 'extraText' ? 80 : 120);
    }
    out.vat = Math.min(out.vat, 100);
    if (isObj(q.hwPrices)) for (const [k, v] of Object.entries(q.hwPrices)) if (/^[\w.-]{1,60}$/.test(k) && v !== '' && v != null && Number.isFinite(+v) && +v >= 0) out.hwPrices[k] = +v;
    return out;
}

/** Räknar fram offertens rader. Påslaget läggs på material, kantlist och beslag, inte på arbetet. */
export function buildQuote(col, opt, q) {
    const lines = [];
    opt.materials.forEach(m => {
        if (m.sheets) lines.push({ group: 'material', text: `Skiva ${matLabel(m.sheet.t, m.sheet.name)}, ${fmt(m.sheet.L)} × ${fmt(m.sheet.W)} mm`, qty: m.sheets, unit: 'st', price: m.sheet.price });
    });
    (opt.linear || []).forEach(r => {
        const meters = r.count * r.stock.L / 1000;
        lines.push({ group: 'material', text: `Virke ${boardLabel(r.stock.t, r.stock.w, r.stock.name)}, ${r.count} × ${fmt(r.stock.L)} mm`, qty: round1(meters), unit: 'm', price: r.stock.price });
    });
    if (col.edgeMeters > 0) lines.push({ group: 'material', text: 'Kantlist inkl. 10 % marginal', qty: Math.ceil(col.edgeMeters * 1.1 * 10) / 10, unit: 'm', price: q.edgePrice });
    col.hardware.forEach(h => lines.push({ group: 'hardware', key: h.key, text: h.name, qty: h.qty, unit: h.unit, price: q.hwPrices[h.key] ?? 0, missing: q.hwPrices[h.key] == null }));
    if (q.hours > 0) lines.push({ group: 'labor', text: 'Arbete', qty: q.hours, unit: 'h', price: q.rate });
    if (q.extra > 0) lines.push({ group: 'extra', text: q.extraText || 'Övrigt', qty: 1, unit: 'st', price: q.extra });
    lines.forEach(l => { l.sum = l.qty * l.price; });
    const sumOf = g => lines.filter(l => g.includes(l.group)).reduce((a, l) => a + l.sum, 0);
    const goods = sumOf(['material', 'hardware']);
    const markup = goods * q.markup / 100;
    const net = goods + markup + sumOf(['labor', 'extra']);
    const vat = net * q.vat / 100;
    return {
        lines, goods, markup, labor: sumOf(['labor']), extra: sumOf(['extra']), net, vat, total: net + vat,
        missingPrices: lines.filter(l => l.missing).length
    };
}

// ---------------------------------------------------------------------------
// Beställning till kapservice (text för mejl)
// ---------------------------------------------------------------------------
export const edgeText = r => {
    const parts = [];
    if (r.bl) parts.push(`${r.bl} långsida${r.bl > 1 ? 'or' : ''}`);
    if (r.bw) parts.push(`${r.bw} kortsida${r.bw > 1 ? 'or' : ''}`);
    return parts.join(' + ');
};
export function orderText(col, opt, o) {
    const L = [];
    L.push(`Beställning av kapning – ${o.project}`, '');
    if (o.name) L.push(`Beställare: ${o.name}`);
    if (o.phone) L.push(`Telefon: ${o.phone}`);
    L.push(`Leverans: ${o.delivery === 'delivery' ? 'Leverans' : 'Hämtas i butik'}`);
    if (o.note) L.push(`Meddelande: ${o.note}`);
    L.push('', 'SKIVOR (uppskattat antal enligt CutYards optimering)');
    opt.materials.forEach(m => { if (m.sheets) L.push(`- ${m.sheets} st ${matLabel(m.sheet.t, m.sheet.name)} ${fmt(m.sheet.L)} × ${fmt(m.sheet.W)} mm`); });
    const sheetRows = col.rows.filter(r => !r.board);
    let cur = '';
    L.push('', 'KAPLISTA (mått i mm, längd × bredd, kantlistens tjocklek är redan avdragen)');
    sheetRows.forEach(r => {
        const k = matLabel(r.t, r.mn);
        if (k !== cur) { cur = k; L.push('', k); }
        L.push(`#${r.nr}  ${r.count} st  ${fmt(r.l)} × ${fmt(r.w)}${r.lock ? '  ådring längs längden' : ''}${edgeText(r) ? `  kantlist: ${edgeText(r)}` : ''}  (${r.names.join(', ')})`);
    });
    if (col.edgeMeters > 0) L.push('', `Kantlist totalt: ca ${fmt(Math.ceil(col.edgeMeters * 1.1 * 10) / 10)} m inkl. 10 % marginal`);
    L.push('', 'Skapad med CutYard');
    return L.join('\n');
}

export function exampleProject() {
    return {
        name: 'Exempel: kök',
        items: [
            makeItem('cabinet', 'Bänkskåp med lådor', { plinthH: 100 }),
            { ...makeItem('cabinet', 'Väggskåp', { kind: 'wall', w: 800, h: 700, d: 350, shelves: 2, fronts: 'doors', frontStyle: 'shaker' }), qty: 2 },
            makeItem('cabinet', 'Bänkskåp med dörr', { w: 400, h: 720, d: 560, shelves: 1, fronts: 'doors', plinthH: 100 })
        ],
        quote: sanitizeQuote()
    };
}

export function buildItem(item, S) {
    return ITEM_TYPES[item.type].build(item.params, S);
}

/**
 * Samlar alla delar i projektet (eller ett objekt) till en grupperad, numrerad kaplista.
 */
export function collect(items, S) {
    const pieces = [], hwMap = new Map(), warnings = [], drillings = [], processing = [], toolMap = new Map();
    for (const item of items) {
        const res = buildItem(item, S);
        res.warnings.forEach(w => warnings.push(`${item.name}: ${w}`));
        res.hardware.forEach(h => {
            const ex = hwMap.get(h.key);
            if (ex) ex.qty += h.qty * item.qty; else hwMap.set(h.key, { ...h, qty: h.qty * item.qty });
        });
        res.drillings.forEach(dr => drillings.push({ ...dr, item: item.name, count: item.qty }));
        (res.processing || []).forEach(pr => processing.push({ ...pr, item: item.name, count: item.qty }));
        (res.tools || []).forEach(t => { const ex = toolMap.get(t.key); if (ex) { if (!ex.items.includes(item.name)) ex.items.push(item.name); } else toolMap.set(t.key, { ...t, items: [item.name] }); });
        for (const part of res.parts) {
            if (item.excluded[part.key]) continue;
            const band = part.band || NO_BAND;
            let l = part.l - band.w * S.edgeThick;
            let w = part.w - band.l * S.edgeThick;
            const edgeLen = band.l * part.l + band.w * part.w;
            // 'fixed' = låst per del (egen kaplista). 'visible' = synlig del, låses om objektet eller
            // inställningen säger att ådringen ska följas. false = dold del som alltid får vridas.
            const board = part.stock === 'board';
            // Virke sågas alltid på längden, så där är l alltid längden på brädan.
            const lock = !board && (part.grain === 'fixed' || (part.grain === 'visible' && (S.grainLock || item.params.grain === true)));
            let bl = band.l, bw = band.w;               // antal kantlistade långsidor och kortsidor
            if (!lock && !board && w > l) { [l, w] = [w, l]; [bl, bw] = [bw, bl]; }
            // "Låda 2: Lådsida vänster" → "Lådsida vänster" så att listan inte upprepar sig
            pieces.push({ name: part.name.replace(/^[^:]+: /, ''), item: item.name, t: round1(part.t), mn: normName(part.mn), l: round1(l), w: round1(w), lock, board, bl, bw, edgeLen, count: item.qty * (part.qty || 1) });
        }
    }
    const rows = [];
    for (const p of pieces) {
        const ex = rows.find(r => r.board === p.board && r.bl === p.bl && r.bw === p.bw && r.t === p.t && matKey(r.t, r.mn) === matKey(p.t, p.mn) && r.l === p.l && r.w === p.w && r.lock === p.lock);
        if (ex) {
            ex.count += p.count; ex.edgeLen += p.edgeLen * p.count;
            if (!ex.names.includes(p.name)) ex.names.push(p.name);
            if (!ex.items.includes(p.item)) ex.items.push(p.item);
        } else rows.push({ t: p.t, mn: p.mn, l: p.l, w: p.w, lock: p.lock, board: p.board, bl: p.bl, bw: p.bw, count: p.count, edgeLen: p.edgeLen * p.count, names: [p.name], items: [p.item] });
    }
    rows.sort((a, b) => a.board - b.board || b.t - a.t || (a.board ? b.w - a.w : 0) || a.mn.localeCompare(b.mn, 'sv') || b.l - a.l || b.w - a.w);
    rows.forEach((r, i) => { r.nr = i + 1; });
    return {
        rows,
        hardware: [...hwMap.values()],
        warnings,
        drillings,
        processing,
        tools: [...toolMap.values()],
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

function packRun(pieces, sheet, S, offcuts, sortKey, split) {
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
        else bin = newBin('sheet', sheet.L, sheet.W, S.trim, kerf);
        const spot = findSpot(bin, pw, ph, allowRot);
        if (!spot) { oversize.push(piece); continue; }
        place(bin, spot, piece, split, kerf);
        bins.push(bin);
    }
    return { bins, oversize };
}

export function optimizeSheets(rows, sheet, S, offcuts = []) {
    const pieces = [];
    rows.forEach(r => { for (let k = 0; k < r.count; k++) pieces.push({ nr: r.nr, name: r.names[0], l: r.l, w: r.w, lock: r.lock, t: r.t, mn: r.mn }); });
    let best = null;
    for (const sortKey of Object.keys(SORTS)) {
        for (const split of SPLITS) {
            const run = packRun(pieces, sheet, S, offcuts, sortKey, split);
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
        b.leftovers.forEach(f => newOffcuts.push({ t: sheet.t, mn: sheet.name || '', l: f.l, w: f.w }));
    });
    const sheets = best.bins.filter(b => b.kind === 'sheet').length;
    return {
        sheet, bins: best.bins, oversize: best.oversize, sheets,
        offcutsUsed: best.bins.filter(b => b.kind === 'offcut').map(b => b.offcutId),
        newOffcuts, cost: sheets * sheet.price
    };
}

function util(bin) { return bin.placements.reduce((a, p) => a + p.dl * p.dw, 0) / (bin.L * bin.W); }
// Lägre är bättre i alla led. Vid lika antal skivor vinner lägst nyttjande på sista skivan,
// eftersom de andra skivorna då är fullare och restbiten blir större.
function better(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return a[3] < b[3];
}

export function optimize(rows, S, offcuts = []) {
    // Map behåller kaplistans ordning (tjockast först); ett vanligt objekt sorterar sifferliknande nycklar själv.
    const byMat = new Map(), byBoard = new Map();
    rows.forEach(r => {
        if (r.board) { const k = boardKey(r.t, r.w, r.mn); if (!byBoard.has(k)) byBoard.set(k, []); byBoard.get(k).push(r); return; }
        const k = matKey(r.t, r.mn); if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(r);
    });
    const linear = [...byBoard.values()].map(list => optimizeBoards(list, boardFor(S, list[0].t, list[0].w, list[0].mn), S));
    const results = [...byMat].map(([k, list]) => {
        const { t, mn } = list[0];
        return optimizeSheets(list, sheetFor(S, t, mn), S, offcuts.filter(o => matKey(o.t, o.mn) === k));
    });
    const sheetArea = results.reduce((a, r) => a + r.bins.filter(b => b.kind === 'sheet').reduce((s, b) => s + b.L * b.W, 0), 0);
    const usedArea = results.reduce((a, r) => a + r.bins.filter(b => b.kind === 'sheet').reduce((s, b) => s + b.util * b.L * b.W, 0), 0);
    return {
        materials: results,
        linear,
        boards: linear.reduce((a, r) => a + r.count, 0),
        boardMeters: linear.reduce((a, r) => a + r.count * r.stock.L, 0) / 1000,
        totalCost: results.reduce((a, r) => a + r.cost, 0) + linear.reduce((a, r) => a + r.cost, 0),
        sheets: results.reduce((a, r) => a + r.sheets, 0),
        offcutsUsed: results.flatMap(r => r.offcutsUsed),
        newOffcuts: results.flatMap(r => r.newOffcuts),
        utilization: sheetArea ? usedArea / sheetArea : 0
    };
}

// ---------------------------------------------------------------------------
// Virke på längden (1D). Ändarna på varje bräda kapas rent (S.trim) och varje snitt tar
// sågspalten. Provar flera sorteringar med first fit och best fit och väljer färst brädor,
// och vid lika antal den lösning som lämnar längst restbit.
// ---------------------------------------------------------------------------
export function optimizeBoards(rows, stock, S) {
    const kerf = S.kerf, trim = S.trim;
    const usable = stock.L - 2 * trim;
    const pieces = [], oversize = [];
    rows.forEach(r => { for (let k = 0; k < r.count; k++) (r.l > usable ? oversize : pieces).push({ nr: r.nr, name: r.names[0], l: r.l }); });
    const orders = [ps => [...ps].sort((a, b) => b.l - a.l), ps => [...ps].sort((a, b) => a.l - b.l)];
    let best = null;
    for (const order of orders) {
        for (const fit of ['first', 'best']) {
            const bars = [];
            for (const p of order(pieces)) {
                const need = p.l + kerf;
                let pick = null;
                for (const b of bars) {
                    if (b.free + kerf < need - 1e-9) continue; // sista delen behöver ingen sågspalt efter sig
                    if (fit === 'first') { pick = b; break; }
                    if (!pick || b.free < pick.free) pick = b;
                }
                if (!pick) { pick = { cuts: [], free: usable }; bars.push(pick); }
                pick.cuts.push({ ...p, x: trim + (usable - pick.free) });
                pick.free -= need;
            }
            const score = [bars.length, -Math.max(0, ...bars.map(b => b.free))];
            if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { bars, score };
        }
    }
    const bars = best.bars.map(b => {
        const used = b.cuts.reduce((a, c) => a + c.l, 0);
        const left = round1(Math.max(0, b.free + kerf)); // restbiten efter sista snittet
        return { L: stock.L, trim, cuts: b.cuts, used, left, util: used / stock.L };
    });
    return { stock, bars, count: bars.length, oversize, cost: bars.length * stock.L / 1000 * stock.price };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export function buildCsv(col, { sep = ';', bom = true } = {}) {
    const n = x => String(round1(x)).replace('.', ',');
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const L = [];
    L.push(['Nr', 'Antal', 'Längd (mm)', 'Bredd (mm)', 'Tjocklek (mm)', 'Skivtyp', 'Komponent', 'Objekt', 'Ådring låst', 'Kantlist (m)', 'Ämne'].join(sep));
    col.rows.forEach(r => L.push([r.nr, r.count, n(r.l), n(r.w), n(r.t), q(r.mn || ''), q(r.names.join(', ')), q(r.items.join(', ')), r.lock ? 'Ja' : 'Nej', n(r.edgeLen / 1000), r.board ? 'Virke' : 'Skiva'].join(sep)));
    if (col.hardware.length) {
        L.push('', 'BESLAGSLISTA', ['Produkt', 'Antal', 'Enhet'].join(sep));
        col.hardware.forEach(h => L.push([q(h.name), h.qty, q(h.unit)].join(sep)));
    }
    return (bom ? '﻿' : '') + L.join('\n') + '\n';
}

export function labelText(row) {
    return `CutYard #${row.nr} | ${fmt(row.l)}x${fmt(row.w)}x${fmt(row.t)} mm${row.mn ? ` ${row.mn}` : ''} | ${row.names.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Sågordning för verkstadsläget. Eftersom schemat är giljotinsnitt kan det alltid delas
// upp i raka genomgående snitt. Vi börjar med snitt längs bitens långa sida (remsor),
// sågar sedan varje remsa i delar och kapar bort spill runt varje del.
// Steg: { kind: 'trim' } | { kind: 'cut', axis, at, region, dist, len } | { kind: 'done', piece, region }
//   axis 'y' = snittlinjen går längs x-axeln (skivans längd), 'x' = tvärs.
//   dist = avstånd från bitens övre (y) eller vänstra (x) kant till snittet.
// ---------------------------------------------------------------------------
export function cutSequence(bin, kerf) {
    const E = 1e-6;
    const steps = [];
    if (bin.trim > 0) steps.push({ kind: 'trim', trim: bin.trim });
    const rects = bin.placements.map((p, i) => ({ i, x: p.x, y: p.y, w: p.dl, h: p.dw }));
    const cut = (axis, at, R) => ({
        kind: 'cut', axis, at, region: { ...R },
        dist: round1(at - (axis === 'x' ? R.x0 : R.y0)),
        len: round1(axis === 'x' ? R.y1 - R.y0 : R.x1 - R.x0)
    });
    const rec = (rs, R) => {
        if (!rs.length) return;
        if (rs.length === 1) {
            const r = rs[0];
            // Kapa bort överskott så att bara delen blir kvar (längsta snittet först)
            const needX = r.x + r.w < R.x1 - E, needY = r.y + r.h < R.y1 - E;
            const order = (R.x1 - R.x0) >= (R.y1 - R.y0) ? ['y', 'x'] : ['x', 'y'];
            for (const axis of order) {
                if (axis === 'x' && needX) { steps.push(cut('x', r.x + r.w, R)); R = { ...R, x1: r.x + r.w }; }
                if (axis === 'y' && needY) { steps.push(cut('y', r.y + r.h, R)); R = { ...R, y1: r.y + r.h }; }
            }
            steps.push({ kind: 'done', piece: r.i, region: { ...R } });
            return;
        }
        // Snitt längs bitens långa sida först, sedan tvärs
        const axes = (R.x1 - R.x0) >= (R.y1 - R.y0) ? ['y', 'x'] : ['x', 'y'];
        for (const axis of axes) {
            const ends = [...new Set(rs.map(r => (axis === 'x' ? r.x + r.w : r.y + r.h)))].sort((a, b) => a - b);
            for (const c of ends) {
                const A = rs.filter(r => (axis === 'x' ? r.x + r.w : r.y + r.h) <= c + E);
                const B = rs.filter(r => (axis === 'x' ? r.x : r.y) >= c - E);
                if (A.length && B.length && A.length + B.length === rs.length) {
                    steps.push(cut(axis, c, R));
                    rec(A, axis === 'x' ? { ...R, x1: c } : { ...R, y1: c });
                    rec(B, axis === 'x' ? { ...R, x0: c + kerf } : { ...R, y0: c + kerf });
                    return;
                }
            }
        }
        // Ska inte inträffa för giljotinscheman; markera resterande delar som klara så att listan blir komplett.
        rs.forEach(r => steps.push({ kind: 'done', piece: r.i, region: { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h } }));
    };
    rec(rects, { x0: bin.trim, y0: bin.trim, x1: bin.L - bin.trim, y1: bin.W - bin.trim });
    return steps;
}

// ---------------------------------------------------------------------------
// Inklistring från Excel, Numbers eller CSV.
// Kolumner känns igen från rubrikraden. Utan rubrik antas: Antal, Längd, Bredd, Tjocklek, Namn, Skivtyp.
// ---------------------------------------------------------------------------
const HEADER_MAP = [
    [/^(nr|#|pos)\b/i, 'skip'],
    [/antal|qty|quantity|st\b|stk/i, 'qty'],
    [/längd|langd|length|^l\b/i, 'l'],
    [/bredd|width|^b\b|^w\b/i, 'w'],
    [/tjock|thick|^t\b/i, 't'],
    [/skivtyp|material/i, 'mn'],
    [/namn|name|del|komponent|benämning|part/i, 'name']
];
const DEFAULT_COLS = ['qty', 'l', 'w', 't', 'name', 'mn'];

export function parsePartsTable(text, { defaultT = 16 } = {}) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/^﻿/, '')).filter(l => l.trim());
    if (!lines.length) return { rows: [], errors: [], columns: [] };
    const sep = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : ',';
    const split = l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"'));
    const toNum = v => {
        if (v == null || v === '') return NaN;
        let x = String(v).replace(/\s/g, '').replace(/mm$/i, '');
        if (sep !== ',') x = x.replace(',', '.');
        return Number(x);
    };
    let cols = DEFAULT_COLS;
    let start = 0;
    const first = split(lines[0]);
    const looksLikeHeader = first.some(c => /[a-zåäö]/i.test(c) && !Number.isFinite(toNum(c))) && first.filter(c => Number.isFinite(toNum(c))).length < 2;
    if (looksLikeHeader) {
        cols = first.map(c => (HEADER_MAP.find(([re]) => re.test(c)) || [null, 'skip'])[1]);
        const seen = new Set();
        cols = cols.map(c => (c !== 'skip' && seen.has(c) ? 'skip' : (seen.add(c), c)));
        start = 1;
    }
    const rows = [], errors = [];
    for (let i = start; i < lines.length; i++) {
        const cells = split(lines[i]);
        const get = key => { const idx = cols.indexOf(key); return idx >= 0 ? cells[idx] : undefined; };
        const l = toNum(get('l')), w = toNum(get('w'));
        if (!(l > 0) || !(w > 0)) { errors.push(`Rad ${i + 1}: längd och bredd måste vara tal större än 0.`); continue; }
        const qty = toNum(get('qty')), t = toNum(get('t'));
        rows.push(makeListRow({
            qty: qty > 0 ? Math.round(qty) : 1, l, w, t: t > 0 ? t : defaultT,
            name: get('name') || '', mn: get('mn') || ''
        }));
    }
    return { rows, errors, columns: cols, header: looksLikeHeader };
}

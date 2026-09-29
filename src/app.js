// CutYard – gränssnitt. All beräkning sker i core.js.
import {
    fmt, fmtKr, uid, DEFAULT_SETTINGS, SHOPS, sanitizeSettings, shopUrl,
    matKey, matLabel, parseMatKey, normName, parsePartsTable, CABINET_KINDS, boardKey, boardLabel, boardFor, sanitizeOffcuts, sheetFor, FRAME_PROFILES, PANEL_STYLES, RAISED_PANEL_NOTE, profileTools,
    SLIDES, slideById, ITEM_TYPES, DEFAULT_PARAMS, makeItem, sanitizeProject, exampleProject,
    buildItem, collect, optimize, buildCsv
} from './core.js';
import { Viewer } from './viewer.js';
import { sheetCanvas } from './draw.js';
import { profileSvg } from './profiles.js';
import { renderListEditor, nextRow } from './listEditor.js';
import { openWorkshop, initWorkshop } from './workshop.js';
import { sheetsSvg, sheetsDxf } from './export.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// Lagring (per webbläsare). Allt är inslaget i try/catch – privat läge m.m.
// ---------------------------------------------------------------------------
const KEYS = { settings: 'cutyard.v2.settings', offcuts: 'cutyard.v3.offcuts', project: 'cutyard.v2.project', active: 'cutyard.v2.active', tab: 'cutyard.v2.tab' };
const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoreras */ } }
};

// ---------------------------------------------------------------------------
// Tillstånd
// ---------------------------------------------------------------------------
const state = {
    settings: { ...DEFAULT_SETTINGS },
    offcuts: [],
    project: exampleProject(),
    activeId: null,
    scope: 'project',
    tab: 'list',
    wallView: false,
    last: null   // senaste beräkning { col, opt, items }
};
const activeItem = () => state.project.items.find(i => i.id === state.activeId) || state.project.items[0]; // undefined om projektet är tomt

// ---------------------------------------------------------------------------
// Formulärschema per objekttyp. Grupper → rader → fält. show(p) styr synlighet.
// ---------------------------------------------------------------------------
const TYPE_COLOR = { cabinet: '#5b93f5', drawer: '#a58bf0', shaker: '#5fbf9a', list: '#e0a458' };
const TYPE_LABEL = { cabinet: 'Skåp', drawer: 'Lådor', shaker: 'Shaker-dörr', list: 'Egen kaplista' };

const n = (key, label, o = {}) => ({ kind: 'num', key, label, unit: 'mm', ...o });
const sel = (key, label, options, o = {}) => ({ kind: 'select', key, label, options, ...o });
const chk = (key, label, o = {}) => ({ kind: 'check', key, label, ...o });
const note = (text, o = {}) => ({ kind: 'note', text, ...o });
const html = (render, o = {}) => ({ kind: 'html', render, ...o });
const txt = (key, label, o = {}) => ({ kind: 'text', key, label, ...o });
const listField = () => ({ kind: 'list', key: 'rows' });
const extLink = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener" class="whitespace-nowrap hover:underline" style="color: var(--accent)">${esc(text)} ↗</a>`;
const slideNote = p => { const s = slideById(p.slideId); return `${esc(s.note)}${s.link ? ` ${extLink(s.link.url, `Mer hos ${s.link.label}`)}` : ''}`; };
const profileOptions = Object.entries(FRAME_PROFILES).map(([k, v]) => [k, v.name]);
const panelOptions = Object.entries(PANEL_STYLES).map(([k, v]) => [k, v.name]);

// Förhandsvisning av vald profil med fräsarna som behövs
function profilePreview(p) {
    const fp = FRAME_PROFILES[p.profile] || FRAME_PROFILES.square;
    const ps = PANEL_STYLES[p.panelStyle] || PANEL_STYLES.flat;
    const tools = profileTools(p.profile, p.panelStyle);
    return `<div class="rounded-lg p-3 space-y-3" style="background: var(--bg); border: 1px solid var(--line);">
        ${profileSvg(p.profile, p.panelStyle)}
        <div class="text-[12px] muted">Fog: ${esc(fp.joint.toLowerCase())}. Fyllningen bör vara ${esc(ps.minT)}–${esc(ps.maxT)} mm tjock.</div>
        ${tools.length ? '<div class="text-[12px] font-medium">Fräsar som behövs</div>' : ''}
        <ul class="space-y-1.5 text-[12px] !mt-1">${tools.map(t => `<li><span>${esc(t.name)}</span><span class="faint"> – ${esc(t.use)}</span></li>`).join('')}</ul>
        ${p.panelStyle !== 'flat' ? `<p class="text-[12px]" style="color: var(--warn)">${esc(RAISED_PANEL_NOTE)}</p>` : ''}
        <button type="button" class="btn-line !py-1.5 !text-[12px]" data-open-profiles>Visa alla profiler och fräsar</button>
    </div>`;
}
const group = (title, rows, o = {}) => ({ title, rows, ...o });
const slideOptions = SLIDES.map(s => [s.id, s.name]);
const STOCK_OPTIONS = [['sheet', 'Skiva'], ['board', 'Virke (brädor i rätt bredd)']];

const isDrawers = p => p.fronts === 'drawers';
const hasFronts = p => p.fronts !== 'none';
const isShakerFront = p => hasFronts(p) && p.frontStyle === 'shaker';

const SCHEMA = {
    cabinet: [
        group('Yttermått', [
            [sel('kind', 'Skåptyp', Object.entries(CABINET_KINDS).map(([k, v]) => [k, v.label]), { hint: 'Byter till typens standardmått. Går att ångra.' }),
             n('plinthH', 'Sockel', { min: 0, max: 300, hint: '0 = ingen sockel' })],
            [n('w', 'Bredd', { min: 100 }), n('h', 'Höjd', { min: 100 }), n('d', 'Djup', { min: 100 })]
        ], { desc: 'Skåpets mått utvändigt, utan fronter och sockel. Sockeln läggs under skåpet och dras in 50 mm från framkanten.' }),
        group('Stomme', [
            [n('carcassT', 'Skivtjocklek', { min: 3, step: 0.5 }), n('backT', 'Bakstycke', { min: 0, step: 0.5, hint: '0 = inget' }),
             sel('backMount', 'Bakstycket', [['surface', 'Skruvas på'], ['groove', 'I spår']], { show: p => p.backT > 0, hint: 'Spår: 10 mm in, 8 mm djupt' })],
            [chk('edgeBand', 'Kantlist på framkanterna', { hint: 'Listens tjocklek dras av från delarnas mått.' })]
        ], { desc: 'Sidor, topp och botten sågas ur samma skiva. Bakstycket är en tunnare skiva som antingen skruvas på baksidan eller sitter i ett spår.' }),
        group('Inredning', [
            [n('shelves', 'Hyllplan per fack', { min: 0, max: 20, int: true, unit: 'st' }), n('dividers', 'Mellanväggar', { min: 0, max: 4, int: true, unit: 'st', hint: 'Delar skåpet i fack' })],
            [chk('shelfHoles', 'Borra hyllhål (32-mm-systemet)', { show: p => p.shelves > 0, hint: 'Hålraderna hamnar i Borrschemat.' })],
            [chk('rail', 'Garderobsstång i varje fack', { show: p => p.kind === 'tall' })]
        ], { show: p => !isDrawers(p), desc: 'Hyllplan och mellanväggar. Hyllplanen går att flytta om du borrar hyllhål.' }),
        group('Fronter', [
            [sel('fronts', 'Fronter', [['none', 'Inga fronter'], ['doors', 'Dörrar'], ['drawers', 'Lådor']]),
             sel('doorCount', 'Antal dörrar', [['auto', 'Auto'], ['1', '1 dörr'], ['2', '2 dörrar']], { show: p => p.fronts === 'doors', hint: 'Auto: 2 dörrar över 600 mm' }),
             n('drawerCount', 'Antal lådor', { min: 1, max: 8, int: true, unit: 'st', show: isDrawers })],
            [sel('frontStyle', 'Utförande', [['flat', 'Slät skiva'], ['shaker', 'Shaker (ram och fyllning)']], { show: hasFronts }),
             n('frontT', 'Fronttjocklek', { min: 3, step: 0.5, show: hasFronts })],
            [n('frame', 'Rambredd', { min: 20, show: isShakerFront, hint: 'Ramens synliga bredd' }),
             n('tenon', 'Tappdjup', { min: 0, show: isShakerFront, hint: 'Enligt din fräsats' }),
             n('panelT', 'Fyllning', { min: 2, step: 0.5, show: isShakerFront, hint: 'Fyllningens tjocklek' })],
            [sel('frameStock', 'Ramdelarna sågas ur', STOCK_OPTIONS, { show: isShakerFront, hint: 'Virke optimeras på längden' })],
            [sel('profile', 'Ramprofil', profileOptions, { show: isShakerFront }), sel('panelStyle', 'Fyllningstyp', panelOptions, { show: isShakerFront })],
            [html(profilePreview, { show: isShakerFront })],
            [chk('frontBand', 'Kantlist runt fronterna', { show: p => hasFronts(p) && p.frontStyle === 'flat' })]
        ], { desc: 'Dörrar eller lådfronter som täcker skåpets framsida. Spelet runt dem ställs in under Inställningar.' }),
        group('Lådor', [
            [sel('slideId', 'Lådskenor', slideOptions)],
            [n('drawerSideT', 'Lådsidor', { min: 3, step: 0.5, hint: 'Tjocklek' }), n('drawerBotT', 'Lådbotten', { min: 2, step: 0.5, hint: 'Tjocklek' }),
             n('groove', 'Spårdjup', { min: 0, step: 0.5, hint: 'Spåret för bottnen' })],
            [n('clearance', 'Spel per sida', { min: 0, step: 0.1, show: p => p.slideId === 'custom', hint: 'Mellan skåpsida och lådsida' })],
            [html(slideNote, { cls: 'text-[12px] muted leading-relaxed' })]
        ], { show: isDrawers, desc: 'Lådlådorna räknas fram automatiskt utifrån skåpets innermått och de skenor du väljer.' }),
        group('Skivtyp och ådring', [
            [txt('carcassName', 'Stomme'), txt('backName', 'Bakstycke', { show: p => p.backT > 0 })],
            [txt('frontName', 'Fronter', { show: hasFronts }), txt('panelName', 'Fyllning', { show: isShakerFront })],
            [txt('drawerName', 'Lådsidor', { show: isDrawers }), txt('drawerBotName', 'Lådbotten', { show: isDrawers })],
            [chk('grain', 'Ådringen ska gå längs delarnas längd', { hint: 'Synliga delar vrids inte på skivan. Dolda delar som lådbottnar och bakstycken vrids ändå.' })]
        ], { collapsible: true, desc: 'Ge skivorna ett namn om du använder olika sorters skivor med samma tjocklek, t.ex. "Vit melamin" och "Björkplywood". Då hamnar de på olika skivor i skärschemat.' })
    ],
    drawer: [
        group('Skåpsöppning', [[n('w', 'Innerbredd', { min: 50, hint: 'Mellan skåpsidorna' }), n('h', 'Lådans höjd', { min: 30 }), n('d', 'Innerdjup', { min: 100, hint: 'Fram till bakstycket' })]],
            { desc: 'Mät öppningen i skåpet där lådan ska sitta. Appen räknar ut lådans mått utifrån skenorna.' }),
        group('Tjocklekar', [[n('sideT', 'Lådsidor', { min: 3, step: 0.5 }), n('botT', 'Lådbotten', { min: 2, step: 0.5 }), n('groove', 'Spårdjup', { min: 0, step: 0.5, hint: 'Spåret för bottnen' })]],
            { desc: 'Bottnen sitter i ett spår som fräses i lådans sidor, fram- och bakstycke.' }),
        group('Lådskenor', [
            [sel('slideId', 'Typ av skenor', slideOptions)],
            [n('clearance', 'Spel per sida', { min: 0, step: 0.1, show: p => p.slideId === 'custom', hint: 'Mellan skåpsida och lådsida' })],
            [html(slideNote, { cls: 'text-[12px] muted leading-relaxed' })]
        ]),
        group('Skivtyp och ådring', [
            [txt('sideName', 'Lådsidor'), txt('botName', 'Lådbotten')],
            [chk('grain', 'Ådringen ska gå längs delarnas längd', { hint: 'Synliga delar vrids inte på skivan. Dolda delar som lådbottnar och bakstycken vrids ändå.' })]
        ], { collapsible: true, desc: 'Ge skivorna ett namn om du använder olika sorters skivor med samma tjocklek, t.ex. "Vit melamin" och "Björkplywood". Då hamnar de på olika skivor i skärschemat.' })
    ],
    shaker: [
        group('Dörrmått', [[n('w', 'Bredd', { min: 100 }), n('h', 'Höjd', { min: 100 })]], { desc: 'Dörrens färdiga mått.' }),
        group('Profil', [
            [sel('profile', 'Ramprofil', profileOptions), sel('panelStyle', 'Fyllningstyp', panelOptions)],
            [html(profilePreview)]
        ], { desc: 'Hur ramens innerkant och fyllningen ser ut, och vilka fräsar som behövs.' }),
        group('Ram och fyllning', [
            [n('frame', 'Rambredd', { min: 20, hint: 'Ramens synliga bredd' }), n('tenon', 'Tappdjup', { min: 0, hint: 'Enligt din fräsats' })],
            [n('frameT', 'Ramtjocklek', { min: 5, step: 0.5 }), n('panelT', 'Fyllning', { min: 2, step: 0.5, hint: 'Fyllningens tjocklek' })],
            [sel('frameStock', 'Ramdelarna sågas ur', STOCK_OPTIONS, { hint: 'Virke optimeras på längden' })]
        ], { desc: 'Ramen består av två stående delar (stiles) och två liggande (rails). Tappdjupet är hur långt de liggande delarna går in i de stående.' }),
        group('Gångjärn', [[chk('hinges', 'Räkna gångjärn och borrschema')]]),
        group('Skivtyp och ådring', [
            [txt('frameName', 'Ram'), txt('panelName', 'Fyllning')],
            [chk('grain', 'Ådringen ska gå längs delarnas längd', { hint: 'Synliga delar vrids inte på skivan. Dolda delar som lådbottnar och bakstycken vrids ändå.' })]
        ], { collapsible: true, desc: 'Ge skivorna ett namn om du använder olika sorters skivor med samma tjocklek, t.ex. "Vit melamin" och "Björkplywood". Då hamnar de på olika skivor i skärschemat.' })
    ],
    list: [
        group('Delar', [[listField()]], { desc: 'Skriv in delarna du vill såga, eller klistra in en lista från Excel. Längden är måttet som ska gå längs ådringen.' })
    ]
};

const CHECK_SVG = '<svg class="check-mark" fill="none" stroke="currentColor" stroke-width="3.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
let fieldEls = [];   // [{ field, wrap, input }]

function renderField(f, item) {
    const p = item.params, id = `f_${f.key}`;
    const wrap = document.createElement('div');
    wrap.className = 'min-w-0';
    if (f.kind === 'num') {
        wrap.innerHTML = `<label class="lbl" for="${id}">${esc(f.label)}</label>
            <div class="fld-unit"><input type="number" id="${id}" class="fld" inputmode="decimal" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}
                step="${f.step || (f.int ? 1 : 'any')}" value="${esc(p[f.key])}" placeholder="${esc(DEFAULT_PARAMS[item.type][f.key])}"${f.hint ? ` title="${esc(f.hint)}"` : ''}><span class="unit">${f.unit}</span></div>
            ${f.hint ? `<span class="block text-[11px] faint mt-1">${esc(f.hint)}</span>` : ''}`;
    } else if (f.kind === 'select') {
        wrap.innerHTML = `<label class="lbl" for="${id}">${esc(f.label)}</label><select id="${id}" class="fld">${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(p[f.key]) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
            ${f.hint ? `<span class="block text-[11px] faint mt-1">${esc(f.hint)}</span>` : ''}`;
    } else if (f.kind === 'check') {
        wrap.innerHTML = `<label class="inline-flex items-start gap-2.5 cursor-pointer"><span class="check-wrap mt-0.5"><input type="checkbox" id="${id}" class="check"${p[f.key] ? ' checked' : ''}>${CHECK_SVG}</span>
            <span>${esc(f.label)}${f.hint ? `<span class="block text-[11px] faint mt-0.5">${esc(f.hint)}</span>` : ''}</span></label>`;
    } else if (f.kind === 'note') {
        wrap.className = 'text-[12px] faint leading-relaxed';
    } else if (f.kind === 'html') {
        wrap.className = `min-w-0 ${f.cls || ''}`;
    } else if (f.kind === 'text') {
        wrap.innerHTML = `<label class="lbl" for="${id}">${esc(f.label)}</label><input type="text" id="${id}" class="fld" list="matNames" maxlength="40" value="${esc(p[f.key] || '')}" placeholder="Valfritt">`;
    } else if (f.kind === 'list') {
        renderListEditor(wrap, item, listHooks);
        return { field: f, wrap, input: null };
    }
    return { field: f, wrap, input: wrap.querySelector('input,select') };
}

function renderForm() {
    const item = activeItem();
    const form = $('itemForm');
    form.innerHTML = '';
    fieldEls = [];
    updateMatNames();
    for (const g of SCHEMA[item.type]) {
        let fs;
        if (g.collapsible) {
            // Frivilliga inställningar: hopfällda tills man behöver dem
            const used = g.rows.flat().some(f => f.kind === 'text' ? normName(item.params[f.key]) : f.kind === 'check' && item.params[f.key]);
            fs = document.createElement('details');
            fs.className = 'space-y-3 group-details';
            fs.open = used;
            fs.innerHTML = `<summary class="group-title cursor-pointer select-none">${esc(g.title)} <span class="faint font-normal text-[12px]">valfritt</span></summary>${g.desc ? `<p class="text-[12px] muted leading-relaxed">${esc(g.desc)}</p>` : ''}`;
        } else {
            fs = document.createElement('fieldset');
            fs.className = 'space-y-3';
            fs.innerHTML = `<legend class="group-title mb-1">${esc(g.title)}</legend>${g.desc ? `<p class="text-[12px] muted leading-relaxed">${esc(g.desc)}</p>` : '<div></div>'}`;
        }
        const rowEls = [];
        for (const row of g.rows) {
            const r = document.createElement('div');
            r.className = `grid gap-3 ${row.length === 3 ? 'grid-cols-3' : row.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`;
            row.forEach(f => { const fe = renderField(f, item); r.appendChild(fe.wrap); fieldEls.push(fe); });
            fs.appendChild(r);
            const entry = { field: { show: p => row.some(f => !f.show || f.show(p)) }, wrap: r };
            fieldEls.push(entry);
            rowEls.push(entry);
        }
        fieldEls.push({ field: { show: p => (!g.show || g.show(p)) && rowEls.some(e => e.field.show(p)) }, wrap: fs });
        form.appendChild(fs);
    }
    updateVisibility();
}

function updateVisibility() {
    const p = activeItem().params;
    for (const { field, wrap } of fieldEls) {
        wrap.hidden = !!field.show && !field.show(p);
        if (field.kind === 'note') wrap.textContent = field.text(p);
        if (field.kind === 'html' && !wrap.hidden) {
            const out = field.render(p);
            if (wrap.dataset.html !== out) { wrap.innerHTML = out; wrap.dataset.html = out; }
        }
    }
}

function readField({ field, input }) {
    const item = activeItem();
    if (!input) return;
    if (field.kind === 'num') {
        const raw = input.value.trim().replace(',', '.');
        let v = raw === '' ? DEFAULT_PARAMS[item.type][field.key] : parseFloat(raw);
        if (!Number.isFinite(v)) return;
        if (field.int) v = Math.round(v);
        if (field.min != null) v = Math.max(field.min, v);
        if (field.max != null) v = Math.min(field.max, v);
        item.params[field.key] = v;
    } else if (field.kind === 'check') item.params[field.key] = input.checked;
    else item.params[field.key] = input.value;
}

// Förslag på skivtyper som redan används i projektet (datalist för textfälten)
function updateMatNames() {
    const names = new Set();
    for (const it of state.project.items) {
        for (const [k, v] of Object.entries(it.params)) if (k.endsWith('Name') && normName(v)) names.add(normName(v));
        (it.params.rows || []).forEach(r => { if (r.mn) names.add(r.mn); });
    }
    state.offcuts.forEach(o => { if (o.mn) names.add(o.mn); });
    $('matNames').innerHTML = [...names].sort((a, b) => a.localeCompare(b, 'sv')).map(n => `<option value="${esc(n)}"></option>`).join('');
}

// Kopplingar från listredigeraren
const listHooks = {
    changed(immediate) { renderItemList(); if (immediate) recompute(); else scheduleRecompute(); },
    removeRow(id) {
        const item = activeItem();
        const idx = item.params.rows.findIndex(r => r.id === id);
        if (idx < 0) return;
        const name = item.params.rows[idx].name || `Del ${idx + 1}`;
        withUndo(`${name} borttagen`, () => { item.params.rows.splice(idx, 1); renderForm(); recompute(); });
    },
    addRow() {
        const item = activeItem();
        item.params.rows.push(nextRow(item.params.rows));
        renderForm();
        recompute();
        const cards = $('itemForm').querySelectorAll('[data-row] [data-col="name"]');
        cards[cards.length - 1]?.focus();
    },
    openPaste() { openPaste(); },
    importFile() { $('csvUpload').click(); }
};

// ---------------------------------------------------------------------------
// Objektlista och editor
// ---------------------------------------------------------------------------
function renderItemList() {
    const items = state.project.items;
    $('itemCount').textContent = items.length ? String(items.length) : '';
    $('itemList').innerHTML = items.map(it => {
        const on = it.id === state.activeId;
        return `<li class="item-row ${on ? 'is-active' : ''} shrink-0 lg:shrink">
            <button type="button" role="tab" aria-selected="${on}" data-item="${esc(it.id)}" class="flex-1 min-w-0 flex items-center gap-2.5 pl-2.5 pr-1 py-2 text-left">
                <span class="w-2 h-2 rounded-full shrink-0" style="background:${TYPE_COLOR[it.type]}"></span>
                <span class="min-w-0"><span class="block truncate">${esc(it.name)}</span>
                <span class="block text-[11px] faint">${it.type === 'cabinet' ? CABINET_KINDS[it.params.kind]?.label || 'Skåp' : TYPE_LABEL[it.type]}${it.qty > 1 ? ` · ${it.qty} st` : ''}</span></span>
            </button>
            <button type="button" data-remove="${esc(it.id)}" class="rm px-2.5 self-stretch muted hover:text-[var(--danger)]" title="Ta bort ${esc(it.name)}" aria-label="Ta bort ${esc(it.name)}">✕</button>
        </li>`;
    }).join('');
}

function selectItem(id) {
    state.activeId = id;
    const item = activeItem();
    const empty = !item;
    $('emptyState').hidden = !empty;
    $('editorPanel').hidden = empty;
    $('viewerPanel').hidden = empty;
    if (empty) { renderItemList(); recompute(); return; }
    state.activeId = item.id;
    store.set(KEYS.active, item.id);
    $('itemName').value = item.name;
    $('itemQty').value = item.qty;
    $('itemType').textContent = TYPE_LABEL[item.type];
    viewer.frameKey = '';
    renderItemList();
    renderForm();
    recompute();
}

function addItem(type) {
    const count = state.project.items.filter(i => i.type === type).length + 1;
    const item = makeItem(type, `${ITEM_TYPES[type].label} ${count}`, type === 'cabinet' ? CABINET_KINDS.base.preset : undefined);
    state.project.items.push(item);
    selectItem(item.id);
    $('itemName').focus();
    $('itemName').select();
}

// ---------------------------------------------------------------------------
// Beräkning och rendering
// ---------------------------------------------------------------------------
let viewer;

function recompute() {
    const item = activeItem();
    if (item) {
        const built = buildItem(item, state.settings);
        if (state.wallView) showWall();
        else viewer.show(built.parts, item.excluded, `${item.id}|${item.params.w}|${item.params.h}|${item.params.d}`);
        renderItemStatus(item, built);
    }
    const items = !item ? [] : state.scope === 'item' ? [item] : state.project.items;
    const col = collect(items, state.settings);
    const opt = optimize(col.rows, state.settings, state.offcuts);
    state.last = { col, opt, items };
    renderResults(col, opt);
    persist();
}
// Hela projektet i 3D: bänk- och högskåp på golvet i en rad, väggskåp ovanför med underkant
// 1 450 mm över golvet, övriga objekt till höger. Bakkanterna ligger mot samma vägg.
const WALL_BOTTOM = 1450;
function showWall() {
    const floor = [], wall = [], other = [];
    for (const it of state.project.items) {
        const built = buildItem(it, state.settings);
        const n = Math.min(it.qty, 6);
        for (let k = 0; k < n; k++) (it.type === 'cabinet' ? (it.params.kind === 'wall' ? wall : floor) : other).push({ it, parts: built.parts });
    }
    const parts = [], excluded = {}, tallRanges = [];
    const place = (list, x0, lift, skip = []) => {
        let x = x0;
        for (const { it, parts: ps } of list) {
            const box = { x0: Infinity, x1: -Infinity, y0: Infinity, z0: Infinity };
            ps.forEach(p => { if (!p.geo) return; const [sx, sy, sz] = p.geo.size, [px, py, pz] = p.geo.pos;
                box.x0 = Math.min(box.x0, px - sx / 2); box.x1 = Math.max(box.x1, px + sx / 2); box.y0 = Math.min(box.y0, py - sy / 2); box.z0 = Math.min(box.z0, pz - sz / 2); });
            if (!Number.isFinite(box.x0)) continue;
            // Väggskåp flyttas förbi högskåp så att de inte hamnar i varandra
            for (const r of skip) if (x < r[1] && x + (box.x1 - box.x0) > r[0]) x = r[1];
            if (it.params.kind === 'tall') tallRanges.push([x, x + box.x1 - box.x0]);
            const dx = x - box.x0, dy = lift - box.y0, dz = -box.z0;
            ps.forEach(p => {
                if (!p.geo) return;
                const key = `${it.id}::${p.key}`;
                if (it.excluded[p.key]) excluded[key] = true;
                parts.push({ key, geo: { ...p.geo, pos: [p.geo.pos[0] + dx, p.geo.pos[1] + dy, p.geo.pos[2] + dz] } });
            });
            x += box.x1 - box.x0 + (it.type === 'cabinet' ? 0 : 100);
        }
        return x;
    };
    const endFloor = place(floor, 0, 0);
    place(wall, 0, WALL_BOTTOM, tallRanges);
    place(other, Math.max(endFloor, 0) + (floor.length ? 400 : 0), 0);
    viewer.show(parts, excluded, `wall|${state.project.items.map(i => `${i.id}:${i.qty}:${i.params.w}:${i.params.h}`).join(',')}`);
}

let timer;
const scheduleRecompute = () => { clearTimeout(timer); timer = setTimeout(recompute, 120); };

function renderItemStatus(item, built) {
    const warn = $('itemWarn');
    warn.hidden = !built.warnings.length;
    warn.innerHTML = built.warnings.map(w => `<div>${esc(w)}</div>`).join('');
    const info = $('itemInfo');
    info.hidden = !built.info;
    info.textContent = built.info ? built.info.join(' ') : '';
    // Delar som klickats bort i 3D-vyn (nycklar som inte längre finns räknas inte)
    const keys = new Set(built.parts.map(p => p.key));
    const off = Object.keys(item.excluded).filter(k => keys.has(k));
    $('excludedNote').hidden = !off.length;
    $('excludedText').textContent = off.length === 1 ? '1 del är borttagen ur kaplistan (röd i 3D-vyn).' : `${off.length} delar är borttagna ur kaplistan (röda i 3D-vyn).`;
}

function renderResults(col, opt) {
    const showItems = state.scope === 'project';
    $('scopeItemName').textContent = activeItem()?.name || 'objektet';
    $('statParts').textContent = col.partCount;
    $('statEdge').textContent = col.edgeMeters > 0 ? `${fmt(Math.ceil(col.edgeMeters * 1.1 * 10) / 10)} m` : '–';
    $('statSheets').textContent = opt.sheets;
    $('statUtil').textContent = [opt.sheets ? `${Math.round(opt.utilization * 100)} % av ytan används` : '',
        opt.boards ? `+ ${opt.boards} ${opt.boards === 1 ? 'bräda' : 'brädor'} virke (${fmt(opt.boardMeters)} m)` : ''].filter(Boolean).join(' · ');
    $('statCost').textContent = fmtKr(opt.totalCost);

    const warnings = [...col.warnings];
    opt.materials.forEach(r => {
        if (r.oversize.length) warnings.push(`${r.oversize.length} del(ar) i ${matLabel(r.sheet.t, r.sheet.name)} är större än skivan: ${[...new Set(r.oversize.map(p => `#${p.nr} ${fmt(p.l)}×${fmt(p.w)}`))].join(', ')} mm.`);
    });
    opt.linear.forEach(r => {
        if (r.oversize.length) warnings.push(`${r.oversize.length} del(ar) i virket ${boardLabel(r.stock.t, r.stock.w, r.stock.name)} är längre än brädan (${fmt(r.stock.L)} mm minus kapning i ändarna): ${[...new Set(r.oversize.map(p => `#${p.nr} ${fmt(p.l)}`))].join(', ')} mm. Ange en längre bräda under Skärscheman.`);
    });
    $('resWarn').hidden = !warnings.length;
    $('resWarn').innerHTML = warnings.map(w => `<div>${esc(w)}</div>`).join('');

    // Kaplista: en tabell, grupperad per tjocklek
    const byT = new Map();
    col.rows.forEach(r => { const k = r.board ? `b|${boardKey(r.t, r.w, r.mn)}` : matKey(r.t, r.mn); if (!byT.has(k)) byT.set(k, []); byT.get(k).push(r); });
    $('resList').innerHTML = col.rows.length ? `<table class="tbl">
        <thead><tr><th>Nr</th><th class="!text-right">Antal</th><th class="!text-right">Längd</th><th class="!text-right">Bredd</th><th>Del</th>${showItems ? '<th>Hör till</th>' : ''}</tr></thead>
        <tbody>${[...byT.values()].map(rows => `
            <tr><td colspan="${showItems ? 6 : 5}" class="!pt-5 !pb-2"><span class="font-semibold">${rows[0].board ? `Virke ${esc(boardLabel(rows[0].t, rows[0].w, rows[0].mn))}` : esc(matLabel(rows[0].t, rows[0].mn))}</span> <span class="faint text-[12px] ml-2 num">${rows.reduce((a, r) => a + r.count, 0)} delar</span></td></tr>
            ${rows.map(r => `<tr>
                <td><span class="nr">${r.nr}</span></td>
                <td class="num text-right">${r.count}</td>
                <td class="num text-right whitespace-nowrap">${fmt(r.l)}${r.lock ? '<span class="faint" title="Får inte vändas: ådringen ska gå längs längden"> ⇅</span>' : ''}</td>
                <td class="num text-right">${fmt(r.w)}</td>
                <td class="muted">${esc(r.names.join(', '))}</td>
                ${showItems ? `<td class="faint">${esc(r.items.join(', '))}</td>` : ''}
            </tr>`).join('')}`).join('')}</tbody></table>
        <p class="text-[12px] muted mt-4 leading-relaxed">Mått i mm. Kantlistens tjocklek är redan avdragen, så delarna sågas till exakt dessa mått. Numret står också på skärschemat och etiketten.${col.rows.some(r => r.lock) ? ' ⇅ betyder att delen inte får vändas eftersom ådringen ska gå längs längden.' : ''}</p>`
        : `<p class="muted">${activeItem() ? 'Alla delar är borttagna ur kaplistan. Klicka på de röda delarna i 3D-vyn för att ta med dem igen.' : 'Lägg till ett skåp, lådor eller en shaker-dörr i listan till vänster för att få en kaplista.'}</p>`;

    // Skärscheman per tjocklek
    const resOpt = $('resOpt');
    resOpt.innerHTML = '';
    opt.materials.forEach((r, mi) => {
        const key = r.sheet.key;
        const label = matLabel(r.sheet.t, r.sheet.name);
        const own = r.sheet.custom;
        const inp = (field, unit, w, def, min) => `<span class="fld-unit ${w}"><input type="number" min="${min}" class="fld !py-1" data-sheet="${key}" data-field="${field}"
            value="${own[field] ?? ''}" placeholder="${def}" aria-label="${field === 'price' ? 'Pris per skiva' : field === 'L' ? 'Skivans längd' : 'Skivans bredd'} för ${esc(label)}"><span class="unit">${unit}</span></span>`;
        const sec = document.createElement('section');
        sec.innerHTML = `<div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                <h3 class="font-semibold">${esc(label)}</h3>
                <span class="text-[12px] muted">${r.sheets} ${r.sheets === 1 ? 'ny skiva' : 'nya skivor'}${r.offcutsUsed.length ? ` + ${r.offcutsUsed.length} från spillager` : ''}</span>
                <div class="ml-auto flex flex-wrap items-center gap-2 text-[12px] muted">
                    <span title="Tomt fält = standard från Inställningar">Skivans mått</span>${inp('L', 'mm', 'w-28', state.settings.sheetL, 300)}<span>×</span>${inp('W', 'mm', 'w-28', state.settings.sheetW, 300)}
                    <span class="ml-2">Pris per skiva</span>${inp('price', 'kr', 'w-24', state.settings.price, 0)}
                </div>
                <span class="num text-[13px] w-20 text-right">${fmtKr(r.cost)}</span>
            </div>
            <div class="grid gap-4 xl:grid-cols-2"></div>`;
        const grid = sec.lastElementChild;
        let sheetNo = 0;
        r.bins.forEach((b, bi) => {
            const fig = document.createElement('figure');
            const title = b.kind === 'offcut' ? `Spillbit ${fmt(b.L)} × ${fmt(b.W)}` : `Skiva ${++sheetNo}`;
            const c = sheetCanvas(b, 1000, 'dark');
            c.className = 'sheet-canvas';
            c.setAttribute('role', 'img');
            c.setAttribute('aria-label', `${title}: delar ${b.placements.map(p => p.piece.nr).join(', ')}`);
            fig.appendChild(c);
            const cap = document.createElement('figcaption');
            cap.className = 'mt-1.5 flex justify-between text-[12px] muted';
            cap.innerHTML = `<span>${title} · ${b.placements.length} delar · ${Math.round(b.util * 100)} % av skivan används</span>
                <button type="button" class="hover:underline shrink-0" style="color: var(--accent)" data-workshop="${mi}:${bi}">Såga i verkstadsläge →</button>`;
            fig.appendChild(cap);
            grid.appendChild(fig);
        });
        resOpt.appendChild(sec);
    });
    opt.linear.forEach(r => resOpt.appendChild(boardSection(r)));
    if (!opt.materials.length && !opt.linear.length) resOpt.innerHTML = '<p class="muted">Inget att optimera.</p>';
    $('exportRow').hidden = !opt.materials.length;
    $('offcutCount').textContent = state.offcuts.length ? `${state.offcuts.length} bitar i lager${opt.offcutsUsed.length ? `, varav ${opt.offcutsUsed.length} används här` : ''}` : '';
    const saveBtn = $('btnSaveOffcuts');
    saveBtn.hidden = !opt.newOffcuts.length && !opt.offcutsUsed.length;
    saveBtn.textContent = `Spara ${opt.newOffcuts.length} spillbitar i lager`;
    saveBtn.title = 'Lägger till spillbitarna från de här skärschemana i spillagret och tar bort de bitar som används.';

    // Beslag och fräsar
    const hwCount = col.hardware.length, toolCount = col.tools.length;
    $('hardwareEmpty').hidden = !!(hwCount || toolCount);
    $('hardwareBody').hidden = !hwCount;
    $('toolsBody').hidden = !toolCount;
    const priceLink = q => { const url = shopUrl(state.settings, q); return url ? `<a href="${esc(url)}" target="_blank" rel="noopener sponsored" class="whitespace-nowrap hover:underline" style="color: var(--accent)">Sök pris ↗</a>` : ''; };
    $('resHardwareList').innerHTML = col.hardware.map(h => `<tr><td>${esc(h.name)}</td><td class="num text-right">${h.qty}</td><td class="muted">${esc(h.unit)}</td>
            <td class="text-right text-[12px] space-x-3">${h.link ? extLink(h.link.url, `Visa hos ${h.link.label}`) : ''}${priceLink(h.query)}</td></tr>`).join('');
    $('resToolList').innerHTML = col.tools.map(t => `<tr><td>${esc(t.name)}</td><td class="muted">${esc(t.use)}</td><td class="faint">${esc(t.items.join(', '))}</td>
            <td class="text-right text-[12px]">${priceLink(t.query)}</td></tr>`).join('');
    $('shopNote').textContent = shopUrl(state.settings, 'x') ? `"Sök pris" söker hos ${SHOPS[state.settings.shop].name}. Du kan byta under Inställningar.` : 'Ange en länkmall under Inställningar för att visa prislänkar.';

    // Borrschema: gångjärn, hyllhål och spår
    $('drillEmpty').hidden = !!(col.drillings.length || col.processing.length);
    $('drillBody').hidden = !col.drillings.length;
    $('procBody').hidden = !col.processing.length;
    $('resProcList').innerHTML = col.processing.map(pr => {
        if (pr.kind === 'groove') {
            return `<tr><td>${esc(pr.item)}</td><td>Spår för bakstycke</td><td class="muted">${esc(pr.part)}</td><td class="num text-right">${pr.faces * pr.count}</td>
                <td class="leading-relaxed">${fmt(pr.width)} mm brett och ${fmt(pr.depth)} mm djupt, ${fmt(pr.inset)} mm in från bakkanten, på insidan av delen.</td></tr>`;
        }
        const h = pr.holes;
        const pos = h.length > 8 ? `${fmt(h[0])}, ${fmt(h[1])}, ${fmt(h[2])} … ${fmt(h[h.length - 1])} (${h.length} hål per rad, var ${pr.pitch}:e mm)` : h.map(fmt).join(' · ');
        return `<tr><td>${esc(pr.item)}</td><td>Hyllhål</td><td class="muted">${esc(pr.part)}</td><td class="num text-right">${pr.faces * pr.count}</td>
            <td class="leading-relaxed">Två rader Ø${pr.dia} × ${pr.depth} mm: ${pr.front} mm från framkanten och ${fmt(pr.rear)} mm från bakkanten. Från delens underkant: <span class="num">${pos}</span>.</td></tr>`;
    }).join('');
    $('resDrillList').innerHTML = col.drillings.map(d => `<tr><td>${esc(d.item)}</td><td class="muted">${esc(d.door)}</td><td class="num text-right">${d.count}</td>
        <td class="num whitespace-nowrap">${fmt(d.h)} × ${fmt(d.w)}</td><td class="muted">${esc(d.side)}</td><td class="num whitespace-nowrap">${d.holes.map(fmt).join(' · ')}</td></tr>`).join('');

    // Antal i flikarna
    const counts = { list: col.rows.length, sheets: opt.sheets + opt.offcutsUsed.length, hardware: hwCount + toolCount, drill: col.drillings.length + col.processing.length };
    document.querySelectorAll('[data-tab]').forEach(t => {
        const base = t.dataset.label || (t.dataset.label = t.textContent.trim());
        const c = counts[t.dataset.tab];
        t.innerHTML = `${esc(base)}${c ? ` <span class="faint num text-[12px] ml-0.5">${c}</span>` : ''}`;
    });
}

// Virke: varje bräda ritas som en stapel med delarna i den ordning de kapas
function boardSection(r) {
    const { stock } = r;
    const label = boardLabel(stock.t, stock.w, stock.name);
    const inp = (field, unit, w, def, min, aria) => `<span class="fld-unit ${w}"><input type="number" min="${min}" class="fld !py-1" data-board="${esc(stock.key)}" data-field="${field}"
        value="${stock.custom[field] ?? ''}" placeholder="${def}" aria-label="${aria} för ${esc(label)}"><span class="unit">${unit}</span></span>`;
    const pct = v => `${(v / stock.L) * 100}%`;
    const sec = document.createElement('section');
    sec.innerHTML = `<div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
            <h3 class="font-semibold">Virke ${esc(label)}</h3>
            <span class="text-[12px] muted">${r.count} ${r.count === 1 ? 'bräda' : 'brädor'}</span>
            <div class="ml-auto flex flex-wrap items-center gap-2 text-[12px] muted">
                <span>Brädans längd</span>${inp('L', 'mm', 'w-28', state.settings.boardL, 300, 'Brädans längd')}
                <span class="ml-2">Pris per meter</span>${inp('price', 'kr', 'w-24', state.settings.boardPrice, 0, 'Pris per meter')}
            </div>
            <span class="num text-[13px] w-20 text-right">${fmtKr(r.cost)}</span>
        </div>
        <div class="space-y-3">${r.bars.map((b, i) => `<figure>
            <div class="board-bar" role="img" aria-label="Bräda ${i + 1}: delar ${b.cuts.map(c => c.nr).join(', ')}">
                ${b.trim ? `<span class="board-trim" style="left:0;width:${pct(b.trim)}"></span>` : ''}
                ${b.cuts.map(c => `<span class="board-cut" style="left:${pct(c.x)};width:${pct(c.l)}" title="#${c.nr} ${esc(c.name)}, ${fmt(c.l)} mm"><b>${c.nr}</b><span class="hidden sm:inline faint">&nbsp;·&nbsp;${fmt(c.l)}</span></span>`).join('')}
            </div>
            <figcaption class="mt-1 flex justify-between text-[12px] muted"><span>Bräda ${i + 1} · ${b.cuts.length} delar</span><span>Rest ${fmt(b.left)} mm</span></figcaption>
        </figure>`).join('')}</div>`;
    return sec;
}

function setTab(tab) {
    if (!['list', 'sheets', 'hardware', 'drill'].includes(tab)) tab = 'list';
    state.tab = tab;
    store.set(KEYS.tab, tab);
    document.querySelectorAll('[data-tab]').forEach(t => { const on = t.dataset.tab === tab; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', on); });
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
}

// ---------------------------------------------------------------------------
// Toast, ångra, nedladdning, urklipp
// ---------------------------------------------------------------------------
let toastTimer, undoFn = null;
function toast(msg, isError = false, undo = null) {
    undoFn = undo;
    $('toastUndo').hidden = !undo;
    $('toastMsg').textContent = msg;
    $('toastDot').style.background = isError ? 'var(--danger)' : '#4fbf8a';
    $('toast').classList.remove('is-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').classList.add('is-hidden'); undoFn = null; }, undo ? 8000 : 3200);
}

// Ångra: sparar en kopia av det som kan ändras innan en borttagning eller ersättning.
function snapshot() {
    return structuredClone({ project: state.project, offcuts: state.offcuts, settings: state.settings, activeId: state.activeId });
}
function restore(snap) {
    Object.assign(state, snap);
    $('projectName').value = state.project.name;
    selectItem(state.activeId);
    if (!$('modalOffcuts').hidden) renderOffcuts();
}
function withUndo(msg, change) {
    const snap = snapshot();
    change();
    toast(msg, false, () => { restore(snap); toast('Ångrat'); });
}
function runUndo() {
    if (!undoFn) return false;
    const fn = undoFn;
    undoFn = null;
    fn();
    return true;
}
$('toastUndo').addEventListener('click', runUndo);
document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
    if (e.target.closest?.('input, textarea, select')) return; // låt fälten ha sin egen ångra
    if (runUndo()) e.preventDefault();
});

function removeItem(id) {
    const idx = state.project.items.findIndex(i => i.id === id);
    if (idx < 0) return;
    const name = state.project.items[idx].name;
    withUndo(`${name} borttaget`, () => {
        state.project.items.splice(idx, 1);
        const next = state.project.items[Math.min(idx, state.project.items.length - 1)];
        selectItem(id === state.activeId ? next?.id : state.activeId);
    });
}

// I en inbäddad Claude-artifact går nedladdningar via värdens API; på en vanlig webbsida via en länk.
let downloadsCap;
function getDownloads() {
    if (typeof window.claude?.use !== 'function') return Promise.resolve(null);
    return (downloadsCap ??= window.claude.use('downloads').catch(() => null));
}

async function download(filename, content, type) {
    const cap = await getDownloads();
    if (cap) {
        try {
            // Värden tillåter bara vissa filändelser, t.ex. json och csv
            await cap.save({ filename: filename.replace(/\.cutyard$/, '.cutyard.json'), data: content });
            return true;
        } catch (e) {
            if (e?.code !== 'declined') toast('Filen kunde inte sparas här.', true);
            return false;
        }
    }
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
}

async function copyText(text, okMsg) {
    try {
        await navigator.clipboard.writeText(text);
        toast(okMsg);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { /* ignoreras */ }
        ta.remove();
        toast(ok ? okMsg : 'Kunde inte kopiera. Använd CSV i stället.', !ok);
    }
}

const today = () => new Date().toISOString().slice(0, 10);
// Filnamn med bara a–z, siffror, _ och -: äldre CNC-program och vissa webbläsare tappar annars namnet
const safeName = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'projekt';

// ---------------------------------------------------------------------------
// Persistens och projektfiler
// ---------------------------------------------------------------------------
let persistTimer;
function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        store.set(KEYS.project, state.project);
        store.set(KEYS.settings, state.settings);
        store.set(KEYS.offcuts, state.offcuts);
    }, 300);
}

function projectFile() {
    return { app: 'cutyard', version: 4, savedAt: new Date().toISOString(), project: state.project, settings: state.settings, offcuts: state.offcuts };
}

// Filer från version 1–2 sparade formulärfälten direkt.
function migrateV2(data) {
    const v = id => data.inputs?.[id];
    const num = id => (v(id) === '' || v(id) == null ? undefined : +v(id));
    const drop = o => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && Number.isFinite(x)));
    return { name: 'Importerat projekt', items: [
        { ...makeItem('cabinet', 'Skåp', { ...drop({ w: num('cabW'), h: num('cabH'), d: num('cabD'), shelves: num('cabShelves'), carcassT: num('cabMatStom'), backT: num('cabMatBack') }), fronts: 'none', edgeBand: v('cabEdgeBand') !== false }), qty: num('cabQty') || 1 },
        { ...makeItem('drawer', 'Lådor', drop({ w: num('drwW'), h: num('drwH'), d: num('drwD'), sideT: num('drwMatSide'), botT: num('drwMatBot'), clearance: num('drwClearance'), groove: num('drwGroove') })), qty: num('drwQty') || 1 },
        { ...makeItem('shaker', 'Shaker-dörr', drop({ w: num('shkW'), h: num('shkH'), frame: num('shkFrame'), tenon: num('shkTenon'), panelT: num('shkMatPanel') })), qty: num('shkQty') || 1 }
    ] };
}

function loadProjectData(data) {
    if (!data || typeof data !== 'object') throw new Error('format');
    let project;
    if (data.project) project = sanitizeProject(data.project);
    else if (data.inputs) project = sanitizeProject(migrateV2(data));
    if (!project) throw new Error('format');
    if (data.settings) state.settings = sanitizeSettings({ ...state.settings, ...data.settings });
    if (data.offcuts) state.offcuts = sanitizeOffcuts(data.offcuts);
    state.project = project;
    $('projectName').value = project.name;
    selectItem(project.items[0]?.id);
}

// ---------------------------------------------------------------------------
// Dialoger
// ---------------------------------------------------------------------------
const MODALS = ['modalSettings', 'modalOffcuts', 'modalNew', 'modalProfiles', 'modalPaste'];
let lastFocus = null;
function openModal(id) { lastFocus = document.activeElement; $(id).hidden = false; $(id).querySelector('input,select,button')?.focus(); }
function closeModal(id) { $(id).hidden = true; lastFocus?.focus?.(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') MODALS.forEach(id => { if (!$(id).hidden) closeModal(id); }); });
MODALS.forEach(id => $(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); }));

// Inställningar
const SETTING_FIELDS = { setSheetL: 'sheetL', setSheetW: 'sheetW', setPrice: 'price', setBoardL: 'boardL', setBoardPrice: 'boardPrice', setKerf: 'kerf', setTrim: 'trim', setEdgeThick: 'edgeThick', setReveal: 'reveal', setFrontGap: 'frontGap', setMinOffcutL: 'minOffcutL', setMinOffcutW: 'minOffcutW' };
function fillSettings() {
    for (const [id, k] of Object.entries(SETTING_FIELDS)) $(id).value = state.settings[k];
    $('setGrainLock').checked = state.settings.grainLock;
    $('setShop').innerHTML = Object.entries(SHOPS).map(([k, s]) => `<option value="${k}"${k === state.settings.shop ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    $('setShopTemplate').value = state.settings.shopTemplate;
    $('setShopTemplateWrap').hidden = state.settings.shop !== 'custom';
}
$('setShop').addEventListener('change', () => { $('setShopTemplateWrap').hidden = $('setShop').value !== 'custom'; });
$('btnSettings').addEventListener('click', () => { fillSettings(); openModal('modalSettings'); });
$('btnCloseSettings').addEventListener('click', () => closeModal('modalSettings'));
$('btnSaveSettings').addEventListener('click', () => {
    const next = { ...state.settings, grainLock: $('setGrainLock').checked, shop: $('setShop').value, shopTemplate: $('setShopTemplate').value.trim() };
    for (const [id, k] of Object.entries(SETTING_FIELDS)) next[k] = $(id).value === '' ? DEFAULT_SETTINGS[k] : $(id).value;
    if (next.shop === 'custom' && !/^https:\/\/.+\{q\}/.test(next.shopTemplate)) { toast('Länkmallen måste börja med https:// och innehålla {q}.', true); return; }
    state.settings = sanitizeSettings(next);
    closeModal('modalSettings');
    recompute();
    toast('Inställningar sparade');
});

// Längd och pris per virkesdimension
$('resOpt').addEventListener('change', e => {
    const { board: key, field } = e.target.dataset;
    if (key == null || !field) return;
    const raw = e.target.value.trim().replace(',', '.');
    const boards = structuredClone(state.settings.boards);
    const entry = boards[key] || {};
    if (raw === '') delete entry[field]; else entry[field] = +raw;
    boards[key] = entry;
    state.settings = sanitizeSettings({ ...state.settings, boards });
    if (raw !== '' && state.settings.boards[key]?.[field] !== +raw) toast(field === 'price' ? 'Priset kan inte vara negativt.' : 'Brädan måste vara minst 300 mm.', true);
    recompute();
});

// Skivformat och pris per tjocklek (direkt i skärschemafliken). Tomt fält = standard från Inställningar.
$('resOpt').addEventListener('change', e => {
    const { sheet: key, field } = e.target.dataset;
    if (key == null || !field) return;
    const raw = e.target.value.trim().replace(',', '.');
    const sheets = structuredClone(state.settings.sheets);
    const entry = sheets[key] || {};
    if (raw === '') delete entry[field]; else entry[field] = +raw;
    sheets[key] = entry;
    const mk = parseMatKey(key);
    const before = sheetFor(state.settings, mk.t, mk.name);
    state.settings = sanitizeSettings({ ...state.settings, sheets });
    const after = sheetFor(state.settings, mk.t, mk.name);
    if (raw !== '' && after[field] !== +raw) toast(field === 'price' ? 'Priset kan inte vara negativt.' : 'Skivan måste vara minst 300 mm.', true);
    if (before.L !== after.L || before.W !== after.W || before.price !== after.price) recompute();
});

// Profilgalleri för shaker-dörrar
function renderProfiles() {
    const p = activeItem()?.params;
    if (!p) return;
    const card = (kind, id, d, svg) => {
        const on = (kind === 'profile' ? p.profile : p.panelStyle) === id;
        const links = d.bits.map(b => {
            const url = shopUrl(state.settings, b.query);
            return `<li><span>${esc(b.name)}</span>${url ? ` ${extLink(url, 'Sök')}` : ''}<span class="block faint">${esc(b.use)}</span></li>`;
        }).join('');
        return `<article class="rounded-lg p-3 flex flex-col gap-2" style="background: var(--bg); border: 1px solid ${on ? 'var(--accent)' : 'var(--line)'};">
            ${svg}
            <div class="flex items-baseline justify-between gap-2"><h4 class="font-semibold">${esc(d.name)}</h4>${d.joint ? `<span class="text-[11px] faint">${esc(d.joint)}</span>` : `<span class="text-[11px] faint num">${d.minT}–${d.maxT} mm</span>`}</div>
            <p class="text-[12px] muted">${esc(d.desc)}</p>
            ${d.bits.length ? `<ul class="text-[12px] space-y-1.5">${links}</ul>` : '<p class="text-[12px] faint">Inga fräsar behövs.</p>'}
            <button type="button" class="${on ? 'btn-accent' : 'btn-line'} !py-1.5 mt-auto" data-pick="${kind}" data-id="${id}">${on ? 'Vald' : 'Välj'}</button>
        </article>`;
    };
    $('profileFrames').innerHTML = Object.entries(FRAME_PROFILES).map(([id, d]) => card('profile', id, d, profileSvg(id, p.panelStyle))).join('');
    $('profilePanels').innerHTML = Object.entries(PANEL_STYLES).map(([id, d]) => card('panelStyle', id, d, profileSvg(p.profile, id))).join('');
}
$('itemForm').addEventListener('click', e => { if (e.target.closest('[data-open-profiles]')) { renderProfiles(); openModal('modalProfiles'); } });
$('modalProfiles').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const item = activeItem();
    item.params[b.dataset.pick] = b.dataset.id;
    const sel = $(`f_${b.dataset.pick}`);
    if (sel) sel.value = b.dataset.id;
    updateVisibility();
    recompute();
    renderProfiles();
});
$('btnCloseProfiles').addEventListener('click', () => closeModal('modalProfiles'));

// Spillager
function renderOffcuts() {
    const list = [...state.offcuts].sort((a, b) => b.t - a.t || b.l * b.w - a.l * a.w);
    $('offcutList').innerHTML = list.length ? `<div class="max-h-72 overflow-y-auto"><table class="tbl">
        <thead><tr><th>Skiva</th><th>Mått</th><th></th></tr></thead>
        <tbody>${list.map(o => `<tr><td>${esc(matLabel(o.t, o.mn))}</td><td class="num">${fmt(o.l)} × ${fmt(o.w)} mm</td>
            <td class="text-right"><button type="button" data-deloff="${esc(o.id)}" class="muted hover:text-[var(--danger)] px-1" aria-label="Ta bort spillbit">✕</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted text-[13px]">Inga sparade spillbitar.</p>';
}
$('btnOffcuts').addEventListener('click', () => { renderOffcuts(); openModal('modalOffcuts'); });
$('btnCloseOffcuts').addEventListener('click', () => closeModal('modalOffcuts'));
$('offcutList').addEventListener('click', e => {
    const id = e.target.closest('[data-deloff]')?.dataset.deloff;
    if (!id) return;
    withUndo('Spillbiten borttagen', () => { state.offcuts = state.offcuts.filter(o => o.id !== id); renderOffcuts(); recompute(); });
});
$('btnAddOffcut').addEventListener('click', () => {
    const t = +$('newOffT').value, l = +$('newOffL').value, w = +$('newOffW').value;
    if (!(t > 0 && l > 0 && w > 0)) { toast('Ange tjocklek, längd och bredd.', true); return; }
    state.offcuts = sanitizeOffcuts([...state.offcuts, { id: uid('off'), t, mn: $('newOffMn').value, l: Math.max(l, w), w: Math.min(l, w) }]);
    $('newOffL').value = ''; $('newOffW').value = '';
    renderOffcuts();
    recompute();
});
$('btnSaveOffcuts').addEventListener('click', () => {
    const { opt } = state.last;
    const used = new Set(opt.offcutsUsed);
    withUndo(`Spillager uppdaterat: ${used.size} använda, ${opt.newOffcuts.length} nya`, () => {
        state.offcuts = state.offcuts.filter(o => !used.has(o.id)).concat(opt.newOffcuts.map(o => ({ id: uid('off'), ...o })));
        recompute();
    });
});

// Inklistring från Excel och import av CSV-fil
function pasteDefaultT() { const v = parseFloat($('pasteT').value.replace(',', '.')); return v > 0 ? v : 16; }
function renderPastePreview() {
    const res = parsePartsTable($('pasteText').value, { defaultT: pasteDefaultT() });
    const n = res.rows.length;
    $('btnPasteApply').disabled = !n;
    $('btnPasteApply').textContent = n ? `Lägg till ${n} ${n === 1 ? 'del' : 'delar'}` : 'Lägg till';
    if (!$('pasteText').value.trim()) { $('pastePreview').innerHTML = ''; return; }
    const shown = res.rows.slice(0, 8);
    $('pastePreview').innerHTML = `<p class="text-[12px] muted mb-2">${res.header ? 'Rubrikraden kändes igen.' : 'Ingen rubrikrad hittades, kolumnerna läses som Antal, Längd, Bredd, Tjocklek, Namn, Skivtyp.'} ${n} ${n === 1 ? 'del' : 'delar'} hittades.</p>
        ${n ? `<div class="overflow-x-auto"><table class="tbl"><thead><tr><th class="!text-right">Antal</th><th class="!text-right">Längd</th><th class="!text-right">Bredd</th><th class="!text-right">Tjocklek</th><th>Namn</th><th>Skivtyp</th></tr></thead>
        <tbody>${shown.map(r => `<tr><td class="num text-right">${r.qty}</td><td class="num text-right">${fmt(r.l)}</td><td class="num text-right">${fmt(r.w)}</td><td class="num text-right">${fmt(r.t)}</td><td>${esc(r.name)}</td><td class="muted">${esc(r.mn)}</td></tr>`).join('')}
        ${n > shown.length ? `<tr><td colspan="6" class="faint">… och ${n - shown.length} till</td></tr>` : ''}</tbody></table></div>` : ''}
        ${res.errors.length ? `<div class="note-warn mt-3">${res.errors.slice(0, 5).map(e => `<div>${esc(e)}</div>`).join('')}${res.errors.length > 5 ? `<div>… och ${res.errors.length - 5} rader till som inte kunde läsas.</div>` : ''}</div>` : ''}`;
}
function openPaste(text = '') {
    $('pasteText').value = text;
    renderPastePreview();
    openModal('modalPaste');
    $('pasteText').focus();
}
$('pasteText').addEventListener('input', renderPastePreview);
$('pasteT').addEventListener('input', renderPastePreview);
$('btnPasteCancel').addEventListener('click', () => closeModal('modalPaste'));
$('btnPasteApply').addEventListener('click', () => {
    const { rows } = parsePartsTable($('pasteText').value, { defaultT: pasteDefaultT() });
    if (!rows.length) return;
    closeModal('modalPaste');
    withUndo(`${rows.length} ${rows.length === 1 ? 'del' : 'delar'} tillagda`, () => {
        let item = activeItem();
        if (item?.type !== 'list') {
            item = makeItem('list', 'Inklistrad lista', { rows: [] });
            state.project.items.push(item);
        } else if (item.params.rows.length === 1 && !item.params.rows[0].name && item.params.rows[0].l === 600 && item.params.rows[0].w === 300) {
            item.params.rows = []; // ersätt den tomma startraden
        }
        item.params.rows.push(...rows);
        selectItem(item.id);
    });
});
$('csvUpload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { openPaste(String(ev.target.result)); $('csvUpload').value = ''; };
    reader.onerror = () => { toast('Filen kunde inte läsas.', true); $('csvUpload').value = ''; };
    reader.readAsText(file);
});
$('btnPasteList').addEventListener('click', () => openPaste());

// Verkstadsläge
function startWorkshop(matIndex = 0, binIndex = 0) {
    if (!state.last?.opt.materials.length) { toast('Det finns inget att såga ännu.', true); return; }
    openWorkshop(state.last.opt, { matIndex, binIndex }, state.settings.kerf);
}
$('btnWorkshop').addEventListener('click', () => startWorkshop());
$('resOpt').addEventListener('click', e => {
    const w = e.target.closest('[data-workshop]')?.dataset.workshop;
    if (!w) return;
    const [mi, bi] = w.split(':').map(Number);
    startWorkshop(mi, bi);
});

// ---------------------------------------------------------------------------
// Händelser
// ---------------------------------------------------------------------------
$('itemForm').addEventListener('input', e => {
    const fe = fieldEls.find(f => f.input === e.target);
    if (!fe || fe.field.key === 'kind') return; // hanteras i change nedan
    readField(fe);
    updateVisibility();
    scheduleRecompute();
});
$('itemForm').addEventListener('change', e => {
    const fe = fieldEls.find(f => f.input === e.target);
    if (fe?.field.key === 'kind') {
        const item = activeItem(), kind = e.target.value;
        withUndo(`Standardmått för ${CABINET_KINDS[kind].label.toLowerCase()}`, () => {
            Object.assign(item.params, { kind, ...CABINET_KINDS[kind].preset });
            renderItemList(); renderForm(); recompute();
        });
        return;
    }
    if (fe) { readField(fe); updateVisibility(); recompute(); }
});
$('itemForm').addEventListener('submit', e => e.preventDefault());

$('itemName').addEventListener('input', e => { activeItem().name = e.target.value.trim() || TYPE_LABEL[activeItem().type]; renderItemList(); scheduleRecompute(); });
$('itemQty').addEventListener('input', e => { const v = Math.round(+e.target.value); if (v >= 1) { activeItem().qty = Math.min(999, v); renderItemList(); scheduleRecompute(); } });
$('projectName').addEventListener('input', e => { state.project.name = e.target.value.trim() || 'Mitt projekt'; persist(); });

$('itemList').addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]')?.dataset.remove;
    if (rm) { removeItem(rm); return; }
    const id = e.target.closest('[data-item]')?.dataset.item;
    if (id) selectItem(id);
});
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addItem(b.dataset.add)));

$('btnDuplicate').addEventListener('click', () => {
    const src = activeItem();
    const copy = { ...structuredClone(src), id: uid('it'), name: `${src.name} (kopia)` };
    state.project.items.splice(state.project.items.indexOf(src) + 1, 0, copy);
    selectItem(copy.id);
    toast('Objektet duplicerat');
});
$('btnDelete').addEventListener('click', () => removeItem(activeItem().id));
$('btnRestoreParts').addEventListener('click', () => {
    const item = activeItem();
    withUndo('Alla delar är med i kaplistan igen', () => { item.excluded = {}; recompute(); });
});
$('showFronts').addEventListener('change', e => viewer.setShowFronts(e.target.checked));
$('wallView').addEventListener('change', e => { state.wallView = e.target.checked; viewer.frameKey = ''; recompute(); });

document.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
    state.scope = b.dataset.scope;
    document.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('is-on', x === b));
    recompute();
}));
document.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

// Nytt projekt
$('btnNew').addEventListener('click', () => openModal('modalNew'));
$('btnNewCancel').addEventListener('click', () => closeModal('modalNew'));
$('btnNewExample').addEventListener('click', () => { closeModal('modalNew'); withUndo('Exempelprojekt laddat', () => loadProjectData({ project: exampleProject() })); });
$('btnNewEmpty').addEventListener('click', () => {
    closeModal('modalNew');
    withUndo('Nytt projekt skapat', () => loadProjectData({ project: { name: 'Nytt projekt', items: [makeItem('cabinet', 'Skåp 1', { fronts: 'none' })] } }));
});

// Spara/öppna
$('btnSaveProject').addEventListener('click', async () => {
    if (await download(`${safeName(state.project.name)}_${today()}.cutyard`, JSON.stringify(projectFile(), null, 2), 'application/json')) toast('Projektet sparat');
});
$('btnLoadProject').addEventListener('click', () => $('fileUpload').click());
$('fileUpload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try { const data = JSON.parse(ev.target.result); withUndo('Projektet öppnat', () => loadProjectData(data)); }
        catch { toast('Filen kunde inte läsas. Välj en giltig .cutyard-fil.', true); }
        finally { $('fileUpload').value = ''; }
    };
    reader.onerror = () => { toast('Filen kunde inte läsas.', true); $('fileUpload').value = ''; };
    reader.readAsText(file);
});

// Export
$('btnExportCsv').addEventListener('click', async () => {
    if (!state.last?.col.rows.length) { toast('Kaplistan är tom', true); return; }
    if (await download(`${safeName(state.project.name)}_kaplista_${today()}.csv`, buildCsv(state.last.col), 'text/csv;charset=utf-8')) toast('CSV-filen sparad');
});
$('btnCopyCsv').addEventListener('click', () => {
    if (!state.last?.col.rows.length) { toast('Kaplistan är tom', true); return; }
    copyText(buildCsv(state.last.col, { sep: '\t', bom: false }), 'Kaplistan kopierad – klistra in i Excel');
});
$('btnBuyAll').addEventListener('click', () => {
    const lines = state.last.col.hardware.map(h => {
        const url = shopUrl(state.settings, h.query);
        return `${h.qty} ${h.unit}  ${h.name}${url ? `\n    ${url}` : ''}`;
    });
    copyText(`Inköpslista – ${state.project.name}\n\n${lines.join('\n')}\n`, 'Inköpslistan kopierad');
});

// Skärscheman som SVG och DXF
$('btnExportSvg').addEventListener('click', async () => {
    if (!state.last?.opt.materials.length) { toast('Det finns inga skärscheman att exportera.', true); return; }
    if (await download(`${safeName(state.project.name)}_skarscheman_${today()}.svg`, sheetsSvg(state.last.opt, state.project.name), 'image/svg+xml')) toast('SVG-filen sparad');
});
$('btnExportDxf').addEventListener('click', async () => {
    if (!state.last?.opt.materials.length) { toast('Det finns inga skärscheman att exportera.', true); return; }
    if (await download(`${safeName(state.project.name)}_skarscheman_${today()}.dxf`, sheetsDxf(state.last.opt), 'application/dxf')) toast('DXF-filen sparad');
});

// Utskrift (laddar QR-biblioteket först när det behövs)
$('btnPrint').addEventListener('click', async () => {
    if (!state.last?.col.rows.length) { toast('Kaplistan är tom', true); return; }
    try {
        const { buildPrint } = await import('./print.js');
        buildPrint($('printArea'), {
            projectName: state.project.name,
            scopeLabel: state.scope === 'item' ? activeItem().name : `${state.project.items.length} objekt`,
            col: state.last.col, opt: state.last.opt, withLabels: true
        });
        window.print();
    } catch (err) {
        console.error(err);
        toast('Utskriften kunde inte förberedas.', true);
    }
});

// Offline-indikator och service worker (PWA)
const updateOnline = () => { $('offlineBadge').hidden = navigator.onLine; };
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* t.ex. i en sandlåda */ }));
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
function init() {
    $('year').textContent = new Date().getFullYear();
    updateOnline();
    const legacy = store.get('cutyardSettings'); // version 1
    state.settings = sanitizeSettings(store.get(KEYS.settings) || legacy || {});
    state.offcuts = sanitizeOffcuts(store.get(KEYS.offcuts));
    state.project = sanitizeProject(store.get(KEYS.project)) || exampleProject();
    state.activeId = store.get(KEYS.active);
    $('projectName').value = state.project.name;
    viewer = new Viewer($('viewer3D'), key => {
        if (key.includes('::')) { // klick i väggvyn: nyckeln är objekt-id::del
            const [id, partKey] = key.split('::');
            const it = state.project.items.find(i => i.id === id);
            if (!it) return;
            if (it.excluded[partKey]) delete it.excluded[partKey]; else it.excluded[partKey] = true;
            recompute();
            return;
        }
        const item = activeItem();
        if (item.excluded[key]) delete item.excluded[key]; else item.excluded[key] = true;
        recompute();
    });
    initWorkshop();
    setTab(store.get(KEYS.tab) || 'list');
    selectItem(state.activeId);
    if (document.fonts?.ready) document.fonts.ready.then(() => recompute());
}

init();

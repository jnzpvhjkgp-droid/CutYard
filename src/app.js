// CutYard – gränssnitt. All beräkning sker i core.js.
import {
    fmt, fmtKr, round1, uid, DEFAULT_SETTINGS, SHOPS, sanitizeSettings, shopUrl,
    DEFAULT_MATERIALS, materialLabel, sanitizeMaterials, sanitizeOffcuts,
    SLIDES, slideById, ITEM_TYPES, DEFAULT_PARAMS, makeItem, sanitizeProject, exampleProject,
    buildItem, collect, optimize, buildCsv
} from './core.js';
import { Viewer } from './viewer.js';
import { sheetCanvas } from './draw.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// Lagring (per webbläsare). Allt är inslaget i try/catch – privat läge m.m.
// ---------------------------------------------------------------------------
const KEYS = { settings: 'cutyard.v2.settings', materials: 'cutyard.v2.materials', offcuts: 'cutyard.v2.offcuts', project: 'cutyard.v2.project', active: 'cutyard.v2.active' };
const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignoreras */ } }
};

// ---------------------------------------------------------------------------
// Tillstånd
// ---------------------------------------------------------------------------
const state = {
    settings: { ...DEFAULT_SETTINGS },
    materials: DEFAULT_MATERIALS.map(m => ({ ...m })),
    offcuts: [],
    project: exampleProject(),
    activeId: null,
    scope: 'project',
    last: null   // senaste beräkning { col, opt, items }
};
const M = () => Object.fromEntries(state.materials.map(m => [m.id, m]));
const activeItem = () => state.project.items.find(i => i.id === state.activeId) || state.project.items[0]; // undefined om projektet är tomt

// ---------------------------------------------------------------------------
// Formulärschema per objekttyp. show(p) styr om fältet syns.
// ---------------------------------------------------------------------------
const ACCENT = { cabinet: '#3B82F6', drawer: '#A855F7', shaker: '#10B981' };
const BAR = { cabinet: 'from-blue-600', drawer: 'from-purple-500', shaker: 'from-emerald-500' };
const TYPE_LABEL = { cabinet: 'Skåp', drawer: 'Lådor (fristående)', shaker: 'Shaker-dörr' };

const n = (key, label, o = {}) => ({ kind: 'num', key, label, ...o });
const mat = (key, label, o = {}) => ({ kind: 'mat', key, label, ...o });
const sel = (key, label, options, o = {}) => ({ kind: 'select', key, label, options, ...o });
const chk = (key, label, o = {}) => ({ kind: 'check', key, label, ...o });
const sec = (label, o = {}) => ({ kind: 'section', label, ...o });
const note = (text, o = {}) => ({ kind: 'note', text, ...o });
const slideOptions = () => SLIDES.map(s => [s.id, s.name]);

const SCHEMA = {
    cabinet: [
        sec('Yttermått (mm)'),
        [n('w', 'Bredd', { min: 100 }), n('h', 'Höjd', { min: 100 }), n('d', 'Djup', { min: 100 })],
        sec('Stomme'),
        [mat('carcassMat', 'Stommaterial'), mat('backMat', 'Bakstycke', { allowNone: true })],
        [n('shelves', 'Hyllplan', { min: 0, max: 20, int: true, show: p => p.fronts !== 'drawers' }), chk('edgeBand', 'Kantlist på framkanter')],
        sec('Fronter'),
        [sel('fronts', 'Fronter', [['none', 'Inga'], ['doors', 'Dörrar'], ['drawers', 'Lådor']]),
         sel('doorCount', 'Antal dörrar', [['auto', 'Auto'], ['1', '1'], ['2', '2']], { show: p => p.fronts === 'doors' }),
         n('drawerCount', 'Antal lådor', { min: 1, max: 8, int: true, show: p => p.fronts === 'drawers' })],
        [mat('frontMat', 'Frontmaterial', { show: p => p.fronts !== 'none' }),
         sel('frontStyle', 'Stil', [['flat', 'Slät'], ['shaker', 'Shaker']], { show: p => p.fronts !== 'none' })],
        [n('frame', 'Rambredd', { min: 20, show: p => p.fronts !== 'none' && p.frontStyle === 'shaker' }),
         n('tenon', 'Tapp/spår', { min: 0, show: p => p.fronts !== 'none' && p.frontStyle === 'shaker' }),
         mat('panelMat', 'Fyllning', { show: p => p.fronts !== 'none' && p.frontStyle === 'shaker' })],
        sec('Lådor', { show: p => p.fronts === 'drawers' }),
        [sel('slideId', 'Lådskenor', slideOptions(), { show: p => p.fronts === 'drawers' }),
         n('clearance', 'Spel/sida', { min: 0, step: 0.1, show: p => p.fronts === 'drawers' && p.slideId === 'custom' })],
        [mat('drawerSideMat', 'Lådsidor', { show: p => p.fronts === 'drawers' }), mat('drawerBotMat', 'Lådbotten', { show: p => p.fronts === 'drawers' }),
         n('groove', 'Spårdjup', { min: 0, step: 0.5, show: p => p.fronts === 'drawers' })],
        note(p => slideById(p.slideId).note, { show: p => p.fronts === 'drawers' })
    ],
    drawer: [
        sec('Skåpsöppning (mm)'),
        [n('w', 'Innerbredd', { min: 50 }), n('h', 'Lådhöjd', { min: 30 }), n('d', 'Innerdjup', { min: 100 })],
        sec('Material'),
        [mat('sideMat', 'Lådsidor'), mat('botMat', 'Botten'), n('groove', 'Spårdjup', { min: 0, step: 0.5 })],
        sec('Lådskenor'),
        [sel('slideId', 'Skenor', slideOptions()), n('clearance', 'Spel/sida', { min: 0, step: 0.1, show: p => p.slideId === 'custom' })],
        note(p => slideById(p.slideId).note)
    ],
    shaker: [
        sec('Dörrmått (mm)'),
        [n('w', 'Bredd', { min: 100 }), n('h', 'Höjd', { min: 100 })],
        [n('frame', 'Rambredd', { min: 20 }), n('tenon', 'Tapp/spårdjup', { min: 0 })],
        sec('Material'),
        [mat('frameMat', 'Ram'), mat('panelMat', 'Fyllning')],
        chk('hinges', 'Räkna gångjärn och borrschema')
    ]
};

const CHECK_SVG = '<svg class="check-mark" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>';
let fieldEls = [];   // [{ field, wrap, input }]

function materialOptions(selected, allowNone) {
    const opts = state.materials.map(m => `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(materialLabel(m))}</option>`);
    if (allowNone) opts.unshift(`<option value="none"${selected === 'none' ? ' selected' : ''}>Inget</option>`);
    if (selected !== 'none' && !state.materials.some(m => m.id === selected)) opts.unshift(`<option value="${esc(selected)}" selected>Saknas i biblioteket</option>`);
    return opts.join('');
}

function renderField(f, item) {
    const p = item.params, id = `f_${f.key}`;
    const wrap = document.createElement('div');
    wrap.className = 'min-w-0';
    if (f.kind === 'num') {
        wrap.innerHTML = `<label class="fld-label" for="${id}">${esc(f.label)}</label><input type="number" id="${id}" class="fld" inputmode="decimal" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} step="${f.step || (f.int ? 1 : 'any')}" value="${esc(p[f.key])}" placeholder="${esc(DEFAULT_PARAMS[item.type][f.key])}">`;
    } else if (f.kind === 'mat') {
        wrap.innerHTML = `<label class="fld-label" for="${id}">${esc(f.label)}</label><select id="${id}" class="fld">${materialOptions(p[f.key], f.allowNone)}</select>`;
    } else if (f.kind === 'select') {
        wrap.innerHTML = `<label class="fld-label" for="${id}">${esc(f.label)}</label><select id="${id}" class="fld">${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(p[f.key]) === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.kind === 'check') {
        wrap.className = 'min-w-0 flex items-end pb-2';
        wrap.innerHTML = `<label class="flex items-center gap-3 cursor-pointer"><span class="check-wrap"><input type="checkbox" id="${id}" class="check"${p[f.key] ? ' checked' : ''}>${CHECK_SVG}</span><span class="text-sm text-gray-300">${esc(f.label)}</span></label>`;
    }
    return { field: f, wrap, input: wrap.querySelector('input,select') };
}

function renderForm() {
    const item = activeItem();
    const form = $('itemForm');
    form.innerHTML = '';
    fieldEls = [];
    for (const entry of SCHEMA[item.type]) {
        if (Array.isArray(entry)) {
            const row = document.createElement('div');
            row.className = `grid gap-3 sm:gap-4 ${entry.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`;
            entry.forEach(f => { const fe = renderField(f, item); row.appendChild(fe.wrap); fieldEls.push(fe); });
            fieldEls.push({ field: { show: p => entry.some(f => !f.show || f.show(p)) }, wrap: row });
            form.appendChild(row);
        } else if (entry.kind === 'section') {
            const h = document.createElement('div');
            h.className = 'section-title';
            h.textContent = entry.label;
            form.appendChild(h);
            fieldEls.push({ field: entry, wrap: h });
        } else if (entry.kind === 'note') {
            const pEl = document.createElement('p');
            pEl.className = 'text-xs text-gray-500';
            form.appendChild(pEl);
            fieldEls.push({ field: entry, wrap: pEl });
        } else {
            const fe = renderField(entry, item);
            form.appendChild(fe.wrap); fieldEls.push(fe);
        }
    }
    const first = form.querySelector('.section-title');
    if (first) first.classList.remove('pt-2', 'border-t');
    updateVisibility();
}

function updateVisibility() {
    const p = activeItem().params;
    for (const { field, wrap } of fieldEls) {
        wrap.hidden = !!field.show && !field.show(p);
        if (field.kind === 'note') wrap.textContent = field.text(p);
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

// ---------------------------------------------------------------------------
// Projektlista (chips) och editor
// ---------------------------------------------------------------------------
function renderChips() {
    const wrap = $('itemChips');
    wrap.innerHTML = state.project.items.map(it => {
        const on = it.id === state.activeId;
        return `<div class="chip ${on ? 'chip-active' : 'chip-idle'} !p-0 !gap-0">
            <button type="button" role="tab" aria-selected="${on}" data-item="${esc(it.id)}" class="flex items-center gap-2 pl-3 pr-2 py-2">
                <span class="w-2 h-2 rounded-full shrink-0" style="background:${ACCENT[it.type]}"></span>
                <span>${esc(it.name)}</span>${it.qty > 1 ? `<span class="num text-xs text-gray-400">×${it.qty}</span>` : ''}</button>
            <button type="button" data-remove="${esc(it.id)}" class="self-stretch px-2.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-r-lg border-l border-white/5" title="Ta bort ${esc(it.name)}" aria-label="Ta bort ${esc(it.name)}">✕</button></div>`;
    }).join('');
}

function selectItem(id) {
    state.activeId = id;
    const item = activeItem();
    const empty = !item;
    $('emptyState').hidden = !empty;
    $('editorSection').hidden = empty;
    if (empty) { renderChips(); recompute(); return; }
    state.activeId = item.id;
    store.set(KEYS.active, item.id);
    $('itemName').value = item.name;
    $('itemQty').value = item.qty;
    $('itemType').textContent = TYPE_LABEL[item.type];
    $('editorPanel').style.setProperty('--accent', ACCENT[item.type]);
    $('editorBar').className = `absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${BAR[item.type]} to-transparent`;
    viewer.frameKey = '';
    renderChips();
    renderForm();
    recompute();
}

function addItem(type) {
    const count = state.project.items.filter(i => i.type === type).length + 1;
    const item = makeItem(type, `${ITEM_TYPES[type].label} ${count}`);
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
    const mats = M();
    const item = activeItem();
    if (item) {
        const built = buildItem(item, mats, state.settings);
        viewer.show(built.parts, item.excluded, `${item.id}|${item.params.w}|${item.params.h}|${item.params.d}`);
        renderItemStatus(item, built);
    }
    const items = !item ? [] : state.scope === 'item' ? [item] : state.project.items;
    const col = collect(items, mats, state.settings);
    const opt = optimize(col.rows, mats, state.settings, state.offcuts);
    state.last = { col, opt, items };
    renderResults(col, opt, mats);
    persist();
}

function renderItemStatus(item, built) {

    const warn = $('itemWarn');
    warn.hidden = !built.warnings.length;
    warn.innerHTML = built.warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('');
    const info = $('itemInfo');
    info.hidden = !built.info;
    info.textContent = built.info ? built.info.join(' · ') : '';

    // Delar som klickats bort i 3D-vyn (nycklar som inte längre finns räknas inte)
    const keys = new Set(built.parts.map(p => p.key));
    const off = Object.keys(item.excluded).filter(k => keys.has(k));
    $('excludedNote').hidden = !off.length;
    $('excludedText').textContent = off.length === 1 ? '1 del är borttagen ur kaplistan.' : `${off.length} delar är borttagna ur kaplistan.`;
}
let timer;
const scheduleRecompute = () => { clearTimeout(timer); timer = setTimeout(recompute, 120); };

function renderResults(col, opt, mats) {
    $('scopeItemName').textContent = activeItem()?.name || 'objektet';
    $('statParts').textContent = col.partCount;
    $('statEdge').textContent = col.edgeMeters > 0 ? `${fmt(Math.ceil(col.edgeMeters * 1.1 * 10) / 10)} m` : '–';
    $('statSheets').textContent = opt.sheets;
    $('statUtil').textContent = opt.sheets ? `${Math.round(opt.utilization * 100)} % nyttjat` : '';
    $('statCost').textContent = fmtKr(opt.totalCost);
    $('statOffcuts').textContent = opt.offcutsUsed.length ? `${opt.offcutsUsed.length} spillbitar används` : 'Exempelpriser, ändra under Material';

    const warnings = [...col.warnings];
    opt.materials.forEach(r => {
        if (r.oversize.length) warnings.push(`${r.oversize.length} del(ar) i ${materialLabel(r.mat)} är större än skivan: ${[...new Set(r.oversize.map(p => `#${p.nr} ${fmt(p.l)}×${fmt(p.w)}`))].join(', ')} mm.`);
    });
    const wb = $('resWarn');
    wb.hidden = !warnings.length;
    wb.innerHTML = warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('');

    // Kaplista grupperad per material
    const byMat = {};
    col.rows.forEach(r => { (byMat[r.mat] = byMat[r.mat] || []).push(r); });
    $('resList').innerHTML = col.rows.length ? Object.entries(byMat).map(([id, rows]) => `
        <div class="glass-card p-4">
            <h4 class="text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/5 pb-2 flex justify-between items-center gap-2">
                <span class="text-white">${esc(materialLabel(mats[id]))}</span>
                <span class="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2.5 py-0.5 rounded-full whitespace-nowrap num">${rows.reduce((a, r) => a + r.count, 0)} delar</span>
            </h4>
            <ul class="space-y-2.5">${rows.map(r => `
                <li class="flex items-start gap-3 text-sm">
                    <span class="num shrink-0 w-8 h-6 rounded bg-amber-500/90 text-black text-xs font-bold flex items-center justify-center" title="Delnummer på skärschema och etikett">${r.nr}</span>
                    <span class="min-w-0 flex-1">
                        <span class="num text-white font-medium whitespace-nowrap">${fmt(r.l)} × ${fmt(r.w)}</span>
                        ${r.lock ? '<span class="text-[10px] text-amber-400/80 ml-1" title="Ådring längs första måttet">⇄</span>' : ''}
                        <span class="block text-gray-500 text-xs truncate" title="${esc(r.names.join(', '))} – ${esc(r.items.join(', '))}">${esc(r.names.join(', '))}${state.scope === 'project' ? ` · ${esc(r.items.join(', '))}` : ''}</span>
                    </span>
                    <span class="num bg-white/5 text-gray-300 border border-white/10 px-2 py-1 rounded text-xs font-bold whitespace-nowrap">${r.count} st</span>
                </li>`).join('')}
            </ul>
        </div>`).join('') : `<p class="text-sm text-gray-500">${activeItem() ? 'Inga delar valda. Klicka på delarna i 3D-vyn för att ta med dem igen.' : 'Lägg till ett objekt för att få en kaplista.'}</p>`;

    // Skärscheman
    const resOpt = $('resOpt');
    resOpt.innerHTML = '';
    opt.materials.forEach(r => {
        const group = document.createElement('div');
        group.innerHTML = `<h4 class="text-sm font-bold text-gray-300 mb-3 flex flex-wrap justify-between gap-2"><span>${esc(materialLabel(r.mat))}</span><span class="text-xs text-gray-500 num">${r.sheets} ${r.sheets === 1 ? 'skiva' : 'skivor'} · ${fmtKr(r.cost)}</span></h4>`;
        let sheetNo = 0;
        r.bins.forEach(b => {
            const card = document.createElement('div');
            card.className = 'glass-card mb-4 p-1';
            const title = b.kind === 'offcut' ? `Spillbit ${fmt(b.L)}×${fmt(b.W)}` : `Skiva ${++sheetNo}`;
            const u = Math.round(b.util * 100);
            card.innerHTML = `<div class="px-3 py-2 text-[10px] font-bold tracking-widest text-gray-500 uppercase flex flex-wrap justify-between items-center gap-2">
                <span>${title} · ${b.placements.length} delar</span>
                <span class="flex gap-2"><span class="num bg-black/30 px-2 py-0.5 rounded ${u >= 70 ? 'text-emerald-400' : u >= 40 ? 'text-yellow-400' : 'text-red-400'}">${u} %</span>
                ${b.kind === 'offcut' ? '<span class="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">Från spillager</span>' : ''}</span></div>`;
            const c = sheetCanvas(b, 1000, 'dark');
            c.className = 'sheet-canvas';
            c.setAttribute('role', 'img');
            c.setAttribute('aria-label', `${title}: ${b.placements.map(p => '#' + p.piece.nr).join(', ')}`);
            card.appendChild(c);
            group.appendChild(card);
        });
        resOpt.appendChild(group);
    });
    if (!opt.materials.length) resOpt.innerHTML = '<p class="text-sm text-gray-500">Inget att optimera.</p>';
    const saveBtn = $('btnSaveOffcuts');
    saveBtn.hidden = !opt.newOffcuts.length && !opt.offcutsUsed.length;
    saveBtn.textContent = `Uppdatera spillager (+${opt.newOffcuts.length}${opt.offcutsUsed.length ? `, −${opt.offcutsUsed.length}` : ''})`;

    // Beslag med butikslänkar
    $('resHardwareSection').hidden = !col.hardware.length;
    $('resHardwareList').innerHTML = col.hardware.map(h => {
        const url = shopUrl(state.settings, h.query);
        return `<tr><td class="font-medium text-gray-200">${esc(h.name)}</td><td class="text-center text-orange-400 font-bold num">${h.qty}</td><td class="text-gray-500">${esc(h.unit)}</td>
            <td class="text-right">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener sponsored" class="text-blue-400 hover:text-blue-300 text-xs font-semibold whitespace-nowrap">Sök pris →</a>` : ''}</td></tr>`;
    }).join('');
    const shop = SHOPS[state.settings.shop];
    $('shopNote').textContent = shopUrl(state.settings, 'x') ? `Länkarna söker hos ${shop.name}. Byt butik under Inställningar.` : 'Ange en giltig länkmall under Inställningar för att visa köplänkar.';

    // Borrschema
    $('resDrillSection').hidden = !col.drillings.length;
    $('resDrillList').innerHTML = col.drillings.map(d => `<tr><td>${esc(d.item)}</td><td>${esc(d.door)}</td><td class="text-center num">${d.count}</td>
        <td class="num whitespace-nowrap">${fmt(d.h)} × ${fmt(d.w)}</td><td>${esc(d.side)}</td><td class="num whitespace-nowrap text-orange-300">${d.holes.map(fmt).join(' · ')}</td></tr>`).join('');
}

// ---------------------------------------------------------------------------
// Hjälpare: toast, nedladdning, urklipp
// ---------------------------------------------------------------------------
let toastTimer, undoFn = null;
function toast(msg, isError = false, undo = null) {
    undoFn = undo;
    $('toastUndo').hidden = !undo;
    $('toastMsg').textContent = msg;
    $('toastIcon').className = `p-1.5 rounded-full ${isError ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`;
    $('toast').classList.remove('is-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').classList.add('is-hidden'); undoFn = null; }, undo ? 8000 : 3200);
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

// Ångra: sparar en kopia av det som kan ändras innan en borttagning eller ersättning.
function snapshot() {
    return structuredClone({ project: state.project, materials: state.materials, offcuts: state.offcuts, settings: state.settings, activeId: state.activeId });
}
function restore(snap) {
    Object.assign(state, snap);
    $('projectName').value = state.project.name;
    selectItem(state.activeId);
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
        toast(ok ? okMsg : 'Kunde inte kopiera. Använd Exportera CSV.', !ok);
    }
}

const today = () => new Date().toISOString().slice(0, 10);
const safeName = s => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'projekt';

// ---------------------------------------------------------------------------
// Persistens och projektfiler
// ---------------------------------------------------------------------------
let persistTimer;
function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        store.set(KEYS.project, state.project);
        store.set(KEYS.settings, state.settings);
        store.set(KEYS.materials, state.materials);
        store.set(KEYS.offcuts, state.offcuts);
    }, 300);
}

function projectFile() {
    return { app: 'cutyard', version: 3, savedAt: new Date().toISOString(), project: state.project, settings: state.settings, materials: state.materials, offcuts: state.offcuts };
}

// Äldre filer (version 1–2) sparade formulärfälten direkt.
function migrateV2(data) {
    const v = id => data.inputs?.[id];
    const num = id => (v(id) === '' || v(id) == null ? undefined : +v(id));
    const drop = o => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && Number.isFinite(x)));
    const items = [
        { ...makeItem('cabinet', 'Skåp', { ...drop({ w: num('cabW'), h: num('cabH'), d: num('cabD'), shelves: num('cabShelves') }), fronts: 'none', edgeBand: v('cabEdgeBand') !== false }), qty: num('cabQty') || 1 },
        { ...makeItem('drawer', 'Lådor', drop({ w: num('drwW'), h: num('drwH'), d: num('drwD'), clearance: num('drwClearance'), groove: num('drwGroove') })), qty: num('drwQty') || 1 },
        { ...makeItem('shaker', 'Shaker-dörr', drop({ w: num('shkW'), h: num('shkH'), frame: num('shkFrame'), tenon: num('shkTenon') })), qty: num('shkQty') || 1 }
    ];
    return { name: 'Importerat projekt', items };
}

function loadProjectData(data) {
    if (!data || typeof data !== 'object') throw new Error('format');
    let project;
    if (data.project) project = sanitizeProject(data.project);
    else if (data.inputs) project = sanitizeProject(migrateV2(data));
    if (!project) throw new Error('format');
    if (data.materials) state.materials = sanitizeMaterials(data.materials);
    if (data.settings) state.settings = sanitizeSettings({ ...state.settings, ...data.settings });
    if (data.offcuts) state.offcuts = sanitizeOffcuts(data.offcuts, state.materials);
    state.project = project;
    $('projectName').value = project.name;
    selectItem(project.items[0]?.id);
}

// ---------------------------------------------------------------------------
// Modaler
// ---------------------------------------------------------------------------
let lastFocus = null;
function openModal(id) { lastFocus = document.activeElement; $(id).hidden = false; $(id).querySelector('input,select,button')?.focus(); }
function closeModal(id) { $(id).hidden = true; lastFocus?.focus?.(); }
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['modalSettings', 'modalMaterials', 'modalNew'].forEach(id => { if (!$(id).hidden) closeModal(id); });
});
['modalSettings', 'modalMaterials', 'modalNew'].forEach(id => $(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); }));

// Inställningar
const SETTING_FIELDS = { setKerf: 'kerf', setTrim: 'trim', setEdgeThick: 'edgeThick', setReveal: 'reveal', setFrontGap: 'frontGap', setMinOffcutL: 'minOffcutL', setMinOffcutW: 'minOffcutW' };
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
    const next = { grainLock: $('setGrainLock').checked, shop: $('setShop').value, shopTemplate: $('setShopTemplate').value.trim() };
    for (const [id, k] of Object.entries(SETTING_FIELDS)) next[k] = $(id).value === '' ? DEFAULT_SETTINGS[k] : $(id).value;
    if (next.shop === 'custom' && !/^https:\/\/.+\{q\}/.test(next.shopTemplate)) { toast('Länkmallen måste börja med https:// och innehålla {q}.', true); return; }
    state.settings = sanitizeSettings(next);
    closeModal('modalSettings');
    recompute();
    toast('Inställningar sparade');
});

// Material och spillager (redigeras i en arbetskopia tills Spara)
let draftMats = [], draftOffcuts = [];
function renderMaterialModal() {
    const cell = (i, k, type, extra = '') => `<input data-i="${i}" data-k="${k}" type="${type}" class="fld ${type === 'text' ? 'fld-text text-sm' : '!px-2'}" value="${esc(draftMats[i][k])}" ${extra}>`;
    const box = (i, k) => `<span class="check-wrap"><input data-i="${i}" data-k="${k}" type="checkbox" class="check"${draftMats[i][k] ? ' checked' : ''}>${CHECK_SVG}</span>`;
    $('matRows').innerHTML = draftMats.map((m, i) => `<tr>
        <td class="min-w-[180px]">${cell(i, 'name', 'text', 'maxlength="60" aria-label="Namn"')}</td>
        <td class="w-20">${cell(i, 'thick', 'number', 'min="1" step="0.5" aria-label="Tjocklek mm"')}</td>
        <td class="w-24">${cell(i, 'L', 'number', 'min="100" aria-label="Längd mm"')}</td>
        <td class="w-24">${cell(i, 'W', 'number', 'min="100" aria-label="Bredd mm"')}</td>
        <td class="w-24">${cell(i, 'price', 'number', 'min="0" aria-label="Pris kr"')}</td>
        <td class="text-center">${box(i, 'grain')}</td><td class="text-center">${box(i, 'edgeable')}</td>
        <td><button type="button" data-del="${i}" class="text-gray-500 hover:text-red-400 px-2" aria-label="Ta bort ${esc(materialLabel(m))}">✕</button></td></tr>`).join('');
    $('newOffMat').innerHTML = draftMats.map(m => `<option value="${esc(m.id)}">${esc(materialLabel(m))}</option>`).join('');
    const label = id => { const m = draftMats.find(x => x.id === id); return m ? materialLabel(m) : '?'; };
    $('offcutList').innerHTML = draftOffcuts.length ? draftOffcuts.map((o, i) => `<span class="chip chip-idle !py-1 text-xs"><span class="num">${fmt(o.l)}×${fmt(o.w)}</span><span class="text-gray-500">${esc(label(o.mat))}</span><button type="button" data-deloff="${i}" class="hover:text-red-400" aria-label="Ta bort spillbit">✕</button></span>`).join('')
        : '<span class="text-xs text-gray-500">Inga sparade spillbitar.</span>';
}
$('matRows').addEventListener('input', e => {
    const { i, k } = e.target.dataset;
    if (i == null) return;
    draftMats[+i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? +e.target.value : e.target.value;
});
$('matRows').addEventListener('click', e => {
    const i = e.target.closest('[data-del]')?.dataset.del;
    if (i == null) return;
    if (draftMats.length <= 1) { toast('Minst ett material behövs.', true); return; }
    const id = draftMats[+i].id;
    draftMats.splice(+i, 1);
    draftOffcuts = draftOffcuts.filter(o => o.mat !== id);
    renderMaterialModal();
});
$('offcutList').addEventListener('click', e => {
    const i = e.target.closest('[data-deloff]')?.dataset.deloff;
    if (i == null) return;
    draftOffcuts.splice(+i, 1);
    renderMaterialModal();
});
$('btnAddMaterial').addEventListener('click', () => { draftMats.push({ id: uid('mat'), name: 'Nytt material', thick: 18, L: 2440, W: 1220, price: 0, grain: false, edgeable: true }); renderMaterialModal(); });
$('btnResetMaterials').addEventListener('click', () => { draftMats = DEFAULT_MATERIALS.map(m => ({ ...m })); draftOffcuts = draftOffcuts.filter(o => draftMats.some(m => m.id === o.mat)); renderMaterialModal(); });
$('btnAddOffcut').addEventListener('click', () => {
    const l = +$('newOffL').value, w = +$('newOffW').value;
    if (!(l > 0 && w > 0)) { toast('Ange längd och bredd för spillbiten.', true); return; }
    draftOffcuts.push({ id: uid('off'), mat: $('newOffMat').value, l: Math.max(l, w), w: Math.min(l, w) });
    $('newOffL').value = ''; $('newOffW').value = '';
    renderMaterialModal();
});
$('btnMaterials').addEventListener('click', () => {
    draftMats = state.materials.map(m => ({ ...m }));
    draftOffcuts = state.offcuts.map(o => ({ ...o }));
    renderMaterialModal();
    openModal('modalMaterials');
});
$('btnCloseMaterials').addEventListener('click', () => closeModal('modalMaterials'));
$('btnSaveMaterials').addEventListener('click', () => {
    closeModal('modalMaterials');
    withUndo('Materialbiblioteket sparat', () => {
        state.materials = sanitizeMaterials(draftMats);
        state.offcuts = sanitizeOffcuts(draftOffcuts, state.materials);
        if (activeItem()) renderForm();
        recompute();
    });
});

$('btnSaveOffcuts').addEventListener('click', () => {
    const { opt } = state.last;
    const used = new Set(opt.offcutsUsed);
    withUndo(`Spillager uppdaterat: ${used.size} förbrukade, ${opt.newOffcuts.length} nya`, () => {
        state.offcuts = state.offcuts.filter(o => !used.has(o.id)).concat(opt.newOffcuts.map(o => ({ id: uid('off'), ...o })));
        recompute();
    });
});

// ---------------------------------------------------------------------------
// Händelser
// ---------------------------------------------------------------------------
$('itemForm').addEventListener('input', e => {
    const fe = fieldEls.find(f => f.input === e.target);
    if (!fe) return;
    readField(fe);
    updateVisibility();
    scheduleRecompute();
});
$('itemForm').addEventListener('change', e => {
    const fe = fieldEls.find(f => f.input === e.target);
    if (fe) { readField(fe); updateVisibility(); recompute(); }
});
$('itemForm').addEventListener('submit', e => e.preventDefault());

$('itemName').addEventListener('input', e => { activeItem().name = e.target.value.trim() || TYPE_LABEL[activeItem().type]; renderChips(); scheduleRecompute(); });
$('itemQty').addEventListener('input', e => { const v = Math.round(+e.target.value); if (v >= 1) { activeItem().qty = Math.min(999, v); renderChips(); scheduleRecompute(); } });
$('projectName').addEventListener('input', e => { state.project.name = e.target.value.trim() || 'Mitt projekt'; persist(); });

$('itemChips').addEventListener('click', e => {
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

$('btnShowResults').addEventListener('click', () => $('resultSection').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
$('showFronts').addEventListener('change', e => viewer.setShowFronts(e.target.checked));

document.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
    state.scope = b.dataset.scope;
    document.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('seg-on', x === b));
    recompute();
}));

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
    if (await download(`${safeName(state.project.name)}_kaplista_${today()}.csv`, buildCsv(state.last.col, M()), 'text/csv;charset=utf-8')) toast('CSV-filen sparad');
});
$('btnCopyCsv').addEventListener('click', () => {
    if (!state.last?.col.rows.length) { toast('Kaplistan är tom', true); return; }
    copyText(buildCsv(state.last.col, M(), { sep: '\t', bom: false }), 'Kaplistan kopierad – klistra in i Excel');
});
$('btnBuyAll').addEventListener('click', () => {
    const lines = state.last.col.hardware.map(h => {
        const url = shopUrl(state.settings, h.query);
        return `${h.qty} ${h.unit}  ${h.name}${url ? `\n    ${url}` : ''}`;
    });
    copyText(`Inköpslista – ${state.project.name}\n\n${lines.join('\n')}\n`, 'Inköpslistan kopierad');
});

// Utskrift (laddar QR-biblioteket först när det behövs)
$('btnPrint').addEventListener('click', async () => {
    if (!state.last?.col.rows.length) { toast('Kaplistan är tom', true); return; }
    try {
        const { buildPrint } = await import('./print.js');
        buildPrint($('printArea'), {
            projectName: state.project.name,
            scopeLabel: state.scope === 'item' ? activeItem().name : `${state.project.items.length} objekt`,
            col: state.last.col, opt: state.last.opt, M: M(), withLabels: $('printLabels').checked
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
    state.materials = sanitizeMaterials(store.get(KEYS.materials));
    state.offcuts = sanitizeOffcuts(store.get(KEYS.offcuts), state.materials);
    state.project = sanitizeProject(store.get(KEYS.project)) || exampleProject();
    state.activeId = store.get(KEYS.active);
    $('projectName').value = state.project.name;
    viewer = new Viewer($('viewer3D'), key => {
        const item = activeItem();
        if (item.excluded[key]) delete item.excluded[key]; else item.excluded[key] = true;
        recompute();
    });
    selectItem(state.activeId);
    if (document.fonts?.ready) document.fonts.ready.then(() => recompute());
}

init();

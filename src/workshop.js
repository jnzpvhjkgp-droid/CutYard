// Verkstadsläge: ett snitt i taget, stora siffror, för surfplatta eller telefon vid sågen.
import { fmt, matLabel, cutSequence } from './core.js';
import { drawSheet } from './draw.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PROGRESS_KEY = 'cutyard.v2.workshop';

let ctx = null;        // { sheets: [{ bin, label, steps, key }], idx, step }
let wakeLock = null;
let lastFocus = null;

function loadProgress() { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; } }
function saveProgress() {
    if (!ctx) return;
    try {
        const all = loadProgress();
        const sh = ctx.sheets[ctx.idx];
        all[sh.key] = ctx.step;
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    } catch { /* ignoreras */ }
}

// Nyckel som ändras om schemat ändras, så att gammal progress inte hamnar på fel skiva
const binKey = (label, bin) => `${label}|${bin.L}x${bin.W}|${bin.placements.map(p => `${p.piece.nr}@${Math.round(p.x)},${Math.round(p.y)}`).join(';')}`;

export function openWorkshop(opt, { matIndex = 0, binIndex = 0 } = {}, kerf) {
    const sheets = [];
    opt.materials.forEach((m, mi) => {
        let n = 0;
        m.bins.forEach((b, bi) => {
            const label = `${matLabel(m.sheet.t, m.sheet.name)} · ${b.kind === 'offcut' ? `spillbit ${fmt(b.L)} × ${fmt(b.W)}` : `skiva ${++n}`}`;
            sheets.push({ bin: b, label, steps: cutSequence(b, kerf), key: binKey(label, b), mi, bi });
        });
    });
    if (!sheets.length) return false;
    const start = Math.max(0, sheets.findIndex(s => s.mi === matIndex && s.bi === binIndex));
    const progress = loadProgress();
    ctx = { sheets, idx: start, step: Math.min(progress[sheets[start].key] ?? 0, sheets[start].steps.length - 1) };

    $('wsSheet').innerHTML = sheets.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('');
    lastFocus = document.activeElement;
    $('workshop').hidden = false;
    document.body.style.overflow = 'hidden';
    render();
    $('wsNext').focus();
    if (navigator.wakeLock?.request) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => { /* skärmen kan släckas */ });
    return true;
}

function close() {
    $('workshop').hidden = true;
    document.body.style.overflow = '';
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
    ctx = null;
    lastFocus?.focus?.();
}

function go(delta) {
    if (!ctx) return;
    const sh = ctx.sheets[ctx.idx];
    ctx.step = Math.max(0, Math.min(sh.steps.length - 1, ctx.step + delta));
    saveProgress();
    render();
}

function describe(step, sh) {
    const b = sh.bin;
    if (step.kind === 'trim') {
        return { title: 'Putsa kanterna', big: `${fmt(step.trim)} mm`, text: `Såga bort ${fmt(step.trim)} mm runt hela skivan så att du får raka, rena kanter att mäta från.` };
    }
    if (step.kind === 'cut') {
        const g = step.region;
        const size = `${fmt(g.x1 - g.x0)} × ${fmt(g.y1 - g.y0)} mm`;
        return step.axis === 'y'
            ? { title: 'Längssnitt', big: `${fmt(step.dist)} mm`, text: `Såga ${fmt(step.dist)} mm från bitens övre kant i bilden. Snittet går längs hela biten (${fmt(step.len)} mm). Biten du sågar i är ${size}.` }
            : { title: 'Tvärsnitt', big: `${fmt(step.dist)} mm`, text: `Kapa ${fmt(step.dist)} mm från bitens vänstra kant i bilden. Snittet är ${fmt(step.len)} mm långt. Biten du sågar i är ${size}.` };
    }
    const p = b.placements[step.piece];
    return { title: `Del ${p.piece.nr} är klar`, big: `#${p.piece.nr}`, text: `${fmt(p.piece.l)} × ${fmt(p.piece.w)} mm, ${p.piece.name}. Märk delen med nummer ${p.piece.nr} eller sätt på etiketten.` };
}

function render() {
    const sh = ctx.sheets[ctx.idx];
    const steps = sh.steps;
    const step = steps[ctx.step];
    const done = new Set(steps.slice(0, ctx.step + 1).filter(s => s.kind === 'done').map(s => s.piece));
    $('wsSheet').value = String(ctx.idx);

    // Canvas i full upplösning för skärmen
    const canvas = $('wsCanvas');
    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(box.width / sh.bin.L, box.height / sh.bin.W);
    const cssW = Math.max(200, Math.floor(sh.bin.L * scale)), cssH = Math.max(100, Math.floor(sh.bin.W * scale));
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr); canvas.height = Math.floor(cssH * dpr);
    drawSheet(canvas, sh.bin, 'dark', {
        done,
        current: step.kind === 'done' ? step.piece : -1,
        region: step.kind === 'cut' ? step.region : step.kind === 'done' ? step.region : null,
        cut: step.kind === 'cut' ? step : null,
        trim: step.kind === 'trim'
    });

    const d = describe(step, sh);
    const cuts = steps.filter(s => s.kind === 'cut').length;
    const cutNo = steps.slice(0, ctx.step + 1).filter(s => s.kind === 'cut').length;
    $('wsProgress').textContent = `Steg ${ctx.step + 1} av ${steps.length} · ${done.size} av ${sh.bin.placements.length} delar klara`;
    $('wsTitle').textContent = step.kind === 'cut' ? `${d.title} ${cutNo} av ${cuts}` : d.title;
    $('wsBig').textContent = d.big;
    $('wsBig').style.color = step.kind === 'done' ? '#4fbf8a' : step.kind === 'cut' || step.kind === 'trim' ? '#ef6b6b' : '';
    $('wsText').textContent = d.text;
    $('wsPrev').disabled = ctx.step === 0;
    const last = ctx.step === steps.length - 1;
    $('wsNext').textContent = last ? (ctx.idx < ctx.sheets.length - 1 ? 'Nästa skiva →' : 'Klart') : 'Nästa →';
    $('wsBar').style.width = `${Math.round(((ctx.step + 1) / steps.length) * 100)}%`;

    // Delar på skivan
    const byNr = new Map();
    sh.bin.placements.forEach((p, i) => {
        const e = byNr.get(p.piece.nr) || { nr: p.piece.nr, name: p.piece.name, l: p.piece.l, w: p.piece.w, total: 0, done: 0 };
        e.total++; if (done.has(i)) e.done++;
        byNr.set(p.piece.nr, e);
    });
    $('wsParts').innerHTML = [...byNr.values()].sort((a, b) => a.nr - b.nr).map(e => `<li class="flex items-center gap-3 py-1.5 ${e.done === e.total ? 'opacity-50' : ''}">
        <span class="nr">${e.nr}</span><span class="num">${fmt(e.l)} × ${fmt(e.w)}</span><span class="muted truncate flex-1">${esc(e.name)}</span>
        <span class="num text-[12px] ${e.done === e.total ? '' : 'muted'}">${e.done === e.total ? '✓' : `${e.done}/${e.total}`}</span></li>`).join('');
}

export function initWorkshop() {
    $('wsClose').addEventListener('click', close);
    $('wsPrev').addEventListener('click', () => go(-1));
    $('wsNext').addEventListener('click', () => {
        const sh = ctx.sheets[ctx.idx];
        if (ctx.step < sh.steps.length - 1) return go(1);
        if (ctx.idx < ctx.sheets.length - 1) { ctx.idx++; ctx.step = loadProgress()[ctx.sheets[ctx.idx].key] ?? 0; render(); }
        else close();
    });
    $('wsRestart').addEventListener('click', () => { ctx.step = 0; saveProgress(); render(); });
    $('wsSheet').addEventListener('change', e => {
        ctx.idx = +e.target.value;
        const sh = ctx.sheets[ctx.idx];
        ctx.step = Math.min(loadProgress()[sh.key] ?? 0, sh.steps.length - 1);
        render();
    });
    document.addEventListener('keydown', e => {
        if (!ctx || $('workshop').hidden) return;
        if (e.target.closest?.('select')) return;
        if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button')) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); $('wsNext').click(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });
    window.addEventListener('resize', () => { if (ctx) render(); });
}

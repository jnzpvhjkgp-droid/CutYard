// Redigering av "Egen kaplista": en kortrad per del med antal, mått, skivtyp, kantlist per kant och ådring.
import { makeListRow } from './core.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EDGE_LABEL = { l1: 'Långsida 1', l2: 'Långsida 2', w1: 'Kortsida 1', w2: 'Kortsida 2' };

// Kantlistväljaren: en liten rektangel där varje kant är en knapp.
function edgePicker(r) {
    const btn = (k, cls) => `<button type="button" data-edge="${k}" aria-pressed="${r.edges[k]}" title="${EDGE_LABEL[k]}"
        aria-label="Kantlist på ${EDGE_LABEL[k].toLowerCase()}" class="edge-btn ${cls}"></button>`;
    return `<div class="edge-picker" role="group" aria-label="Kantlist">
        ${btn('l1', 'edge-top')}${btn('w1', 'edge-left')}<span class="edge-body" aria-hidden="true"></span>${btn('w2', 'edge-right')}${btn('l2', 'edge-bottom')}
    </div>`;
}

function rowCard(r, i) {
    // Enheten står i etiketten så att hela måttet får plats i de smala fälten
    const num = (col, label, unit, v, step = 'any', min = 0) => `<label class="min-w-0"><span class="lbl !mb-1">${label} <span class="faint">${unit}</span></span>
        <input type="number" class="fld !py-1.5 !px-2 num" data-col="${col}" value="${esc(v)}" min="${min}" step="${step}" inputmode="decimal"></label>`;
    return `<div class="rounded-lg p-3 space-y-2.5" style="background: var(--bg); border: 1px solid var(--line);" data-row="${esc(r.id)}">
        <div class="flex items-center gap-2">
            <span class="nr shrink-0">${i + 1}</span>
            <input type="text" class="fld !py-1.5 flex-1" data-col="name" value="${esc(r.name)}" maxlength="60" placeholder="Namn, t.ex. Sida" aria-label="Namn på del ${i + 1}">
            <button type="button" data-del-row class="muted hover:text-[var(--danger)] px-2 py-1" title="Ta bort delen" aria-label="Ta bort del ${i + 1}">✕</button>
        </div>
        <div class="grid grid-cols-4 gap-2">
            ${num('qty', 'Antal', 'st', r.qty, 1, 1)}${num('l', 'Längd', 'mm', r.l)}${num('w', 'Bredd', 'mm', r.w)}${num('t', 'Tjocklek', 'mm', r.t, 0.5)}
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <input type="text" class="fld !py-1.5 flex-1 min-w-[9rem]" data-col="mn" value="${esc(r.mn)}" list="matNames" maxlength="40" placeholder="Skivtyp (valfritt)" aria-label="Skivtyp för del ${i + 1}">
            <span class="flex items-center gap-2 text-[12px] muted">Kantlist ${edgePicker(r)}</span>
            <label class="inline-flex items-center gap-2 text-[12px] muted cursor-pointer" title="Delen vrids inte på skivan, så ådringen går längs längden">
                <span class="check-wrap"><input type="checkbox" class="check" data-col="grain"${r.grain ? ' checked' : ''}><svg class="check-mark" fill="none" stroke="currentColor" stroke-width="3.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></span>
                Ådring längs längden
            </label>
        </div>
    </div>`;
}

/**
 * Ritar redigeraren i `wrap` och kopplar händelser.
 * hooks: { changed(immediate), removeRow(id), addRow(), openPaste(), importFile() }
 */
export function renderListEditor(wrap, item, hooks) {
    const rows = item.params.rows;
    wrap.innerHTML = `<div class="space-y-2" data-rows>${rows.map(rowCard).join('')}</div>
        <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-line" data-add-row>+ Lägg till del</button>
            <button type="button" class="btn-quiet" data-paste>Klistra in från Excel</button>
            <button type="button" class="btn-quiet" data-import>Importera CSV-fil</button>
        </div>
        <p class="text-[12px] faint leading-relaxed">Kantlist: klicka på kanterna i den lilla rektangeln. Den långa sidan är längden. Kantlistens tjocklek dras av från måtten.</p>`;

    const rowOf = el => rows.find(r => r.id === el.closest('[data-row]')?.dataset.row);
    const update = (el, immediate) => {
        const r = rowOf(el);
        if (!r) return;
        const col = el.dataset.col;
        if (col === 'grain') r.grain = el.checked;
        else if (col === 'name' || col === 'mn') r[col] = el.value;
        else {
            const v = parseFloat(String(el.value).replace(',', '.'));
            if (!Number.isFinite(v) || v <= 0) return; // ogiltigt värde: behåll det gamla tills fältet är rätt
            r[col] = col === 'qty' ? Math.min(999, Math.max(1, Math.round(v))) : Math.min(10000, Math.round(v * 10) / 10);
        }
        hooks.changed(immediate);
    };
    wrap.addEventListener('input', e => { if (e.target.dataset.col) update(e.target, false); });
    wrap.addEventListener('change', e => { if (e.target.dataset.col) update(e.target, true); });
    wrap.addEventListener('click', e => {
        const edge = e.target.closest('[data-edge]');
        if (edge) {
            const r = rowOf(edge);
            r.edges[edge.dataset.edge] = !r.edges[edge.dataset.edge];
            edge.setAttribute('aria-pressed', r.edges[edge.dataset.edge]);
            hooks.changed(true);
            return;
        }
        if (e.target.closest('[data-del-row]')) { hooks.removeRow(rowOf(e.target).id); return; }
        if (e.target.closest('[data-add-row]')) { hooks.addRow(); return; }
        if (e.target.closest('[data-paste]')) { hooks.openPaste(); return; }
        if (e.target.closest('[data-import]')) hooks.importFile();
    });
}

// Ny rad ärver tjocklek och skivtyp från raden ovanför, det är oftast samma skiva.
export function nextRow(rows) {
    const last = rows[rows.length - 1];
    return makeListRow({ name: '', t: last?.t ?? 16, mn: last?.mn ?? '' });
}

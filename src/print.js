// Bygger en utskriftsvänlig version: kaplista, beslag, skärscheman, borrschema och etiketter med QR-kod.
import qrcode from '../vendor/qrcode.mjs';
import { fmt, fmtKr, matLabel, labelText } from './core.js';
import { sheetCanvas } from './draw.js';

// Å, Ä och Ö ska kodas som UTF-8 i QR-koden
qrcode.stringToBytes = s => Array.from(new TextEncoder().encode(s));

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}

export function buildPrint(el, { projectName, scopeLabel, col, opt, withLabels }) {
    const date = new Date().toLocaleDateString('sv-SE');
    const h = [];
    h.push(`<h1>${esc(projectName)}</h1><div>${esc(scopeLabel)} · ${date} · ${col.partCount} delar · ${opt.sheets} skivor · ${fmtKr(opt.totalCost)}${col.edgeMeters > 0 ? ` · kantlist ${fmt(col.edgeMeters * 1.1)} m` : ''}</div>`);

    h.push('<h2>Kaplista</h2><table><thead><tr><th>Nr</th><th>Antal</th><th>Längd</th><th>Bredd</th><th>Skiva</th><th>Del</th><th>Objekt</th></tr></thead><tbody>');
    col.rows.forEach(r => h.push(`<tr><td class="p-num"><b>${r.nr}</b></td><td class="p-num">${r.count}</td><td class="p-num">${fmt(r.l)}${r.lock ? ' ⇅' : ''}</td><td class="p-num">${fmt(r.w)}</td><td>${esc(matLabel(r.t, r.mn))}</td><td>${esc(r.names.join(', '))}</td><td>${esc(r.items.join(', '))}</td></tr>`));
    h.push('</tbody></table><div style="font-size:8pt;margin-top:1mm">Mått i mm. Kantlistens tjocklek är redan avdragen. ⇅ = delen får inte vändas, ådringen ska gå längs längden.</div>');

    if (col.hardware.length) {
        h.push('<h2>Beslag</h2><table><thead><tr><th>Produkt</th><th>Antal</th><th>Enhet</th></tr></thead><tbody>');
        col.hardware.forEach(x => h.push(`<tr><td>${esc(x.name)}</td><td class="p-num">${x.qty}</td><td>${esc(x.unit)}</td></tr>`));
        h.push('</tbody></table>');
    }
    if (col.tools?.length) {
        h.push('<h2>Fräsar</h2><table><thead><tr><th>Fräs</th><th>Används till</th><th>Objekt</th></tr></thead><tbody>');
        col.tools.forEach(t => h.push(`<tr><td>${esc(t.name)}</td><td>${esc(t.use)}</td><td>${esc(t.items.join(', '))}</td></tr>`));
        h.push('</tbody></table>');
    }
    if (col.drillings.length) {
        h.push('<h2>Borrschema gångjärn</h2><div style="font-size:8.5pt;margin-bottom:1mm">Kopphål Ø35 × 13 mm, centrum 22,5 mm från dörrkanten. Mått från dörrens överkant.</div><table><thead><tr><th>Objekt</th><th>Dörr</th><th>Antal</th><th>Dörrmått</th><th>Sida</th><th>Hål (mm)</th></tr></thead><tbody>');
        col.drillings.forEach(d => h.push(`<tr><td>${esc(d.item)}</td><td>${esc(d.door)}</td><td class="p-num">${d.count}</td><td class="p-num">${fmt(d.h)} × ${fmt(d.w)}</td><td>${esc(d.side)}</td><td class="p-num">${d.holes.map(fmt).join(' · ')}</td></tr>`));
        h.push('</tbody></table>');
    }

    h.push('<div class="p-break"></div><h2>Skärscheman</h2>');
    el.innerHTML = h.join('');
    opt.materials.forEach(r => {
        r.bins.forEach((b, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'p-sheet';
            const title = b.kind === 'offcut' ? `Spillbit ${fmt(b.L)} × ${fmt(b.W)} mm` : `Skiva ${i + 1} · ${fmt(b.L)} × ${fmt(b.W)} mm`;
            wrap.innerHTML = `<div style="font-weight:600;margin-bottom:1mm">${esc(matLabel(r.sheet.t, r.sheet.name))} – ${title} · ${Math.round(b.util * 100)} % nyttjat</div>`;
            const img = document.createElement('img');
            img.alt = title;
            img.src = sheetCanvas(b, 1600, 'light').toDataURL('image/png');
            wrap.appendChild(img);
            el.appendChild(wrap);
        });
    });

    if (withLabels) {
        const labels = document.createElement('div');
        labels.innerHTML = '<div class="p-break"></div><h2>Etiketter</h2>';
        const grid = document.createElement('div');
        grid.className = 'p-labels';
        const cells = [];
        col.rows.forEach(r => {
            const svg = qrSvg(labelText(r));
            for (let k = 0; k < r.count; k++) {
                cells.push(`<div class="p-label">${svg}<div><div class="nr">#${r.nr}</div><div class="dim">${fmt(r.l)} × ${fmt(r.w)} × ${fmt(r.t)}</div><div class="meta">${r.mn ? `${esc(r.mn)}<br>` : ''}${esc(r.names.join(', '))}<br>${esc(r.items.join(', '))}</div></div></div>`);
            }
        });
        grid.innerHTML = cells.join('');
        labels.appendChild(grid);
        el.appendChild(labels);
    }
}

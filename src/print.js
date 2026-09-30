// Bygger en utskriftsvänlig version: kaplista, beslag, skärscheman, borrschema och etiketter med QR-kod.
import qrcode from '../vendor/qrcode.mjs';
import { fmt, fmtKr, matLabel, boardLabel, labelText, edgeText } from './core.js';
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
    h.push(`<h1>${esc(projectName)}</h1><div>${esc(scopeLabel)} · ${date} · ${col.partCount} delar · ${opt.sheets} skivor${opt.boards ? ` · ${opt.boards} brädor virke` : ''} · ${fmtKr(opt.totalCost)}${col.edgeMeters > 0 ? ` · kantlist ${fmt(col.edgeMeters * 1.1)} m` : ''}</div>`);

    h.push('<h2>Kaplista</h2><table><thead><tr><th>Nr</th><th>Antal</th><th>Längd</th><th>Bredd</th><th>Skiva</th><th>Del</th><th>Objekt</th></tr></thead><tbody>');
    col.rows.forEach(r => h.push(`<tr><td class="p-num"><b>${r.nr}</b></td><td class="p-num">${r.count}</td><td class="p-num">${fmt(r.l)}${r.lock ? ' ⇅' : ''}</td><td class="p-num">${fmt(r.w)}</td><td>${esc(r.board ? `Virke ${boardLabel(r.t, r.w, r.mn)}` : matLabel(r.t, r.mn))}</td><td>${esc(r.names.join(', '))}</td><td>${esc(r.items.join(', '))}</td></tr>`));
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

    if (col.processing?.length) {
        h.push('<h2>Hyllhål och spår</h2><table><thead><tr><th>Objekt</th><th>Bearbetning</th><th>Delar</th><th>Antal ytor</th><th>Mått (mm)</th></tr></thead><tbody>');
        col.processing.forEach(p => h.push(p.kind === 'groove'
            ? `<tr><td>${esc(p.item)}</td><td>Spår för bakstycke</td><td>${esc(p.part)}</td><td class="p-num">${p.faces * p.count}</td><td>${fmt(p.width)} brett, ${fmt(p.depth)} djupt, ${fmt(p.inset)} från bakkant</td></tr>`
            : `<tr><td>${esc(p.item)}</td><td>Hyllhål Ø${p.dia} × ${p.depth}</td><td>${esc(p.part)}</td><td class="p-num">${p.faces * p.count}</td><td>Rader ${p.front} från framkant och ${fmt(p.rear)} från bakkant. Från underkant: ${p.holes.map(fmt).join(' · ')}</td></tr>`));
        h.push('</tbody></table>');
    }
    if (opt.linear?.length) {
        h.push('<h2>Virke</h2><table><thead><tr><th>Virke</th><th>Bräda</th><th>Delar i kaporder (nr: längd)</th><th>Rest</th></tr></thead><tbody>');
        opt.linear.forEach(r => r.bars.forEach((b, i) => h.push(`<tr><td>${esc(boardLabel(r.stock.t, r.stock.w, r.stock.name))}</td><td class="p-num">${i + 1} (${fmt(r.stock.L)})</td><td class="p-num">${b.cuts.map(c => `#${c.nr}: ${fmt(c.l)}`).join(' · ')}</td><td class="p-num">${fmt(b.left)}</td></tr>`)));
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

// Offert till kund
export function buildQuotePrint(el, { projectName, company, quote: q, result: r }) {
    const date = new Date();
    const valid = new Date(date.getTime() + q.validDays * 864e5);
    const d = x => x.toLocaleDateString('sv-SE');
    const h = [];
    h.push(`<div style="display:flex;justify-content:space-between;gap:10mm;align-items:flex-start">
        <div style="white-space:pre-line;font-size:9pt">${esc(company || '')}</div>
        <div style="text-align:right"><h1 style="margin:0">Offert</h1><div style="font-size:9pt">${q.reference ? `Nr ${esc(q.reference)}<br>` : ''}Datum ${d(date)}<br>Giltig t.o.m. ${d(valid)}</div></div>
    </div>`);
    h.push(`<div style="margin:8mm 0 4mm">${q.customer ? `<div style="font-size:9pt;color:#555">Till</div><div style="white-space:pre-line">${esc(q.customer)}</div>` : ''}
        <div style="margin-top:4mm"><b>Avser:</b> ${esc(projectName)}</div></div>`);
    const title = { material: 'Material', hardware: 'Beslag', labor: 'Arbete', extra: 'Övrigt' };
    h.push('<table><thead><tr><th>Beskrivning</th><th style="text-align:right">Antal</th><th>Enhet</th><th style="text-align:right">À-pris</th><th style="text-align:right">Summa</th></tr></thead><tbody>');
    let cur = '';
    // Kunden ser priser inklusive påslag, fördelat på material- och beslagsraderna
    const factor = r.goods ? (r.goods + r.markup) / r.goods : 1;
    r.lines.forEach(l => {
        if (l.group !== cur) { cur = l.group; h.push(`<tr><td colspan="5" style="background:#f4f4f4;font-weight:600">${title[l.group]}</td></tr>`); }
        const f = l.group === 'material' || l.group === 'hardware' ? factor : 1;
        h.push(`<tr><td>${esc(l.text)}</td><td class="p-num" style="text-align:right">${fmt(l.qty)}</td><td>${esc(l.unit)}</td><td class="p-num" style="text-align:right">${fmt(l.price * f)}</td><td class="p-num" style="text-align:right">${fmtKr(l.sum * f)}</td></tr>`);
    });
    h.push('</tbody></table>');
    const row = (a, b, strong) => `<tr><td style="border:0;text-align:right;${strong ? 'font-weight:700;font-size:11pt' : ''}">${a}</td><td class="p-num" style="border:0;text-align:right;width:35mm;${strong ? 'font-weight:700;font-size:11pt' : ''}">${b}</td></tr>`;
    h.push(`<table style="margin-top:3mm;width:auto;margin-left:auto">${row('Summa exkl. moms', fmtKr(r.net))}${row(`Moms ${fmt(q.vat)} %`, fmtKr(r.vat))}${row('Att betala', fmtKr(r.total), true)}</table>`);
    h.push(`<p style="font-size:8.5pt;margin-top:8mm;color:#444">Offerten gäller till och med ${d(valid)}. Priserna gäller för de mått och antal som anges ovan. Ändringar kan påverka priset.</p>`);
    el.innerHTML = h.join('');
}

// Beställning till kapservice
export function buildOrderPrint(el, { text, col, info, serviceName }) {
    const h = [];
    h.push(`<h1>Beställning av kapning</h1><div>${serviceName ? `Till: ${esc(serviceName)} · ` : ''}${new Date().toLocaleDateString('sv-SE')}</div>`);
    h.push(`<div style="margin:3mm 0">${[info.name && `Beställare: ${esc(info.name)}`, info.phone && `Telefon: ${esc(info.phone)}`, info.delivery === 'delivery' ? 'Leverans' : 'Hämtas i butik', info.note && esc(info.note)].filter(Boolean).join(' · ')}</div>`);
    h.push('<h2>Delar</h2><table><thead><tr><th>Nr</th><th>Antal</th><th>Längd</th><th>Bredd</th><th>Skiva</th><th>Kantlist</th><th>Ådring</th><th>Del</th></tr></thead><tbody>');
    col.rows.filter(r => !r.board).forEach(r => h.push(`<tr><td class="p-num"><b>${r.nr}</b></td><td class="p-num">${r.count}</td><td class="p-num">${fmt(r.l)}</td><td class="p-num">${fmt(r.w)}</td><td>${esc(matLabel(r.t, r.mn))}</td><td>${esc(edgeText(r) || '–')}</td><td>${r.lock ? 'längs längden' : ''}</td><td>${esc(r.names.join(', '))}</td></tr>`));
    h.push('</tbody></table><div style="font-size:8pt;margin-top:1mm">Mått i mm. Kantlistens tjocklek är redan avdragen.</div>');
    h.push(`<h2>Sammanfattning</h2><pre style="font-family:inherit;font-size:8.5pt;white-space:pre-wrap">${esc(text.split('\n\nKAPLISTA')[0])}</pre>`);
    el.innerHTML = h.join('');
}

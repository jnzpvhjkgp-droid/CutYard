// Export av skärscheman till SVG (för att visa eller skriva ut) och DXF (för CNC och CAD).
// Alla mått i mm. Skivorna läggs under varandra med 200 mm mellanrum.
import { fmt, matLabel } from './core.js';

const GAP = 200;
const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(opt) {
    const out = [];
    let y = 0;
    opt.materials.forEach(m => {
        let n = 0;
        m.bins.forEach(b => {
            const title = `${matLabel(m.sheet.t, m.sheet.name)} – ${b.kind === 'offcut' ? `spillbit ${fmt(b.L)} × ${fmt(b.W)}` : `skiva ${++n}, ${fmt(b.L)} × ${fmt(b.W)}`}`;
            out.push({ bin: b, title, y });
            y += b.W + GAP;
        });
    });
    return { sheets: out, height: Math.max(0, y - GAP), width: Math.max(0, ...out.map(s => s.bin.L)) };
}

export function sheetsSvg(opt, projectName = '') {
    const { sheets, height, width } = layout(opt);
    const top = 60;
    const el = [];
    sheets.forEach(({ bin, title, y }) => {
        const oy = y + top;
        el.push(`<text x="0" y="${oy - 20}" font-size="40" font-weight="600">${xmlEsc(title)}</text>`);
        el.push(`<rect x="0" y="${oy}" width="${bin.L}" height="${bin.W}" fill="#fff" stroke="#000" stroke-width="3"/>`);
        (bin.leftovers || []).forEach(f => {
            const w = f.swapped ? f.w : f.l, h = f.swapped ? f.l : f.w;
            el.push(`<rect x="${f.x}" y="${oy + f.y}" width="${w}" height="${h}" fill="none" stroke="#059669" stroke-width="2" stroke-dasharray="12 8"/>`);
        });
        bin.placements.forEach(p => {
            el.push(`<rect x="${p.x}" y="${oy + p.y}" width="${p.dl}" height="${p.dw}" fill="#eef2f7" stroke="#000" stroke-width="2"/>`);
            const fs = Math.max(14, Math.min(60, Math.min(p.dl, p.dw) * 0.3));
            el.push(`<text x="${p.x + p.dl / 2}" y="${oy + p.y + p.dw / 2}" font-size="${fs}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${p.piece.nr}</text>`);
            if (p.dl > 200 && p.dw > 90) el.push(`<text x="${p.x + p.dl / 2}" y="${oy + p.y + p.dw / 2 + fs}" font-size="24" text-anchor="middle" dominant-baseline="middle" fill="#333">${fmt(p.piece.l)} × ${fmt(p.piece.w)}</text>`);
        });
    });
    const h = height + top;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${h}mm" viewBox="0 0 ${width} ${h}" font-family="Helvetica, Arial, sans-serif">
<title>${xmlEsc(projectName || 'CutYard')} – skärscheman</title>
${el.join('\n')}
</svg>
`;
}

// DXF R12 med LINE och TEXT – det enklaste formatet som alla CAD- och CNC-program läser.
// DXF har y-axeln uppåt, så schemat vänds så att skiva 1 hamnar överst som på skärmen.
export function sheetsDxf(opt) {
    const { sheets, height } = layout(opt);
    const out = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '4'];
    for (const [name, color] of [['SKIVA', 7], ['DELAR', 5], ['SPILL', 3], ['TEXT', 7]]) out.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS');
    out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    const n = v => (Math.round(v * 100) / 100).toString();
    const line = (layer, x1, y1, x2, y2) => out.push('0', 'LINE', '8', layer, '10', n(x1), '20', n(y1), '30', '0', '11', n(x2), '21', n(y2), '31', '0');
    const rect = (layer, x, y, w, h) => { line(layer, x, y, x + w, y); line(layer, x + w, y, x + w, y + h); line(layer, x + w, y + h, x, y + h); line(layer, x, y + h, x, y); };
    const text = (x, y, h, s, center = false) => {
        // DXF R12 klarar inte alla tecken; byt ut de vanligaste
        const safe = String(s).replace(/×/g, 'x').replace(/–/g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '');
        out.push('0', 'TEXT', '8', 'TEXT', '10', n(x), '20', n(y), '30', '0', '40', n(h), '1', safe);
        if (center) out.push('72', '1', '73', '2', '11', n(x), '21', n(y), '31', '0');
    };
    sheets.forEach(({ bin, title, y }) => {
        const Y = v => height - (y + v); // vänd y
        rect('SKIVA', 0, Y(bin.W), bin.L, bin.W);
        text(0, Y(0) + 30, 40, title);
        (bin.leftovers || []).forEach(f => {
            const w = f.swapped ? f.w : f.l, h = f.swapped ? f.l : f.w;
            rect('SPILL', f.x, Y(f.y + h), w, h);
        });
        bin.placements.forEach(p => {
            rect('DELAR', p.x, Y(p.y + p.dw), p.dl, p.dw);
            const fs = Math.max(14, Math.min(60, Math.min(p.dl, p.dw) * 0.3));
            text(p.x + p.dl / 2, Y(p.y + p.dw / 2), fs, String(p.piece.nr), true);
        });
    });
    out.push('0', 'ENDSEC', '0', 'EOF');
    return out.join('\r\n') + '\r\n';
}

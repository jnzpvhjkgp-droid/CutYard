// Ritar ett skärschema på en canvas. Används både på skärmen (mörkt) och vid utskrift (ljust).
import { fmt } from './core.js';

const THEMES = {
    dark: { bg: '#1e1e1e', trim: 'rgba(255,255,255,0.06)', a: '#f59e0b', b: '#d97706', stroke: '#000', text: '#000', sub: 'rgba(0,0,0,0.7)', left: 'rgba(52,211,153,0.9)' },
    light: { bg: '#ffffff', trim: '#e5e5e5', a: '#f3f4f6', b: '#e5e7eb', stroke: '#000', text: '#000', sub: '#333', left: '#059669' }
};

export function drawSheet(canvas, bin, theme = 'dark') {
    const T = THEMES[theme];
    const ctx = canvas.getContext('2d');
    const s = canvas.width / bin.L;
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (bin.trim > 0) {
        ctx.fillStyle = T.trim;
        const t = bin.trim * s;
        ctx.fillRect(0, 0, canvas.width, t); ctx.fillRect(0, canvas.height - t, canvas.width, t);
        ctx.fillRect(0, 0, t, canvas.height); ctx.fillRect(canvas.width - t, 0, t, canvas.height);
    }
    // Spillbitar som är värda att spara
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = T.left; ctx.lineWidth = 1.5;
    ctx.font = "11px 'Inter', sans-serif"; ctx.fillStyle = T.left; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of bin.leftovers || []) {
        const w = (f.swapped ? f.w : f.l) * s, h = (f.swapped ? f.l : f.w) * s;
        ctx.strokeRect(f.x * s + 3, f.y * s + 3, w - 6, h - 6);
        if (w > 80 && h > 18) ctx.fillText(`spill ${fmt(f.l)}×${fmt(f.w)}`, f.x * s + w / 2, f.y * s + h / 2);
    }
    ctx.restore();

    for (const p of bin.placements) {
        const x = p.x * s, y = p.y * s, w = p.dl * s, h = p.dw * s;
        if (theme === 'dark') {
            const g = ctx.createLinearGradient(x, y, x + w, y + h);
            g.addColorStop(0, T.a); g.addColorStop(1, T.b);
            ctx.fillStyle = g;
        } else ctx.fillStyle = T.a;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = T.stroke; ctx.lineWidth = theme === 'dark' ? 1 : 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.fillStyle = T.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const nrSize = Math.max(10, Math.min(22, Math.min(w, h) * 0.35));
        if (w > 18 && h > 14) {
            const showDims = w > 70 && h > 34;
            ctx.font = `bold ${nrSize}px 'Inter', sans-serif`;
            ctx.fillText(String(p.piece.nr), x + w / 2, y + h / 2 - (showDims ? 8 : 0));
            if (showDims) {
                ctx.font = "11px 'JetBrains Mono', monospace"; ctx.fillStyle = T.sub;
                ctx.fillText(`${fmt(p.piece.l)}×${fmt(p.piece.w)}`, x + w / 2, y + h / 2 + 10);
            }
            if (p.rotated && w > 30 && h > 20) { ctx.font = "bold 11px 'Inter', sans-serif"; ctx.textAlign = 'right'; ctx.fillStyle = T.sub; ctx.fillText('↻', x + w - 4, y + 10); }
        }
    }
}

export function sheetCanvas(bin, width, theme) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * bin.W / bin.L);
    drawSheet(c, bin, theme);
    return c;
}

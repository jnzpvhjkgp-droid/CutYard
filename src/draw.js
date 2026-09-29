// Ritar ett skärschema på en canvas. Används både på skärmen (mörkt) och vid utskrift (ljust).
import { fmt } from './core.js';

const THEMES = {
    dark: { bg: '#0e131b', trim: 'rgba(255,255,255,0.04)', a: '#22324a', b: '#22324a', stroke: 'rgba(91,147,245,0.75)', text: '#e6e9ef', sub: '#8b93a3', left: 'rgba(95,191,154,0.8)' },
    light: { bg: '#ffffff', trim: '#e5e5e5', a: '#f3f4f6', b: '#e5e7eb', stroke: '#000', text: '#000', sub: '#333', left: '#059669' }
};

/**
 * opts (verkstadsläget): { done: Set(index), current: index, region: {x0,y0,x1,y1}, cut: {axis, at, region}, trim: bool }
 */
export function drawSheet(canvas, bin, theme = 'dark', opts = {}) {
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
        ctx.fillStyle = T.a;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = T.stroke; ctx.lineWidth = theme === 'dark' ? 1.25 : 1.5;
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
    if (opts.done || opts.cut || opts.region || opts.trim) drawWorkshop(ctx, bin, s, opts);
}

function drawWorkshop(ctx, bin, s, opts) {
    const R = r => [r.x0 * s, r.y0 * s, (r.x1 - r.x0) * s, (r.y1 - r.y0) * s];
    ctx.save();
    // Färdiga delar tonas gröna med en bock
    bin.placements.forEach((p, i) => {
        if (!opts.done?.has(i)) return;
        ctx.fillStyle = i === opts.current ? 'rgba(79,191,138,0.55)' : 'rgba(79,191,138,0.28)';
        ctx.fillRect(p.x * s, p.y * s, p.dl * s, p.dw * s);
        ctx.fillStyle = '#e6e9ef'; ctx.font = "bold 16px 'Inter', sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('✓', p.x * s + 5, p.y * s + 4);
    });
    if (opts.trim) {
        ctx.strokeStyle = '#ef6b6b'; ctx.lineWidth = Math.max(4, bin.trim * s);
        const h = ctx.lineWidth / 2;
        ctx.strokeRect(h, h, bin.L * s - 2 * h, bin.W * s - 2 * h);
    }
    // Biten man arbetar med just nu
    if (opts.region) {
        ctx.strokeStyle = '#5b93f5'; ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
        ctx.strokeRect(...R(opts.region));
        ctx.setLineDash([]);
    }
    // Snittet som ska sågas
    if (opts.cut) {
        const { axis, at, region: g } = opts.cut;
        ctx.strokeStyle = '#ef6b6b'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath();
        if (axis === 'y') { ctx.moveTo(g.x0 * s, at * s); ctx.lineTo(g.x1 * s, at * s); }
        else { ctx.moveTo(at * s, g.y0 * s); ctx.lineTo(at * s, g.y1 * s); }
        ctx.stroke();
    }
    ctx.restore();
}

export function sheetCanvas(bin, width, theme) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(width * bin.W / bin.L);
    drawSheet(c, bin, theme);
    return c;
}

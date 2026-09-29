// Principskisser (tvärsnitt) av ram- och fyllningsprofiler för shaker-dörrar.
// Stilesen ritas från ytterkanten (vänster) in mot fyllningen (höger). Inte skalenliga.
import { FRAME_PROFILES, PANEL_STYLES } from './core.js';

// Stilesens innerkant uppe vid framsidan (från x=10 till x=100, framsida y=15)
const STILE_EDGE = {
    square: 'H100 V30',
    'shaker-cope': 'H100 V30',
    bevel: 'H90 L100 25 V30',
    roundover: 'H90 A10 10 0 0 1 100 25 V30',
    ogee: 'H84 C90 15 90 20 92 20 C96 20 96 25 100 25 V30'
};
// Fyllningen. Tungan går in i spåret (y 31–41), fältet ligger till höger.
const PANEL = {
    flat: 'M82 31 H215 V41 H82 Z',
    'raised-bevel': 'M82 31 H108 L140 19 H215 V41 H82 Z',
    'raised-cove': 'M82 31 H108 Q112 19 140 19 H215 V41 H82 Z',
    'raised-ogee': 'M82 31 H106 C116 31 118 25 124 25 C130 25 132 19 140 19 H215 V41 H82 Z'
};

export function profileSvg(profile, panel) {
    const edge = STILE_EDGE[profile] || STILE_EDGE.square;
    const stile = `M10 15 ${edge} H80 V42 H100 V57 H10 Z`;
    const label = `${FRAME_PROFILES[profile]?.name || ''} ram, ${PANEL_STYLES[panel]?.name.toLowerCase() || ''} fyllning`;
    return `<svg viewBox="0 0 220 64" class="w-full h-auto block" role="img" aria-label="Tvärsnitt: ${label}">
        <path d="${PANEL[panel] || PANEL.flat}" fill="#8f806a" stroke="#0b0f15" stroke-width="1"/>
        <path d="${stile}" fill="#c9b79c" stroke="#0b0f15" stroke-width="1"/>
        <text x="12" y="63" font-size="7" fill="#8b93a3">Framsida uppåt · principskiss</text>
    </svg>`;
}

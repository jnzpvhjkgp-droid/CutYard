// Delningslänk: projektet komprimeras och läggs i adressens #-del. Allt efter # stannar i
// webbläsaren och skickas aldrig till servern, så länken kräver inget konto eller någon databas.
const PREFIX = 'p=';

const toB64Url = bytes => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = s => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
};
async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodeProject(data) {
    const json = new TextEncoder().encode(JSON.stringify(data));
    return PREFIX + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Returnerar projektdata från en #-del, eller null om den inte innehåller något projekt. */
export async function decodeProject(hash) {
    const h = String(hash || '').replace(/^#/, '');
    if (!h.startsWith(PREFIX)) return null;
    try {
        const bytes = await pipe(fromB64Url(h.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

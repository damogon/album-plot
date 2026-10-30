// ===============================
// AlbumPlot - Main Script
// ===============================

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const SITE_URL = "damogon.github.io/album-plot/";

const CARD_W = 540;                 // ancho de diseño de la tarjeta (px lógicos)
const EXPORT_W = 1080;              // ancho real de la imagen exportada
const ESCALA = EXPORT_W / CARD_W;   // 2
const ALTO_TARJETA = { square: CARD_W, story: Math.round(CARD_W * 16 / 9) }; // 540 y 960

let timerBusqueda;
let peticionArtista = 0; // para descartar respuestas antiguas
let peticionAlbum = 0;
let peticionPortada = 0;
let titulosActuales = []; // nombres de las canciones del álbum elegido
let notas = [];           // nota de cada canción (null = sin puntuar)
let indiceActual = 0;     // canción en foco (modo "una cada vez")
let timerAvance;
let pantallaActual = 1;   // 1 = buscar y puntuar, 2 = personalizar y ver el resultado
let formatoActual = 'square';   // 'square' | 'story'
let tipoGrafica = 'linea';      // 'linea' | 'barras' | 'curva'
let albumTitulo = 'Your Album';
let artistaNombre = 'Artist';
let portadaImg = null;    // portada cargada (con CORS) para dibujarla en la tarjeta

// DOM Elements
const inputArtista = document.getElementById('artista');
const dropdownArtistas = document.getElementById('dropdown-artistas');
const selectAlbumes = document.getElementById('albumes');
const msgCanciones = document.getElementById('msg-canciones');
const vistaUno = document.getElementById('vista-uno');
const focoNum = document.getElementById('foco-num');
const focoTitulo = document.getElementById('foco-titulo');
const focoNotas = document.getElementById('foco-notas');
const btnPistaAtras = document.getElementById('btn-pista-atras');
const btnPistaSiguiente = document.getElementById('btn-pista-siguiente');
const btnContinuar = document.getElementById('btn-continuar');
const btnDescargar = document.getElementById('btn-descargar');
const btnCompartir = document.getElementById('btn-compartir');
const btnBorrar = document.getElementById('btn-borrar');
const canvasTarjeta = document.getElementById('tarjeta');
const progresoFill = document.getElementById('progreso-fill');
const progresoTexto = document.getElementById('progreso-texto');
const contador = document.getElementById('contador');
const aviso = document.getElementById('aviso');
const estado = document.getElementById('estado');
const estadoTexto = document.getElementById('estado-texto');
const albumElegido = document.getElementById('album-elegido');
const coverElegido = document.getElementById('cover-elegido');
const aeTitulo = document.getElementById('ae-titulo');
const aeSub = document.getElementById('ae-sub');
const pantallas = [null,
    document.getElementById('pantalla-1'),
    document.getElementById('pantalla-2')];

// Cerrar el desplegable al hacer clic fuera
document.addEventListener('click', (e) => {
    if (!inputArtista.contains(e.target) && !dropdownArtistas.contains(e.target)) {
        dropdownArtistas.style.display = 'none';
    }
});

// ======================================================
// UTILIDADES
// ======================================================
// Placeholder de portada para el <img> del paso 2 (se genera con un canvas: PNG, no SVG)
function crearPlaceholder() {
    const c = document.createElement('canvas');
    c.width = c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#e9e0d5';
    x.fillRect(0, 0, 300, 300);
    x.fillStyle = '#6b625a';
    x.font = '24px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('No cover', 150, 150);
    return c.toDataURL('image/png');
}
const PLACEHOLDER_COVER = crearPlaceholder();

// Petición con tiempo máximo y reintentos automáticos si MusicBrainz está saturado (503/429).
// Opciones: intentos, timeoutMs y signal (para cancelarla desde fuera: una cancelación no se reintenta).
async function fetchJSON(url, { intentos = 3, timeoutMs = 12000, signal } = {}) {
    let ultimoError;
    for (let k = 0; k < intentos; k++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const ctrl = new AbortController();
        const alCancelar = () => ctrl.abort();
        signal?.addEventListener('abort', alCancelar, { once: true });
        const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
        let fatal = false;
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (res.ok) return await res.json();
            ultimoError = new Error(`HTTP ${res.status} en ${url}`);
            if (res.status !== 503 && res.status !== 429) {
                fatal = true;
                throw ultimoError;
            }
        } catch (err) {
            if (fatal || signal?.aborted) throw err; // error no recuperable o cancelada a propósito
            ultimoError = err; // tiempo agotado o fallo de red: se reintenta
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', alCancelar);
        }
        if (k < intentos - 1) await new Promise(r => setTimeout(r, 1000 * (k + 1)));
    }
    throw ultimoError;
}

function mostrarEstado(texto) {
    estadoTexto.textContent = texto;
    estado.hidden = false;
}

function ocultarEstado() {
    estado.hidden = true;
}

function recortar(texto, max) {
    return texto.length > max ? texto.slice(0, max - 1).trimEnd() + '…' : texto;
}

function notasPuntuadas() {
    return notas.filter(v => v !== null);
}

function todasPuntuadas() {
    return titulosActuales.length > 0 &&
           notas.length === titulosActuales.length &&
           notas.every(v => v !== null);
}

function calcularMedia() {
    const v = notasPuntuadas();
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function nombreArchivo() {
    return `${albumTitulo.replace(/[^a-z0-9]/gi, '_')}_albumplot.png`;
}

function mostrarAviso(texto) {
    aviso.textContent = texto || '';
}

// ======================================================
// TINTES DEL COLOR DE ACENTO (colores sólidos, sin color-mix)
// ======================================================
function hexARgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Mezcla: pct de A + (1 - pct) de B
function mezclar(hexA, hexB, pct) {
    const a = hexARgb(hexA), b = hexARgb(hexB);
    return '#' + a.map((v, i) => Math.round(v * pct + b[i] * (1 - pct)).toString(16).padStart(2, '0')).join('');
}

function aplicarTintes() {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const c = css.getPropertyValue('--c').trim();
    const bg = css.getPropertyValue('--bg').trim();
    const line = css.getPropertyValue('--line').trim();
    root.style.setProperty('--tinte-fondo', mezclar(c, bg, 0.14));
    root.style.setProperty('--tinte-borde', mezclar(c, line, 0.45));
    root.style.setProperty('--tinte-hover', mezclar(c, '#ffffff', 0.30));
}

// ======================================================
// PANTALLAS (1: buscar y puntuar · 2: personalizar y ver el resultado)
// ======================================================
function irAPantalla(n, registrar = true) {
    if (n > 1 && !todasPuntuadas()) n = 1; // no se puede avanzar sin puntuar todo
    const cambia = n !== pantallaActual;
    pantallaActual = n;

    pantallas.forEach((p, i) => { if (p) p.hidden = (i !== n); });
    clearTimeout(timerAvance);
    mostrarAviso('');

    if (registrar && cambia) history.pushState({ pantalla: n }, '');
    window.scrollTo(0, 0);

    if (n === 1) refrescarPreview();
    if (n === 2) {
        redibujarTarjeta();
        // Si las fuentes de Google aún no estaban listas, se vuelve a dibujar cuando lo estén
        asegurarFuentes().then(() => { if (pantallaActual === 2) redibujarTarjeta(); });
    }
}

// El botón "atrás" del navegador / del móvil también vuelve a la pantalla anterior
history.replaceState({ pantalla: 1 }, '');
window.addEventListener('popstate', (e) => irAPantalla(e.state?.pantalla || 1, false));

// Cualquier botón con data-ir="N" lleva a esa pantalla
document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]');
    if (b && !b.disabled) irAPantalla(Number(b.dataset.ir));
});

function asegurarFuentes() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
        document.fonts.load("700 24px Oswald"),
        document.fonts.load("600 16px Oswald"),
        document.fonts.load("700 16px Nunito")
    ]).catch(() => {});
}

// ======================================================
// DIBUJO: utilidades de canvas
// ======================================================
function rutaRedondeada(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Barra con las esquinas superiores redondeadas
function rutaBarra(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
}

// Texto con separación entre letras (canvas.letterSpacing no está en todos los navegadores)
function anchoEspaciado(ctx, texto, espacio) {
    let w = 0;
    for (const ch of texto) w += ctx.measureText(ch).width + espacio;
    return Math.max(0, w - espacio);
}

function textoEspaciado(ctx, texto, x, cy, espacio, alinear = 'center') {
    const total = anchoEspaciado(ctx, texto, espacio);
    let cx = alinear === 'center' ? x - total / 2 : x;
    const prev = ctx.textAlign;
    ctx.textAlign = 'left';
    for (const ch of texto) {
        ctx.fillText(ch, cx, cy);
        cx += ctx.measureText(ch).width + espacio;
    }
    ctx.textAlign = prev;
    return total;
}

// Parte un texto en líneas que quepan en maxW (corta palabras demasiado largas)
function partirLineas(ctx, texto, maxW) {
    const palabras = texto.split(/\s+/).filter(Boolean);
    const lineas = [];
    let actual = '';
    palabras.forEach(p => {
        if (ctx.measureText(p).width > maxW) {
            if (actual) { lineas.push(actual); actual = ''; }
            let trozo = '';
            for (const ch of p) {
                if (trozo && ctx.measureText(trozo + ch).width > maxW) { lineas.push(trozo); trozo = ch; }
                else trozo += ch;
            }
            actual = trozo;
            return;
        }
        const prueba = actual ? `${actual} ${p}` : p;
        if (actual && ctx.measureText(prueba).width > maxW) { lineas.push(actual); actual = p; }
        else actual = prueba;
    });
    if (actual) lineas.push(actual);
    return lineas;
}

// Ajusta el tamaño de fuente hasta que el texto quepa en maxLineas; si no, recorta con "…"
function ajustarTexto(ctx, texto, fuente, tamBase, tamMin, maxW, maxLineas) {
    let tam = tamBase, lineas;
    for (; tam >= tamMin; tam -= 2) {
        ctx.font = fuente(tam);
        lineas = partirLineas(ctx, texto, maxW);
        if (lineas.length <= maxLineas) return { lineas, tam };
    }
    tam = tamMin;
    ctx.font = fuente(tam);
    lineas = partirLineas(ctx, texto, maxW).slice(0, maxLineas);
    let ultima = lineas[maxLineas - 1];
    while (ultima.length > 1 && ctx.measureText(ultima + '…').width > maxW) ultima = ultima.slice(0, -1);
    lineas[maxLineas - 1] = ultima.trimEnd() + '…';
    return { lineas, tam };
}

function recortarAncho(ctx, texto, maxW) {
    if (ctx.measureText(texto).width <= maxW) return texto;
    let t = texto;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
}

// ======================================================
// DIBUJO: geometría para colocar las etiquetas sin que nada las tape
// ======================================================
// ¿El segmento s corta el rectángulo r? (Liang–Barsky)
function rectCortaSegmento(r, s) {
    let t0 = 0, t1 = 1;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const p = [-dx, dx, -dy, dy];
    const q = [s.x1 - r.x, r.x + r.w - s.x1, s.y1 - r.y, r.y + r.h - s.y1];
    for (let k = 0; k < 4; k++) {
        if (p[k] === 0) {
            if (q[k] < 0) return false;
        } else {
            const t = q[k] / p[k];
            if (p[k] < 0) {
                if (t > t1) return false;
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return false;
                if (t < t1) t1 = t;
            }
        }
    }
    return true;
}

function circuloToca(r, cx, cy, rad) {
    const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
    const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
    return (nx - cx) ** 2 + (ny - cy) ** 2 < rad * rad;
}

function rectsSolapan(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inflar(r, d) {
    return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

// Tangentes de una interpolación cúbica monótona (Fritsch–Carlson):
// la curva suave nunca se sale del rango de las notas (no baja de 0 ni pasa de 10)
function tangentesMonotonas(pts) {
    const n = pts.length;
    const d = [], m = new Array(n).fill(0);
    for (let k = 0; k < n - 1; k++) d[k] = (pts[k + 1].y - pts[k].y) / (pts[k + 1].x - pts[k].x);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
    for (let k = 0; k < n - 1; k++) {
        if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue; }
        const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
        if (s > 9) {
            const t = 3 / Math.sqrt(s);
            m[k] = t * a * d[k];
            m[k + 1] = t * b * d[k];
        }
    }
    return m;
}

// ======================================================
// DIBUJO: la gráfica (línea, barras o curva suave) dentro de un área de la tarjeta
// ======================================================
function dibujarGraficaEn(ctx, ox, oy, W, H, col) {
    const { ink, lineCol, muted, accent } = col;

    ctx.save();
    ctx.translate(ox, oy);

    const n = titulosActuales.length;
    const m = { l: 34, r: 22, t: 30, b: 40 };
    const PAD = 16;   // separación entre el eje Y y la primera nota (y entre la última y el borde)
    const R = 6;      // radio de los puntos
    const titulos = titulosActuales.map(t => recortar(t, 20));
    let tam = 12;

    const posX = (i, pw) => n === 1
        ? m.l + pw / 2
        : m.l + PAD + (pw - 2 * PAD) * i / (n - 1);

    // Márgenes según el texto real de los títulos (en diagonal, anclados a la derecha)
    if (n > 0) {
        for (let it = 0; it < 3; it++) {
            const pw0 = W - m.l - m.r;
            const paso0 = n > 1 ? (pw0 - 2 * PAD) / (n - 1) : pw0;
            tam = Math.max(9, Math.min(13, paso0 * 0.7));
            ctx.font = `700 ${tam}px 'Nunito', sans-serif`;

            let deficit = 0;
            titulos.forEach((t, i) => {
                const w = ctx.measureText(t).width;
                deficit = Math.max(deficit, w * Math.SQRT1_2 + tam * 0.4 - posX(i, pw0));
            });
            if (deficit > 0) m.l = Math.min(W * 0.35, m.l + deficit);
        }
        ctx.font = `700 ${tam}px 'Nunito', sans-serif`;
        const maxW = Math.max(...titulos.map(t => ctx.measureText(t).width));
        m.b = Math.min(H * 0.55, maxW * Math.SQRT1_2 + tam * 0.8 + 24);
    }

    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const xAt = i => posX(i, pw);
    const yAt = v => m.t + ph * (1 - v / 10);
    const yEje = m.t + ph;

    // Rejilla horizontal y eje Y (0 a 10)
    ctx.font = "600 12px 'Oswald', sans-serif";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= 10; v++) {
        const y = yAt(v);
        ctx.strokeStyle = v === 0 ? ink : lineCol;
        ctx.lineWidth = v === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(m.l, y);
        ctx.lineTo(W - m.r, y);
        ctx.stroke();
        ctx.fillStyle = muted;
        ctx.fillText(String(v), m.l - 8, y);
    }

    // Eje vertical
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.l, m.t);
    ctx.lineTo(m.l, yEje);
    ctx.stroke();

    if (n === 0) { ctx.restore(); return; }

    // Eje X: marcas y nombres de canción en diagonal
    ctx.font = `700 ${tam}px 'Nunito', sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    titulos.forEach((titulo, i) => {
        const x = xAt(i);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, yEje);
        ctx.lineTo(x, yEje + 5);
        ctx.stroke();

        ctx.save();
        ctx.translate(x + 3, yEje + 12);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = notas[i] === null ? muted : ink;
        ctx.fillText(titulo, 0, 0);
        ctx.restore();
    });

    // Puntos puntuados (se unen en orden, saltando los vacíos)
    const puntos = [];
    notas.forEach((v, i) => { if (v !== null) puntos.push({ x: xAt(i), y: yAt(v), v }); });
    if (puntos.length === 0) { ctx.restore(); return; }

    const ETQ_H = 14;
    const etiqueta = (texto, cx, cy) => {
        ctx.font = "600 14px 'Oswald', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fff'; // halo blanco: se lee aunque pase una línea de la rejilla por detrás
        ctx.strokeText(texto, cx, cy);
        ctx.fillStyle = ink;
        ctx.fillText(texto, cx, cy);
    };

    // ---------------- BARRAS ----------------
    if (tipoGrafica === 'barras') {
        const paso = n > 1 ? (pw - 2 * PAD) / (n - 1) : pw / 2;
        const bw = Math.max(6, Math.min(36, paso * 0.62));
        puntos.forEach(p => {
            const alto = Math.max(3, yEje - p.y);
            ctx.fillStyle = accent;
            ctx.strokeStyle = ink;
            ctx.lineWidth = 2;
            rutaBarra(ctx, p.x - bw / 2, yEje - alto, bw, alto, 4);
            ctx.fill();
            ctx.stroke();
        });
        puntos.forEach(p => etiqueta(String(p.v), p.x, Math.min(p.y, yEje - 3) - 11));
        ctx.restore();
        return;
    }

    // ---------------- LÍNEA / CURVA SUAVE ----------------
    // Líneas verticales de puntos: unen cada nota con el título de su canción
    ctx.save();
    ctx.strokeStyle = muted;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([0.1, 6]); // con extremo redondo, esto dibuja puntos
    puntos.forEach(p => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + 8);
        ctx.lineTo(p.x, yEje);
        ctx.stroke();
    });
    ctx.restore();

    // Trazo (y, para colocar etiquetas, el mismo trazo en forma de segmentos)
    const segmentos = [];
    if (puntos.length > 1) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(puntos[0].x, puntos[0].y);

        if (tipoGrafica === 'curva') {
            const tg = tangentesMonotonas(puntos);
            for (let k = 0; k < puntos.length - 1; k++) {
                const p0 = puntos[k], p1 = puntos[k + 1], h = p1.x - p0.x;
                const c1x = p0.x + h / 3, c1y = p0.y + tg[k] * h / 3;
                const c2x = p1.x - h / 3, c2y = p1.y - tg[k + 1] * h / 3;
                ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p1.x, p1.y);

                let px = p0.x, py = p0.y;
                for (let s = 1; s <= 12; s++) {
                    const u = s / 12, v = 1 - u;
                    const x = v ** 3 * p0.x + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u ** 3 * p1.x;
                    const y = v ** 3 * p0.y + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u ** 3 * p1.y;
                    segmentos.push({ x1: px, y1: py, x2: x, y2: y });
                    px = x; py = y;
                }
            }
        } else {
            for (let k = 1; k < puntos.length; k++) {
                ctx.lineTo(puntos[k].x, puntos[k].y);
                segmentos.push({ x1: puntos[k - 1].x, y1: puntos[k - 1].y, x2: puntos[k].x, y2: puntos[k].y });
            }
        }
        ctx.stroke();
    }

    // Puntos
    puntos.forEach(p => {
        ctx.fillStyle = accent;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    // Etiquetas con el valor: se colocan donde no las cruce ninguna línea
    ctx.font = "600 14px 'Oswald', sans-serif";
    const colocadas = [];
    puntos.forEach((p, idx) => {
        const texto = String(p.v);
        const w = ctx.measureText(texto).width;
        const h2 = ETQ_H / 2;
        const v = R + 3 + h2;           // desplazamiento vertical (arriba / abajo)
        const hz = w / 2 + R + 4;       // desplazamiento horizontal (izquierda / derecha)
        const dg = w / 2 + R + 2;       // desplazamiento horizontal de las diagonales

        // Orden de preferencia: arriba, abajo, derecha, izquierda y diagonales
        const candidatos = [
            { dx: 0, dy: -v }, { dx: 0, dy: v },
            { dx: hz, dy: 0 }, { dx: -hz, dy: 0 },
            { dx: dg, dy: -(R + h2) }, { dx: -dg, dy: -(R + h2) },
            { dx: dg, dy: R + h2 }, { dx: -dg, dy: R + h2 }
        ];

        const lineaPuntos = { x1: p.x, y1: p.y + 8, x2: p.x, y2: yEje };

        let mejor = null;
        candidatos.forEach(c => {
            const cx = p.x + c.dx, cy = p.y + c.dy;
            const r = { x: cx - w / 2, y: cy - h2, w, h: ETQ_H };
            const rr = inflar(r, 2);

            let score = 0;
            if (r.x < 0 || r.x + r.w > W || r.y < 0) score += 100;   // fuera del área
            if (r.y + r.h > yEje + 1) score += 100;                  // por debajo del eje X
            if (r.x < m.l + 2) score += 6;                           // pisa el eje Y
            segmentos.forEach(s => { if (rectCortaSegmento(rr, s)) score += 10; });
            puntos.forEach(q => { if (circuloToca(rr, q.x, q.y, R + 1)) score += 10; });
            colocadas.forEach(o => { if (rectsSolapan(rr, o)) score += 10; });
            if (rectCortaSegmento(rr, lineaPuntos)) score += 3;      // la línea de puntos: penalización suave

            if (!mejor || score < mejor.score) mejor = { score, cx, cy, rect: rr };
        });

        colocadas.push(mejor.rect);
        etiqueta(texto, mejor.cx, mejor.cy);
    });

    ctx.restore();
}

// ======================================================
// DIBUJO: la tarjeta completa (es lo que se ve en pantalla Y lo que se descarga)
// ======================================================
function dibujarMarca(ctx, cx, top, tam, col) {
    const alto = Math.round(tam * 1.3);
    const espacio = tam * 0.04;
    ctx.font = `700 ${tam}px 'Oswald', sans-serif`;
    ctx.textBaseline = 'middle';
    const wAlbum = anchoEspaciado(ctx, 'ALBUM', espacio);
    const wPlot = anchoEspaciado(ctx, 'PLOT', espacio);
    const wPildora = wPlot + 12;
    const x0 = cx - (wAlbum + wPlot + 12) / 2;
    const cy = top + alto / 2 + 0.5;

    ctx.fillStyle = col.ink;
    textoEspaciado(ctx, 'ALBUM', x0, cy, espacio, 'left');

    ctx.fillStyle = col.accent;
    rutaRedondeada(ctx, x0 + wAlbum, top, wPildora, alto, 6);
    ctx.fill();
    ctx.fillStyle = col.ink;
    textoEspaciado(ctx, 'PLOT', x0 + wAlbum + 6, cy, espacio, 'left');
    return top + alto;
}

function dibujarPortada(ctx, x, y, tam, col) {
    const radio = Math.round(tam * 0.1);
    ctx.save();
    rutaRedondeada(ctx, x, y, tam, tam, radio);
    ctx.clip();
    if (portadaImg) {
        // equivalente a object-fit: cover
        const iw = portadaImg.naturalWidth, ih = portadaImg.naturalHeight;
        const lado = Math.min(iw, ih);
        ctx.drawImage(portadaImg, (iw - lado) / 2, (ih - lado) / 2, lado, lado, x, y, tam, tam);
    } else {
        ctx.fillStyle = col.lineCol;
        ctx.fillRect(x, y, tam, tam);
        ctx.fillStyle = col.muted;
        ctx.font = `700 ${Math.max(11, Math.round(tam * 0.13))}px 'Nunito', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No cover', x + tam / 2, y + tam / 2);
    }
    ctx.restore();
    rutaRedondeada(ctx, x, y, tam, tam, radio);
    ctx.lineWidth = 2;
    ctx.strokeStyle = col.lineCol;
    ctx.stroke();
}

function dibujarInsignia(ctx, cx, cy, media, col) {
    const r = 42;
    ctx.fillStyle = col.ink;                       // sombra
    ctx.beginPath(); ctx.arc(cx, cy + 4, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();   // borde
    ctx.fillStyle = col.accent;
    ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = col.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "700 32px 'Oswald', sans-serif";
    ctx.fillText(media === null ? '–' : media.toFixed(1), cx, cy - 6);
    ctx.font = "600 11px 'Oswald', sans-serif";
    textoEspaciado(ctx, 'AVG', cx, cy + 17, 1.3);
}

function dibujarTarjeta() {
    const W = CARD_W;
    const H = ALTO_TARJETA[formatoActual];
    const story = formatoActual === 'story';
    const pad = 24;

    canvasTarjeta.width = EXPORT_W;
    canvasTarjeta.height = H * ESCALA;

    const ctx = canvasTarjeta.getContext('2d');
    ctx.setTransform(ESCALA, 0, 0, ESCALA, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    const col = { ink: v('--ink'), lineCol: v('--line'), muted: v('--muted'), accent: v('--c') };

    // Marca
    const marcaBase = dibujarMarca(ctx, W / 2, story ? 56 : 24, story ? 26 : 22, col);

    // Nota media (esquina superior derecha)
    dibujarInsignia(ctx, W - 16 - 42, (story ? 48 : 16) + 42, calcularMedia(), col);

    // Cabecera: portada + título + artista
    let yFinCabecera;
    ctx.textBaseline = 'alphabetic';
    if (!story) {
        const top = marcaBase + 14, cover = 124, xTxt = pad + cover + 18;
        const maxW = W - pad - 96 - xTxt;
        dibujarPortada(ctx, pad, top, cover, col);

        const fuenteTitulo = t => `700 ${t}px 'Oswald', sans-serif`;
        const tit = ajustarTexto(ctx, albumTitulo.toUpperCase(), fuenteTitulo, 24, 16, maxW, 3);
        ctx.font = "700 16px 'Nunito', sans-serif";
        const art = recortarAncho(ctx, artistaNombre, maxW);

        const lh = Math.round(tit.tam * 1.15);
        const bloque = tit.lineas.length * lh + 6 + 20;
        let y = top + Math.max(0, (cover - bloque) / 2);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = col.ink;
        ctx.font = fuenteTitulo(tit.tam);
        tit.lineas.forEach((l, i) => ctx.fillText(l, xTxt, y + i * lh));
        ctx.fillStyle = col.muted;
        ctx.font = "700 16px 'Nunito', sans-serif";
        ctx.fillText(art, xTxt, y + tit.lineas.length * lh + 6);

        yFinCabecera = top + Math.max(cover, bloque) + 12;
    } else {
        const top = marcaBase + 18, cover = 250;
        dibujarPortada(ctx, (W - cover) / 2, top, cover, col);

        const maxW = W - 2 * pad - 16;
        const fuenteTitulo = t => `700 ${t}px 'Oswald', sans-serif`;
        const tit = ajustarTexto(ctx, albumTitulo.toUpperCase(), fuenteTitulo, 30, 20, maxW, 3);
        const lh = Math.round(tit.tam * 1.15);
        let y = top + cover + 14;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = col.ink;
        ctx.font = fuenteTitulo(tit.tam);
        tit.lineas.forEach((l, i) => ctx.fillText(l, W / 2, y + i * lh));
        y += tit.lineas.length * lh + 6;

        ctx.fillStyle = col.muted;
        ctx.font = "700 16px 'Nunito', sans-serif";
        ctx.fillText(recortarAncho(ctx, artistaNombre, maxW), W / 2, y);

        yFinCabecera = y + 20 + 16;
    }

    // Separador discontinuo en el color de acento
    ctx.save();
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pad, yFinCabecera);
    ctx.lineTo(W - pad, yFinCabecera);
    ctx.stroke();
    ctx.restore();

    // Marca de agua
    const yMarcaAgua = H - (story ? 40 : 16) - 6;
    ctx.fillStyle = col.muted;
    ctx.textBaseline = 'middle';
    ctx.font = "700 11px 'Nunito', sans-serif";
    textoEspaciado(ctx, `MADE AT: ${SITE_URL}`, W / 2, yMarcaAgua, 0.55);

    // Gráfica en el espacio que queda
    const yGraf = yFinCabecera + 10;
    const hGraf = (yMarcaAgua - 14) - yGraf;
    dibujarGraficaEn(ctx, pad, yGraf, W - 2 * pad, hGraf, col);
}

function redibujarTarjeta() {
    if (pantallaActual !== 2) return;
    dibujarTarjeta();
    invalidarImagen();
}

// ======================================================
// ENTRADA DE NOTAS: vistas, progreso y estado de los botones
// ======================================================
function actualizarProgreso() {
    const total = titulosActuales.length;
    const hechas = notasPuntuadas().length;

    progresoFill.style.width = total ? `${(hechas / total) * 100}%` : '0%';
    contador.textContent = total ? `${hechas}/${total}` : '';

    if (total === 0) {
        progresoTexto.textContent = 'Select an album to start rating.';
    } else if (hechas < total) {
        progresoTexto.textContent = `${hechas} of ${total} tracks rated. Rate all tracks to continue.`;
    } else {
        progresoTexto.textContent = 'All tracks rated. Ready to continue!';
    }
}

function refrescarPreview() {
    actualizarEntrada();
    actualizarProgreso();

    const lista = todasPuntuadas();
    btnContinuar.disabled = !lista;
    btnDescargar.disabled = !lista;
    btnCompartir.disabled = !lista;
    btnBorrar.disabled = notasPuntuadas().length === 0;

    redibujarTarjeta(); // solo hace algo si se está viendo la pantalla 2
}

function mensajeCanciones(texto, cargando = false, reintentar = null) {
    msgCanciones.innerHTML = '';
    if (cargando) {
        const sp = document.createElement('span');
        sp.className = 'spinner';
        sp.setAttribute('aria-hidden', 'true');
        msgCanciones.appendChild(sp);
    }
    msgCanciones.appendChild(document.createTextNode(texto));
    if (reintentar) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = 'Try again';
        b.addEventListener('click', reintentar);
        msgCanciones.appendChild(b);
    }
    actualizarVistas();
}

function actualizarVistas() {
    const hay = titulosActuales.length > 0;
    msgCanciones.hidden = hay;
    vistaUno.hidden = !hay;
}

function actualizarEntrada() {
    renderFoco();
}

// ---------- Puntuar: una canción cada vez ----------
function crearBotonesFoco() {
    for (let v = 0; v <= 10; v++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nota-btn';
        btn.dataset.v = v;
        btn.textContent = v;
        btn.setAttribute('aria-pressed', 'false');
        focoNotas.appendChild(btn);
    }
}

function renderFoco() {
    const n = titulosActuales.length;
    if (n === 0) return;
    const i = indiceActual;

    focoNum.textContent = `Track ${i + 1} of ${n}`;
    focoTitulo.textContent = titulosActuales[i];

    focoNotas.querySelectorAll('.nota-btn').forEach(btn => {
        const activo = notas[i] === Number(btn.dataset.v);
        btn.classList.toggle('sel', activo);
        btn.setAttribute('aria-pressed', String(activo));
        btn.setAttribute('aria-label', `${btn.dataset.v} for ${titulosActuales[i]}`);
    });

    const ultima = i === n - 1;
    btnPistaAtras.disabled = i === 0;
    if (ultima && todasPuntuadas()) {
        btnPistaSiguiente.textContent = 'Continue →';
        btnPistaSiguiente.disabled = false;
    } else {
        btnPistaSiguiente.textContent = 'Next →';
        btnPistaSiguiente.disabled = ultima;
    }
}

function irA(i) {
    const n = titulosActuales.length;
    if (n === 0) return;
    clearTimeout(timerAvance);
    indiceActual = Math.max(0, Math.min(n - 1, i));
    actualizarEntrada();
}

// Tras puntuar: pasa a la siguiente canción; si era la última, a la primera sin puntuar
function siguienteDestino(i) {
    if (i < titulosActuales.length - 1) return i + 1;
    return notas.findIndex(v => v === null);
}

focoNotas.addEventListener('click', (e) => {
    const btn = e.target.closest('.nota-btn');
    if (!btn) return;

    const i = indiceActual;
    const v = Number(btn.dataset.v);
    clearTimeout(timerAvance);
    mostrarAviso('');

    if (notas[i] === v) {
        notas[i] = null; // tocar la misma nota la quita
    } else {
        notas[i] = v;
        const destino = siguienteDestino(i);
        if (destino !== -1) {
            // pequeña pausa para que se vea la nota seleccionada antes de avanzar
            timerAvance = setTimeout(() => { if (indiceActual === i) irA(destino); }, 280);
        }
    }
    refrescarPreview();
});

btnPistaAtras.addEventListener('click', () => irA(indiceActual - 1));

btnPistaSiguiente.addEventListener('click', () => {
    const ultima = indiceActual === titulosActuales.length - 1;
    if (ultima && todasPuntuadas()) irAPantalla(2);
    else irA(indiceActual + 1);
});

// Borrar todas las notas
btnBorrar.addEventListener('click', () => {
    clearTimeout(timerAvance);
    notas = notas.map(() => null);
    indiceActual = 0;
    mostrarAviso('');
    refrescarPreview();
});

crearBotonesFoco();

// ======================================================
// COLOR DE ACENTO, FORMATO Y TIPO DE GRÁFICA
// ======================================================
function aplicarColor(valor, swatchActivo) {
    document.documentElement.style.setProperty('--c', valor);
    aplicarTintes();
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s === swatchActivo));
    refrescarPreview();
}

document.getElementById('swatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (sw) aplicarColor(sw.dataset.color, sw);
});

document.getElementById('btn-random').addEventListener('click', () => {
    const swatches = Array.from(document.querySelectorAll('.swatch'));
    const actual = getComputedStyle(document.documentElement).getPropertyValue('--c').trim();
    const opciones = swatches.filter(s => s.dataset.color !== actual);
    const elegido = opciones[Math.floor(Math.random() * opciones.length)];
    aplicarColor(elegido.dataset.color, elegido);
});

document.getElementById('formatos').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    formatoActual = btn.dataset.fmt;
    document.querySelectorAll('#formatos .seg').forEach(s => s.classList.toggle('sel', s === btn));
    redibujarTarjeta();
});

document.getElementById('tipos-grafica').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    tipoGrafica = btn.dataset.grafica;
    document.querySelectorAll('#tipos-grafica .seg').forEach(s => s.classList.toggle('sel', s === btn));
    redibujarTarjeta();
});

// ======================================================
// 1. AUTOCOMPLETADO DE ARTISTAS
// ======================================================
// Artistas "de propósito especial" de MusicBrainz (recopilatorios, desconocidos...):
// no tienen álbumes de estudio, así que se ocultan. Se filtra por nombre exacto.
const ARTISTAS_ESPECIALES = new Set([
    "various artists", "[unknown]", "[anonymous]", "[no artist]",
    "[dialogue]", "[traditional]", "[data]"
]);
const MAX_ARTISTAS = 8;

function filtrarArtistas(lista) {
    return lista
        .filter(a => !ARTISTAS_ESPECIALES.has((a.name || '').trim().toLowerCase()))
        .slice(0, MAX_ARTISTAS);
}

const cacheArtistas = new Map(); // búsqueda -> artistas ya filtrados (repetir una búsqueda es instantáneo)
let controlBusqueda = null;      // para cancelar la petición anterior al seguir escribiendo

function mostrarMensajeDropdown(texto) {
    dropdownArtistas.innerHTML = '';
    const msg = document.createElement('div');
    msg.textContent = texto;
    msg.style.cssText =
        "padding:12px 16px;font-size:16px;color:var(--muted);font-style:italic;font-family:'Nunito',sans-serif;";
    dropdownArtistas.appendChild(msg);
    dropdownArtistas.style.display = 'block';
}

function cancelarBusquedaArtistas() {
    clearTimeout(timerBusqueda);
    controlBusqueda?.abort();
    ++peticionArtista; // invalida cualquier respuesta anterior todavía en vuelo
}

function pintarArtistas(artistas) {
    if (artistas.length === 0) {
        mostrarMensajeDropdown('No artists found');
        return;
    }

    dropdownArtistas.innerHTML = '';
    artistas.forEach(art => {
        const item = document.createElement('div');
        item.textContent = art.disambiguation
            ? `${art.name} (${art.disambiguation})`
            : art.name;
        item.style.cssText =
            "padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--line);" +
            "font-size:16px;color:var(--ink);font-family:'Nunito',sans-serif;";

        item.addEventListener('mouseover', () => item.style.background = 'var(--bg)');
        item.addEventListener('mouseout', () => item.style.background = 'transparent');

        item.addEventListener('click', () => {
            cancelarBusquedaArtistas(); // por si había una petición en vuelo
            inputArtista.value = art.name;
            artistaNombre = art.name;
            dropdownArtistas.style.display = 'none';
            buscarAlbumes(art.id);
        });

        dropdownArtistas.appendChild(item);
    });

    dropdownArtistas.style.display = 'block';
}

inputArtista.addEventListener('input', () => {
    cancelarBusquedaArtistas();

    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) {
        dropdownArtistas.style.display = 'none';
        return;
    }

    // Si ya se buscó antes, se muestra al instante
    const clave = busqueda.toLowerCase();
    if (cacheArtistas.has(clave)) {
        pintarArtistas(cacheArtistas.get(clave));
        return;
    }

    mostrarMensajeDropdown('Searching…');

    timerBusqueda = setTimeout(async () => {
        const miPeticion = peticionArtista;
        controlBusqueda = new AbortController();
        const { signal } = controlBusqueda;

        // Se piden 10 para compensar los artistas especiales que se descartan
        const url = `${MB_BASE}/artist?query=${encodeURIComponent(busqueda)}&limit=10&fmt=json`;

        try {
            // Sin reintentos largos: si falla, se avisa enseguida y la siguiente tecla lanza otra búsqueda
            const data = await fetchJSON(url, { intentos: 1, timeoutMs: 8000, signal });
            if (miPeticion !== peticionArtista) return; // llegó una respuesta más nueva

            const artistas = filtrarArtistas(data.artists || []);
            cacheArtistas.set(clave, artistas);
            pintarArtistas(artistas);
        } catch (err) {
            if (signal.aborted) return; // cancelada porque el usuario siguió escribiendo
            console.error("Error buscando artistas:", err);
            if (miPeticion === peticionArtista) {
                mostrarMensajeDropdown("Couldn't reach MusicBrainz. Keep typing to try again.");
            }
        }
    }, 400);
});

// ======================================================
// 2. ÁLBUMES DEL ARTISTA (solo álbumes de estudio)
// ======================================================
async function buscarAlbumes(idArtista) {
    const miPeticion = ++peticionAlbum;

    // Reset de la interfaz
    clearTimeout(timerAvance);
    selectAlbumes.disabled = true;
    selectAlbumes.innerHTML = '<option value="">Loading albums...</option>';
    albumTitulo = "Your Album";
    titulosActuales = [];
    notas = [];
    indiceActual = 0;
    resetPortada();
    ocultarAlbumElegido();
    mostrarAviso('');
    mensajeCanciones('Select an album to generate the tracklist.');
    mostrarEstado('Loading albums…');
    refrescarPreview();

    try {
        const url = `${MB_BASE}/release-group?artist=${idArtista}&type=album&limit=100&fmt=json`;
        const data = await fetchJSON(url);
        if (miPeticion !== peticionAlbum) return;

        // Solo álbumes "puros": sin tipos secundarios (live, compilation, etc.)
        const grupos = (data["release-groups"] || [])
            .filter(g => g["primary-type"] === "Album" &&
                         (!g["secondary-types"] || g["secondary-types"].length === 0))
            .sort((a, b) => (a["first-release-date"] || "9999")
                .localeCompare(b["first-release-date"] || "9999"));

        selectAlbumes.innerHTML = '<option value="">-- Select an Album --</option>';

        if (grupos.length === 0) {
            selectAlbumes.innerHTML = '<option value="">No albums found</option>';
            return;
        }

        grupos.forEach(g => {
            const year = (g["first-release-date"] || "").slice(0, 4);
            const option = document.createElement('option');
            option.value = g.id;               // ID del release-group
            option.dataset.title = g.title;
            option.dataset.year = year;
            option.textContent = year ? `${g.title} (${year})` : g.title;
            selectAlbumes.appendChild(option);
        });

        selectAlbumes.disabled = false;
    } catch (err) {
        console.error("Error cargando álbumes:", err);
        selectAlbumes.innerHTML = '<option value="">Error loading albums (try again)</option>';
    } finally {
        if (miPeticion === peticionAlbum) ocultarEstado();
    }
}

// ======================================================
// 3. PORTADA
// ======================================================
// Portada para la tarjeta (canvas): se carga con CORS para que la imagen exportada no quede "contaminada".
// Si la portada no existe o no permite CORS, la tarjeta dibuja el cuadro "No cover".
function resetPortada() {
    ++peticionPortada;
    portadaImg = null;
}

function cargarPortada(idReleaseGroup) {
    const miId = ++peticionPortada;
    portadaImg = null;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        if (miId !== peticionPortada) return;
        portadaImg = img;
        redibujarTarjeta();
    };
    img.onerror = () => {
        if (miId !== peticionPortada) return;
        portadaImg = null;
        redibujarTarjeta();
    };
    img.src = `${CAA_BASE}/release-group/${idReleaseGroup}/front-500`;
}

// Portada + título del álbum elegido en el paso 2, para confirmar que es el correcto
function mostrarAlbumElegido(idGrupo, titulo, anio) {
    aeTitulo.textContent = titulo;
    aeSub.textContent = [artistaNombre, anio].filter(Boolean).join(' · ');

    coverElegido.crossOrigin = "anonymous";
    coverElegido.onerror = () => {
        coverElegido.onerror = null;
        coverElegido.src = PLACEHOLDER_COVER;
    };
    coverElegido.src = `${CAA_BASE}/release-group/${idGrupo}/front-500`;
    albumElegido.hidden = false;
}

function ocultarAlbumElegido() {
    albumElegido.hidden = true;
    coverElegido.onerror = null;
    coverElegido.removeAttribute('src');
}

// ======================================================
// 4. TRACKLIST DEL ÁLBUM
// ======================================================
const cacheTracks = new Map(); // idGrupo -> títulos (evita repetir peticiones)

// Dos peticiones ligeras en lugar de una pesada:
//  1) ediciones del álbum (sin canciones) -> elegimos la edición original
//  2) consulta directa de esa edición con sus canciones
async function obtenerTracklist(idGrupo) {
    if (cacheTracks.has(idGrupo)) return cacheTracks.get(idGrupo);

    let data = await fetchJSON(
        `${MB_BASE}/release?release-group=${idGrupo}&status=official&inc=media&limit=50&fmt=json`
    );
    let releases = data.releases || [];
    if (releases.length === 0) {
        data = await fetchJSON(
            `${MB_BASE}/release?release-group=${idGrupo}&inc=media&limit=50&fmt=json`
        );
        releases = data.releases || [];
    }
    if (releases.length === 0) return [];

    // La más antigua (edición original); a igualdad de fecha, la de menos pistas
    const numPistas = r => (r.media || []).reduce((s, m) => s + (m["track-count"] || 0), 0) || 999;
    releases.sort((a, b) =>
        (a.date || "9999").localeCompare(b.date || "9999") || numPistas(a) - numPistas(b));

    const release = await fetchJSON(`${MB_BASE}/release/${releases[0].id}?inc=recordings&fmt=json`);
    const titulos = (release.media || []).flatMap(m => m.tracks || []).map(t => t.title);

    if (titulos.length > 0) cacheTracks.set(idGrupo, titulos);
    return titulos;
}

// Si el panel de puntuación queda fuera de pantalla (móvil), lo acerca
function llevarAPasoPuntuar() {
    const el = document.getElementById('paso-puntuar');
    if (el.getBoundingClientRect().top > window.innerHeight * 0.6) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function cargarCanciones(idGrupo) {
    clearTimeout(timerAvance);
    titulosActuales = [];
    notas = [];
    indiceActual = 0;
    mostrarAviso('');
    mensajeCanciones('Loading tracks…', true);
    mostrarEstado('Loading tracklist…');
    refrescarPreview();

    cargarPortada(idGrupo);

    const miPeticion = ++peticionAlbum;

    try {
        const titulos = await obtenerTracklist(idGrupo);
        if (miPeticion !== peticionAlbum) return;

        if (titulos.length === 0) {
            mensajeCanciones('No tracks found for this album.');
            return;
        }

        titulosActuales = titulos;
        notas = titulos.map(() => null);
        indiceActual = 0;

        actualizarVistas();
        refrescarPreview();
    } catch (err) {
        console.error("Error cargando canciones:", err);
        if (miPeticion === peticionAlbum) {
            mensajeCanciones("Couldn't load the tracks. MusicBrainz may be busy.", false,
                () => cargarCanciones(idGrupo));
        }
    } finally {
        if (miPeticion === peticionAlbum) ocultarEstado();
    }
}

selectAlbumes.addEventListener('change', () => {
    const idGrupo = selectAlbumes.value;
    if (!idGrupo) return;

    const opcion = selectAlbumes.options[selectAlbumes.selectedIndex];
    const titulo = opcion.dataset.title || opcion.text;
    albumTitulo = titulo;
    mostrarAlbumElegido(idGrupo, titulo, opcion.dataset.year);
    cargarCanciones(idGrupo);
    llevarAPasoPuntuar(); // en móvil, el paso 2 (con la portada) queda fuera de pantalla
});

// ======================================================
// 5. IMAGEN: descargar y compartir (se exporta el propio canvas de la tarjeta)
// ======================================================
let blobPromesa = null;   // imagen ya generada (o en proceso) para el dibujo actual
let timerImagen;

// Cada redibujado invalida la imagen y la prepara en segundo plano.
// Así "Share" puede abrirse al instante (algunos móviles exigen que se llame justo tras el toque).
function invalidarImagen() {
    blobPromesa = null;
    clearTimeout(timerImagen);
    if (pantallaActual === 2 && todasPuntuadas()) {
        timerImagen = setTimeout(() => { obtenerImagen().catch(() => {}); }, 300);
    }
}

function obtenerImagen() {
    if (!blobPromesa) {
        blobPromesa = new Promise((resolve, reject) => {
            canvasTarjeta.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('toBlob devolvió null')),
                'image/png'
            );
        }).catch(err => { blobPromesa = null; throw err; }); // un fallo no se queda guardado
    }
    return blobPromesa;
}

function descargarBlob(blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = nombreArchivo();
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function conEstado(btn, texto, fn) {
    const original = btn.textContent;
    btn.textContent = texto;
    btn.disabled = true;
    try {
        await fn();
    } finally {
        btn.textContent = original;
        btn.disabled = !todasPuntuadas();
    }
}

btnDescargar.addEventListener('click', () => {
    if (!todasPuntuadas()) return;
    mostrarAviso('');
    conEstado(btnDescargar, 'Generating...', async () => {
        try {
            descargarBlob(await obtenerImagen());
        } catch (err) {
            console.error("Error generando la imagen:", err);
            mostrarAviso("Couldn't generate the image. Please try again.");
        }
    });
});

// ---------- Compartir (Web Share API) ----------
function puedeCompartirArchivos() {
    try {
        const prueba = new File([''], 'test.png', { type: 'image/png' });
        return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [prueba] }));
    } catch {
        return false;
    }
}

if (puedeCompartirArchivos()) {
    btnCompartir.hidden = false;
}

btnCompartir.addEventListener('click', () => {
    if (!todasPuntuadas()) return;
    mostrarAviso('');

    conEstado(btnCompartir, 'Preparing...', async () => {
        try {
            const blob = await obtenerImagen();
            const file = new File([blob], nombreArchivo(), { type: 'image/png' });

            if (!navigator.canShare({ files: [file] })) {
                descargarBlob(blob);
                return;
            }

            const media = calcularMedia();
            await navigator.share({
                files: [file],
                title: `${albumTitulo} - ${artistaNombre}`,
                text: `My AlbumPlot for ${albumTitulo} by ${artistaNombre}: ${media === null ? '–' : media.toFixed(1)}/10 · ${SITE_URL}`
            });
        } catch (err) {
            if (err.name === 'AbortError') return; // el usuario cerró el menú de compartir
            console.error("Error al compartir:", err);
            mostrarAviso("Couldn't open the share menu. Try \"Save Image\" instead.");
        }
    });
});

// ======================================================
// ARRANQUE
// ======================================================
aplicarTintes();
refrescarPreview();

// ===============================
// AlbumPlot - Main Script
// ===============================

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const SITE_URL = "damogon.github.io/album-plot/";

const CARD_W = 540;     // ancho fijo de la tarjeta (px de diseño)
const EXPORT_W = 1080;  // ancho de la imagen exportada

// Colores pastel disponibles (los mismos que los círculos del HTML)
const COLORES_SORPRESA = ["#f28c9f", "#ffad80", "#f2cc5c", "#7dd3a8", "#7ab6f7", "#b69cf5"];

// Placeholder embebido (SVG en data URI) para portadas que no existen
const PLACEHOLDER_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
       <rect width="100%" height="100%" fill="#e9e0d5"/>
       <text x="50%" y="50%" font-family="sans-serif" font-size="24" fill="#6b625a"
             text-anchor="middle" dominant-baseline="middle">No cover</text>
     </svg>`
  );

let timerBusqueda;
let peticionArtista = 0; // para descartar respuestas antiguas
let peticionAlbum = 0;
let titulosActuales = []; // nombres de las canciones del álbum elegido
let notas = [];           // nota de cada canción (null = sin puntuar)
let indiceActual = 0;     // canción en foco (modo "una cada vez")
let modoLista = false;    // false = una cada vez, true = lista completa
let timerAvance;

// DOM Elements
const inputArtista = document.getElementById('artista');
const dropdownArtistas = document.getElementById('dropdown-artistas');
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
const msgCanciones = document.getElementById('msg-canciones');
const modos = document.getElementById('modos');
const vistaUno = document.getElementById('vista-uno');
const navPuntos = document.getElementById('nav-puntos');
const focoNum = document.getElementById('foco-num');
const focoTitulo = document.getElementById('foco-titulo');
const focoNotas = document.getElementById('foco-notas');
const btnAtras = document.getElementById('btn-atras');
const btnSiguiente = document.getElementById('btn-siguiente');
const viewArtista = document.getElementById('view-artista');
const viewAlbum = document.getElementById('view-album');
const btnDescargar = document.getElementById('btn-descargar');
const btnCompartir = document.getElementById('btn-compartir');
const btnBorrar = document.getElementById('btn-borrar');
const canvasGrafica = document.getElementById('grafica');
const notaMediaValor = document.getElementById('nota-media-valor');
const card = document.getElementById('zona-captura');
const previewEscala = document.getElementById('preview-escala');
const progresoFill = document.getElementById('progreso-fill');
const progresoTexto = document.getElementById('progreso-texto');
const contador = document.getElementById('contador');
const aviso = document.getElementById('aviso');

// Marca de agua con el enlace completo
document.getElementById('marca-agua').textContent = `MADE AT: ${SITE_URL}`;

// Cerrar el desplegable al hacer clic fuera
document.addEventListener('click', (e) => {
    if (!inputArtista.contains(e.target) && !dropdownArtistas.contains(e.target)) {
        dropdownArtistas.style.display = 'none';
    }
});

// ======================================================
// UTILIDADES
// ======================================================
async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return res.json();
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

function nombreArchivo() {
    return `${viewAlbum.textContent.replace(/[^a-z0-9]/gi, '_')}_albumplot.png`;
}

function mostrarAviso(texto) {
    aviso.textContent = texto || '';
}

// ======================================================
// ESCALA DE LA TARJETA (se reduce en pantallas pequeñas)
// ======================================================
function ajustarEscala() {
    const cw = previewEscala.clientWidth;
    if (!cw) return;
    const k = Math.min(1, cw / CARD_W);
    const offset = (cw - CARD_W * k) / 2;
    card.style.transform = `translate(${offset}px, 0) scale(${k})`;
    previewEscala.style.height = `${card.offsetHeight * k}px`;
}
window.addEventListener('resize', ajustarEscala);

// ======================================================
// GEOMETRÍA para colocar las etiquetas sin que nada las tape
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

// ======================================================
// GRÁFICA (canvas): notas por canción
// ======================================================
function dibujarGrafica() {
    if (!canvasGrafica) return;

    const wrap = canvasGrafica.parentElement;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    if (!W || !H) return;

    const S = 2; // factor de nitidez
    canvasGrafica.width = W * S;
    canvasGrafica.height = H * S;

    const ctx = canvasGrafica.getContext('2d');
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const col = name => css.getPropertyValue(name).trim();
    const ink = col('--ink'), lineCol = col('--line'), muted = col('--muted'), accent = col('--c');

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

    if (n === 0) return;

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
    if (puntos.length === 0) return;

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

    // Línea continua
    if (puntos.length > 1) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        puntos.forEach((p, k) => k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
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

    // ---- Etiquetas con el valor: se colocan donde no las cruce ninguna línea ----
    const ETQ_H = 14;
    ctx.font = "600 14px 'Oswald', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const segmentos = [];
    for (let k = 0; k < puntos.length - 1; k++) {
        segmentos.push({ x1: puntos[k].x, y1: puntos[k].y, x2: puntos[k + 1].x, y2: puntos[k + 1].y });
    }
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
            if (r.x < 0 || r.x + r.w > W || r.y < 0) score += 100;   // fuera del canvas
            if (r.y + r.h > yEje + 1) score += 100;                  // por debajo del eje X
            if (r.x < m.l + 2) score += 6;                           // pisa el eje Y
            segmentos.forEach(s => { if (rectCortaSegmento(rr, s)) score += 10; });
            puntos.forEach(q => { if (circuloToca(rr, q.x, q.y, R + 1)) score += 10; });
            colocadas.forEach(o => { if (rectsSolapan(rr, o)) score += 10; });
            if (rectCortaSegmento(rr, lineaPuntos)) score += 3;      // la línea de puntos: penalización suave

            if (!mejor || score < mejor.score) mejor = { score, cx, cy, rect: rr };
        });

        colocadas.push(mejor.rect);

        // Halo blanco para que se lea aunque pase una línea de la rejilla por detrás
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fff';
        ctx.strokeText(texto, mejor.cx, mejor.cy);
        ctx.fillStyle = ink;
        ctx.fillText(texto, mejor.cx, mejor.cy);
    });
}

// ======================================================
// PREVIEW: media, progreso y estado de los botones
// ======================================================
function actualizarMedia() {
    const valores = notasPuntuadas();
    if (valores.length === 0) {
        notaMediaValor.textContent = '–';
        return;
    }
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    notaMediaValor.textContent = media.toFixed(1);
}

function actualizarProgreso() {
    const total = titulosActuales.length;
    const hechas = notasPuntuadas().length;

    progresoFill.style.width = total ? `${(hechas / total) * 100}%` : '0%';
    contador.textContent = total ? `${hechas}/${total}` : '';

    if (total === 0) {
        progresoTexto.textContent = 'Select an album to start rating.';
    } else if (hechas < total) {
        progresoTexto.textContent = `${hechas} of ${total} tracks rated. Rate all tracks to save.`;
    } else {
        progresoTexto.textContent = 'All tracks rated. Ready to save or share!';
    }
}

function refrescarPreview() {
    actualizarEntrada();
    dibujarGrafica();
    actualizarMedia();
    actualizarProgreso();

    const lista = todasPuntuadas();
    btnDescargar.disabled = !lista;
    btnCompartir.disabled = !lista;
    btnBorrar.disabled = notasPuntuadas().length === 0;

    invalidarImagen();
}

// Redibujar cuando las fuentes de Google estén cargadas
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { ajustarEscala(); refrescarPreview(); });
}

// ======================================================
// ENTRADA DE NOTAS: vistas y estado
// ======================================================
function mensajeCanciones(texto) {
    msgCanciones.textContent = texto;
    actualizarVistas();
}

function actualizarVistas() {
    const hay = titulosActuales.length > 0;
    msgCanciones.hidden = hay;
    modos.hidden = !hay;
    vistaUno.hidden = !hay || modoLista;
    listaCanciones.hidden = !hay || !modoLista;
}

function actualizarEntrada() {
    pintarNotas();
    renderFoco();
    pintarNavPuntos();
}

// ---------- Modo "una canción cada vez" ----------
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
    btnAtras.disabled = i === 0;
    if (ultima && todasPuntuadas()) {
        btnSiguiente.textContent = 'See plot ↓';
        btnSiguiente.disabled = false;
    } else {
        btnSiguiente.textContent = 'Next →';
        btnSiguiente.disabled = ultima;
    }
}

function construirNavPuntos() {
    navPuntos.innerHTML = '';
    titulosActuales.forEach((t, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'punto';
        b.dataset.i = i;
        b.textContent = i + 1;
        b.setAttribute('aria-label', `Go to track ${i + 1}: ${t}`);
        navPuntos.appendChild(b);
    });
}

function pintarNavPuntos() {
    Array.from(navPuntos.children).forEach((b, i) => {
        b.classList.toggle('hecho', notas[i] !== null && notas[i] !== undefined);
        b.classList.toggle('actual', i === indiceActual);
    });
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

btnAtras.addEventListener('click', () => irA(indiceActual - 1));

btnSiguiente.addEventListener('click', () => {
    const ultima = indiceActual === titulosActuales.length - 1;
    if (ultima && todasPuntuadas()) {
        document.getElementById('paso-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        irA(indiceActual + 1);
    }
});

navPuntos.addEventListener('click', (e) => {
    const b = e.target.closest('.punto');
    if (b) irA(Number(b.dataset.i));
});

// Cambiar entre "One by one" y "Full list"
modos.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    modoLista = btn.dataset.modo === 'lista';
    modos.querySelectorAll('.seg').forEach(s => s.classList.toggle('sel', s === btn));
    actualizarVistas();
});

// ---------- Modo lista completa ----------
function crearFilaCancion(titulo, index) {
    const item = document.createElement('div');
    item.className = 'cancion-item';

    const nombre = document.createElement('span');
    nombre.className = 'cancion-nombre';
    nombre.textContent = `${index + 1}. ${titulo}`;

    const fila = document.createElement('div');
    fila.className = 'notas';
    fila.setAttribute('role', 'group');
    fila.setAttribute('aria-label', `Rating for ${titulo}`);

    for (let v = 0; v <= 10; v++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nota-btn';
        btn.dataset.i = index;
        btn.dataset.v = v;
        btn.textContent = v;
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', `${v} for ${titulo}`);
        fila.appendChild(btn);
    }

    item.appendChild(nombre);
    item.appendChild(fila);
    return item;
}

function pintarNotas() {
    listaCanciones.querySelectorAll('.cancion-item').forEach((item, i) => {
        item.querySelectorAll('.nota-btn').forEach(btn => {
            const activo = notas[i] === Number(btn.dataset.v);
            btn.classList.toggle('sel', activo);
            btn.setAttribute('aria-pressed', String(activo));
        });
    });
}

// Un clic pone la nota; otro clic sobre la misma la quita
listaCanciones.addEventListener('click', (e) => {
    const btn = e.target.closest('.nota-btn');
    if (!btn) return;

    const i = Number(btn.dataset.i);
    const v = Number(btn.dataset.v);
    notas[i] = notas[i] === v ? null : v;
    indiceActual = i; // si vuelve al modo "una cada vez", estará en esta canción

    mostrarAviso('');
    refrescarPreview();
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
// COLOR DE ACENTO
// ======================================================
function aplicarColor(valor, swatchActivo) {
    document.documentElement.style.setProperty('--c', valor);
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s === swatchActivo));
    refrescarPreview();
}

document.getElementById('swatches').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (sw) aplicarColor(sw.dataset.color, sw);
});

document.getElementById('btn-sorpresa').addEventListener('click', () => {
    const actual = getComputedStyle(document.documentElement).getPropertyValue('--c').trim();
    const opciones = COLORES_SORPRESA.filter(c => c !== actual);
    const elegido = opciones[Math.floor(Math.random() * opciones.length)];
    const sw = Array.from(document.querySelectorAll('.swatch')).find(s => s.dataset.color === elegido);
    aplicarColor(elegido, sw);
});

// ======================================================
// FORMATO DE LA IMAGEN (1:1 o 9:16)
// ======================================================
document.getElementById('formatos').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;

    document.querySelectorAll('#formatos .seg').forEach(s => s.classList.toggle('sel', s === btn));
    card.classList.toggle('fmt-square', btn.dataset.fmt === 'square');
    card.classList.toggle('fmt-story', btn.dataset.fmt === 'story');

    ajustarEscala();
    refrescarPreview();
});

// ======================================================
// 1. AUTOCOMPLETADO DE ARTISTAS
// ======================================================
function mostrarMensajeDropdown(texto) {
    dropdownArtistas.innerHTML = '';
    const msg = document.createElement('div');
    msg.textContent = texto;
    msg.style.cssText =
        "padding:12px 16px;font-size:16px;color:var(--muted);font-style:italic;font-family:'Nunito',sans-serif;";
    dropdownArtistas.appendChild(msg);
    dropdownArtistas.style.display = 'block';
}

inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);
    ++peticionArtista; // invalida cualquier respuesta anterior todavía en vuelo

    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) {
        dropdownArtistas.style.display = 'none';
        return;
    }

    mostrarMensajeDropdown('Searching…');

    timerBusqueda = setTimeout(async () => {
        const miPeticion = peticionArtista;
        const url = `${MB_BASE}/artist?query=${encodeURIComponent(busqueda)}&limit=8&fmt=json`;

        try {
            const data = await fetchJSON(url);
            if (miPeticion !== peticionArtista) return; // llegó una respuesta más nueva

            const artistas = data.artists || [];

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
                    inputArtista.value = art.name;
                    viewArtista.textContent = art.name;
                    dropdownArtistas.style.display = 'none';
                    buscarAlbumes(art.id);
                });

                dropdownArtistas.appendChild(item);
            });

            dropdownArtistas.style.display = 'block';
        } catch (err) {
            console.error("Error buscando artistas:", err);
            if (miPeticion === peticionArtista) {
                mostrarMensajeDropdown("Couldn't reach MusicBrainz. Try again in a moment.");
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
    listaCanciones.innerHTML = '';
    navPuntos.innerHTML = '';
    viewAlbum.textContent = "Your Album";
    titulosActuales = [];
    notas = [];
    indiceActual = 0;
    resetPortada();
    mostrarAviso('');
    mensajeCanciones('Select an album to generate the tracklist.');
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
            option.textContent = year ? `${g.title} (${year})` : g.title;
            selectAlbumes.appendChild(option);
        });

        selectAlbumes.disabled = false;
    } catch (err) {
        console.error("Error cargando álbumes:", err);
        selectAlbumes.innerHTML = '<option value="">Error loading albums (try again)</option>';
    }
}

// ======================================================
// 3. PORTADA
// ======================================================
function resetPortada() {
    const coverArt = document.getElementById('cover-art');
    if (!coverArt) return;
    coverArt.onerror = null;
    coverArt.onload = null;
    coverArt.classList.remove('visible'); // oculta la imagen hasta que haya álbum
    coverArt.removeAttribute('src');
}

function cargarPortada(idReleaseGroup) {
    const coverArt = document.getElementById('cover-art');
    if (!coverArt) return;

    coverArt.crossOrigin = "anonymous"; // necesario para que html2canvas pueda dibujarla
    coverArt.classList.add('visible');
    coverArt.onload = invalidarImagen;  // al cargar la portada, la imagen exportable cambia
    coverArt.onerror = () => {
        coverArt.onerror = null;
        coverArt.src = PLACEHOLDER_COVER;
    };
    coverArt.src = `${CAA_BASE}/release-group/${idReleaseGroup}/front-500`;
}

// ======================================================
// 4. TRACKLIST DEL ÁLBUM
// ======================================================
selectAlbumes.addEventListener('change', async () => {
    const idGrupo = selectAlbumes.value;
    if (!idGrupo) return;

    const opcion = selectAlbumes.options[selectAlbumes.selectedIndex];
    viewAlbum.textContent = opcion.dataset.title || opcion.text;

    clearTimeout(timerAvance);
    titulosActuales = [];
    notas = [];
    indiceActual = 0;
    listaCanciones.innerHTML = '';
    navPuntos.innerHTML = '';
    mostrarAviso('');
    mensajeCanciones('Loading tracks...');
    refrescarPreview();

    cargarPortada(idGrupo);

    const miPeticion = ++peticionAlbum;

    try {
        // Buscamos primero una edición oficial; si no hay, cualquiera
        let data = await fetchJSON(
            `${MB_BASE}/release?release-group=${idGrupo}&status=official&inc=recordings&limit=1&fmt=json`
        );
        if (!data.releases || data.releases.length === 0) {
            data = await fetchJSON(
                `${MB_BASE}/release?release-group=${idGrupo}&inc=recordings&limit=1&fmt=json`
            );
        }
        if (miPeticion !== peticionAlbum) return;

        const release = data.releases?.[0];
        // Unimos todos los discos del release
        const tracks = (release?.media || []).flatMap(m => m.tracks || []);

        if (tracks.length === 0) {
            mensajeCanciones('No tracks found for this album.');
            return;
        }

        titulosActuales = tracks.map(t => t.title);
        notas = titulosActuales.map(() => null);
        indiceActual = 0;

        tracks.forEach((track, index) => {
            listaCanciones.appendChild(crearFilaCancion(track.title, index));
        });
        construirNavPuntos();
        actualizarVistas();

        refrescarPreview(); // los botones siguen desactivados hasta puntuar todo
    } catch (err) {
        console.error("Error cargando canciones:", err);
        mensajeCanciones('Error loading tracks. Please try again.');
    }
});

// ======================================================
// 5. GENERAR IMAGEN (descargar / compartir)
// ======================================================
let imagenPromesa = null;   // imagen ya generada (o en proceso) para el estado actual
let timerImagen;

// Cada cambio invalida la imagen y, si todo está puntuado, la prepara en segundo plano.
// Así "Share" puede abrirse al instante (algunos móviles exigen que se llame justo tras el toque).
function invalidarImagen() {
    imagenPromesa = null;
    clearTimeout(timerImagen);
    if (todasPuntuadas()) {
        timerImagen = setTimeout(() => { obtenerImagen().catch(() => {}); }, 500);
    }
}

function generarBlob() {
    return html2canvas(card, {
        scale: EXPORT_W / CARD_W,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        windowWidth: 900,
        onclone: (doc) => {
            // En la copia que se renderiza: sin reducción, sin borde ni esquinas redondeadas
            const c = doc.getElementById('zona-captura');
            c.style.transform = 'none';
            c.style.boxShadow = 'none';
            c.style.borderRadius = '0';
        }
    }).then(canvas => new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob falló')), 'image/png');
    }));
}

function obtenerImagen() {
    if (!imagenPromesa) imagenPromesa = generarBlob();
    return imagenPromesa;
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

            await navigator.share({
                files: [file],
                title: `${viewAlbum.textContent} - ${viewArtista.textContent}`,
                text: `My AlbumPlot for ${viewAlbum.textContent} by ${viewArtista.textContent}: ${notaMediaValor.textContent}/10 · ${SITE_URL}`
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
ajustarEscala();
refrescarPreview();

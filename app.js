// ===============================
// AlbumPlot - Main Script
// ===============================

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const SITE_URL = "damogon.github.io/album-plot/";

const CARD_W = 540;     // ancho fijo de la tarjeta (px de diseño)
const EXPORT_W = 1080;  // ancho de la imagen exportada

const COLORES_SORPRESA = ["#e63946", "#e8590c", "#2b9348", "#2563eb", "#7c3aed", "#d6336c"];

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

// DOM Elements
const inputArtista = document.getElementById('artista');
const dropdownArtistas = document.getElementById('dropdown-artistas');
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
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
    const titulos = titulosActuales.map(t => recortar(t, 20));
    let tam = 12;

    // Márgenes según el texto real de los títulos (en diagonal, anclados a la derecha)
    if (n > 0) {
        for (let it = 0; it < 3; it++) {
            const pw0 = W - m.l - m.r;
            const paso0 = n > 1 ? pw0 / (n - 1) : pw0;
            tam = Math.max(9, Math.min(13, paso0 * 0.7));
            ctx.font = `700 ${tam}px 'Nunito', sans-serif`;

            let deficit = 0;
            titulos.forEach((t, i) => {
                const x = n === 1 ? m.l + pw0 / 2 : m.l + pw0 * i / (n - 1);
                const w = ctx.measureText(t).width;
                deficit = Math.max(deficit, w * Math.SQRT1_2 + tam * 0.4 - x);
            });
            if (deficit > 0) m.l = Math.min(W * 0.35, m.l + deficit);
        }
        ctx.font = `700 ${tam}px 'Nunito', sans-serif`;
        const maxW = Math.max(...titulos.map(t => ctx.measureText(t).width));
        m.b = Math.min(H * 0.55, maxW * Math.SQRT1_2 + tam * 0.8 + 24);
    }

    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const xAt = i => n === 1 ? m.l + pw / 2 : m.l + pw * i / (n - 1);
    const yAt = v => m.t + ph * (1 - v / 10);

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
    ctx.lineTo(m.l, m.t + ph);
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
        ctx.moveTo(x, m.t + ph);
        ctx.lineTo(x, m.t + ph + 5);
        ctx.stroke();

        ctx.save();
        ctx.translate(x + 3, m.t + ph + 12);
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
        ctx.lineTo(p.x, m.t + ph);
        ctx.stroke();
    });
    ctx.restore();

    // Línea continua
    if (puntos.length > 1) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        puntos.forEach((p, k) => k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
    }

    // Puntos y valor sobre cada punto
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = "600 14px 'Oswald', sans-serif";
    puntos.forEach(p => {
        ctx.fillStyle = accent;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = ink;
        ctx.fillText(String(p.v), p.x, p.y - 10);
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
// BOTONES DE NOTA (0-10)
// ======================================================
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

    mostrarAviso('');
    pintarNotas();
    refrescarPreview();
});

// Borrar todas las notas
btnBorrar.addEventListener('click', () => {
    notas = notas.map(() => null);
    mostrarAviso('');
    pintarNotas();
    refrescarPreview();
});

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

    document.querySelectorAll('.seg').forEach(s => s.classList.toggle('sel', s === btn));
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
    selectAlbumes.disabled = true;
    selectAlbumes.innerHTML = '<option value="">Loading albums...</option>';
    listaCanciones.innerHTML =
        '<p style="text-align:center;color:var(--muted);font-size:16px;margin:0;">Select an album to generate the tracklist.</p>';
    viewAlbum.textContent = "Your Album";
    titulosActuales = [];
    notas = [];
    resetPortada();
    mostrarAviso('');
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
    titulosActuales = [];
    notas = [];
    mostrarAviso('');
    refrescarPreview();
    listaCanciones.innerHTML =
        '<p style="text-align:center;color:var(--muted);font-size:16px;margin:0;">Loading tracks...</p>';

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

        listaCanciones.innerHTML = '';

        if (tracks.length === 0) {
            listaCanciones.innerHTML =
                '<p style="text-align:center;color:var(--muted);margin:0;">No tracks found for this album.</p>';
            return;
        }

        titulosActuales = tracks.map(t => t.title);
        notas = titulosActuales.map(() => null);

        tracks.forEach((track, index) => {
            listaCanciones.appendChild(crearFilaCancion(track.title, index));
        });

        refrescarPreview(); // los botones siguen desactivados hasta puntuar todo
    } catch (err) {
        console.error("Error cargando canciones:", err);
        listaCanciones.innerHTML =
            '<p style="text-align:center;color:var(--muted);margin:0;">Error loading tracks. Please try again.</p>';
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

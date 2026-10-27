// ===============================
// AlbumPlot - Main Script
// ===============================

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";

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

// DOM Elements
const inputArtista = document.getElementById('artista');
const dropdownArtistas = document.getElementById('dropdown-artistas');
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
const viewArtista = document.getElementById('view-artista');
const viewAlbum = document.getElementById('view-album');
const btnDescargar = document.getElementById('btn-descargar');
const canvasGrafica = document.getElementById('grafica');
const notaMediaValor = document.getElementById('nota-media-valor');

// Marca de agua con el enlace completo
if (document.getElementById('marca-agua')) {
    document.getElementById('marca-agua').textContent =
        'MADE AT: damogon.github.io/rate-this-album/';
}

// Cerrar el desplegable al hacer clic fuera
document.addEventListener('click', (e) => {
    if (!inputArtista.contains(e.target) && !dropdownArtistas.contains(e.target)) {
        dropdownArtistas.style.display = 'none';
    }
});

// ======================================================
// UTILIDAD: fetch JSON con comprobación de errores
// ======================================================
async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return res.json();
}

// ======================================================
// GRÁFICA (canvas): notas por canción + nota media
// ======================================================
function obtenerNotas() {
    return Array.from(listaCanciones.querySelectorAll('.nota-select'))
        .map(sel => sel.value === '' ? null : Number(sel.value));
}

function recortar(texto, max) {
    return texto.length > max ? texto.slice(0, max - 1).trimEnd() + '…' : texto;
}

function dibujarGrafica() {
    if (!canvasGrafica) return;

    const W = 1000, H = 600, S = 2; // tamaño lógico y factor de nitidez
    canvasGrafica.width = W * S;
    canvasGrafica.height = H * S;

    const ctx = canvasGrafica.getContext('2d');
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const col = name => css.getPropertyValue(name).trim();
    const ink = col('--ink'), lineCol = col('--line'), muted = col('--muted'), accent = col('--c');

    const n = titulosActuales.length;
    const notas = obtenerNotas();
    const m = { l: 56, r: 30, t: 30, b: 170 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const xAt = i => n === 1 ? m.l + pw / 2 : m.l + pw * i / (n - 1);
    const yAt = v => m.t + ph * (1 - v / 10);

    // Rejilla horizontal y eje Y (0 a 10)
    ctx.font = "600 15px 'Oswald', sans-serif";
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
        ctx.fillText(String(v), m.l - 12, y);
    }

    // Eje vertical
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.l, m.t);
    ctx.lineTo(m.l, m.t + ph);
    ctx.stroke();

    if (n === 0) return;

    // Eje X: nombres de canción en diagonal
    const paso = n > 1 ? pw / (n - 1) : pw;
    const tam = Math.max(9, Math.min(15, paso * 0.7));
    ctx.font = `700 ${tam}px 'Nunito', sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    titulosActuales.forEach((titulo, i) => {
        const x = xAt(i);
        // marca de tracción
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, m.t + ph);
        ctx.lineTo(x, m.t + ph + 6);
        ctx.stroke();

        ctx.save();
        ctx.translate(x + 4, m.t + ph + 14);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = notas[i] === null ? muted : ink;
        ctx.fillText(recortar(titulo, 26), 0, 0);
        ctx.restore();
    });

    // Puntos puntuados (se unen en orden, saltando los vacíos)
    const puntos = [];
    notas.forEach((v, i) => { if (v !== null) puntos.push({ x: xAt(i), y: yAt(v), v }); });

    if (puntos.length > 0) {
        // Líneas verticales de puntos: unen cada nota con el título de su canción
        ctx.save();
        ctx.strokeStyle = muted;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.setLineDash([0.1, 7]); // con lineCap redondo, esto dibuja puntos
        puntos.forEach(p => {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y + 9);
            ctx.lineTo(p.x, m.t + ph);
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

        // Puntos y valor sobre cada punto
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = "600 16px 'Oswald', sans-serif";
        puntos.forEach(p => {
            ctx.fillStyle = accent;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = ink;
            ctx.fillText(String(p.v), p.x, p.y - 12);
        });
    }

    actualizarMedia(puntos.map(p => p.v));
}

function actualizarMedia(valores) {
    if (!notaMediaValor) return;
    if (!valores || valores.length === 0) {
        notaMediaValor.textContent = '–';
        return;
    }
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    notaMediaValor.textContent = media.toFixed(1);
}

function todasPuntuadas() {
    const notas = obtenerNotas();
    return notas.length > 0 && notas.length === titulosActuales.length &&
           notas.every(v => v !== null);
}

function refrescarPreview() {
    dibujarGrafica();
    // Si no hay canciones, dibujarGrafica sale antes de calcular la media
    if (titulosActuales.length === 0) actualizarMedia([]);
    // El botón solo se activa cuando están todas las canciones puntuadas
    btnDescargar.disabled = !todasPuntuadas();
}

// Cada vez que se cambia una nota, se redibuja la gráfica
listaCanciones.addEventListener('change', (e) => {
    if (e.target.classList.contains('nota-select')) refrescarPreview();
});

// Redibujar cuando las fuentes de Google estén cargadas
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(refrescarPreview);
} else {
    refrescarPreview();
}

// ======================================================
// 1. AUTOCOMPLETADO DE ARTISTAS
// ======================================================
inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);

    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) {
        dropdownArtistas.style.display = 'none';
        return;
    }

    timerBusqueda = setTimeout(async () => {
        const miPeticion = ++peticionArtista;
        const url = `${MB_BASE}/artist?query=${encodeURIComponent(busqueda)}&limit=8&fmt=json`;

        try {
            const data = await fetchJSON(url);
            if (miPeticion !== peticionArtista) return; // llegó una respuesta más nueva

            const artistas = data.artists || [];
            dropdownArtistas.innerHTML = '';

            if (artistas.length === 0) {
                dropdownArtistas.style.display = 'none';
                return;
            }

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
            dropdownArtistas.style.display = 'none';
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
        '<p style="text-align:center;color:var(--muted);font-size:16px;">Select an album to generate the tracklist.</p>';
    viewAlbum.textContent = "Your Album";
    btnDescargar.disabled = true;
    titulosActuales = [];
    resetPortada();
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
    if (coverArt) coverArt.src = PLACEHOLDER_COVER;
}

function cargarPortada(idReleaseGroup) {
    const coverArt = document.getElementById('cover-art');
    if (!coverArt) return;

    coverArt.crossOrigin = "anonymous"; // necesario para que html2canvas pueda dibujarla
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
    btnDescargar.disabled = true;
    titulosActuales = [];
    refrescarPreview();
    listaCanciones.innerHTML =
        '<p style="text-align:center;color:var(--muted);font-size:16px;">Loading tracks...</p>';

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
                '<p style="text-align:center;color:var(--muted)">No tracks found for this album.</p>';
            return;
        }

        tracks.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'cancion-item';

            const nombre = document.createElement('span');
            nombre.className = 'cancion-nombre';
            nombre.textContent = `${index + 1}. ${track.title}`;

            const select = document.createElement('select');
            select.className = 'nota-select';

            const empty = document.createElement('option');
            empty.value = "";
            empty.textContent = "-";
            select.appendChild(empty);

            for (let i = 0; i <= 10; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = i;
                select.appendChild(opt);
            }

            item.appendChild(nombre);
            item.appendChild(select);
            listaCanciones.appendChild(item);
        });

        titulosActuales = tracks.map(t => t.title);
        refrescarPreview(); // el botón sigue desactivado hasta puntuar todo
    } catch (err) {
        console.error("Error cargando canciones:", err);
        listaCanciones.innerHTML =
            '<p style="text-align:center;color:var(--muted)">Error loading tracks. Please try again.</p>';
    }
});

// ======================================================
// 5. GENERAR Y DESCARGAR IMAGEN (la preview)
// ======================================================
btnDescargar.addEventListener('click', () => {
    if (!todasPuntuadas()) return;
    const contenedor = document.getElementById('zona-captura');

    html2canvas(contenedor, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `${viewAlbum.textContent.replace(/[^a-z0-9]/gi, '_')}_albumplot.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }).catch(err => console.error("Error generando la imagen:", err));
});

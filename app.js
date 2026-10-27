// ===============================
// RateThisAlbum - Main Script
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
             text-anchor="middle" dominant-baseline="middle">Sin portada</text>
     </svg>`
  );

let timerBusqueda;
let peticionArtista = 0; // para descartar respuestas antiguas
let peticionAlbum = 0;

// DOM Elements
const inputArtista = document.getElementById('artista');
const dropdownArtistas = document.getElementById('dropdown-artistas');
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
const viewArtista = document.getElementById('view-artista');
const viewAlbum = document.getElementById('view-album');
const btnDescargar = document.getElementById('btn-descargar');

// Dynamic Watermark setup
if (document.getElementById('marca-agua')) {
    document.getElementById('marca-agua').textContent =
        `MADE AT: ${window.location.host.toUpperCase()}`;
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
    selectAlbumes.innerHTML = '<option value="">Cargando álbumes...</option>';
    listaCanciones.innerHTML =
        '<p style="text-align:center;color:var(--muted);font-size:16px;">Select an album to generate the tracklist.</p>';
    viewAlbum.textContent = "Your Album";
    btnDescargar.disabled = true;
    resetPortada();

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
            selectAlbumes.innerHTML = '<option value="">No se encontraron álbumes</option>';
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
        selectAlbumes.innerHTML = '<option value="">Error al cargar (reintenta)</option>';
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
    listaCanciones.innerHTML =
        '<p style="text-align:center;color:var(--muted);font-size:16px;">Cargando canciones...</p>';

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

            for (let i = 1; i <= 10; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = i;
                select.appendChild(opt);
            }

            item.appendChild(nombre);
            item.appendChild(select);
            listaCanciones.appendChild(item);
        });

        btnDescargar.disabled = false;
    } catch (err) {
        console.error("Error cargando canciones:", err);
        listaCanciones.innerHTML =
            '<p style="text-align:center;color:var(--muted)">Error al cargar las canciones. Inténtalo de nuevo.</p>';
    }
});

// ======================================================
// 5. GENERAR Y DESCARGAR IMAGEN
// ======================================================
btnDescargar.addEventListener('click', () => {
    const contenedor = document.getElementById('zona-captura');

    // Reflejar la opción elegida en el DOM para que html2canvas la pinte
    contenedor.querySelectorAll('.nota-select').forEach(sel => {
        Array.from(sel.options).forEach((opt, i) => {
            if (i === sel.selectedIndex) {
                opt.setAttribute('selected', 'selected');
            } else {
                opt.removeAttribute('selected');
            }
        });
    });

    html2canvas(contenedor, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `${viewAlbum.textContent.replace(/[^a-z0-9]/gi, '_')}_rate.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }).catch(err => console.error("Error generando la imagen:", err));
});

// ===============================
// RateThisAlbum - Main Script
// ===============================

const USER_AGENT = "RateThisAlbumApp/1.0.0 (info@ratethisalbum.com)";
let timerBusqueda;

// DOM Elements
const inputArtista = document.getElementById('artista');
const datalistArtistas = document.getElementById('lista-artistas');
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
const viewArtista = document.getElementById('view-artista');
const viewAlbum = document.getElementById('view-album');
const coverArt = document.getElementById('cover-art');
const btnDescargar = document.getElementById('btn-descargar');

// Dynamic Watermark
if (document.getElementById('marca-agua')) {
    document.getElementById('marca-agua').textContent =
      `MADE AT: ${window.location.host.toUpperCase()}`;
}

// ======================================================
// UTILITY: Normalize text (removes accents/tildes and converts to lowercase)
// ======================================================
function limpiarTexto(texto) {
    return texto.normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .trim();
}

// ======================================================
// 1. ARTIST AUTOCOMPLETE (Handles casing, tildes, and filters empty artists)
// ======================================================
inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);

    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) return;

    const textoUsuarioLimpio = limpiarTexto(busqueda);

    timerBusqueda = setTimeout(() => {
        const url = `https://musicbrainz.org{encodeURIComponent(textoUsuarioLimpio)}&limit=40&fmt=json`;

        fetch(url, { headers: { "User-Agent": USER_AGENT } })
            .then(res => res.json())
            .then(data => {
                datalistArtistas.innerHTML = '';

                if (!data.artists || data.artists.length === 0) return;

                // 1. Filter out duplicate artists by their unique MusicBrainz ID
                const unicos = new Map();
                data.artists.forEach(a => unicos.set(a.id, a));

                const listaPromesas = [...unicos.values()].map(art => {
                    const nombreApiLimpio = limpiarTexto(art.name);
                    
                    // Cross-reference user input natively with API response text matching
                    if (nombreApiLimpio.includes(textoUsuarioLimpio)) {
                        
                        // REQUIREMENT: Pre-fetch subquery to confirm artist has real studio "Albums" (LPs)
                        return fetch(`https://musicbrainz.org{art.id}&inc=release-groups&limit=30&fmt=json`, {
                            headers: { "User-Agent": USER_AGENT }
                        })
                        .then(res => res.json())
                        .then(albumData => {
                            const tieneLPs = albumData.releases?.some(rel => rel["release-group"]?.["primary-type"] === "Album");
                            return tieneLPs ? art : null;
                        })
                        .catch(() => null);
                    }
                    return null;
                });

                // Resolve all async validation checks in background thread layout mapping
                Promise.all(listaPromesas).then(resultados => {
                    const artistasValidos = resultados.filter(a => a !== null);
                    
                    // Populate up to 8 accurate autocomplete options into selection drop down
                    artistasValidos.slice(0, 8).forEach(art => {
                        const option = document.createElement('option');
                        option.value = art.name; // Preserves proper format casing (e.g., ROSALÍA)
                        option.dataset.id = art.id;
                        datalistArtistas.appendChild(option);
                    });
                });
            })
            .catch(err => {
                console.error("Error fetching artist:", err);
                datalistArtistas.innerHTML = '';
            });

    }, 400); 
});

// ======================================================
// 2. DETECT ARTIST SELECTION
// ======================================================
inputArtista.addEventListener('change', () => {
    const opciones = Array.from(datalistArtistas.options);
    const seleccion = opciones.find(opt => opt.value === inputArtista.value);

    if (seleccion) {
        const idArtista = seleccion.dataset.id;
        viewArtista.textContent = inputArtista.value;
        buscarAlbumes(idArtista);
    }
});

// ======================================================
// 3. FETCH ALBUMS (LPs Only)
// ======================================================
function buscarAlbumes(idArtista) {
    fetch(`https://musicbrainz.org{idArtista}&inc=release-groups&limit=100&fmt=json`, {
        headers: { "User-Agent": USER_AGENT }
    })
    .then(res => res.json())
    .then(data => {
        selectAlbumes.innerHTML = '<option value="">-- Select an Album --</option>';

        if (!data.releases) return;

        const discosUnicos = new Set();

        data.releases.forEach(rel => {
            const grupo = rel["release-group"];

            // Restrict lists strictly to primary LP album releases
            if (grupo?.["primary-type"] !== "Album") return;

            if (!discosUnicos.has(rel.title)) {
                discosUnicos.add(rel.title);

                const option = document.createElement('option');
                option.value = rel.id;
                option.textContent = rel.title;
                option.dataset.group = grupo.id;
                selectAlbumes.appendChild(option);
            }
        });

        selectAlbumes.disabled = false;
    })
    .catch(err => console.error("Error fetching albums:", err));
}

// ======================================================
// 4. FETCH ALBUM COVER ART
// ======================================================
function cargarPortada(idReleaseGroup) {
    const url = `https://coverartarchive.org{idReleaseGroup}/front`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("No cover");
            if (coverArt) coverArt.src = url;
        })
        .catch(() => {
            if (coverArt) {
                // Fallback placeholder image asset if no official front artwork exists
                coverArt.src = "https://wikimedia.org";
            }
        });
}

// ======================================================
// 5. FETCH TRACKLIST FROM ALBUM SELECTION
// ======================================================
selectAlbumes.addEventListener('change', () => {
    const idAlbum = selectAlbumes.value;
    if (!idAlbum) return;

    const idGrupo = selectAlbumes.options[selectAlbumes.selectedIndex].dataset.group;

    viewAlbum.textContent = selectAlbumes.options[selectAlbumes.selectedIndex].text;

    cargarPortada(idGrupo);

    fetch(`https://musicbrainz.org{idAlbum}?inc=recordings&fmt=json`, {
        headers: { "User-Agent": USER_AGENT }
    })
    .then(res => res.json())
    .then(data => {
        listaCanciones.innerHTML = '';

        const tracks = data.media?.[0]?.tracks || [];

        if (tracks.length === 0) {
            listaCanciones.innerHTML =
                '<p style="text-align:center;color:var(--muted)">No tracks found for this album.</p>';
            return;
        }

        tracks.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'cancion-item';

            const select = document.createElement('select');
            select.className = "nota-select";

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

            item.innerHTML = `
                <span class="cancion-nombre">${index + 1}. ${track.title}</span>
            `;
            item.appendChild(select);

            listaCanciones.appendChild(item);
        });

        btnDescargar.disabled = false;
    })
    .catch(err => console.error("Error fetching tracklist:", err));
});

// ======================================================
// 6. RENDER AND DOWNLOAD CARD IMAGE
// ======================================================
btnDescargar.addEventListener('click', () => {
    const contenedor = document.getElementById('zona-captura');

    // Force exact select values to synchronize directly into DOM node elements for html2canvas
    const selects = contenedor.querySelectorAll('.nota-select');
    selects.forEach(sel => {
        const opciones = sel.querySelectorAll('option');
        opciones.forEach(opt => {
            if (opt.value == sel.value) {
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
    });
});

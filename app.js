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
// UTILITY: Remove accents/tildes
// ======================================================
function sinTildes(texto) {
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ======================================================
// 1. ARTIST AUTOCOMPLETE (Stable, ignores accents)
// ======================================================
inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);

    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) return;

    const normalizada = sinTildes(busqueda);

    timerBusqueda = setTimeout(() => {
        // FIXED: Removed the trailing slash before '?query=' to prevent 404 endpoint mapping errors
        const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(normalizada)}&limit=25&fmt=json`;

        fetch(url, { headers: { "User-Agent": USER_AGENT } })
            .then(res => res.json())
            .then(data => {
                datalistArtistas.innerHTML = '';

                if (!data.artists || data.artists.length === 0) return;

                const unicos = new Map();
                data.artists.forEach(a => unicos.set(a.id, a));

                [...unicos.values()]
                    .slice(0, 8)
                    .forEach(art => {
                        const option = document.createElement('option');
                        option.value = art.name;
                        option.dataset.id = art.id;
                        datalistArtistas.appendChild(option);
                    });
            })
            .catch(err => {
                console.error("Error fetching artist:", err);
                datalistArtistas.innerHTML = '';
            });

    }, 350);
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
    // FIXED: Removed the trailing slash before '?artist='
    fetch(`https://musicbrainz.org/ws/2/release?artist=${idArtista}&inc=release-groups&limit=100&fmt=json`, {
        headers: { "User-Agent": USER_AGENT }
    })
    .then(res => res.json())
    .then(data => {
        selectAlbumes.innerHTML = '<option value="">-- Select an Album --</option>';

        if (!data.releases) return;

        const discosUnicos = new Set();

        data.releases.forEach(rel => {
            const grupo = rel["release-group"];

            // LPs only
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
// 4. FETCH ALBUM ART COVER
// ======================================================
function cargarPortada(idReleaseGroup) {
    const url = `https://coverartarchive.org/release-group/${idReleaseGroup}/front`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("No cover");
            if (coverArt) coverArt.src = url;
        })
        .catch(() => {
            if (coverArt) {
                coverArt.src = "https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/No-Image-Placeholder.svg/600px-No-Image-Placeholder.svg.png";
            }
        });
}

// ======================================================
// 5. FETCH TRACKLIST FROM ALBUM
// ======================================================
selectAlbumes.addEventListener('change', () => {
    const idAlbum = selectAlbumes.value;
    if (!idAlbum) return;

    const idGrupo = selectAlbumes.options[selectAlbumes.selectedIndex].dataset.group;

    viewAlbum.textContent = selectAlbumes.options[selectAlbumes.selectedIndex].text;

    cargarPortada(idGrupo);

    fetch(`https://musicbrainz.org/ws/2/release/${idAlbum}?inc=recordings&fmt=json`, {
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
// 6. RENDER AND DOWNLOAD IMAGE
// ======================================================
btnDescargar.addEventListener('click', () => {
    const contenedor = document.getElementById('zona-captura');

    // FIXED: Explicitly sync selected option states into HTML properties so html2canvas renders scores
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

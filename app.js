// ===============================
// RateThisAlbum - Main Script
// ===============================

const USER_AGENT = "RateThisAlbumApp/1.0.0 (info@ratethisalbum.com)";
let timerBusqueda;

// DOM Elements
const inputArtista = document.getElementById('artista');
const dropdownArtistas = document.getElementById('dropdown-artistas'); // New custom dropdown element
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
const viewArtista = document.getElementById('view-artista');
const viewAlbum = document.getElementById('view-album');
const coverArt = document.getElementById('cover-art');
const btnDescargar = document.getElementById('btn-descargar');

// Dynamic Watermark setup
if (document.getElementById('marca-agua')) {
    document.getElementById('marca-agua').textContent =
      `MADE AT: ${window.location.host.toUpperCase()}`;
}

// Close custom dropdown when clicking anywhere else on the screen
document.addEventListener('click', (e) => {
    if (e.target !== inputArtista && e.target !== dropdownArtistas) {
        dropdownArtistas.style.display = 'none';
    }
});

// ======================================================
// UTILITY: Normalize strings (removes accents/tildes and lowercases)
// ======================================================
function limpiarTexto(texto) {
    return texto.normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .trim();
}

// ======================================================
// 1. ARTIST AUTOCOMPLETE DROPDOWN (Strict validation)
// ======================================================
inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);

    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) {
        dropdownArtistas.style.display = 'none';
        return;
    }

    const textoUsuarioLimpio = limpiarTexto(busqueda);

    timerBusqueda = setTimeout(() => {
        const url = `https://musicbrainz.org{encodeURIComponent(textoUsuarioLimpio)}&limit=40&fmt=json`;

        fetch(url, { headers: { "User-Agent": USER_AGENT } })
            .then(res => res.json())
            .then(async data => {
                dropdownArtistas.innerHTML = '';

                if (!data.artists || data.artists.length === 0) {
                    dropdownArtistas.style.display = 'none';
                    return;
                }

                // Remove duplicate IDs from the root payload response
                const unicos = new Map();
                data.artists.forEach(a => unicos.set(a.id, a));

                // Strict validation array sequence
                const artistasParaVerificar = [...unicos.values()];
                const artistasValidados = [];

                // Sequential scanning logic prevents race condition rendering bugs
                for (const art of artistasParaVerificar) {
                    const nombreApiLimpio = limpiarTexto(art.name);

                    if (nombreApiLimpio.includes(textoUsuarioLimpio)) {
                        try {
                            const subQueryUrl = `https://musicbrainz.org{art.id}&inc=release-groups&limit=30&fmt=json`;
                            const response = await fetch(subQueryUrl, { headers: { "User-Agent": USER_AGENT } });
                            const albumData = await response.json();

                            // Validate that at least 1 record maps explicitly as a physical LP "Album"
                            const tieneLPs = albumData.releases?.some(rel => rel["release-group"]?.["primary-type"] === "Album");
                            
                            if (tieneLPs) {
                                artistasValidos.push(art);
                            }
                        } catch (err) {
                            console.error("Subquery validation dropped for artist ID:", art.id, err);
                        }
                    }

                    // Cut evaluation early once we collect enough clean, matching results
                    if (artistasValidos.length >= 6) break;
                }

                if (artistasValidos.length === 0) {
                    dropdownArtistas.style.display = 'none';
                    return;
                }

                // Render custom interactive dropdown option items
                artistasValidos.forEach(art => {
                    const item = document.createElement('div');
                    item.textContent = art.name;
                    item.style.padding = '12px 16px';
                    item.style.cursor = 'pointer';
                    item.style.borderBottom = '1px solid var(--line)';
                    item.style.fontSize = '16px';
                    item.style.color = 'var(--ink)';
                    item.style.fontFamily = "'Nunito', sans-serif";

                    // Hover background effect
                    item.addEventListener('mouseover', () => item.style.background = 'var(--bg)');
                    item.addEventListener('mouseout', () => item.style.background = 'transparent');

                    // Selection logic triggers album queries smoothly
                    item.addEventListener('click', () => {
                        inputArtista.value = art.name; // Sets exact official name (e.g. ROSALÍA)
                        viewArtista.textContent = art.name;
                        dropdownArtistas.style.display = 'none';
                        buscarAlbumes(art.id);
                    });

                    dropdownArtistas.appendChild(item);
                });

                dropdownArtistas.style.display = 'block';
            })
            .catch(err => {
                console.error("Error fetching artist autocomplete list:", err);
                dropdownArtistas.style.display = 'none';
            });

    }, 400); 
});

// ======================================================
// 2. FETCH ALBUMS (LPs Only)
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
// 3. FETCH TRACKLIST FROM ALBUM
// ======================================================
selectAlbumes.addEventListener('change', () => {
    const idAlbum = selectAlbumes.value;
    if (!idAlbum) return;

    viewAlbum.textContent = selectAlbumes.options[selectAlbumes.selectedIndex].text;

    fetch(`https://musicbrainz.org{idAlbum}?inc=recordings&fmt=json`, {
        headers: { "User-Agent": USER_AGENT }
    })
    .then(res => res.json())
    .then(data => {
        listaCanciones.innerHTML = '';
        const tracks = data.media?.[0]?.tracks || [];

        if (tracks.length === 0) {
            listaCanciones.innerHTML = '<p style="text-align:center;color:var(--muted)">No tracks found for this album.</p>';
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
// 4. RENDER AND DOWNLOAD IMAGE
// ======================================================
btnDescargar.addEventListener('click', () => {
    const contenedor = document.getElementById('zona-captura');

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

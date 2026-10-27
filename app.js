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

// Watermark dinámico
document.getElementById('marca-agua').textContent =
  `MADE AT: ${window.location.host.toUpperCase()}`;


// ======================================================
// UTILIDAD: eliminar tildes
// ======================================================
function sinTildes(texto) {
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}


// ======================================================
// 1. AUTOCOMPLETE DE ARTISTAS
// ======================================================
inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);

    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) return;

    const normalizada = sinTildes(busqueda);

    timerBusqueda = setTimeout(() => {

        const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(normalizada)}&limit=25&fmt=json`;

        fetch(url, { headers: { "User-Agent": USER_AGENT } })
            .then(res => res.json())
            .then(data => {
                datalistArtistas.innerHTML = '';

                if (!data.artists || data.artists.length === 0) return;

                // Filtrar duplicados por ID
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
// 2. DETECTAR SELECCIÓN DE ARTISTA
// ======================================================
inputArtista.addEventListener('change', () => {
    const opciones = Array.from(datalistArtistas.options);
    const seleccion = opciones.find(opt => opt.value === inputArtista.value);

    if (seleccion) {
        const idArtista = seleccion.dataset.id;
        view

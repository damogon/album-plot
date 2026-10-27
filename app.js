let timerBusqueda;
// MusicBrainz exige identificar tu aplicación con un correo o nombre descriptivo en las peticiones
const USER_AGENT = "RankMusicApp/1.0.0 (contacto-tu-email@ejemplo.com)";

const inputArtista = document.getElementById('artista');
const datalistArtistas = document.getElementById('lista-artistas');
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
const viewArtista = document.getElementById('view-artista');
const viewAlbum = document.getElementById('view-album');
const btnDescargar = document.getElementById('btn-descargar');

// Actualizar la marca de agua con la URL real de tu página automáticamente
document.getElementById('marca-agua').textContent = `HECHO EN: ${window.location.host.toUpperCase()}`;

// 1. AUTOCOMPLETADO DE ARTISTAS (Espera 400ms tras teclear para no saturar la API)
inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);
    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) return;

    timerBusqueda = setTimeout(() => {
        fetch(`https://musicbrainz.org{encodeURIComponent(busqueda)}&fmt=json`, {
            headers: { 'User-Agent': USER_AGENT }
        })
        .then(res => res.json())
        .then(data => {
            datalistArtistas.innerHTML = '';
            // Tomamos los primeros 5 resultados coincidentes
            data.artists.slice(0, 5).forEach(art => {
                const option = document.createElement('option');
                option.value = art.name;
                option.dataset.id = art.id;
                datalistArtistas.appendChild(option);
            });
        }).catch(err => console.error("Error buscando artista:", err));
    }, 400);
});

// Detectar selección definitiva del artista
inputArtista.addEventListener('change', () => {
    const opciones = Array.from(datalistArtistas.options);
    const seleccion = opciones.find(opt => opt.value === inputArtista.value);
    
    if (seleccion) {
        const idArtista = seleccion.dataset.id;
        viewArtista.textContent = inputArtista.value;
        buscarAlbumes(idArtista);
    }
});

// 2. BUSCAR LOS ÁLBUMES DEL ARTISTA SELECCIONADO
function buscarAlbumes(idArtista) {
    fetch(`https://musicbrainz.org{idArtista}&limit=40&fmt=json`, {
        headers: { 'User-Agent': USER_AGENT }
    })
    .then(res => res.json())
    .then(data => {
        selectAlbumes.innerHTML = '<option value="">-- Elige un Álbum --</option>';
        
        // Filtrar nombres repetidos (MusicBrainz repite discos si hay ediciones de distintos países)
        const discosUnicos = new Set();
        data.releases.forEach(rel => {
            if (!discosUnicos.has(rel.title)) {
                discosUnicos.add(rel.title);
                const option = document.createElement('option');
                option.value = rel.id;
                option.textContent = rel.title;
                selectAlbumes.appendChild(option);
            }
        });
        selectAlbumes.disabled = false;
    }).catch(err => console.error("Error buscando álbumes:", err));
}

// 3. OBTENER LAS CANCIONES DEL ÁLBUM SELECCIONADO
selectAlbumes.addEventListener('change', () => {
    const idAlbum = selectAlbumes.value;
    if (!idAlbum) return;

    viewAlbum.textContent = selectAlbumes.options[selectAlbumes.selectedIndex].text;

    fetch(`https://musicbrainz.org{idAlbum}?inc=recordings&fmt=json`, {
        headers: { 'User-Agent': USER_AGENT }
    })
    .then(res => res.json())
    .then(data => {
        listaCanciones.innerHTML = '';
        const tracks = data.media?.[0]?.tracks || [];
        
        if(tracks.length === 0) {
            listaCanciones.innerHTML = '<p style="text-align:center;color:var(--muted)">No se encontraron canciones para este disco.</p>';
            return;
        }

        tracks.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'cancion-item';
            item.innerHTML = `
                <span class="cancion-nombre">${index + 1}. ${track.title}</span>
                <input type="number" class="nota-input" min="1" max="10" placeholder="-" oninput="validarRango(this)">
            `;
            listaCanciones.appendChild(item);
        });
        btnDescargar.disabled = false;
    }).catch(err => console.error("Error obteniendo canciones:", err));
});

// Limitar de forma estricta que solo se escriba del 1 al 10
function validarRango(input) {
    let num = parseInt(input.value);
    if (num > 10) input.value = 10;
    if (num < 1) input.value = '';
}

// 4. GENERAR Y DESCARGAR LA IMAGEN FINAL (html2canvas)
btnDescargar.addEventListener('click', () => {
    const contenedor = document.getElementById('zona-captura');
    
    // Forzar que los inputs muestren su valor actual en el pantallazo del canvas
    const inputs = contenedor.querySelectorAll('.nota-input');
    inputs.forEach(input => input.setAttribute('value', input.value));

    html2canvas(contenedor, {
        scale: 2, // Duplica la resolución de imagen para que se lea nítida en Twitter
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true // Evita bloqueos de recursos externos si añades portadas en el futuro
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `${viewAlbum.textContent.replace(/[^a-z0-9]/gi, '_')}_ranking.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
});

let timerBusqueda;
const USER_AGENT = "RateThisAlbumApp/1.0.0 (info@ratethisalbum.com)";

const inputArtista = document.getElementById('artista');
const datalistArtistas = document.getElementById('lista-artistas');
const selectAlbumes = document.getElementById('albumes');
const listaCanciones = document.getElementById('lista-canciones');
const viewArtista = document.getElementById('view-artista');
const viewAlbum = document.getElementById('view-album');
const btnDescargar = document.getElementById('btn-descargar');

// The dynamic watermark uses the current web host name to strip away hardcoded GitHub profiles
document.getElementById('marca-agua').textContent = `MADE AT: ${window.location.host.toUpperCase()}`;

// 1. ARTIST AUTOCOMPLETE
inputArtista.addEventListener('input', () => {
    clearTimeout(timerBusqueda);
    const busqueda = inputArtista.value.trim();
    if (busqueda.length < 2) return;

    timerBusqueda = setTimeout(() => {
        // FIXED: URL structure corrected with correct forward slashes, question marks, and template literals
        fetch(`https://musicbrainz.org{encodeURIComponent(busqueda)}&fmt=json`, {
            headers: { 'User-Agent': USER_AGENT }
        })
        .then(res => res.json())
        .then(data => {
            datalistArtistas.innerHTML = '';
            if (!data.artists) return;
            
            data.artists.slice(0, 5).forEach(art => {
                const option = document.createElement('option');
                option.value = art.name;
                option.dataset.id = art.id;
                datalistArtistas.appendChild(option);
            });
        }).catch(err => console.error("Error fetching artist:", err));
    }, 400);
});

// Detect definitive artist selection
inputArtista.addEventListener('change', () => {
    const opciones = Array.from(datalistArtistas.options);
    const seleccion = opciones.find(opt => opt.value === inputArtista.value);
    
    if (seleccion) {
        const idArtista = seleccion.dataset.id;
        viewArtista.textContent = inputArtista.value;
        buscarAlbumes(idArtista);
    }
});

// 2. FETCH ALBUMS
function buscarAlbumes(idArtista) {
    // FIXED: Corrected the endpoint query mapping for releases
    fetch(`https://musicbrainz.org{idArtista}&limit=40&fmt=json`, {
        headers: { 'User-Agent': USER_AGENT }
    })
    .then(res => res.json())
    .then(data => {
        selectAlbumes.innerHTML = '<option value="">-- Select an Album --</option>';
        if (!data.releases) return;
        
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
    }).catch(err => console.error("Error fetching albums:", err));
}

// 3. FETCH TRACKLIST
selectAlbumes.addEventListener('change', () => {
    const idAlbum = selectAlbumes.value;
    if (!idAlbum) return;

    viewAlbum.textContent = selectAlbumes.options[selectAlbumes.selectedIndex].text;

    // FIXED: Properly formatted lookup string using backticks and variables
    fetch(`https://musicbrainz.org{idAlbum}?inc=recordings&fmt=json`, {
        headers: { 'User-Agent': USER_AGENT }
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
            item.innerHTML = `
                <span class="cancion-nombre">${index + 1}. ${track.title}</span>
                <input type="number" class="nota-input" min="1" max="10" placeholder="-" oninput="validarRango(this)">
            `;
            listaCanciones.appendChild(item);
        });
        btnDescargar.disabled = false;
    }).catch(err => console.error("Error fetching tracklist:", err));
});

function validarRango(input) {
    let num = parseInt(input.value);
    if (num > 10) input.value = 10;
    if (num < 1) input.value = '';
}

// 4. IMAGE RENDER & DOWNLOAD
btnDescargar.addEventListener('click', () => {
    const contenedor = document.getElementById('zona-captura');
    
    const inputs = contenedor.querySelectorAll('.nota-input');
    inputs.forEach(input => input.setAttribute('value', input.value));

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

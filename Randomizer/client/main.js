/**
 * main.js
 * Lógica:
 *  - Cargar una (o varias) playlists, pedirla(s) a /api/playlist
 *  - Almacenar resultados en localStorage (comprimidos con LZString)
 *  - Manejo de IFrame Player API para reproducir, onError => pasar al siguiente.
 *  - Búsqueda local con Elasticlunr (En construccion)
 */

// Claves para localStorage
const KEY_PLAYLIST = "myrnd-playlist"; // Para JSON comprimido
const KEY_IDX      = "myrnd-idx";      // Índice actual
const KEY_PID      = "myrnd-pid";      // IDs guardados

let videos = [];
let currentIndex = 0;
let player = null; // Instancia de la IFrame Player (para evitar video no disponible en youtube)

// URL de tu back-end en Render (o donde esté tu servidor Node)
const baseURL = "https://randomizer-cg53.onrender.com";

/**
 * Cuando se cargue el DOM, configuramos eventos
 */
document.addEventListener("DOMContentLoaded", () => {
  const loadBtn = document.getElementById("loadBtn");
  const resumeBtn = document.getElementById("resumeBtn");

  // Si en localStorage hay sesión previa (videos + índice + pid), mostramos el botón para retomarla
  if (localStorage.getItem(KEY_PLAYLIST) && localStorage.getItem(KEY_IDX) && localStorage.getItem(KEY_PID)) {
    resumeBtn.classList.remove("hidden");
  }

  // Al pulsar "Cargar Playlist"
  loadBtn.addEventListener("click", () => {
    const pidInput = document.getElementById("playlistId").value.trim();
    if (!pidInput) {
      alert("Ingresa un ID de playlist o una URL válida de YouTube.");
      return;
    }
    loadPlaylist(pidInput);
  });

  // Al pulsar "Retomar Sesión Anterior"
  resumeBtn.addEventListener("click", () => {
    resumeSession();
  });

  // Botones de anterior/siguiente en el reproductor
  document.getElementById("prevBtn").addEventListener("click", () => {
    playVideoAtIndex(currentIndex - 1);
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    playVideoAtIndex(currentIndex + 1);
  });

  // Evento al cambiar manualmente en la lista de videos
  document.getElementById("playlistView").addEventListener("change", (e) => {
    const idx = parseInt(e.target.value, 10);
    playVideoAtIndex(idx);
  });

  // Búsqueda local (en construcción)
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");

  // Cada vez que tecleamos en la búsqueda
  searchInput.addEventListener("keyup", () => {
    const query = searchInput.value.trim();
    if (query.length < 3) {
      searchResults.classList.add("hidden");
      return;
    }
    // Filtrar usando elasticlunr
    const results = idxSearch(query);
    searchResults.innerHTML = "";

    results.forEach(r => {
      // r.ref es el índice en 'videos'
      const opt = document.createElement("option");
      opt.value = r.ref;
      opt.textContent = r.ref + " - " + videos[r.ref].title;
      searchResults.appendChild(opt);
    });

    if (results.length > 0) {
      searchResults.size = Math.min(results.length, 8);
      searchResults.classList.remove("hidden");
    } else {
      searchResults.classList.add("hidden");
    }
  });

  // Al hacer clic en un resultado de búsqueda
  searchResults.addEventListener("click", () => {
    const val = parseInt(searchResults.value, 10);
    if (!isNaN(val)) {
      playVideoAtIndex(val);
    }
  });
});

/**
 * 1) Función para extraer el playlistId de una URL o devolver la cadena si ya es un ID
 */
function getPlaylistIdFromUrl(urlOrId) {
  try {
    // Si NO contiene "youtube.com", asumimos que es directamente un ID (p. ej. PLxxxxx)
    if (!urlOrId.includes("youtube.com")) {
      return urlOrId;
    }
    const url = new URL(urlOrId);
    // Tomamos el valor del parámetro "list"
    return url.searchParams.get("list");
  } catch (error) {
    // Si falla, devolvemos la misma cadena por si era un ID
    return urlOrId;
  }
}

/**
 * 2) Llama al servidor /api/playlist?playlistId=...
 * Soporta URL completa o solo ID
 */
async function loadPlaylist(pidInput) {
  try {
    // Extraemos el ID real de la playlist
    const playlistId = getPlaylistIdFromUrl(pidInput);

    // Construimos la URL de la petición al back-end
    const url = `${baseURL}/api/playlist?playlistId=${encodeURIComponent(playlistId)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      alert("Error al contactar con el servidor");
      return;
    }
    const data = await resp.json();
    if (data.status !== 200) {
      alert("No se pudo cargar la playlist");
      return;
    }

    videos = data.response;
    // Mezclar (Fisher-Yates):
    shuffleArray(videos);

    currentIndex = 0;
    // Guardar en localStorage (puedes guardar 'playlistId' o 'pidInput')
    saveSession(pidInput);

    // Mostrar el área de reproducción y rellenar la lista
    document.getElementById("playerArea").classList.remove("hidden");
    fillPlaylistView();
    createPlayerIfNeeded();
    playVideoAtIndex(currentIndex);

  } catch (err) {
    console.error(err);
    alert("Ocurrió un error al obtener la playlist");
  }
}

/**
 * 3) Rellena el <select> con la lista de videos randomizados
 */
function fillPlaylistView() {
  const sel = document.getElementById("playlistView");
  sel.innerHTML = "";
  videos.forEach((vid, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = `(${idx}) ${vid.title}`;
    sel.appendChild(opt);
  });
  sel.classList.remove("hidden");
}

/**
 * 4) Guardar la sesión en localStorage (videos + índice + "pid")
 */
function saveSession(pid) {
  // Comprimir con LZString
  const comp = LZString.compressToUTF16(JSON.stringify(videos));
  localStorage.setItem(KEY_PLAYLIST, comp);
  localStorage.setItem(KEY_IDX, currentIndex.toString());
  localStorage.setItem(KEY_PID, pid);
}

/**
 * 5) Retomar la sesión previa en localStorage
 */
function resumeSession() {
  const comp = localStorage.getItem(KEY_PLAYLIST);
  videos = JSON.parse(LZString.decompressFromUTF16(comp));
  currentIndex = parseInt(localStorage.getItem(KEY_IDX), 10) || 0;

  // Mostramos el reproductor y la lista
  document.getElementById("playerArea").classList.remove("hidden");
  fillPlaylistView();
  createPlayerIfNeeded();
  playVideoAtIndex(currentIndex);
}

/**
 * 6) Crear el iframe de YouTube si no existe todavía
 */
function createPlayerIfNeeded() {
  if (window.YT && window.YT.Player) {
    if (!player) {
      createIframePlayer();
    }
  } else {
    // Cargar la librería de la IFrame Player API
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    // Cuando la API se cargue, llamará a onYouTubeIframeAPIReady()
    window.onYouTubeIframeAPIReady = () => {
      createIframePlayer();
    };
  }
}

/**
 * 7) Crear el reproductor embebido
 */
function createIframePlayer() {
  player = new YT.Player("iframe-container", {
    width: "640",
    height: "360",
    videoId: (videos[0]?.id) || "dQw4w9WgXcQ", 
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0
    },
    events: {
      onReady: (event) => {
        event.target.playVideo();
      },
      onError: (event) => {
        // Cuando falla un video, saltamos al siguiente
        setTimeout(() => {
          playVideoAtIndex(currentIndex + 1);
        }, 2000);
      },
      onStateChange: (event) => {
        // Si termina, pasamos al siguiente
        if (event.data === YT.PlayerState.ENDED) {
          playVideoAtIndex(currentIndex + 1);
        }
      }
    }
  });
}

/**
 * 8) Reproduce el video en la posición idx (con comportamiento "circular")
 */
function playVideoAtIndex(idx) {
  if (!videos || videos.length === 0) return;

  // Comportamiento circular: si sale de rango, volvemos al inicio o al final
  if (idx < 0) idx = videos.length - 1;
  if (idx >= videos.length) idx = 0;

  currentIndex = idx;
  document.getElementById("playlistView").value = idx;

  if (player && player.loadVideoById) {
    const videoId = videos[idx].id;
    player.loadVideoById(videoId);
  }

  localStorage.setItem(KEY_IDX, currentIndex.toString());
}

/**
 * 9) Algoritmo de Fisher-Yates para mezclar la lista
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 10) Búsqueda local con elasticlunr (en construcción)
 */
let elasticIndex = null;
function buildIndexIfNeeded() {
  if (!elasticIndex) {
    elasticIndex = elasticlunr(function() {
      this.setRef("idx");
      this.addField("title");
    });
    videos.forEach((v, i) => {
      elasticIndex.addDoc({ idx: i, title: v.title });
    });
  }
}

function idxSearch(query) {
  buildIndexIfNeeded();
  // bool: "AND", expand: true => busca palabras parciales
  const results = elasticIndex.search(query, { bool: "AND", expand: true });
  return results; // { ref: 'X', score: #, doc: {...} }
}

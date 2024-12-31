/**
 * main.js
 * -------------
 * Lógica front-end:
 *  - Cargar una (o varias) playlists, pedirla(s) a /api/playlist
 *  - Almacenar resultados en localStorage (comprimidos con LZString)
 *  - Manejo de IFrame Player API para reproducir, onError => pasar al siguiente.
 *  - Búsqueda local con Elasticlunr
 */

const KEY_PLAYLIST = "myrnd-playlist"; // para JSON comprimido
const KEY_IDX      = "myrnd-idx";      // índice actual
const KEY_PID      = "myrnd-pid";      // IDs guardados

let videos = [];
let currentIndex = 0;
let player = null; // Instancia de la IFrame Player

document.addEventListener("DOMContentLoaded", () => {
  const loadBtn = document.getElementById("loadBtn");
  const resumeBtn = document.getElementById("resumeBtn");

  // Si en localStorage tenemos datos previos:
  if (localStorage.getItem(KEY_PLAYLIST) && localStorage.getItem(KEY_IDX) && localStorage.getItem(KEY_PID)) {
    resumeBtn.classList.remove("hidden");
  }

  loadBtn.addEventListener("click", () => {
    const pid = document.getElementById("playlistId").value.trim();
    if (!pid) {
      alert("Ingresa un ID de playlist.");
      return;
    }
    loadPlaylist(pid);
  });

  resumeBtn.addEventListener("click", () => {
    resumeSession();
  });

  document.getElementById("prevBtn").addEventListener("click", () => {
    playVideoAtIndex(currentIndex - 1);
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    playVideoAtIndex(currentIndex + 1);
  });

  // Cuando el usuario elige algo en la lista textual
  document.getElementById("playlistView").addEventListener("change", (e) => {
    const idx = parseInt(e.target.value, 10);
    playVideoAtIndex(idx);
  });

  // Configurar búsqueda local
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");

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

  // Al hacer clic en un resultado
  searchResults.addEventListener("click", () => {
    const val = parseInt(searchResults.value, 10);
    if (!isNaN(val)) {
      playVideoAtIndex(val);
    }
  });
});

/**
 * Llama a nuestro servidor /api/playlist?playlistId=...
 */
async function loadPlaylist(pid) {
  try {
    const url = `/api/playlist?playlistId=${encodeURIComponent(pid)}`;
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
    // Si quieres barajar (Fisher-Yates):
    shuffleArray(videos);

    currentIndex = 0;
    // Guardar en localStorage
    saveSession(pid);

    // Mostrar el área de reproducción
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
 * Rellena el <select> con la lista de videos randomizados
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
 * Guarda la sesión en localStorage
 */
function saveSession(pid) {
  // Comprimir con LZString
  const comp = LZString.compressToUTF16(JSON.stringify(videos));
  localStorage.setItem(KEY_PLAYLIST, comp);
  localStorage.setItem(KEY_IDX, currentIndex.toString());
  localStorage.setItem(KEY_PID, pid);
}

/**
 * Retoma lo que hay en localStorage
 */
function resumeSession() {
  const comp = localStorage.getItem(KEY_PLAYLIST);
  videos = JSON.parse(LZString.decompressFromUTF16(comp));
  currentIndex = parseInt(localStorage.getItem(KEY_IDX), 10) || 0;

  document.getElementById("playerArea").classList.remove("hidden");
  fillPlaylistView();
  createPlayerIfNeeded();
  playVideoAtIndex(currentIndex);
}

/**
 * Crea el iframe de YouTube si no existe todavía
 */
function createPlayerIfNeeded() {
  if (window.YT && window.YT.Player) {
    if (!player) {
      createIframePlayer();
    }
  } else {
    // Cargar la librería de la IFrame Player API
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      createIframePlayer();
    };
  }
}

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
        // Cuando falla, saltamos al siguiente
        setTimeout(() => {
          playVideoAtIndex(currentIndex + 1);
        }, 2000);
      },
      onStateChange: (event) => {
        // Si termina, pasar al siguiente
        if (event.data === YT.PlayerState.ENDED) {
          playVideoAtIndex(currentIndex + 1);
        }
      }
    }
  });
}

/**
 * Reproduce el video en el índice idx (con comportamiento "circular")
 */
function playVideoAtIndex(idx) {
  if (!videos || videos.length === 0) return;

  // Circular
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
 * Fisher-Yates shuffle para mezclar la lista
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Búsqueda local con elasticlunr
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
  // Devuelve array de { ref: 'X', score: #, doc: {...} }
  return results;
}

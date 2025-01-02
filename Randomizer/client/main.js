// Claves para localStorage
const KEY_PLAYLIST = "myrnd-playlist"; // Para JSON comprimido
const KEY_IDX      = "myrnd-idx";      // Índice actual
const KEY_PID      = "myrnd-pid";      // IDs guardados
const KEY_SAVED    = "myrnd-saved";   // Canciones guardadas

let videos = [];
let savedSongs = JSON.parse(localStorage.getItem(KEY_SAVED)) || [];
let currentIndex = 0;
let player = null; // Instancia de la IFrame Player (para evitar video no disponible en youtube)

// URL de tu back-end en Render (o donde esté tu servidor Node)
const baseURL = "https://randomizer-cg53.onrender.com";

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM completamente cargado.");

  const loadBtn = document.getElementById("loadBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");

  if (localStorage.getItem(KEY_PLAYLIST) && localStorage.getItem(KEY_IDX) && localStorage.getItem(KEY_PID)) {
    console.log("Sesión previa detectada en localStorage.");
    resumeBtn.classList.remove("hidden");
  }

  loadBtn.addEventListener("click", () => {
    const pidInput = document.getElementById("playlistId").value.trim();
    console.log("Cargar Playlist presionado. ID/URL introducido:", pidInput);
    if (!pidInput) {
      alert("Ingresa un ID de playlist o una URL válida de YouTube.");
      return;
    }
    loadPlaylist(pidInput);
  });

  resumeBtn.addEventListener("click", () => {
    console.log("Retomar sesión anterior.");
    resumeSession();
  });

  document.getElementById("prevBtn").addEventListener("click", () => {
    console.log("Reproducir video anterior.");
    playVideoAtIndex(currentIndex - 1);
  });

  document.getElementById("nextBtn").addEventListener("click", () => {
    console.log("Reproducir video siguiente.");
    playVideoAtIndex(currentIndex + 1);
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    console.log("Entrada en barra de búsqueda:", query);
    searchResults.innerHTML = "";

    if (query.length === 0) {
        console.log("No se ingresó término de búsqueda. Ocultando resultados.");
        searchResults.classList.add("hidden");
        return;
    }

    const results = idxSearch(query);
    console.log("Resultados de búsqueda:", results);
    const filteredVideos = results.map(r => videos[parseInt(r.ref, 10)]);
    fillSearchResults(filteredVideos);
  });

  renderSavedSongs();
});

function getPlaylistIdFromUrl(urlOrId) {
  try {
    if (!urlOrId.includes("youtube.com")) {
      return urlOrId;
    }
    const url = new URL(urlOrId);
    return url.searchParams.get("list");
  } catch (error) {
    console.error("Error al extraer el ID de la playlist:", error);
    return urlOrId;
  }
}

async function loadPlaylist(pidInput) {
  try {
    const playlistId = getPlaylistIdFromUrl(pidInput);
    console.log("1. Playlist ID extraído:", playlistId); // Verifica el ID extraído

    const url = `${baseURL}/api/playlist?playlistId=${encodeURIComponent(playlistId)}`;
    console.log("2. URL para cargar la playlist:", url); // Verifica la URL construida

    const resp = await fetch(url);
    console.log("3. Respuesta del servidor (cruda):", resp); // ¡IMPORTANTE!
    if (!resp.ok) {
      console.error("Error al contactar con el servidor:", resp.status, await resp.text()); // Incluye el texto del error
      alert("Error al contactar con el servidor. Código: " + resp.status);
      return;
    }

    const data = await resp.json();
    if (data.status !== 200) {
      console.error("5. Error en la respuesta del servidor:", data);
      alert("No se pudo cargar la playlist: " + (data.message || "Error desconocido"));
      return;
    }

    videos = data.response;
    console.log("6. Videos cargados:", videos);

    shuffleArray(videos);

    currentIndex = 0;
    saveSession(pidInput);

    document.getElementById("playerArea").classList.remove("hidden");
    renderPlaylistView();
    buildIndexIfNeeded(true);

    if (!player) {
      console.log("Inicializando reproductor de YouTube.");
      createPlayerIfNeeded(() => {
        console.log("Reproductor inicializado, reproduciendo video inicial.");
        playVideoAtIndex(currentIndex);
      });
    } else {
      playVideoAtIndex(currentIndex);
    }
  } catch (err) {
    console.error("Error al cargar la playlist:", err);
    alert("Ocurrió un error al obtener la playlist");
  }
}
function fillSearchResults(results) {
  const searchResults = document.getElementById("searchResults");
  searchResults.innerHTML = "";

  if (results.length === 0) {
    searchResults.classList.add("hidden");
    return;
  }

  results.forEach((video, index) => {
    const li = document.createElement("li");
    li.className = "search-item";
    li.dataset.index = videos.indexOf(video);
    li.textContent = video.title;

    li.addEventListener("click", () => {
      playVideoAtIndex(parseInt(li.dataset.index, 10));
    });

    searchResults.appendChild(li);
  });

  searchResults.classList.remove("hidden");
}

function renderPlaylistView() {
  const container = document.getElementById("playlistView");
  container.innerHTML = "";

  videos.forEach((video, index) => {
    const li = document.createElement("li");
    li.className = `playlist-item ${index === currentIndex ? 'current' : ''}`;
    li.dataset.index = index;
    li.innerHTML = `<span style="display: inline-block; width: 5%;">${index + 1}</span><span class="note-icon" style="display: inline-block; width: 5%;">❤</span> <span style="text-align: left; display: inline-block; width: 70%;">${video.title}</span> <span style="display: inline-flex; justify-content: flex-end; width: 20%; gap: 10px;"><span class="favorite-icon">${savedSongs.includes(video.id) ? "★" : "☆"}</span><a href="https://www.youtube.com/watch?v=${video.id}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" style="text-decoration: none;">🔗</a></span>`;

    const favIcon = li.querySelector(".favorite-icon");
    favIcon.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSaveSong(video);
      favIcon.textContent = savedSongs.includes(video.id) ? "★" : "☆";
    });

    li.addEventListener("click", () => {
      playVideoAtIndex(index);
    });

    container.appendChild(li);
  });
}

function renderSavedSongs() {
  const savedSongsList = document.getElementById("savedSongsList");
  savedSongsList.innerHTML = "";
  savedSongs.forEach(songId => {
    const song = videos.find(v => v.id === songId);
    if (song) {
      const li = document.createElement("li");
      li.innerHTML = `<a href="https://www.youtube.com/watch?v=${song.id}" target="_blank" rel="noopener noreferrer">${song.title}</a>`;
      savedSongsList.appendChild(li);
    }
  });
}

function toggleSaveSong(song) {
  if (savedSongs.includes(song.id)) {
    savedSongs = savedSongs.filter(id => id !== song.id);
  } else {
    savedSongs.push(song.id);
  }
  localStorage.setItem(KEY_SAVED, JSON.stringify(savedSongs));
  renderSavedSongs();
}

function saveSession(pid) {
  console.log("Guardando sesión en localStorage.");
  const comp = LZString.compressToUTF16(JSON.stringify(videos));
  localStorage.setItem(KEY_PLAYLIST, comp);
  localStorage.setItem(KEY_IDX, currentIndex.toString());
  localStorage.setItem(KEY_PID, pid);
}

function resumeSession() {
  console.log("Retomando sesión desde localStorage.");
  const comp = localStorage.getItem(KEY_PLAYLIST);
  videos = JSON.parse(LZString.decompressFromUTF16(comp));
  console.log("Videos restaurados:", videos);
  currentIndex = parseInt(localStorage.getItem(KEY_IDX), 10) || 0;

  document.getElementById("playerArea").classList.remove("hidden");
  renderPlaylistView();
  buildIndexIfNeeded();

  if (!player) {
    console.log("Inicializando reproductor de YouTube.");
    createPlayerIfNeeded(() => {
      console.log("Reproductor inicializado, retomando video en índice:", currentIndex);
      playVideoAtIndex(currentIndex);
    });
  } else {
    playVideoAtIndex(currentIndex);
  }
}

function createPlayerIfNeeded(callback) {
  if (window.YT && window.YT.Player) {
    if (!player) {
      createIframePlayer(callback);
    } else if (callback) {
      callback();
    }
  } else {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      createIframePlayer(callback);
    };
  }
}

function createIframePlayer(callback) {
  console.log("Creando reproductor de YouTube.");
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
        console.log("Reproductor listo, reproduciendo video inicial.");
        event.target.playVideo();
        updateTitleAndProgress();
        if (callback) callback();
      },
      onError: (event) => {
        console.error("Error en el reproductor de YouTube, saltando al siguiente video:", event);
        setTimeout(() => {
          playVideoAtIndex(currentIndex + 1);
        }, 2000);
      },
      onStateChange: (event) => {
        if (event.data === YT.PlayerState.ENDED) {
          console.log("Video terminado, reproduciendo el siguiente.");
          playVideoAtIndex(currentIndex + 1);
        }
      }
    }
  });
}

function playVideoAtIndex(idx) {
    if (!videos || videos.length === 0) return;

    console.log("Reproduciendo video en índice:", idx);

    if (idx < 0) idx = videos.length - 1;
    if (idx >= videos.length) idx = 0;

    currentIndex = idx;

    const video = videos[idx];
    if (video && player) { // Comprueba si el video y el reproductor existen
        const videoId = video.id;
        console.log("Cargando video en el reproductor:", videoId);
        player.loadVideoById(videoId);
        updateTitleAndProgress();
    } else {
        console.error("Video no encontrado o reproductor no inicializado.");
         if (!player) {
             createPlayerIfNeeded(() => {
                 playVideoAtIndex(currentIndex);
             })
         }
    }

    localStorage.setItem(KEY_IDX, currentIndex.toString());
    renderPlaylistView();
}

function shuffleArray(arr) {
  console.log("Mezclando videos.");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

let elasticIndex = null;
function buildIndexIfNeeded(forceRebuild = false) {
  if (!elasticIndex || forceRebuild) {
    console.log("Construyendo índice de búsqueda.");
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
  console.log("Realizando búsqueda con término:", query);
  buildIndexIfNeeded();
  const results = elasticIndex.search(query, { bool: "AND", expand: true });
  console.log("Resultados encontrados:", results);
  return results;
}

function updateTitleAndProgress() {
  if (!player || !videos[currentIndex]) return;

  const videoTitle = videos[currentIndex].title || "Título no disponible";
  const totalVideos = videos.length;
  const currentVideoNumber = currentIndex + 1;

  // Limpia cualquier intervalo previo
  if (window.titleUpdateInterval) clearInterval(window.titleUpdateInterval);

  window.titleUpdateInterval = setInterval(() => {
    if (player.getPlayerState() === YT.PlayerState.PLAYING) {
      const currentTime = player.getCurrentTime() || 0;
      const duration = player.getDuration() || 1; // Evita división por cero
      const progress = ((currentTime / duration) * 100).toFixed(2);

      document.title = `Song Progress: ${progress}% of "${videoTitle}" ~ (${currentVideoNumber}/${totalVideos}) of playlist.`;
    }
  }, 1000);
}

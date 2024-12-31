/**
 * server.js
 * -----------
 * Servidor Node + Express que:
 * 1. Lee .env para obtener la clave de YouTube.
 * 2. Ofrece un endpoint /api/playlist?playlistId=...
 * 3. Llama a la YouTube Data API para recoger todos los videos de la playlist (paginando).
 * 4. Devuelve la lista en JSON al front-end.
 */
const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Tu API key de YouTube (desde .env)
const YT_API_KEY = process.env.YT_API_KEY;

if (!YT_API_KEY) {
  console.error("ERROR: Debes configurar YT_API_KEY en tu archivo .env");
  process.exit(1);
}

// Servir archivos estáticos de la carpeta ../client
app.use(express.static('../client'));

/**
 * GET /api/playlist?playlistId=<ID_O_IDS>
 * Acepta un ID de playlist (por ejemplo "PLxxxxx") o varios separados con "~:-".
 */
app.get('/api/playlist', async (req, res) => {
  try {
    let playlistId = req.query.playlistId; 
    if (!playlistId) {
      return res.status(400).json({ status: 400, message: "No playlistId provided." });
    }

    // Aceptar múltiples IDs separados por "~:-"
    let listArr = playlistId.split("~:-").map(id => id.trim()).filter(id => id.length > 0);

    let allVideos = [];
    let combinedTitle = []; // para concatenar títulos

    // Para cada ID, llamamos a la API de YouTube y paginamos
    for (let singleId of listArr) {
      let results = await getAllVideosFromYouTube(singleId);
      if (results && results.items) {
        allVideos = allVideos.concat(
          results.items.map(v => ({
            id: v.snippet.resourceId.videoId,
            title: v.snippet.title,
            thumbnail: v.snippet.thumbnails?.default?.url || "",
          }))
        );
        combinedTitle.push(results.playlistTitle || singleId);
      }
    }

    // Respuesta final
    res.json({
      status: 200,
      title: combinedTitle.join(" + "),
      response: allVideos,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, message: "Server error" });
  }
});


/**
 * Función para obtener TODOS los videos de una playlist (paginación de 50 en 50).
 * Devuelve { items, playlistTitle }
 */
async function getAllVideosFromYouTube(playlistId) {
  let items = [];
  let nextPageToken = "";
  let playlistTitle = "";

  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&pageToken=${nextPageToken}&playlistId=${playlistId}&key=${YT_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`YouTube API error: ${resp.status}`);
    }
    const data = await resp.json();

    // Obtener título genérico (opcional)
    if (!playlistTitle && data.items && data.items[0]) {
      playlistTitle = data.items[0].snippet.channelTitle; 
      // O data.items[0].snippet.title si prefieres.
    }

    items = items.concat(data.items);
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);

  return { items, playlistTitle };
}


app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log("Pulsa CTRL+C para detener.");
});

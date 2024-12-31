/**
 * server.js
 * -----------
 * Servidor Node + Express que:
 * 1. Lee .env para obtener la clave de YouTube.
 * 2. Ofrece un endpoint /api/playlist?playlistId=...
 * 3. Llama a la YouTube Data API para recoger todos los videos de la playlist (paginando).
 * 4. Devuelve la lista en JSON al front-end.
 */

require('dotenv').config();        // Carga variables de entorno (YT_API_KEY)
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// 1) Habilitamos CORS antes de definir las rutas
app.use(cors());

const PORT = process.env.PORT || 3000;

// Tomamos la API key de las variables de entorno
const YT_API_KEY = process.env.YT_API_KEY;
if (!YT_API_KEY) {
  console.error("ERROR: Debes configurar YT_API_KEY en tu archivo .env o en las variables de entorno.");
  process.exit(1);
}

/**
 * Función para obtener TODOS los videos de una playlist (paginación de 50 en 50).
 * Retorna un objeto { items, playlistTitle } con la lista de ítems y el título.
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

    // Tomamos algún título genérico de la playlist (opcional)
    if (!playlistTitle && data.items && data.items[0]) {
      playlistTitle = data.items[0].snippet.channelTitle;
      // O podrías usar: data.items[0].snippet.title, si prefieres.
    }

    items = items.concat(data.items);
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);

  return { items, playlistTitle };
}

/**
 * GET /api/playlist?playlistId=<ID_O_IDS>
 * Acepta un ID de playlist (por ejemplo "PLxxxxx") o varios separados con "~:-".
 */
app.get('/api/playlist', async (req, res) => {
  try {
    const playlistId = req.query.playlistId;
    if (!playlistId) {
      return res.status(400).json({
        status: 400,
        message: "No playlistId provided."
      });
    }

    // Aceptamos múltiples IDs separados por "~:-"
    const listArr = playlistId
      .split("~:-")
      .map(id => id.trim())
      .filter(id => id.length > 0);

    let allVideos = [];
    let combinedTitle = [];

    // Para cada ID, llamamos a la API de YouTube y paginamos
    for (let singleId of listArr) {
      const results = await getAllVideosFromYouTube(singleId);
      if (results && results.items) {
        // Convertimos cada item en { id, title, thumbnail }
        allVideos = allVideos.concat(
          results.items.map(v => ({
            id: v.snippet.resourceId.videoId,
            title: v.snippet.title,
            thumbnail: v.snippet.thumbnails?.default?.url || ""
          }))
        );
        combinedTitle.push(results.playlistTitle || singleId);
      }
    }

    // Respuesta final con status 200 y la lista de videos
    res.json({
      status: 200,
      title: combinedTitle.join(" + "),
      response: allVideos
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: 500,
      message: "Server error"
    });
  }
});

// Ponemos app.listen al final
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log("Pulsa CTRL+C para detener.");
});

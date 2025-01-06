/**
 * server.js
 * -----------
 * Servidor Node + Express que maneja playlists, videos individuales y mixes de YouTube
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY;

if (!YT_API_KEY) {
  console.error("ERROR: Debes configurar YT_API_KEY en tu archivo .env o en las variables de entorno.");
  process.exit(1);
}

/**
 * Función para obtener información de un video individual
 */
async function getVideoInfo(videoId) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YT_API_KEY}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`YouTube API error: ${resp.status} - ${errorText}`);
    }

    const data = await resp.json();
    
    if (!data.items || data.items.length === 0) {
      throw new Error('Video not found');
    }

    return {
      id: videoId,
      title: data.items[0].snippet.title,
      thumbnail: data.items[0].snippet.thumbnails?.default?.url || ""
    };
  } catch (err) {
    console.error("Error en getVideoInfo:", err);
    throw err;
  }
}

/**
 * Función para obtener videos de una playlist
 */
async function getAllVideosFromYouTube(playlistId) {
  let items = [];
  let nextPageToken = "";
  let playlistTitle = "";
  let error = null;

  try {
    do {
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&pageToken=${nextPageToken}&playlistId=${playlistId}&key=${YT_API_KEY}`;
      const resp = await fetch(url);

      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`YouTube API error: ${resp.status} - ${errorText}`);
      }

      const data = await resp.json();

      if (!playlistTitle && data.items?.[0]) {
        playlistTitle = data.items[0].snippet.channelTitle;
      }

      if (data.items) {
        items = items.concat(data.items);
      }
      nextPageToken = data.nextPageToken || "";

    } while (nextPageToken);
  } catch (err) {
    console.error("Error en getAllVideosFromYouTube:", err);
    error = err.message;
  }

  return { items, playlistTitle, error };
}

/**
 * GET /api/video?videoId=<ID>
 * Maneja videos individuales y mixes
 */
app.get('/api/video', async (req, res) => {
  try {
    const videoId = req.query.videoId;
    console.log("1. Video ID recibido:", videoId);

    if (!videoId) {
      return res.status(400).json({ status: 400, message: "No videoId provided." });
    }

    // Verifica si el ID es parte de un mix (contiene RD en el ID)
    if (videoId.includes('RD')) {
      try {
        // Para mixes, tratamos de obtener la información como una playlist
        const results = await getAllVideosFromYouTube(videoId);
        if (results.error) {
          throw new Error(results.error);
        }

        const videos = results.items.map(v => ({
          id: v.snippet.resourceId?.videoId,
          title: v.snippet?.title,
          thumbnail: v.snippet?.thumbnails?.default?.url || ""
        }));

        return res.json({
          status: 200,
          title: results.playlistTitle || "Mix",
          response: videos
        });
      } catch (mixError) {
        // Si falla como mix, intentamos obtenerlo como video individual
        console.log("No es un mix válido, intentando como video individual");
        const videoInfo = await getVideoInfo(videoId);
        return res.json({
          status: 200,
          response: videoInfo
        });
      }
    } else {
      // Video individual
      const videoInfo = await getVideoInfo(videoId);
      res.json({
        status: 200,
        response: videoInfo
      });
    }

  } catch (error) {
    console.error("Error en el servidor:", error);
    res.status(500).json({ status: 500, message: error.message || "Server error" });
  }
});

/**
 * GET /api/playlist?playlistId=<ID_O_IDS>
 * Maneja playlists individuales o múltiples separadas por ~:-
 */
app.get('/api/playlist', async (req, res) => {
  try {
    const playlistId = req.query.playlistId;
    console.log("1. Playlist ID recibido:", playlistId);

    if (!playlistId) {
      return res.status(400).json({ status: 400, message: "No playlistId provided." });
    }

    const listArr = playlistId
      .split("~:-")
      .map(id => id.trim())
      .filter(id => id.length > 0);

    let allVideos = [];
    let combinedTitle = [];

    for (let singleId of listArr) {
      const results = await getAllVideosFromYouTube(singleId);
      if (results.error) {
        return res.status(500).json({ 
          status: 500, 
          message: `Error al obtener la playlist ${singleId}: ${results.error}` 
        });
      }

      if (results?.items) {
        allVideos = allVideos.concat(
          results.items.map(v => ({
            id: v.snippet.resourceId?.videoId,
            title: v.snippet?.title,
            thumbnail: v.snippet?.thumbnails?.default?.url || ""
          }))
        );
        combinedTitle.push(results.playlistTitle || singleId);
      }
    }

    res.json({
      status: 200,
      title: combinedTitle.join(" + "),
      response: allVideos
    });
    console.log("5. Respuesta enviada al cliente.");

  } catch (error) {
    console.error("Error en el servidor:", error);
    res.status(500).json({ status: 500, message: error.message || "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log("Pulsa CTRL+C para detener.");
});
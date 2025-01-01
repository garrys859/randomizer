require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY;

if (!YT_API_KEY) {
  console.error("ERROR: Debes configurar YT_API_KEY en tu archivo .env o en las variables de entorno.");
  process.exit(1);
}

const playlists = {};

// Función para obtener videos de una playlist
async function getAllVideosFromYouTube(playlistId) {
  let items = [];
  let nextPageToken = "";
  let playlistTitle = "";

  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&pageToken=${nextPageToken}&playlistId=${playlistId}&key=${YT_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`YouTube API error: ${resp.status}`);
    const data = await resp.json();

    if (!playlistTitle && data.items && data.items[0]) {
      playlistTitle = data.items[0].snippet.channelTitle;
    }

    items = items.concat(data.items);
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);

  return { items, playlistTitle };
}

// Endpoint GET /api/playlist
app.get('/api/playlist', async (req, res) => {
  try {
    const { playlistId, token } = req.query;

    if (token) {
      if (!playlists[token]) {
        return res.status(404).json({ status: 404, message: "Playlist no encontrada para el token proporcionado." });
      }
      return res.json(playlists[token]);
    }

    if (!playlistId) {
      return res.status(400).json({ status: 400, message: "No playlistId provided." });
    }

    const results = await getAllVideosFromYouTube(playlistId);
    res.json({ status: 200, response: results.items });
  } catch (error) {
    console.error(`Error en /api/playlist: ${error.message}`);
    res.status(500).json({ status: 500, message: "Server error." });
  }
});

// Endpoint POST /api/playlist
app.post('/api/playlist', (req, res) => {
  const { token, playlist } = req.body;
  if (!token || !playlist) {
    return res.status(400).json({ status: 400, message: "Faltan datos (token o playlist)." });
  }
  playlists[token] = playlist;
  res.json({ message: "Playlist guardada con éxito." });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

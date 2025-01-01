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
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const ytdl = require('ytdl-core');

const app = express();

// 1) Habilitamos CORS antes de definir las rutas
app.use(cors());
app.use(express.json()); // Para manejar JSON en solicitudes POST

const PORT = process.env.PORT || 3000;

// Tomamos la API key de las variables de entorno
const YT_API_KEY = process.env.YT_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!YT_API_KEY) {
  console.error("ERROR: Debes configurar YT_API_KEY en tu archivo .env o en las variables de entorno.");
  process.exit(1);
}

if (!DISCORD_BOT_TOKEN) {
  console.error("ERROR: Debes configurar DISCORD_BOT_TOKEN en tu archivo .env o en las variables de entorno.");
  process.exit(1);
}

// Simulación de base de datos para almacenar playlists por token
const playlists = {};

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
    const token = req.query.token;
    console.log("GET /api/playlist - Token recibido:", token);
    // Si se proporciona un token, devolvemos la playlist asociada al token
    if (token) {
      if (!playlists[token]) {
        console.error("GET /api/playlist - No se encontró playlist para el token:", token);
        return res.status(404).json({ status: 404, message: "Playlist no encontrada para el token proporcionado." });
      }
      return res.json(playlists[token]);
    }

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

/**
 * POST /api/playlist
 * Guarda una playlist asociada a un token único.
 */
app.post('/api/playlist', (req, res) => {
  const { token, playlist } = req.body;
  console.log("Token recibido:", token);
  console.log("Playlist recibida:", playlist);
  if (!token || !playlist) {
    return res.status(400).json({
      status: 400,
      message: "Faltan datos (token o playlist)."
    });
  }

  playlists[token] = playlist;
  console.log(`Playlist guardada para token: ${token}`);
  res.json({ message: "Playlist guardada con éxito." });
});

/**
 * POST /api/randomize
 * Recibe un token y randomiza la playlist asociada.
 */
app.post('/api/randomize', (req, res) => {
  const { token } = req.body;

  if (!token || !playlists[token]) {
    return res.status(404).json({
      status: 404,
      message: "Playlist no encontrada para el token proporcionado."
    });
  }

  // Randomiza la playlist asociada al token
  playlists[token] = playlists[token].sort(() => Math.random() - 0.5);
  console.log(`Playlist randomizada para token: ${token}`);
  res.json({
    message: "Playlist randomizada con éxito.",
    playlist: playlists[token]
  });
});

/**
 * Bot de Discord
 */
const botClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

botClient.once('ready', () => {
  console.log(`Bot de Discord iniciado como ${botClient.user.tag}`);
});

botClient.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(' ');
  const command = args.shift().toLowerCase();

  if (command === 'play') {
    const token = args[0];
    if (!token) return message.reply("Por favor proporciona un token válido.");

    try {
      const response = await fetch(`http://localhost:${PORT}/api/playlist?token=${token}`);
      if (!response.ok) throw new Error("No se encontró la playlist.");

      const playlist = await response.json();

      if (!playlist || playlist.length === 0) {
        return message.reply("No se encontró ninguna lista de reproducción asociada al token.");
      }

      const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      const player = createAudioPlayer();
      connection.subscribe(player);

      let currentIndex = 0;

      const playNext = () => {
        if (currentIndex >= playlist.response.length) {
          message.channel.send("Lista de reproducción terminada.");
          connection.destroy();
          return;
        }

        const videoUrl = `https://www.youtube.com/watch?v=${playlist.response[currentIndex].id}`;
        const stream = ytdl(videoUrl, { filter: 'audioonly' });
        const resource = createAudioResource(stream);

        player.play(resource);
        message.channel.send(`Reproduciendo: ${playlist.response[currentIndex].title}`);
        currentIndex++;
      };

      player.on('idle', playNext);
      playNext();

    } catch (error) {
      console.error(error);
      message.reply("Hubo un error al cargar la lista de reproducción.");
    }
  } else if (command === 'randomize') {
    const token = args[0];
    if (!token) return message.reply("Por favor proporciona un token válido.");

    try {
      const response = await fetch(`http://localhost:${PORT}/api/randomize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) throw new Error("Error al randomizar la playlist.");

      const result = await response.json();
      message.reply("Playlist randomizada con éxito.");

    } catch (error) {
      console.error(error);
      message.reply("Hubo un error al randomizar la lista de reproducción.");
    }
  }
});

botClient.login(DISCORD_BOT_TOKEN);

// Ponemos app.listen al final
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log("Pulsa CTRL+C para detener.");
});

/**
 * server.js
 * -----------
 * Servidor Node + Express con funcionalidad de backend y bot de Discord.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
const ytdl = require('ytdl-core');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!YT_API_KEY || !DISCORD_BOT_TOKEN) {
  console.error("Faltan configuraciones en el archivo .env (YT_API_KEY o DISCORD_BOT_TOKEN).");
  process.exit(1);
}

const playlists = {};

/**
 * Función para obtener todos los videos de una playlist de YouTube.
 */
async function getAllVideosFromYouTube(playlistId) {
  let items = [];
  let nextPageToken = "";
  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&pageToken=${nextPageToken}&playlistId=${playlistId}&key=${YT_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Error en la API de YouTube: ${resp.status}`);
    const data = await resp.json();
    items = items.concat(data.items);
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);
  return items.map(v => ({
    id: v.snippet.resourceId.videoId,
    title: v.snippet.title,
    thumbnail: v.snippet.thumbnails?.default?.url || ""
  }));
}

/**
 * Endpoint para obtener o buscar playlists.
 */
app.get('/api/playlist', (req, res) => {
  const token = req.query.token;
  if (!token || !playlists[token]) {
    return res.status(404).json({ status: 404, message: "Playlist no encontrada." });
  }
  res.json({ playlist: playlists[token] }); // Envolver respuesta en `playlist`
});

/**
 * Endpoint para guardar una playlist.
 */
app.post('/api/playlist', (req, res) => {
  const { token, playlist } = req.body;
  if (!token || !playlist) {
    return res.status(400).json({ status: 400, message: "Faltan datos (token o playlist)." });
  }
  playlists[token] = playlist;
  res.json({ message: "Playlist guardada con éxito." });
});

/**
 * Endpoint para randomizar una playlist.
 */
app.post('/api/randomize', (req, res) => {
  const { token } = req.body;
  if (!token || !playlists[token]) {
    return res.status(404).json({ status: 404, message: "Playlist no encontrada." });
  }
  playlists[token] = playlists[token].sort(() => Math.random() - 0.5);
  res.json({ message: "Playlist randomizada con éxito.", playlist: playlists[token] });
});

/**
 * Bot de Discord
 */
const botClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

let currentIndex = 0;
let playlist = [];
let player;

botClient.once('ready', () => {
  console.log(`Bot iniciado como ${botClient.user.tag}`);
});

botClient.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(' ');
  const command = args.shift().toLowerCase();

  if (command === 'play') {
    const token = args[0];
    if (!token) return message.reply("Por favor, proporciona un token válido.");

    try {
      const response = await fetch(`https://randomizer-cg53.onrender.com/api/playlist?token=${token}`);
      if (!response.ok) throw new Error("Playlist no encontrada.");

      const data = await response.json();
      playlist = data.playlist;

      if (!playlist || playlist.length === 0) {
        return message.reply("La playlist está vacía o no existe.");
      }

      const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      player = createAudioPlayer();
      connection.subscribe(player);

      const playNext = () => {
        if (currentIndex >= playlist.length) {
          message.channel.send("Lista de reproducción terminada.");
          connection.destroy();
          currentIndex = 0; // Reinicia el índice
          return;
        }

        const videoUrl = `https://www.youtube.com/watch?v=${playlist[currentIndex].id}`;
        const stream = ytdl(videoUrl, { filter: 'audioonly' });
        const resource = createAudioResource(stream);

        player.play(resource);
        message.channel.send(`Reproduciendo: ${playlist[currentIndex].title}`);
        currentIndex++;
      };

      player.on('idle', playNext);
      playNext();
    } catch (error) {
      console.error(error);
      message.reply("Error al reproducir la playlist.");
    }
  }

  if (command === 'skip') {
    if (!player) {
      return message.reply("No hay ninguna canción reproduciéndose actualmente.");
    }
    player.stop(); // Detiene la canción actual y pasa a la siguiente
    message.reply("Canción actual saltada. Reproduciendo la siguiente...");
  }

  if (command === 'stop') {
    const connection = getVoiceConnection(message.guild.id);
    if (connection) {
      connection.destroy();
      currentIndex = 0;
      message.reply("Reproducción detenida. Bot desconectado.");
    } else {
      message.reply("El bot no está en un canal de voz.");
    }
  }

  if (command === 'randomize') {
    const token = args[0];
    if (!token) return message.reply("Proporciona un token válido.");

    try {
      const response = await fetch(`https://randomizer-cg53.onrender.com/api/randomize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("Error al randomizar.");
      message.reply("Playlist randomizada con éxito.");
    } catch (error) {
      console.error(error);
      message.reply("Error al randomizar la playlist.");
    }
  }
});

botClient.login(DISCORD_BOT_TOKEN);

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

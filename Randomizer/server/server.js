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
    return res.status(404).json({
      status: 404,
      message: "Playlist no encontrada.",
      hint: "Asegúrate de proporcionar un token válido o de haber guardado previamente una playlist.",
    });
  }
  res.json({
    status: 200,
    message: "Playlist encontrada con éxito.",
    playlist: playlists[token],
  });
});

/**
 * Endpoint para guardar una playlist.
 */
app.post('/api/playlist', (req, res) => {
  const { token, playlist } = req.body;
  if (!token || !playlist) {
    return res.status(400).json({
      status: 400,
      message: "Faltan datos (token o playlist).",
      hint: "Asegúrate de enviar ambos campos en la solicitud.",
    });
  }
  playlists[token] = playlist;
  res.json({
    status: 200,
    message: "Playlist guardada con éxito.",
    token,
  });
});

/**
 * Endpoint para randomizar una playlist.
 */
app.post('/api/randomize', (req, res) => {
  const { token } = req.body;
  if (!token || !playlists[token]) {
    return res.status(404).json({
      status: 404,
      message: "Playlist no encontrada.",
      hint: "Proporciona un token válido asociado a una playlist existente.",
    });
  }
  playlists[token] = playlists[token].sort(() => Math.random() - 0.5);
  res.json({
    status: 200,
    message: "Playlist randomizada con éxito.",
    playlist: playlists[token],
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
      const data = await response.json();

      if (response.status !== 200) {
        return message.reply(`Error al cargar la playlist: ${data.message}. Sugerencia: ${data.hint}`);
      }

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

      const playNext = async () => {
        if (currentIndex >= playlist.length) {
          message.channel.send("Lista de reproducción terminada.");
          if (getVoiceConnection(message.guild.id)) {
            getVoiceConnection(message.guild.id).destroy();
          }
          currentIndex = 0; // Reinicia el índice
          return;
        }

        const video = playlist[currentIndex];
        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

        try {
          const stream = ytdl(videoUrl, { filter: 'audioonly' });
          const resource = createAudioResource(stream);

          player.play(resource);
          player.once('error', (error) => {
            console.error(`Error al reproducir el video: ${video.title}`, error);
            message.channel.send(`Error al reproducir: ${video.title}. Saltando al siguiente.`);
            currentIndex++;
            playNext();
          });

          message.channel.send(`Reproduciendo: ${video.title}`);
          currentIndex++;
        } catch (error) {
          console.error(`Error en el video ${video.title}:`, error);
          message.channel.send(`No se pudo reproducir ${video.title}. Saltando al siguiente.`);
          currentIndex++;
          playNext();
        }
      };

      player.on('idle', playNext);
      playNext();
    } catch (error) {
      console.error("Error en el comando !play:", error);
      message.reply("Hubo un error al reproducir la playlist.");
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
      const data = await response.json();

      if (response.status !== 200) {
        return message.reply(`Error al randomizar la playlist: ${data.message}. Sugerencia: ${data.hint}`);
      }

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

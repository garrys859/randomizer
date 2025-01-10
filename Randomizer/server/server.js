/**
 * server.js
 * -----------
 * Servidor Node + Express que maneja playlists, videos individuales y mixes de YouTube
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY;

// Mantener registro de las salas activas
const rooms = new Map();

// Configuración de Socket.IO
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Crear sala
  socket.on('createRoom', (roomId) => {
    rooms.set(roomId, {
      playlist: [],
      currentTrack: null,
      currentTime: 0,
      isPlaying: false,
      messages: [],
      participants: new Set([socket.id])
    });
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
    broadcastParticipants(roomId);
  });

  // Unirse a sala
  socket.on('joinRoom', (roomId) => {
    const room = rooms.get(roomId);
    if (room) {
      room.participants.add(socket.id);
      socket.join(roomId);
      
      // Enviar estado actual de la sala al nuevo participante
      socket.emit('roomJoined', {
        roomId,
        playlist: room.playlist,
        currentTrack: room.currentTrack,
        currentTime: room.currentTime,
        isPlaying: room.isPlaying,
        messages: room.messages
      });
      
      broadcastParticipants(roomId);
    } else {
      socket.emit('error', 'Sala no encontrada');
    }
  });

  // Actualizar playlist
  socket.on('updatePlaylist', ({ roomId, playlist }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.playlist = playlist;
      socket.to(roomId).emit('playlistUpdated', playlist);
    }
  });

  // Actualizar estado de reproducción
  socket.on('updatePlayback', ({ roomId, currentTrack, currentTime, isPlaying }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.currentTrack = currentTrack;
      room.currentTime = currentTime;
      room.isPlaying = isPlaying;
      socket.to(roomId).emit('playbackUpdated', { currentTrack, currentTime, isPlaying });
    }
  });

  // Mensajes de chat
  socket.on('chatMessage', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (room) {
      const messageObject = {
        id: Date.now(),
        userId: socket.id,
        message,
        timestamp: new Date().toISOString(),
        username: `Usuario ${socket.id.slice(0, 4)}`
      };
      room.messages.push(messageObject);
      io.to(roomId).emit('newMessage', messageObject);
    }
  });

  // Salir de sala
  socket.on('leaveRoom', (roomId) => {
    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(socket.id);
      socket.leave(roomId);
      
      if (room.participants.size === 0) {
        rooms.delete(roomId);
      } else {
        broadcastParticipants(roomId);
      }
    }
  });

  // Manejo de desconexión
  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        if (room.participants.size === 0) {
          rooms.delete(roomId);
        } else {
          broadcastParticipants(roomId);
        }
      }
    }
  });
});

// Función auxiliar para transmitir lista de participantes
function broadcastParticipants(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    const participants = Array.from(room.participants).map(id => ({
      id,
      name: `Usuario ${id.slice(0, 4)}`
    }));
    io.to(roomId).emit('participantsUpdated', participants);
  }
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

httpServer.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log("WebSocket habilitado");
  console.log("Pulsa CTRL+C para detener.");
});
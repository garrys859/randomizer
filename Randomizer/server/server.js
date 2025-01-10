// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // En producción, especifica tu dominio
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY;

// Almacenamiento en memoria de las salas
const rooms = new Map();

// Socket.IO
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  // Crear sala
  socket.on('createRoom', (roomId) => {
    console.log('Creando sala:', roomId);
    rooms.set(roomId, {
      participants: new Set([socket.id]),
      playlist: [],
      currentTrack: null,
      currentTime: 0,
      skipVotes: new Set(),
      messages: []
    });
    
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
    broadcastParticipants(roomId);
  });

  // Unirse a sala
  socket.on('joinRoom', (roomId) => {
    console.log('Usuario', socket.id, 'uniéndose a sala:', roomId);
    const room = rooms.get(roomId);
    if (room) {
      room.participants.add(socket.id);
      socket.join(roomId);
      
      // Enviar estado actual de la sala al nuevo participante
      socket.emit('roomJoined', {
        id: roomId,
        playlist: room.playlist,
        track: room.currentTrack,
        time: room.currentTime
      });

      broadcastParticipants(roomId);
    } else {
      socket.emit('error', 'La sala no existe');
    }
  });

  // Dejar sala
  socket.on('leaveRoom', (roomId) => {
    const room = rooms.get(roomId);
    if (room) {
      room.participants.delete(socket.id);
      room.skipVotes.delete(socket.id);
      socket.leave(roomId);
      
      if (room.participants.size === 0) {
        rooms.delete(roomId);
      } else {
        broadcastParticipants(roomId);
      }
    }
  });

  // Chat
  socket.on('chatMessage', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (room) {
      const messageObj = {
        userId: socket.id,
        message,
        timestamp: new Date().toISOString(),
        username: `Usuario ${socket.id.slice(0, 4)}`
      };
      room.messages.push(messageObj);
      io.to(roomId).emit('newChatMessage', messageObj);
    }
  });

  // Actualizar playlist
  socket.on('updatePlaylist', ({ roomId, playlist }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.playlist = playlist;
      socket.to(roomId).emit('playlistUpdate', playlist);
    }
  });

  // Actualizar track actual
  socket.on('updateCurrentTrack', ({ roomId, track, time }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.currentTrack = track;
      room.currentTime = time || 0;
      room.skipVotes.clear(); // Limpiar votos al cambiar de canción
      socket.to(roomId).emit('currentTrackUpdate', { track, time: room.currentTime });
    }
  });

  // Actualizar tiempo de reproducción
  socket.on('updatePlaybackTime', ({ roomId, time }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.currentTime = time;
      socket.to(roomId).emit('playbackTimeUpdate', time);
    }
  });

  // Sistema de votación para saltar
  socket.on('voteSkip', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.skipVotes.add(socket.id);
      
      // Calcular si hay suficientes votos para saltar
      const votesNeeded = Math.ceil(room.participants.size / 2);
      const currentVotes = room.skipVotes.size;
      
      io.to(roomId).emit('skipVoteUpdate', {
        current: currentVotes,
        needed: votesNeeded
      });

      // Si hay suficientes votos, saltar la canción
      if (currentVotes >= votesNeeded) {
        room.skipVotes.clear();
        io.to(roomId).emit('skipTrack');
      }
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
    // Limpiar todas las salas donde estaba el usuario
    for (const [roomId, room] of rooms.entries()) {
      if (room.participants.has(socket.id)) {
        room.participants.delete(socket.id);
        room.skipVotes.delete(socket.id);
        
        if (room.participants.size === 0) {
          rooms.delete(roomId);
        } else {
          broadcastParticipants(roomId);
        }
      }
    }
  });
});

// Función para transmitir lista de participantes
function broadcastParticipants(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    const participantList = Array.from(room.participants).map(id => ({
      id,
      name: `Usuario ${id.slice(0, 4)}`
    }));
    io.to(roomId).emit('participantsUpdate', participantList);
  }
}

// Mantener las rutas API existentes
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

// Rutas API
app.get('/api/video', async (req, res) => {
  // ... (mantener tu código existente para la ruta /api/video)
});

app.get('/api/playlist', async (req, res) => {
  // ... (mantener tu código existente para la ruta /api/playlist)
});

// Iniciar servidor
httpServer.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log("WebSocket habilitado");
  console.log("Pulsa CTRL+C para detener.");
});
process.env.NODE_ENV !== 'production' && require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;
const YT_API_KEY = process.env.YT_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const RABBITMQ_URL = process.env.RABBITMQ_URL;

if (!YT_API_KEY || !DISCORD_BOT_TOKEN || !RABBITMQ_URL) {
    console.error("ERROR: Debes configurar YT_API_KEY, DISCORD_BOT_TOKEN y RABBITMQ_URL en las variables de entorno.");
    process.exit(1);
}

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

            if (!playlistTitle && data.items && data.items.length > 0) {
                playlistTitle = data.items[0].snippet.channelTitle;
            }

            if (data.items) items = items.concat(data.items);
            nextPageToken = data.nextPageToken || "";

        } while (nextPageToken);
    } catch (err) {
        console.error("Error en getAllVideosFromYouTube:", err);
        error = err.message;
    }

    return { items, playlistTitle, error };
}

async function connectToRabbitMQ() {
  try {
      const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      const channel = await connection.createChannel();
      const queue = 'music_queue';
      
      // Asegurarse de que la configuración de la cola sea idéntica en servidor y bot
      await channel.assertQueue(queue, { 
          durable: false,
          arguments: {
              'x-message-ttl': 3600000 // mensajes expiran después de 1 hora
          }
      });
      return channel;
  } catch (error) {
      console.error("Error al conectar a RabbitMQ:", error);
      return null;
  }
}

let rabbitMQChannel = null;
connectToRabbitMQ().then(channel => {
    rabbitMQChannel = channel;
});

async function sendToRabbitMQ(message) {
  if (!rabbitMQChannel) {
      console.error("[SERVER] No hay conexión con RabbitMQ");
      throw new Error("No hay conexión con RabbitMQ");
  }

  console.log("[SERVER] Enviando mensaje a RabbitMQ:", {
      action: message.action,
      token: message.token,
      videoCount: message.videoIds?.length
  });

  return rabbitMQChannel.sendToQueue('music_queue', Buffer.from(JSON.stringify(message)));
}

app.get('/api/playlist', async (req, res) => {
  try {
      const token = uuidv4();
      const playlistId = req.query.playlistId;
      console.log("[SERVER] 1. Playlist ID recibido:", playlistId);
      console.log("[SERVER] Token generado:", token);

      if (!playlistId) {
          return res.status(400).json({ status: 400, message: "No playlistId provided." });
      }

      const listArr = playlistId
          .split("~:-")
          .map(id => id.trim())
          .filter(id => id.length > 0);

      let allVideos = [];
      let combinedTitle = [];
      let hasError = false;

      for (let singleId of listArr) {
          const results = await getAllVideosFromYouTube(singleId);
          if (results.error) {
              console.error(`[SERVER] Error al obtener la playlist ${singleId}:`, results.error);
              hasError = true;
              return res.status(500).json({ status: 500, message: `Error al obtener la playlist ${singleId}: ${results.error}` });
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

      if (hasError) {
          return;
      }

      if (!rabbitMQChannel) {
          console.error("[SERVER] Error: No hay conexión con RabbitMQ");
          return res.status(500).json({ status: 500, message: "Error de conexión con RabbitMQ" });
      }

      const message = {
        action: 'load',
        token: token,
        videoIds: allVideos.map(video => video.id),
        playlistTitle: combinedTitle.join(" + ")
    };

    try {
        await sendToRabbitMQ(message);
        console.log("[SERVER] Mensaje enviado exitosamente a RabbitMQ");
    } catch (rabbitError) {
        console.error("[SERVER] Error al enviar mensaje a RabbitMQ:", rabbitError);
        return res.status(500).json({ 
            status: 500, 
            message: "Error de comunicación con el servicio de cola" 
        });
    }

    res.json({ status: 200, token: token, title: combinedTitle.join(" + "), response: allVideos });
} catch (error) {
    console.error("[SERVER] Error en el servidor:", error);
    res.status(500).json({ status: 500, message: error.message || "Server error" });
}
});

app.post('/api/control', (req, res) => {
    const { token, action } = req.body;
    if (!token || !action) {
        return res.status(400).send("Faltan token o acción.");
    }
    if (rabbitMQChannel) {
        const message = {
            action: action,
            token: token
        };
        rabbitMQChannel.sendToQueue('music_queue', Buffer.from(JSON.stringify(message)));
        console.log(`Mensaje de control ${action} enviado a RabbitMQ con token:`, token);
    }
    res.send("OK");
});

app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
    console.log("Pulsa CTRL+C para detener.");
});
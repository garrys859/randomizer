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
  let error = null; // Variable para almacenar errores

  try {
      do {
          const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&pageToken=${nextPageToken}&playlistId=${playlistId}&key=${YT_API_KEY}`;
          const resp = await fetch(url);

          if (!resp.ok) {
              const errorText = await resp.text(); // Obtener el texto del error
              throw new Error(`YouTube API error: ${resp.status} - ${errorText}`); // Lanzar un error con más detalles
          }

          const data = await resp.json();

          if (!playlistTitle && data.items && data.items.length > 0) { // Comprobar si data.items existe y tiene elementos
              playlistTitle = data.items[0].snippet.channelTitle;
          }

          if(data.items) items = items.concat(data.items); // Comprobar si data.items existe antes de concatenar
          nextPageToken = data.nextPageToken || "";

      } while (nextPageToken);
  } catch (err) {
      console.error("Error en getAllVideosFromYouTube:", err);
      error = err.message; // Guarda el mensaje de error
  }

  return { items, playlistTitle, error }; // Devuelve también el error
}

/**
 * GET /api/playlist?playlistId=<ID_O_IDS>
 * Acepta un ID de playlist (por ejemplo "PLxxxxx") o varios separados con "~:-".
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
      let hasError = false; // Variable para controlar si hubo un error

      for (let singleId of listArr) {
          const results = await getAllVideosFromYouTube(singleId);
          if (results.error) { // Comprobar si hubo un error en la llamada a la API
              console.error(`Error al obtener la playlist ${singleId}:`, results.error);
              hasError = true; // Establecer la variable de error
              return res.status(500).json({ status: 500, message: `Error al obtener la playlist ${singleId}: ${results.error}` }); // Enviar respuesta de error inmediatamente
          }

          if (results?.items) { // Usar optional chaining
              allVideos = allVideos.concat(
                  results.items.map(v => ({
                      id: v.snippet.resourceId?.videoId, // Usar optional chaining aquí también
                      title: v.snippet?.title,
                      thumbnail: v.snippet?.thumbnails?.default?.url || ""
                  }))
              );
              combinedTitle.push(results.playlistTitle || singleId);
          }
      }

      if (hasError) { // Si hubo un error en alguna playlist, no enviar una respuesta exitosa
          return; // Ya se envió la respuesta de error dentro del bucle
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

// Ponemos app.listen al final
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log("Pulsa CTRL+C para detener.");
});

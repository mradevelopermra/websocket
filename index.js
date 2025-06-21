const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: "*"
  }
});

// ✅ Respuesta para verificar el estado desde el navegador
app.get("/", (req, res) => {
  res.send("✅ Servidor WebSocket activo");
});

// Almacenar las mesas disponibles por ID de jugador
const mesasDisponibles = {};

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  // 🔎 Debug global de eventos
  socket.onAny((event, ...args) => {
    console.log(`📡 Evento recibido: ${event}`, args);
  });

  // 🎮 Jugada general
  socket.on("jugada", (data) => {
    console.log("🎮 Jugada recibida:", data);
    socket.broadcast.emit("jugada", data);
  });

  // ⚽ Movimiento del balón
  socket.on("ballMove", (data) => {
    console.log("⚽ Movimiento de balón:", data);
    socket.broadcast.emit("ballMove", data);
  });

  // 🧩 Crear mesa con más datos
  socket.on("crearMesa", (data) => {
    const {
      jugadorID,
      nombre,
      avatarURL,
      equipoReal,
      equipoVisualRival,
      grupo
    } = data;

    // Guardar solo ID de socket para unirse
    mesasDisponibles[jugadorID] = socket.id;

    // Mostrar todos los datos recibidos
    console.log("🧩 Mesa creada:");
    console.log("👤 ID:", jugadorID);
    console.log("📛 Nombre:", nombre);
    console.log("🖼️ Avatar URL:", avatarURL);
    console.log("🇲🇽 Equipo Real:", equipoReal);
    console.log("🏴 Equipo Rival:", equipoVisualRival);
    console.log("🧵 Grupo:", grupo);

    // Avisar a todos que hay una nueva mesa disponible
    socket.broadcast.emit("mesaDisponible", { duenoMesa: jugadorID });
  });

  // 🔗 Unirse a una mesa
  socket.on("unirseAMesa", (data) => {
    const { jugadorID, duenoMesa } = data;
    const socketIdDueno = mesasDisponibles[duenoMesa];

    if (socketIdDueno) {
      const socketDueno = io.sockets.sockets.get(socketIdDueno);

      if (socketDueno) {
        console.log(`🎮 ${jugadorID} se unió a la mesa de ${duenoMesa}`);

        // Avisar a ambos que el juego puede comenzar
        socket.emit("juegoListo", { rival: duenoMesa });
        socketDueno.emit("juegoListo", { rival: jugadorID });

        // Eliminar mesa
        delete mesasDisponibles[duenoMesa];
      }
    } else {
      console.log(`❗ Mesa no encontrada para ${duenoMesa}`);
    }
  });

  // ❌ Desconexión
  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);

    // Limpiar mesas
    for (const [jugadorID, id] of Object.entries(mesasDisponibles)) {
      if (id === socket.id) {
        delete mesasDisponibles[jugadorID];
        console.log(`🗑️ Mesa eliminada de ${jugadorID}`);
        break;
      }
    }
  });
});

server.listen(3000, () => {
  console.log("🚀 Servidor WebSocket corriendo en puerto 3000");
});


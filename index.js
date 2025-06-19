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

  // 🧩 Crear mesa
  socket.on("crearMesa", (data) => {
    const jugadorID = data.jugadorID;
    mesasDisponibles[jugadorID] = socket.id;
    console.log(`🧩 Mesa creada por ${jugadorID}`);

    // 🔔 Avisar a otros que hay una mesa disponible
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

        // Avisar a ambos jugadores que el juego está listo
        socket.emit("juegoListo", { rival: duenoMesa });
        socketDueno.emit("juegoListo", { rival: jugadorID });

        // ❌ Remover la mesa (ya no está disponible)
        delete mesasDisponibles[duenoMesa];
      }
    } else {
      console.log(`❗ Mesa no encontrada para ${duenoMesa}`);
    }
  });

  // ❌ Desconexión
  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);

    // 🧹 Limpiar mesas si el creador se desconecta
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

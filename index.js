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

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  // 🔎 Log de cualquier evento recibido (útil para debugging)
  socket.onAny((event, ...args) => {
    console.log(`📡 Evento recibido: ${event}`, args);
  });

  socket.on("jugada", (data) => {
    console.log("🎮 Jugada recibida:", data);
    socket.broadcast.emit("jugada", data); // Reenvía a los demás
  });
    
    socket.on('crearMesa', (data) => {
        const jugadorID = data.jugadorID;
        console.log(`🧩 Mesa creada por ${jugadorID}`);
        mesasDisponibles[jugadorID] = socket.id; // ejemplo de estructura
    });

    
    socket.on("ballMove", (data) => {
      console.log("⚽ Movimiento de balón:", data);
      socket.broadcast.emit("ballMove", data);
    });


  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("🚀 Servidor WebSocket corriendo en puerto 3000");
});

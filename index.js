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

  socket.on("jugada", (data) => {
    console.log("🎮 Jugada recibida:", data);
    socket.broadcast.emit("jugada", data);
  });

  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);
  });
});

server.listen(3000, () => {
  console.log("Servidor WebSocket corriendo en puerto 3000");
});


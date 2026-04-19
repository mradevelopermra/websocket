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

// ✅ Estado visible desde navegador
app.get("/", (req, res) => {
  res.send("✅ Servidor WebSocket activo");
});

// 🗂️ Mesas disponibles
const mesasDisponibles = {};

// 🧩 Helper para nombre de sala
function getRoomId(duenoMesa) {
  return `mesa_${duenoMesa}`;
}

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  // 🔍 Escuchar todos los eventos para depuración
  socket.onAny((event, ...args) => {
    console.log(`📡 Evento recibido: ${event}`, args);
  });

  // 🎮 Jugada enviada
  socket.on("jugada", (data) => {
    console.log("🎮 Jugada recibida:", data);

    if (!data || !data.duenoMesa) {
      console.log("⚠️ jugada sin duenoMesa:", data);
      return;
    }

    const roomId = getRoomId(data.duenoMesa);
    socket.to(roomId).emit("jugada", data);
  });

  // ⚽ Movimiento del balón
  socket.on("ballMove", (data) => {
    console.log("⚽ Movimiento del balón:", data);

    if (!data || !data.duenoMesa) {
      console.log("⚠️ ballMove sin duenoMesa:", data);
      return;
    }

    const roomId = getRoomId(data.duenoMesa);
    socket.to(roomId).emit("ballMove", data);
  });

  // 💥 Impulso del balón
  socket.on("patearBalon", (data) => {
    console.log("💥 Evento patearBalon recibido:", data);

    if (!data || !data.duenoMesa) {
      console.log("⚠️ patearBalon sin duenoMesa:", data);
      return;
    }

    const roomId = getRoomId(data.duenoMesa);
    socket.to(roomId).emit("patearBalon", data);
  });

  // 🧩 Crear mesa
  socket.on("crearMesa", (data) => {
    const {
      jugadorID,
      nombre,
      avatarURL,
      equipoReal,
      equipoVisualRival,
      grupo
    } = data || {};

    if (!jugadorID || !nombre || !avatarURL || !equipoReal || !equipoVisualRival || !grupo) {
      console.log("⚠️ Datos incompletos para crear mesa:", data);
      return;
    }

    const roomId = getRoomId(jugadorID);

    mesasDisponibles[jugadorID] = {
      socketId: socket.id,
      nombre,
      avatarURL,
      equipoReal,
      equipoVisualRival,
      grupo,
      roomId
    };

    // ✅ El dueño entra a su sala
    socket.join(roomId);

    console.log("🧩 Mesa creada:");
    console.log("👤 ID:", jugadorID);
    console.log("📛 Nombre:", nombre);
    console.log("🖼️ Avatar URL:", avatarURL);
    console.log("🇲🇽 Equipo Real:", equipoReal);
    console.log("🏴 Equipo Visual Rival:", equipoVisualRival);
    console.log("🧵 Grupo:", grupo);
    console.log("🚪 Room:", roomId);

    socket.broadcast.emit("mesaDisponible", {
      duenoMesa: jugadorID
    });
  });

  // 🔗 Unirse a una mesa
  socket.on("unirseAMesa", (data) => {
    const { jugadorID, duenoMesa, nombre, avatarURL } = data || {};
    const mesa = mesasDisponibles[duenoMesa];

    if (!mesa) {
      console.log(`❗ Mesa no encontrada para ${duenoMesa}`);
      return;
    }

    const socketIdDueno = mesa.socketId;
    const socketDueno = io.sockets.sockets.get(socketIdDueno);

    if (!socketDueno) {
      console.log(`❗ Socket del dueño no encontrado para ${duenoMesa}`);
      return;
    }

    const roomId = mesa.roomId || getRoomId(duenoMesa);

    // ✅ El invitado entra a la misma sala
    socket.join(roomId);

    console.log(`🎮 ${jugadorID} se unió a la mesa de ${duenoMesa}`);
    console.log(`🚪 Ambos jugadores en sala: ${roomId}`);

    // ✅ Enviar datos completos al invitado
    socket.emit("juegoListo", {
      rival: duenoMesa,
      nombre: mesa.nombre,
      avatarURL: mesa.avatarURL,
      equipo: mesa.equipoReal,
      grupo: mesa.grupo,
      duenoMesa: duenoMesa,
      roomId: roomId
    });

    // ✅ Enviar más datos también al dueño
    socketDueno.emit("juegoListo", {
      rival: jugadorID,
      nombre: nombre || "",
      avatarURL: avatarURL || "",
      duenoMesa: duenoMesa,
      roomId: roomId
    });

    // Eliminar la mesa después de que se une el rival
    delete mesasDisponibles[duenoMesa];
  });

  // 🎯 Evento personalizado
  socket.on("evento", (data) => {
    if (!data || typeof data !== "object") {
      console.log("⚠️ Evento inválido:", data);
      return;
    }

    console.log("🎯 Evento personalizado recibido:", data);

    if (!data.duenoMesa) {
      console.log("⚠️ evento sin duenoMesa:", data);
      return;
    }

    const roomId = getRoomId(data.duenoMesa);
    socket.to(roomId).emit("evento", data);
  });

  // ❌ Desconexión
  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);

    for (const [jugadorID, mesa] of Object.entries(mesasDisponibles)) {
      if (mesa.socketId === socket.id) {
        delete mesasDisponibles[jugadorID];
        console.log(`🗑️ Mesa eliminada de ${jugadorID}`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Servidor WebSocket corriendo en puerto", PORT);
});

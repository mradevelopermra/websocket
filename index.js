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

// 🗂️ Almacenar todas las mesas disponibles con datos
const mesasDisponibles = {};

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  // 🔍 Escuchar todos los eventos
  socket.onAny((event, ...args) => {
    console.log(`📡 Evento recibido: ${event}`, args);
  });

  // 🎮 Jugada enviada
  socket.on("jugada", (data) => {
    console.log("🎮 Jugada recibida:", data);
    socket.broadcast.emit("jugada", data);
  });

  // ⚽ Movimiento del balón
  socket.on("ballMove", (data) => {
    console.log("⚽ Movimiento del balón:", data);
    socket.broadcast.emit("ballMove", data);
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
    } = data;

    if (!jugadorID || !nombre || !avatarURL || !equipoReal || !equipoVisualRival || !grupo) {
      console.log("⚠️ Datos incompletos para crear mesa:", data);
      return;
    }

    // Guardar mesa con todos los datos
    mesasDisponibles[jugadorID] = {
      socketId: socket.id,
      nombre,
      avatarURL,
      equipoReal,
      equipoVisualRival,
      grupo
    };

    console.log("🧩 Mesa creada:");
    console.log("👤 ID:", jugadorID);
    console.log("📛 Nombre:", nombre);
    console.log("🖼️ Avatar URL:", avatarURL);
    console.log("🇲🇽 Equipo Real:", equipoReal);
    console.log("🏴 Equipo Visual Rival:", equipoVisualRival);
    console.log("🧵 Grupo:", grupo);

    // Avisar a otros clientes
    socket.broadcast.emit("mesaDisponible", { duenoMesa: jugadorID });
  });

  // 🔗 Unirse a una mesa
  socket.on("unirseAMesa", (data) => {
    const { jugadorID, duenoMesa } = data;
    const mesa = mesasDisponibles[duenoMesa];

    if (!mesa) {
      console.log(`❗ Mesa no encontrada para ${duenoMesa}`);
      return;
    }

    const socketIdDueno = mesa.socketId;
    const socketDueno = io.sockets.sockets.get(socketIdDueno);

    if (socketDueno) {
      console.log(`🎮 ${jugadorID} se unió a la mesa de ${duenoMesa}`);

      // Avisar a ambos jugadores con la info relevante
      socket.emit("juegoListo", {
        rival: duenoMesa,
        nombre: mesa.nombre,
        avatarURL: mesa.avatarURL,
        equipo: mesa.equipoReal,
        grupo: mesa.grupo
      });

      socketDueno.emit("juegoListo", {
        rival: jugadorID
      });

      // ❌ Mesa ya no está disponible
      delete mesasDisponibles[duenoMesa];
    }
  });
    
    socket.on("evento", (data) => {
      if (!data || typeof data !== "object") {
        console.log("⚠️ Evento inválido:", data);
        return;
      }

      console.log("🎯 Evento personalizado recibido:", data);
      socket.broadcast.emit("evento", data);
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

socket.on("patearBalon", (data) => {
    const mesaID = jugadoresEnMesa[socket.id];
    if (!mesaID || !mesas[mesaID]) return;

    const oponenteID = mesas[mesaID].find(id => id !== socket.id);
    if (!oponenteID) return;

    io.to(oponenteID).emit("patearBalon", data);
});


server.listen(3000, () => {
  console.log("🚀 Servidor WebSocket corriendo en puerto 3000");
});

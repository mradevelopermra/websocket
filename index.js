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

// 🎮 Partidas activas
// matchId -> { ownerId, guestId, ownerSocketId, guestSocketId, turnId, shooterID, lastSyncTurn }
const partidas = {};

// socket.id -> matchId
const socketToMatch = {};

// Helpers
function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function makeMatchId(ownerId, guestId) {
  return `match_${norm(ownerId)}__${norm(guestId)}__${Date.now()}`;
}

function getMatchBySocket(socketId) {
  const matchId = socketToMatch[socketId];
  if (!matchId) return null;
  return partidas[matchId] || null;
}

function getOpponentSocketId(match, socketId) {
  if (!match) return null;
  if (match.ownerSocketId === socketId) return match.guestSocketId;
  if (match.guestSocketId === socketId) return match.ownerSocketId;
  return null;
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

    const match = getMatchBySocket(socket.id);
    if (!match) {
      console.log("⚠️ jugada recibida fuera de partida activa");
      return;
    }

    const opponentSocketId = getOpponentSocketId(match, socket.id);
    if (!opponentSocketId) {
      console.log("⚠️ No se encontró rival para reenviar jugada");
      return;
    }

    io.to(opponentSocketId).emit("jugada", {
      ...data,
      matchId: match.matchId
    });
  });

  // ⚽ Movimiento del balón
  socket.on("ballMove", (data) => {
    console.log("⚽ Movimiento del balón:", data);

    const match = getMatchBySocket(socket.id);
    if (!match) {
      console.log("⚠️ ballMove recibido fuera de partida activa");
      return;
    }

    const opponentSocketId = getOpponentSocketId(match, socket.id);
    if (!opponentSocketId) {
      console.log("⚠️ No se encontró rival para reenviar ballMove");
      return;
    }

    io.to(opponentSocketId).emit("ballMove", {
      ...data,
      matchId: match.matchId
    });
  });

  // 💥 Impulso del balón
  socket.on("patearBalon", (data) => {
    console.log("💥 Evento patearBalon recibido:", data);

    const match = getMatchBySocket(socket.id);
    if (!match) {
      console.log("⚠️ patearBalon recibido fuera de partida activa");
      return;
    }

    const opponentSocketId = getOpponentSocketId(match, socket.id);
    if (!opponentSocketId) {
      console.log("⚠️ No se encontró rival para reenviar patearBalon");
      return;
    }

    io.to(opponentSocketId).emit("patearBalon", {
      ...data,
      matchId: match.matchId
    });
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

    // ✅ avatarURL puede venir vacío, sólo rechazamos null/undefined
    if (
      !jugadorID ||
      !nombre ||
      avatarURL === undefined ||
      avatarURL === null ||
      !equipoReal ||
      !equipoVisualRival ||
      !grupo
    ) {
      console.log("⚠️ Datos incompletos para crear mesa:", data);
      return;
    }

    mesasDisponibles[jugadorID] = {
      socketId: socket.id,
      jugadorID,
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
    console.log("⚽ Equipo Real:", equipoReal);
    console.log("🏳️ Equipo Visual Rival:", equipoVisualRival);
    console.log("🧵 Grupo:", grupo);

    socket.broadcast.emit("mesaDisponible", { duenoMesa: jugadorID });
  });

  // 🔗 Unirse a una mesa
  socket.on("unirseAMesa", (data) => {
    const { jugadorID, duenoMesa, nombre, avatarURL } = data;
    const mesa = mesasDisponibles[duenoMesa];

    if (!mesa) {
      console.log(`❗ Mesa no encontrada para ${duenoMesa}`);
      return;
    }

    const socketDueno = io.sockets.sockets.get(mesa.socketId);

    if (!socketDueno) {
      console.log(`❗ Socket del dueño no encontrado para ${duenoMesa}`);
      delete mesasDisponibles[duenoMesa];
      return;
    }

    const matchId = makeMatchId(duenoMesa, jugadorID);

    partidas[matchId] = {
      matchId,
      ownerId: duenoMesa,
      guestId: jugadorID,
      ownerSocketId: mesa.socketId,
      guestSocketId: socket.id,
      turnId: 1,
      shooterID: duenoMesa,
      lastSyncTurn: {
        turnId: 1,
        shooterID: norm(duenoMesa)
      }
    };

    socketToMatch[mesa.socketId] = matchId;
    socketToMatch[socket.id] = matchId;

    console.log(`🎮 ${jugadorID} se unió a la mesa de ${duenoMesa}`);
    console.log("✅ Partida activa:", partidas[matchId]);

    // Enviar datos a ambos jugadores
    socket.emit("juegoListo", {
      rival: duenoMesa,
      nombre: mesa.nombre,
      avatarURL: mesa.avatarURL,
      equipo: mesa.equipoReal,
      grupo: mesa.grupo,
      duenoMesa,
      matchId,
      turnId: 1,
      shooterID: duenoMesa
    });

    socketDueno.emit("juegoListo", {
      rival: jugadorID,
      nombre: nombre || "",
      avatarURL: avatarURL || "",
      duenoMesa,
      matchId,
      turnId: 1,
      shooterID: duenoMesa
    });

    // ✅ Bootstrap del primer turno
    io.to(mesa.socketId).emit("evento", {
      tipo: "syncTurno",
      jugadorID: duenoMesa,
      duenoMesa,
      turnId: 1,
      turno: 1,
      shooterID: duenoMesa,
      matchId
    });

    io.to(socket.id).emit("evento", {
      tipo: "syncTurno",
      jugadorID: duenoMesa,
      duenoMesa,
      turnId: 1,
      turno: 1,
      shooterID: duenoMesa,
      matchId
    });

    // Eliminar la mesa después de que se une el rival
    delete mesasDisponibles[duenoMesa];
  });

  // 🎯 Evento personalizado genérico
  socket.on("evento", (data) => {
    if (!data || typeof data !== "object") {
      console.log("⚠️ Evento inválido:", data);
      return;
    }

    const match = getMatchBySocket(socket.id);
    if (!match) {
      console.log("⚠️ evento recibido fuera de partida activa:", data);
      return;
    }

    const tipo = data.tipo;
    console.log("🎯 Evento personalizado recibido:", data);

    // ✅ Validación mínima para syncTurno
    if (tipo === "syncTurno") {
      const requestedTurnId = Number(data.turnId ?? data.turno ?? 0);
      const requestedShooter = norm(data.shooterID);

      if (!requestedTurnId || !requestedShooter) {
        console.log("⛔ syncTurno inválido: falta turnId o shooterID", data);
        return;
      }

      // duplicado idéntico
      if (
        match.lastSyncTurn &&
        match.lastSyncTurn.turnId === requestedTurnId &&
        match.lastSyncTurn.shooterID === requestedShooter
      ) {
        console.log(`🔁 syncTurno duplicado idéntico ignorado turn=${requestedTurnId} shooter=${requestedShooter}`);
        return;
      }

      // conflicto: mismo turno pero distinto shooter
      if (
        match.lastSyncTurn &&
        match.lastSyncTurn.turnId === requestedTurnId &&
        match.lastSyncTurn.shooterID !== requestedShooter
      ) {
        console.log(
          `🚨 CONFLICTO syncTurno rechazado match=${match.matchId} turn=${requestedTurnId} shooterPrevio=${match.lastSyncTurn.shooterID} shooterNuevo=${requestedShooter}`
        );
        return;
      }

      // ✅ aceptamos y actualizamos estado básico
      match.turnId = requestedTurnId;
      match.shooterID = requestedShooter;
      match.lastSyncTurn = {
        turnId: requestedTurnId,
        shooterID: requestedShooter
      };

      console.log(`✅ syncTurno aceptado match=${match.matchId} turn=${requestedTurnId} shooter=${requestedShooter}`);
    }

    const opponentSocketId = getOpponentSocketId(match, socket.id);
    if (!opponentSocketId) {
      console.log("⚠️ No se encontró rival para reenviar evento");
      return;
    }

    io.to(opponentSocketId).emit("evento", {
      ...data,
      matchId: match.matchId
    });
  });

  // ❌ Desconexión
  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);

    // limpiar mesas pendientes
    for (const [jugadorID, mesa] of Object.entries(mesasDisponibles)) {
      if (mesa.socketId === socket.id) {
        delete mesasDisponibles[jugadorID];
        console.log(`🗑️ Mesa eliminada de ${jugadorID}`);
        break;
      }
    }

    // limpiar partida activa
    const matchId = socketToMatch[socket.id];
    if (matchId && partidas[matchId]) {
      const match = partidas[matchId];
      const opponentSocketId = getOpponentSocketId(match, socket.id);

      if (opponentSocketId) {
        io.to(opponentSocketId).emit("evento", {
          tipo: "rivalDesconectado",
          matchId
        });
      }

      delete socketToMatch[match.ownerSocketId];
      delete socketToMatch[match.guestSocketId];
      delete partidas[matchId];

      console.log(`🧹 Partida eliminada: ${matchId}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor WebSocket corriendo en puerto ${PORT}`);
});

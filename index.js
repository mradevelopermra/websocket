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

// 🆕 Partidas activas
const partidas = {};

// 🆕 socket.id -> matchId
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

    io.to(opponentSocketId).emit("jugada", data);
  });

  // ⚽ Movimiento del balón (posición continua)
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

    io.to(opponentSocketId).emit("ballMove", data);
  });

  // 💥 Impulso del balón (patada)
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

    io.to(opponentSocketId).emit("patearBalon", data);
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
    console.log("🇲🇽 Equipo Real:", equipoReal);
    console.log("🏴 Equipo Visual Rival:", equipoVisualRival);
    console.log("🧵 Grupo:", grupo);

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

      const matchId = makeMatchId(duenoMesa, jugadorID);

      partidas[matchId] = {
        matchId,
        ownerId: duenoMesa,
        guestId: jugadorID,
        ownerSocketId: socketIdDueno,
        guestSocketId: socket.id,
        turnId: 1,
        shooterID: duenoMesa,
        lastSyncTurn: {
          turnId: 1,
          shooterID: norm(duenoMesa)
        }
      };

      socketToMatch[socketIdDueno] = matchId;
      socketToMatch[socket.id] = matchId;

      // Enviar datos a ambos jugadores
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

      // Bootstrap del turno 1 para ambos
      io.to(socketIdDueno).emit("evento", {
        tipo: "syncTurno",
        jugadorID: duenoMesa,
        duenoMesa,
        turnId: 1,
        turno: 1,
        shooterID: duenoMesa
      });

      io.to(socket.id).emit("evento", {
        tipo: "syncTurno",
        jugadorID: duenoMesa,
        duenoMesa,
        turnId: 1,
        turno: 1,
        shooterID: duenoMesa
      });

      // Eliminar la mesa después de que se une el rival
      delete mesasDisponibles[duenoMesa];
    }
  });

  // 🎯 Evento personalizado genérico (si se requiere)
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

    console.log("🎯 Evento personalizado recibido:", data);

    const tipo = data.tipo;

    // ✅ Blindaje mínimo de syncTurno
    if (tipo === "syncTurno") {
      const requestedTurnId = Number(data.turnId ?? data.turno ?? 0);
      const requestedShooter = norm(data.shooterID);

      if (!requestedTurnId || !requestedShooter) {
        console.log("⛔ syncTurno inválido: falta turnId o shooterID", data);
        return;
      }

      // Duplicado idéntico
      if (
        match.lastSyncTurn &&
        match.lastSyncTurn.turnId === requestedTurnId &&
        match.lastSyncTurn.shooterID === requestedShooter
      ) {
        console.log(`🔁 syncTurno duplicado idéntico ignorado turn=${requestedTurnId} shooter=${requestedShooter}`);
        return;
      }

      // Conflicto: mismo turno, distinto shooter
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

    io.to(opponentSocketId).emit("evento", data);
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

server.listen(3000, () => {
  console.log("🚀 Servidor WebSocket corriendo en puerto 3000");
});

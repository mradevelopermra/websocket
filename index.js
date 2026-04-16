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

// 🗂️ Almacenar mesas esperando rival
const mesasDisponibles = {};

// 🎮 Partidas activas
const partidas = {};

// 🔗 socket.id -> matchId
const socketToMatch = {};

// =========================
// Helpers
// =========================
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

function isPlayerInMatch(match, jugadorID) {
  if (!match || !jugadorID) return false;
  const id = norm(jugadorID);
  return norm(match.ownerId) === id || norm(match.guestId) === id;
}

function expectedShooterForTurn(match, turnId) {
  return turnId % 2 === 1 ? match.ownerId : match.guestId;
}

function cleanupMatch(matchId, reason = "unknown") {
  const match = partidas[matchId];
  if (!match) return;

  console.log(`🧹 cleanupMatch matchId=${matchId} reason=${reason}`);

  if (match.ownerSocketId) {
    delete socketToMatch[match.ownerSocketId];
    const s = io.sockets.sockets.get(match.ownerSocketId);
    if (s) s.leave(matchId);
  }

  if (match.guestSocketId) {
    delete socketToMatch[match.guestSocketId];
    const s = io.sockets.sockets.get(match.guestSocketId);
    if (s) s.leave(matchId);
  }

  delete partidas[matchId];
}

function logMatchState(prefix, match) {
  if (!match) {
    console.log(`${prefix} match=null`);
    return;
  }

  console.log(
    `${prefix} matchId=${match.matchId} owner=${match.ownerId} guest=${match.guestId} turnId=${match.turnId} shooterID=${match.shooterID}`
  );
}

// =========================
// Socket
// =========================
io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  // 🔍 Log resumido, sin spamear ballMove
  socket.onAny((event) => {
    if (event === "ballMove") return;
    console.log(`📡 Evento recibido: ${event} socket=${socket.id}`);
  });

  // 🎮 Jugada enviada
  socket.on("jugada", (data) => {
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

    console.log(`🎮 jugada tipo=${data?.tipo ?? "?"} turnId=${data?.turnId ?? data?.turno ?? "?"} match=${match.matchId}`);
    io.to(opponentSocketId).emit("jugada", data);
  });

  // ⚽ Movimiento del balón
  socket.on("ballMove", (data) => {
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

    // ✅ Log ultra resumido para no matar Railway
    console.log(`⚽ ballMove turnId=${data?.turnId ?? "?"} match=${match.matchId}`);
    io.to(opponentSocketId).emit("ballMove", data);
  });

  // 💥 Impulso del balón
  socket.on("patearBalon", (data) => {
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

    console.log(`💥 patearBalon turnId=${data?.turnId ?? data?.turno ?? "?"} match=${match.matchId}`);
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
    } = data || {};

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

    console.log(`🧩 Mesa creada jugador=${jugadorID} socket=${socket.id}`);
    socket.broadcast.emit("mesaDisponible", { duenoMesa: jugadorID });
  });

  // 🔗 Unirse a una mesa
  socket.on("unirseAMesa", (data) => {
    const { jugadorID, duenoMesa } = data || {};
    const mesa = mesasDisponibles[duenoMesa];

    if (!jugadorID || !duenoMesa) {
      console.log("⚠️ unirseAMesa incompleto:", data);
      return;
    }

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

    const match = {
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

    partidas[matchId] = match;
    socketToMatch[mesa.socketId] = matchId;
    socketToMatch[socket.id] = matchId;

    // ✅ Meter ambos sockets a room
    socket.join(matchId);
    socketDueno.join(matchId);

    console.log(`🎮 ${jugadorID} se unió a la mesa de ${duenoMesa}`);
    logMatchState("✅ Partida creada", match);

    // Invitado
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

    // Dueño
    socketDueno.emit("juegoListo", {
      rival: jugadorID,
      duenoMesa,
      matchId,
      turnId: 1,
      shooterID: duenoMesa
    });

    // Bootstrap del turno 1 para ambos
    io.to(matchId).emit("evento", {
      tipo: "syncTurno",
      jugadorID: duenoMesa,
      duenoMesa,
      turnId: 1,
      turno: 1,
      shooterID: duenoMesa,
      matchId
    });

    delete mesasDisponibles[duenoMesa];
  });

  // 🎯 Evento genérico
  socket.on("evento", (data) => {
    if (!data || typeof data !== "object") {
      console.log("⚠️ Evento inválido:", data);
      return;
    }

    const tipo = data.tipo;

    // ✅ Permitir solicitarMesasDisponibles fuera de partida sin ruido feo
    if (tipo === "solicitarMesasDisponibles") {
      console.log(`📋 solicitarMesasDisponibles de ${data.jugadorID || "?"}`);
      for (const duenoMesa of Object.keys(mesasDisponibles)) {
        io.to(socket.id).emit("mesaDisponible", { duenoMesa });
      }
      return;
    }

    const match = getMatchBySocket(socket.id);
    if (!match) {
      console.log("⚠️ evento recibido fuera de partida activa:", tipo);
      return;
    }

    console.log(`🎯 evento tipo=${tipo} match=${match.matchId}`);

    if (tipo === "syncTurno") {
      const requestedTurnId = Number(data.turnId ?? data.turno ?? 0);
      const requestedShooter = norm(data.shooterID);
      const senderJugadorID = norm(data.jugadorID);

      if (!requestedTurnId || !requestedShooter) {
        console.log("⛔ syncTurno inválido: falta turnId o shooterID", data);
        return;
      }

      if (!isPlayerInMatch(match, senderJugadorID)) {
        console.log("⛔ syncTurno rechazado: emisor fuera de partida", data);
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

      // conflicto mismo turno distinto shooter
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

      // ✅ debe avanzar exactamente al siguiente turno
      const expectedNextTurn = match.turnId + 1;
      if (requestedTurnId !== expectedNextTurn) {
        console.log(
          `⛔ syncTurno rechazado: requestedTurn=${requestedTurnId} expectedNextTurn=${expectedNextTurn}`
        );
        return;
      }

      // ✅ el servidor decide quién dispara ese turno
      const expectedShooter = norm(expectedShooterForTurn(match, requestedTurnId));
      if (requestedShooter !== expectedShooter) {
        console.log(
          `⛔ syncTurno rechazado: shooter inválido requested=${requestedShooter} expected=${expectedShooter}`
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

      io.to(match.matchId).emit("evento", {
        ...data,
        turnId: requestedTurnId,
        turno: requestedTurnId,
        shooterID: requestedShooter,
        matchId: match.matchId
      });
      return;
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

      cleanupMatch(matchId, "disconnect");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor WebSocket corriendo en puerto ${PORT}`);
});

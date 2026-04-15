const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: "*"
  }
});

app.get("/", (req, res) => {
  res.send("✅ Servidor WebSocket activo");
});

// =========================
// Estado del servidor
// =========================

// Mesas esperando rival
const mesasDisponibles = {};

// Partidas activas
const partidas = {};

// socket.id -> metadata
const socketMeta = new Map();

// =========================
// Helpers
// =========================

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function makeMatchId() {
  if (crypto.randomUUID) {
    return `match_${crypto.randomUUID()}`;
  }
  return `match_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getSocketMeta(socketId) {
  return socketMeta.get(socketId) || null;
}

function setSocketMeta(socketId, patch) {
  const prev = socketMeta.get(socketId) || {};
  const next = { ...prev, ...patch };
  socketMeta.set(socketId, next);
  return next;
}

function removeSocketMeta(socketId) {
  socketMeta.delete(socketId);
}

function getMatchById(matchId) {
  if (!matchId) return null;
  return partidas[matchId] || null;
}

function findMatchBySocketId(socketId) {
  const meta = getSocketMeta(socketId);
  if (!meta?.matchId) return null;
  return partidas[meta.matchId] || null;
}

function getOpponentSocketId(match, socketId) {
  if (!match) return null;
  if (match.ownerSocketId === socketId) return match.guestSocketId;
  if (match.guestSocketId === socketId) return match.ownerSocketId;
  return null;
}

function isSocketInMatch(match, socketId) {
  if (!match) return false;
  return match.ownerSocketId === socketId || match.guestSocketId === socketId;
}

function isPlayerInMatch(match, jugadorID) {
  if (!match || !jugadorID) return false;
  const id = norm(jugadorID);
  return norm(match.ownerId) === id || norm(match.guestId) === id;
}

function expectedShooterForTurn(match, turnId) {
  // Turnos impares: owner
  // Turnos pares: guest
  return turnId % 2 === 1 ? match.ownerId : match.guestId;
}

function safeEmitToMatch(matchId, eventName, payload) {
  io.to(matchId).emit(eventName, payload);
}

function cleanupMatch(matchId, reason = "unknown") {
  const match = partidas[matchId];
  if (!match) return;

  console.log(`🧹 cleanupMatch matchId=${matchId} reason=${reason}`);

  if (match.ownerSocketId) {
    const ownerMeta = getSocketMeta(match.ownerSocketId);
    if (ownerMeta) {
      delete ownerMeta.matchId;
      socketMeta.set(match.ownerSocketId, ownerMeta);
    }
  }

  if (match.guestSocketId) {
    const guestMeta = getSocketMeta(match.guestSocketId);
    if (guestMeta) {
      delete guestMeta.matchId;
      socketMeta.set(match.guestSocketId, guestMeta);
    }
  }

  delete partidas[matchId];
}

function logMatchState(prefix, match) {
  if (!match) {
    console.log(`${prefix} match=null`);
    return;
  }

  console.log(
    `${prefix} matchId=${match.matchId} owner=${match.ownerId} guest=${match.guestId} turnId=${match.turnId} shooterId=${match.shooterId}`
  );
}

function validatePayloadObject(data, label) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.log(`⚠️ ${label} inválido:`, data);
    return false;
  }
  return true;
}

// =========================
// Conexión principal
// =========================

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  setSocketMeta(socket.id, {
    socketId: socket.id,
    jugadorID: null,
    matchId: null
  });

  socket.onAny((event, ...args) => {
    console.log(`📡 Evento recibido socket=${socket.id} event=${event}`, args);
  });

  // =========================
  // Crear mesa
  // =========================
  socket.on("crearMesa", (data) => {
    if (!validatePayloadObject(data, "crearMesa")) return;

    const {
      jugadorID,
      nombre,
      avatarURL,
      equipoReal,
      equipoVisualRival,
      grupo
    } = data;

    // avatarURL puede venir vacío, así que sólo validamos null/undefined
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

    setSocketMeta(socket.id, {
      jugadorID,
      matchId: null
    });

    mesasDisponibles[jugadorID] = {
      socketId: socket.id,
      jugadorID,
      nombre,
      avatarURL,
      equipoReal,
      equipoVisualRival,
      grupo,
      createdAt: Date.now()
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

  // =========================
  // Unirse a una mesa
  // =========================
  socket.on("unirseAMesa", (data) => {
    if (!validatePayloadObject(data, "unirseAMesa")) return;

    const { jugadorID, duenoMesa, nombre, avatarURL } = data;
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

    const matchId = makeMatchId();

    const match = {
      matchId,

      ownerId: mesa.jugadorID,
      ownerSocketId: mesa.socketId,
      ownerNombre: mesa.nombre,
      ownerAvatarURL: mesa.avatarURL,

      guestId: jugadorID,
      guestSocketId: socket.id,
      guestNombre: nombre || "",
      guestAvatarURL: avatarURL || "",

      turnId: 1,
      shooterId: mesa.jugadorID,

      // Para bloquear duplicados/conflictos de syncTurno
      lastAppliedSyncTurn: {
        turnId: 1,
        shooterId: norm(mesa.jugadorID)
      },

      createdAt: Date.now()
    };

    partidas[matchId] = match;

    setSocketMeta(socket.id, {
      jugadorID,
      matchId
    });

    setSocketMeta(mesa.socketId, {
      jugadorID: mesa.jugadorID,
      matchId
    });

    socket.join(matchId);
    socketDueno.join(matchId);

    console.log(`🎮 ${jugadorID} se unió a la mesa de ${duenoMesa}`);
    logMatchState("✅ Partida creada", match);

    // Invitado
    socket.emit("juegoListo", {
      rival: mesa.jugadorID,
      nombre: mesa.nombre,
      avatarURL: mesa.avatarURL,
      equipo: mesa.equipoReal,
      grupo: mesa.grupo,
      duenoMesa: mesa.jugadorID,
      matchId,
      turnId: 1,
      shooterID: mesa.jugadorID
    });

    // Dueño
    socketDueno.emit("juegoListo", {
      rival: jugadorID,
      nombre: nombre || "",
      avatarURL: avatarURL || "",
      duenoMesa: mesa.jugadorID,
      matchId,
      turnId: 1,
      shooterID: mesa.jugadorID
    });

    // Bootstrap autoritativo del turno 1
    safeEmitToMatch(matchId, "evento", {
      tipo: "syncTurno",
      jugadorID: mesa.jugadorID,
      duenoMesa: mesa.jugadorID,
      turnId: 1,
      turno: 1,
      shooterID: mesa.jugadorID,
      matchId
    });

    delete mesasDisponibles[duenoMesa];
  });

  // =========================
  // Jugada
  // =========================
  socket.on("jugada", (data) => {
    if (!validatePayloadObject(data, "jugada")) return;

    const match = findMatchBySocketId(socket.id);
    if (!match) {
      console.log("⚠️ jugada recibida fuera de partida activa:", data);
      return;
    }

    if (!isSocketInMatch(match, socket.id)) {
      console.log("⛔ jugada rechazada: socket fuera de la partida", data);
      return;
    }

    console.log(`🎮 Jugada recibida match=${match.matchId}`, data);

    socket.to(match.matchId).emit("jugada", {
      ...data,
      matchId: match.matchId
    });
  });

  // =========================
  // Movimiento del balón
  // =========================
  socket.on("ballMove", (data) => {
    if (!validatePayloadObject(data, "ballMove")) return;

    const match = findMatchBySocketId(socket.id);
    if (!match) {
      console.log("⚠️ ballMove recibido fuera de partida activa:", data);
      return;
    }

    if (!isSocketInMatch(match, socket.id)) {
      console.log("⛔ ballMove rechazado: socket fuera de la partida", data);
      return;
    }

    socket.to(match.matchId).emit("ballMove", {
      ...data,
      matchId: match.matchId
    });
  });

  // =========================
  // Impulso del balón
  // =========================
  socket.on("patearBalon", (data) => {
    if (!validatePayloadObject(data, "patearBalon")) return;

    const match = findMatchBySocketId(socket.id);
    if (!match) {
      console.log("⚠️ patearBalon recibido fuera de partida activa:", data);
      return;
    }

    if (!isSocketInMatch(match, socket.id)) {
      console.log("⛔ patearBalon rechazado: socket fuera de la partida", data);
      return;
    }

    socket.to(match.matchId).emit("patearBalon", {
      ...data,
      matchId: match.matchId
    });
  });

  // =========================
  // Evento genérico
  // =========================
  socket.on("evento", (data) => {
    if (!validatePayloadObject(data, "evento")) return;

    const match = findMatchBySocketId(socket.id);
    if (!match) {
      console.log("⚠️ evento recibido fuera de partida activa:", data);
      return;
    }

    if (!isSocketInMatch(match, socket.id)) {
      console.log("⛔ evento rechazado: socket fuera de la partida", data);
      return;
    }

    const tipo = data.tipo;
    const senderMeta = getSocketMeta(socket.id);
    const senderJugadorID = senderMeta?.jugadorID || "";
    console.log(`🎯 Evento recibido match=${match.matchId} tipo=${tipo}`, data);

    // =========================
    // VALIDACIÓN AUTORITATIVA DE syncTurno
    // =========================
    if (tipo === "syncTurno") {
      const requestedTurnId = Number(data.turnId ?? data.turno ?? 0);
      const requestedShooter = norm(data.shooterID);
      const senderIdNorm = norm(senderJugadorID);

      if (!requestedTurnId || !requestedShooter) {
        console.log("⛔ syncTurno inválido: falta turnId o shooterID", data);
        return;
      }

      if (!isPlayerInMatch(match, senderJugadorID)) {
        console.log("⛔ syncTurno rechazado: emisor no pertenece a la partida", data);
        return;
      }

      // Repetido exacto
      if (
        match.lastAppliedSyncTurn &&
        match.lastAppliedSyncTurn.turnId === requestedTurnId &&
        match.lastAppliedSyncTurn.shooterId === requestedShooter
      ) {
        console.log(`🔁 syncTurno duplicado idéntico ignorado turn=${requestedTurnId} shooter=${requestedShooter}`);
        return;
      }

      // Conflicto grave: mismo turno, distinto shooter
      if (
        match.lastAppliedSyncTurn &&
        match.lastAppliedSyncTurn.turnId === requestedTurnId &&
        match.lastAppliedSyncTurn.shooterId !== requestedShooter
      ) {
        console.log(
          `🚨 CONFLICTO syncTurno rechazado match=${match.matchId} turn=${requestedTurnId} shooterPrevio=${match.lastAppliedSyncTurn.shooterId} shooterNuevo=${requestedShooter}`
        );
        return;
      }

      // Debe avanzar exactamente al siguiente turno
      const expectedNextTurn = match.turnId + 1;
      if (requestedTurnId !== expectedNextTurn) {
        console.log(
          `⛔ syncTurno rechazado: turnId inválido requested=${requestedTurnId} expected=${expectedNextTurn}`
        );
        return;
      }

      // El shooter esperado lo decide el servidor
      const expectedShooter = norm(expectedShooterForTurn(match, requestedTurnId));
      if (requestedShooter !== expectedShooter) {
        console.log(
          `⛔ syncTurno rechazado: shooter inválido requested=${requestedShooter} expected=${expectedShooter}`
        );
        return;
      }

      // Opcional: sólo el tirador actual puede pedir el siguiente turno
      const currentShooter = norm(match.shooterId);
      if (senderIdNorm !== currentShooter) {
        console.log(
          `⛔ syncTurno rechazado: sólo el tirador actual puede cerrar turno sender=${senderIdNorm} currentShooter=${currentShooter}`
        );
        return;
      }

      match.turnId = requestedTurnId;
      match.shooterId = expectedShooter;
      match.lastAppliedSyncTurn = {
        turnId: requestedTurnId,
        shooterId: expectedShooter
      };

      const payload = {
        ...data,
        turnId: requestedTurnId,
        turno: requestedTurnId,
        shooterID: expectedShooter,
        duenoMesa: match.ownerId,
        jugadorID: senderJugadorID,
        matchId: match.matchId
      };

      console.log(
        `✅ syncTurno aceptado match=${match.matchId} turn=${requestedTurnId} shooter=${expectedShooter}`
      );
      logMatchState("📘 Estado match actualizado", match);

      safeEmitToMatch(match.matchId, "evento", payload);
      return;
    }

    // =========================
    // cerrarMesa
    // =========================
    if (tipo === "cerrarMesa") {
      console.log(`🛑 cerrarMesa recibido match=${match.matchId} por ${senderJugadorID}`);

      const opponentSocketId = getOpponentSocketId(match, socket.id);
      if (opponentSocketId) {
        io.to(opponentSocketId).emit("evento", {
          tipo: "mesaCerrada",
          matchId: match.matchId
        });
      }

      cleanupMatch(match.matchId, "cerrarMesa");
      return;
    }

    // Resto de eventos: sólo al rival
    socket.to(match.matchId).emit("evento", {
      ...data,
      matchId: match.matchId
    });
  });

  // =========================
  // Desconexión
  // =========================
  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);

    // Limpiar mesas pendientes
    for (const [jugadorID, mesa] of Object.entries(mesasDisponibles)) {
      if (mesa.socketId === socket.id) {
        delete mesasDisponibles[jugadorID];
        console.log(`🗑️ Mesa eliminada de ${jugadorID}`);
        break;
      }
    }

    // Limpiar partida activa
    const meta = getSocketMeta(socket.id);
    if (meta?.matchId && partidas[meta.matchId]) {
      const match = partidas[meta.matchId];
      const opponentSocketId = getOpponentSocketId(match, socket.id);

      if (opponentSocketId) {
        io.to(opponentSocketId).emit("evento", {
          tipo: "rivalDesconectado",
          matchId: match.matchId
        });
      }

      cleanupMatch(meta.matchId, "disconnect");
    }

    removeSocketMeta(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor WebSocket corriendo en puerto ${PORT}`);
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get("/", (req, res) => {
  res.send("✅ Servidor WebSocket activo");
});

/**
 * ===============================
 * Estado global en memoria
 * ===============================
 */

// Mesas visibles para matchmaking
// key = duenoMesa
const mesasDisponibles = {};

// Partidas activas
// key = roomId
const partidas = {};

// Relación socket -> room / jugador
const socketIndex = {};

/**
 * ===============================
 * Helpers
 * ===============================
 */

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function safeString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function makeRoomId(duenoMesa) {
  return `mesa:${duenoMesa}`;
}

function getOpponentId(partida, jugadorID) {
  if (!partida) return "";
  if (partida.jugador1?.jugadorID === jugadorID) {
    return partida.jugador2?.jugadorID || "";
  }
  if (partida.jugador2?.jugadorID === jugadorID) {
    return partida.jugador1?.jugadorID || "";
  }
  return "";
}

function getPlayerRole(partida, jugadorID) {
  if (!partida) return null;
  if (partida.jugador1?.jugadorID === jugadorID) return "jugador1";
  if (partida.jugador2?.jugadorID === jugadorID) return "jugador2";
  return null;
}

function buildPlayerPayload(raw = {}) {
  return {
    jugadorID: safeString(raw.jugadorID),
    nombre: safeString(raw.nombre),
    avatarURL: safeString(raw.avatarURL),
    avatarType: safeString(raw.avatarType),
    avatarValue: safeString(raw.avatarValue),
    avatarRemoteUrl: safeString(raw.avatarRemoteUrl),
    equipoReal: safeString(raw.equipoReal),
    equipoVisualRival: safeString(raw.equipoVisualRival),
    grupo: safeString(raw.grupo),
    socketId: safeString(raw.socketId)
  };
}

function buildJuegoListoPayload(partida, receptorId) {
  const esJugador1 = partida.jugador1.jugadorID === receptorId;
  const yo = esJugador1 ? partida.jugador1 : partida.jugador2;
  const rival = esJugador1 ? partida.jugador2 : partida.jugador1;

  return {
    tipo: "juegoListo",
    roomId: partida.roomId,
    duenoMesa: partida.duenoMesa,

    soyJugador1: esJugador1,
    turnoActual: partida.turnoActual,
    shooterID: partida.shooterID,

    yo: {
      jugadorID: yo.jugadorID,
      nombre: yo.nombre,
      avatarURL: yo.avatarURL,
      avatarType: yo.avatarType,
      avatarValue: yo.avatarValue,
      avatarRemoteUrl: yo.avatarRemoteUrl,
      equipoReal: yo.equipoReal,
      equipoVisualRival: yo.equipoVisualRival,
      grupo: yo.grupo
    },

    rival: {
      jugadorID: rival.jugadorID,
      nombre: rival.nombre,
      avatarURL: rival.avatarURL,
      avatarType: rival.avatarType,
      avatarValue: rival.avatarValue,
      avatarRemoteUrl: rival.avatarRemoteUrl,
      equipoReal: rival.equipoReal,
      equipoVisualRival: rival.equipoVisualRival,
      grupo: rival.grupo
    }
  };
}

function emitToRoom(roomId, eventName, payload, excludeSocketId = null) {
  if (!roomId) return;

  if (excludeSocketId) {
    io.to(roomId).except(excludeSocketId).emit(eventName, payload);
  } else {
    io.to(roomId).emit(eventName, payload);
  }
}

function attachRoomMetadata(payload, partida, jugadorID) {
  return {
    ...payload,
    roomId: partida.roomId,
    duenoMesa: partida.duenoMesa,
    jugadorID: safeString(payload.jugadorID || jugadorID)
  };
}

function getPartidaFromSocket(socket) {
  const meta = socketIndex[socket.id];
  if (!meta?.roomId) return null;
  return partidas[meta.roomId] || null;
}

function validateSocketBelongsToPartida(socket, jugadorID = "") {
  const partida = getPartidaFromSocket(socket);
  if (!partida) return { ok: false, error: "Partida no encontrada", partida: null };

  const meta = socketIndex[socket.id];
  if (!meta) return { ok: false, error: "Socket sin metadata", partida: null };

  if (jugadorID && meta.jugadorID && jugadorID !== meta.jugadorID) {
    return { ok: false, error: "jugadorID no coincide con socket", partida };
  }

  return { ok: true, error: "", partida };
}

function removeMesaDisponibleBySocket(socketId) {
  for (const [duenoMesa, mesa] of Object.entries(mesasDisponibles)) {
    if (mesa.socketId === socketId) {
      delete mesasDisponibles[duenoMesa];
      console.log(`🗑️ Mesa eliminada de ${duenoMesa}`);
      return;
    }
  }
}

function closePartida(roomId, reason = "closed") {
  const partida = partidas[roomId];
  if (!partida) return;

  emitToRoom(roomId, "evento", {
    tipo: "partidaCerrada",
    roomId,
    duenoMesa: partida.duenoMesa,
    reason
  });

  delete partidas[roomId];
}

function maybeAdvanceTurn(partida, payload) {
  const turnId = Number(payload.turnId || payload.turno || 0);
  if (!turnId || !partida) return null;

  // Evita avanzar dos veces el mismo turno
  if (turnId < partida.turnoActual) {
    return null;
  }

  const currentShooter = partida.shooterID;
  const nextShooter =
    currentShooter === partida.jugador1.jugadorID
      ? partida.jugador2.jugadorID
      : partida.jugador1.jugadorID;

  partida.turnoActual = turnId + 1;
  partida.shooterID = nextShooter;
  partida.lastTurnClosedAt = Date.now();

  return {
    tipo: "syncTurno",
    roomId: partida.roomId,
    duenoMesa: partida.duenoMesa,
    turnId: partida.turnoActual,
    shooterID: partida.shooterID,
    jugadorTurno: partida.shooterID
  };
}

/**
 * ===============================
 * Socket.IO
 * ===============================
 */

io.on("connection", (socket) => {
  console.log("✅ Usuario conectado:", socket.id);

  socket.onAny((event, ...args) => {
    console.log(`📡 Evento recibido: ${event}`, args);
  });

  /**
   * Crear mesa
   */
  socket.on("crearMesa", (data = {}) => {
    const jugadorID = safeString(data.jugadorID);
    const nombre = safeString(data.nombre);
    const avatarURL = safeString(data.avatarURL);
    const avatarType = safeString(data.avatarType);
    const avatarValue = safeString(data.avatarValue);
    const avatarRemoteUrl = safeString(data.avatarRemoteUrl);
    const equipoReal = safeString(data.equipoReal);
    const equipoVisualRival = safeString(data.equipoVisualRival);
    const grupo = safeString(data.grupo);

    if (
      !isNonEmptyString(jugadorID) ||
      !isNonEmptyString(nombre) ||
      !isNonEmptyString(equipoReal) ||
      !isNonEmptyString(equipoVisualRival) ||
      !isNonEmptyString(grupo)
    ) {
      console.log("⚠️ Datos incompletos para crear mesa:", data);
      socket.emit("errorMesa", {
        tipo: "errorMesa",
        mensaje: "Datos incompletos para crear mesa"
      });
      return;
    }

    const roomId = makeRoomId(jugadorID);
    socket.join(roomId);

    const jugador1 = buildPlayerPayload({
      jugadorID,
      nombre,
      avatarURL,
      avatarType,
      avatarValue,
      avatarRemoteUrl,
      equipoReal,
      equipoVisualRival,
      grupo,
      socketId: socket.id
    });

    mesasDisponibles[jugadorID] = {
      roomId,
      duenoMesa: jugadorID,
      socketId: socket.id,
      nombre,
      avatarURL,
      avatarType,
      avatarValue,
      avatarRemoteUrl,
      equipoReal,
      equipoVisualRival,
      grupo,
      createdAt: Date.now()
    };

    socketIndex[socket.id] = {
      jugadorID,
      roomId,
      duenoMesa: jugadorID
    };

    partidas[roomId] = {
      roomId,
      duenoMesa: jugadorID,
      jugador1,
      jugador2: null,
      turnoActual: 1,
      shooterID: jugadorID,
      lastTurnClosedAt: 0,
      createdAt: Date.now()
    };

    console.log("🧩 Mesa creada:", {
      roomId,
      duenoMesa: jugadorID,
      nombre,
      equipoReal,
      equipoVisualRival,
      grupo
    });

    socket.emit("mesaCreada", {
      tipo: "mesaCreada",
      roomId,
      duenoMesa: jugadorID
    });

    socket.broadcast.emit("mesaDisponible", {
      tipo: "mesaDisponible",
      duenoMesa: jugadorID,
      roomId,
      grupo,
      nombre
    });
  });

  /**
   * Unirse a mesa
   */
  socket.on("unirseAMesa", (data = {}) => {
    const jugadorID = safeString(data.jugadorID);
    const duenoMesa = safeString(data.duenoMesa);
    const nombre = safeString(data.nombre);
    const avatarURL = safeString(data.avatarURL);
    const avatarType = safeString(data.avatarType);
    const avatarValue = safeString(data.avatarValue);
    const avatarRemoteUrl = safeString(data.avatarRemoteUrl);
    const equipoReal = safeString(data.equipoReal);
    const equipoVisualRival = safeString(data.equipoVisualRival);
    const grupo = safeString(data.grupo);

    if (!isNonEmptyString(jugadorID) || !isNonEmptyString(duenoMesa)) {
      console.log("⚠️ Datos incompletos para unirse a mesa:", data);
      socket.emit("errorMesa", {
        tipo: "errorMesa",
        mensaje: "Datos incompletos para unirse a mesa"
      });
      return;
    }

    const mesa = mesasDisponibles[duenoMesa];
    const roomId = makeRoomId(duenoMesa);
    const partida = partidas[roomId];

    if (!mesa || !partida || !partida.jugador1) {
      console.log(`❗ Mesa no encontrada para ${duenoMesa}`);
      socket.emit("errorMesa", {
        tipo: "errorMesa",
        mensaje: "Mesa no encontrada"
      });
      return;
    }

    if (partida.jugador2) {
      console.log(`⚠️ Mesa ya llena: ${duenoMesa}`);
      socket.emit("errorMesa", {
        tipo: "errorMesa",
        mensaje: "Mesa ya llena"
      });
      return;
    }

    const jugador2 = buildPlayerPayload({
      jugadorID,
      nombre,
      avatarURL,
      avatarType,
      avatarValue,
      avatarRemoteUrl,
      equipoReal,
      equipoVisualRival,
      grupo: grupo || partida.jugador1.grupo,
      socketId: socket.id
    });

    partida.jugador2 = jugador2;

    socket.join(roomId);

    socketIndex[socket.id] = {
      jugadorID,
      roomId,
      duenoMesa
    };

    console.log(`🎮 ${jugadorID} se unió a la mesa de ${duenoMesa}`);

    const payloadJugador1 = buildJuegoListoPayload(partida, partida.jugador1.jugadorID);
    const payloadJugador2 = buildJuegoListoPayload(partida, partida.jugador2.jugadorID);

    io.to(partida.jugador1.socketId).emit("juegoListo", payloadJugador1);
    io.to(partida.jugador2.socketId).emit("juegoListo", payloadJugador2);

    emitToRoom(roomId, "evento", {
      tipo: "jugadoresListos",
      roomId,
      duenoMesa,
      turnoActual: partida.turnoActual,
      shooterID: partida.shooterID,
      jugador1: {
        jugadorID: partida.jugador1.jugadorID,
        nombre: partida.jugador1.nombre
      },
      jugador2: {
        jugadorID: partida.jugador2.jugadorID,
        nombre: partida.jugador2.nombre
      }
    });

    delete mesasDisponibles[duenoMesa];
  });

  /**
   * Jugada genérica
   */
  socket.on("jugada", (data = {}) => {
    const jugadorID = safeString(data.jugadorID);
    const check = validateSocketBelongsToPartida(socket, jugadorID);
    if (!check.ok) {
      console.log("⛔ jugada ignorada:", check.error, data);
      return;
    }

    const payload = attachRoomMetadata(data, check.partida, jugadorID);
    console.log("🎮 Jugada recibida:", payload);

    emitToRoom(check.partida.roomId, "jugada", payload, socket.id);
  });

  /**
   * Movimiento / stateSync
   */
  socket.on("ballMove", (data = {}) => {
    const jugadorID = safeString(data.jugadorID);
    const check = validateSocketBelongsToPartida(socket, jugadorID);
    if (!check.ok) {
      console.log("⛔ ballMove ignorado:", check.error, data);
      return;
    }

    const payload = attachRoomMetadata(data, check.partida, jugadorID);
    console.log("⚽ Movimiento del balón:", payload);

    emitToRoom(check.partida.roomId, "ballMove", payload, socket.id);
  });

  /**
   * Disparo
   */
  socket.on("patearBalon", (data = {}) => {
    const jugadorID = safeString(data.jugadorID);
    const check = validateSocketBelongsToPartida(socket, jugadorID);
    if (!check.ok) {
      console.log("⛔ patearBalon ignorado:", check.error, data);
      return;
    }

    const payload = attachRoomMetadata(data, check.partida, jugadorID);
    console.log("💥 Evento patearBalon recibido:", payload);

    emitToRoom(check.partida.roomId, "patearBalon", payload, socket.id);
  });

  /**
   * Evento genérico de partida
   */
  socket.on("evento", (data = {}) => {
    if (!data || typeof data !== "object") {
      console.log("⚠️ Evento inválido:", data);
      return;
    }

    const jugadorID = safeString(data.jugadorID);
    const tipo = safeString(data.tipo);
    const check = validateSocketBelongsToPartida(socket, jugadorID);

    // Permite algunos eventos de lobby fuera de partida activa
    const lobbyTypes = new Set(["crearMesa", "unirseMesa", "solicitarMesasDisponibles"]);
    if (!check.ok && !lobbyTypes.has(tipo)) {
      console.log("⛔ evento ignorado:", check.error, data);
      return;
    }

    if (tipo === "solicitarMesasDisponibles") {
      const listado = Object.values(mesasDisponibles).map((mesa) => ({
        duenoMesa: mesa.duenoMesa,
        roomId: mesa.roomId,
        nombre: mesa.nombre,
        grupo: mesa.grupo
      }));

      socket.emit("mesasDisponibles", {
        tipo: "mesasDisponibles",
        mesas: listado
      });
      return;
    }

    if (lobbyTypes.has(tipo) && !check.ok) {
      // ya se manejan por sus eventos específicos
      return;
    }

    const partida = check.partida;
    const payload = attachRoomMetadata(data, partida, jugadorID);

    console.log("🎯 Evento personalizado recibido:", payload);

    // Si llega cierre de turno, el servidor avanza turno y emite syncTurno autoritativo
    if (tipo === "turn_closed" || tipo === "turnClosed" || tipo === "cerrarTurno") {
      emitToRoom(partida.roomId, "evento", payload, socket.id);

      const syncPayload = maybeAdvanceTurn(partida, payload);
      if (syncPayload) {
        emitToRoom(partida.roomId, "evento", syncPayload);
      }
      return;
    }

    // Fin de partida
    if (tipo === "finPartido" || tipo === "match_finished") {
      emitToRoom(partida.roomId, "evento", payload);
      closePartida(partida.roomId, "match_finished");
      return;
    }

    emitToRoom(partida.roomId, "evento", payload, socket.id);
  });

  /**
   * Desconexión
   */
  socket.on("disconnect", () => {
    console.log("❌ Usuario desconectado:", socket.id);

    removeMesaDisponibleBySocket(socket.id);

    const meta = socketIndex[socket.id];
    if (!meta?.roomId) {
      delete socketIndex[socket.id];
      return;
    }

    const partida = partidas[meta.roomId];
    if (partida) {
      emitToRoom(meta.roomId, "evento", {
        tipo: "rivalDesconectado",
        roomId: meta.roomId,
        duenoMesa: partida.duenoMesa,
        jugadorID: meta.jugadorID
      }, socket.id);

      closePartida(meta.roomId, "disconnect");
    }

    delete socketIndex[socket.id];
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Servidor WebSocket corriendo en puerto ${PORT}`);
});

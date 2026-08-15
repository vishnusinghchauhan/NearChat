import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import crypto from "crypto";

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "near-chat-server", time: new Date().toISOString() });
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

// In-memory MVP state.
// Replace with Redis/MongoDB for production and multiple server instances.
const users = new Map();       // socketId -> user
const waiting = new Set();     // socket IDs currently waiting
const rooms = new Map();       // roomId -> Set(socketId)
const blocked = new Map();     // socketId -> Set(socketId)
const reports = [];

const SEARCH_STEPS_KM = [5, 25, 100];

function isFiniteCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateLocation(location) {
  return (
    location &&
    isFiniteCoordinate(location.lat) &&
    isFiniteCoordinate(location.lng) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180
  );
}

function haversineKm(a, b) {
  const R = 6371;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function makeRoomId() {
  return `room_${crypto.randomUUID()}`;
}

function removeFromRoom(socketId) {
  const user = users.get(socketId);
  if (!user?.roomId) return null;

  const roomId = user.roomId;
  const room = rooms.get(roomId);

  if (room) {
    room.delete(socketId);
    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }

  user.roomId = null;
  return roomId;
}

function getPartner(socketId) {
  const user = users.get(socketId);
  if (!user?.roomId) return null;

  const room = rooms.get(user.roomId);
  if (!room) return null;

  for (const id of room) {
    if (id !== socketId) return id;
  }

  return null;
}

function canMatch(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (!a.location || !b.location) return false;
  if (a.roomId || b.roomId) return false;

  const aBlocks = blocked.get(a.id) || new Set();
  const bBlocks = blocked.get(b.id) || new Set();

  return !aBlocks.has(b.id) && !bBlocks.has(a.id);
}

function chooseNearest(socketId, maxDistanceKm = Infinity) {
  const user = users.get(socketId);
  if (!user?.location) return null;

  let best = null;

  for (const candidateId of waiting) {
    if (candidateId === socketId) continue;

    const candidate = users.get(candidateId);
    if (!canMatch(user, candidate)) continue;

    const distance = haversineKm(user.location, candidate.location);

    if (distance <= maxDistanceKm && (!best || distance < best.distance)) {
      best = { candidate, distance };
    }
  }

  return best;
}

function matchUsers(aId, bId, distanceKm) {
  const a = users.get(aId);
  const b = users.get(bId);

  if (!canMatch(a, b)) return false;

  waiting.delete(aId);
  waiting.delete(bId);

  const roomId = makeRoomId();
  rooms.set(roomId, new Set([aId, bId]));

  a.roomId = roomId;
  b.roomId = roomId;

  const aSocket = io.sockets.sockets.get(aId);
  const bSocket = io.sockets.sockets.get(bId);

  aSocket?.join(roomId);
  bSocket?.join(roomId);

  aSocket?.emit("matched", {
    roomId,
    approximateDistanceKm: Math.round(distanceKm * 10) / 10
  });

  bSocket?.emit("matched", {
    roomId,
    approximateDistanceKm: Math.round(distanceKm * 10) / 10
  });

  return true;
}

function tryMatch(socketId) {
  const user = users.get(socketId);
  if (!user?.location || user.roomId) return false;

  // First: strict nearby radius.
  for (const radius of SEARCH_STEPS_KM) {
    const match = chooseNearest(socketId, radius);
    if (match) {
      return matchUsers(socketId, match.candidate.id, match.distance);
    }
  }

  // Finally: global fallback.
  const match = chooseNearest(socketId, Infinity);
  if (match) {
    return matchUsers(socketId, match.candidate.id, match.distance);
  }

  return false;
}

io.on("connection", (socket) => {
  users.set(socket.id, {
    id: socket.id,
    location: null,
    roomId: null,
    searching: false,
    connectedAt: Date.now()
  });

  blocked.set(socket.id, new Set());

  socket.emit("ready", { socketId: socket.id });

  socket.on("set-location", (payload, callback) => {
    const user = users.get(socket.id);

    if (!user) return;
    if (!validateLocation(payload)) {
      callback?.({ ok: false, error: "Invalid location." });
      return;
    }

    // Only store coordinates server-side for matching.
    // Never send these coordinates to another user.
    user.location = {
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      countryCode: typeof payload.countryCode === "string"
        ? payload.countryCode.slice(0, 2).toUpperCase()
        : null
    };

    callback?.({ ok: true });
  });

  socket.on("find-stranger", (callback) => {
    const user = users.get(socket.id);

    if (!user?.location) {
      callback?.({ ok: false, error: "Location is required before matching." });
      return;
    }

    if (user.roomId) {
      callback?.({ ok: false, error: "You are already chatting." });
      return;
    }

    user.searching = true;
    waiting.add(socket.id);

    const matched = tryMatch(socket.id);

    callback?.({
      ok: true,
      searching: !matched
    });

    if (!matched) {
      socket.emit("searching", { message: "Looking for someone nearby..." });
    }
  });

  socket.on("next", () => {
    const user = users.get(socket.id);
    if (!user) return;

    const oldRoomId = user.roomId;
    const partnerId = getPartner(socket.id);

    if (oldRoomId) {
      removeFromRoom(socket.id);

      if (partnerId) {
        const partner = users.get(partnerId);
        if (partner) partner.roomId = null;

        const partnerSocket = io.sockets.sockets.get(partnerId);
        partnerSocket?.leave(oldRoomId);
        partnerSocket?.emit("partner-left");
      }

      socket.leave(oldRoomId);
      socket.emit("chat-ended");
    }

    user.searching = true;
    waiting.add(socket.id);

    if (!tryMatch(socket.id)) {
      socket.emit("searching", { message: "Looking for another person..." });
    }
  });

  socket.on("leave", () => {
    const user = users.get(socket.id);
    if (!user) return;

    const partnerId = getPartner(socket.id);
    const roomId = user.roomId;

    removeFromRoom(socket.id);
    waiting.delete(socket.id);
    user.searching = false;

    if (roomId) socket.leave(roomId);

    if (partnerId) {
      const partner = users.get(partnerId);
      if (partner) partner.roomId = null;

      const partnerSocket = io.sockets.sockets.get(partnerId);
      partnerSocket?.leave(roomId);
      partnerSocket?.emit("partner-left");
    }

    socket.emit("chat-ended");
  });

  socket.on("message", (payload, callback) => {
    const user = users.get(socket.id);
    if (!user?.roomId) {
      callback?.({ ok: false, error: "You are not in a chat." });
      return;
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";

    if (!text) {
      callback?.({ ok: false, error: "Message is empty." });
      return;
    }

    if (text.length > 1000) {
      callback?.({ ok: false, error: "Message is too long." });
      return;
    }

    io.to(user.roomId).emit("message", {
      id: crypto.randomUUID(),
      sender: socket.id,
      text,
      createdAt: new Date().toISOString()
    });

    callback?.({ ok: true });
  });

  socket.on("typing", (isTyping) => {
    const user = users.get(socket.id);
    if (!user?.roomId) return;

    socket.to(user.roomId).emit("typing", Boolean(isTyping));
  });

  socket.on("block", () => {
    const user = users.get(socket.id);
    const partnerId = getPartner(socket.id);

    if (!user || !partnerId) return;

    const set = blocked.get(socket.id) || new Set();
    set.add(partnerId);
    blocked.set(socket.id, set);

    socket.emit("blocked");

    // End current chat and immediately look for another person.
    const roomId = user.roomId;
    removeFromRoom(socket.id);

    const partner = users.get(partnerId);
    if (partner) partner.roomId = null;

    const partnerSocket = io.sockets.sockets.get(partnerId);
    partnerSocket?.leave(roomId);
    partnerSocket?.emit("partner-left");

    socket.leave(roomId);
    user.searching = true;
    waiting.add(socket.id);

    if (!tryMatch(socket.id)) {
      socket.emit("searching", { message: "Looking for another person..." });
    }
  });

  socket.on("report", (payload) => {
    const user = users.get(socket.id);
    const partnerId = getPartner(socket.id);

    if (!user || !partnerId) return;

    const reason =
      typeof payload?.reason === "string"
        ? payload.reason.slice(0, 200)
        : "No reason provided";

    reports.push({
      id: crypto.randomUUID(),
      reporter: socket.id,
      reported: partnerId,
      reason,
      createdAt: new Date().toISOString()
    });

    socket.emit("reported");
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (!user) return;

    const partnerId = getPartner(socket.id);
    const roomId = user.roomId;

    waiting.delete(socket.id);
    removeFromRoom(socket.id);
    blocked.delete(socket.id);
    users.delete(socket.id);

    if (roomId && partnerId) {
      const partner = users.get(partnerId);
      if (partner) partner.roomId = null;

      const partnerSocket = io.sockets.sockets.get(partnerId);
      partnerSocket?.leave(roomId);
      partnerSocket?.emit("partner-left");
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`NearChat server running on http://localhost:${PORT}`);
});

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
  res.json({
    ok: true,
    service: "near-chat-server",
    time: new Date().toISOString()
  });
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

// Simple MVP state. For production use Redis for matching and a database
// for reports/block lists.
const users = new Map();       // socketId -> user
const waiting = new Set();     // socket IDs currently waiting
const rooms = new Map();       // roomId -> Set(socketId)
const blocked = new Map();     // socketId -> Set(socketId)
const reports = [];

function makeRoomId() {
  return `room_${crypto.randomUUID()}`;
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

function removeFromRoom(socketId) {
  const user = users.get(socketId);
  if (!user?.roomId) return null;

  const roomId = user.roomId;
  const room = rooms.get(roomId);

  if (room) {
    room.delete(socketId);
    if (room.size === 0) rooms.delete(roomId);
  }

  user.roomId = null;
  return roomId;
}

function canMatch(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.roomId || b.roomId) return false;
  if (!waiting.has(a.id) || !waiting.has(b.id)) return false;

  const aBlocks = blocked.get(a.id) || new Set();
  const bBlocks = blocked.get(b.id) || new Set();

  return !aBlocks.has(b.id) && !bBlocks.has(a.id);
}

function findRandomWaitingPartner(socketId) {
  const user = users.get(socketId);
  if (!user) return null;

  const candidates = [];

  for (const candidateId of waiting) {
    if (candidateId === socketId) continue;

    const candidate = users.get(candidateId);
    if (canMatch(user, candidate)) {
      candidates.push(candidate);
    }
  }

  if (!candidates.length) return null;

  // Randomize so the same person is not always selected first.
  const candidate =
    candidates[Math.floor(Math.random() * candidates.length)];

  return candidate;
}

function matchUsers(aId, bId) {
  const a = users.get(aId);
  const b = users.get(bId);

  if (!canMatch(a, b)) return false;

  waiting.delete(aId);
  waiting.delete(bId);

  a.searching = false;
  b.searching = false;

  const roomId = makeRoomId();
  rooms.set(roomId, new Set([aId, bId]));

  a.roomId = roomId;
  b.roomId = roomId;

  const aSocket = io.sockets.sockets.get(aId);
  const bSocket = io.sockets.sockets.get(bId);

  aSocket?.join(roomId);
  bSocket?.join(roomId);

  aSocket?.emit("matched", { roomId });
  bSocket?.emit("matched", { roomId });

  return true;
}

function tryMatch(socketId) {
  const user = users.get(socketId);
  if (!user || user.roomId || !waiting.has(socketId)) return false;

  const partner = findRandomWaitingPartner(socketId);
  if (!partner) return false;

  return matchUsers(socketId, partner.id);
}

function startSearching(socket) {
  const user = users.get(socket.id);
  if (!user) return false;

  user.searching = true;
  waiting.add(socket.id);

  const matched = tryMatch(socket.id);

  if (!matched) {
    socket.emit("searching", {
      message: "Looking for an online stranger..."
    });
  }

  return matched;
}

io.on("connection", (socket) => {
  users.set(socket.id, {
    id: socket.id,
    roomId: null,
    searching: false,
    connectedAt: Date.now()
  });

  blocked.set(socket.id, new Set());

  socket.emit("ready", { socketId: socket.id });

  socket.on("find-stranger", (callback) => {
    const user = users.get(socket.id);

    if (!user) {
      callback?.({ ok: false, error: "User session not found." });
      return;
    }

    if (user.roomId) {
      callback?.({ ok: false, error: "You are already chatting." });
      return;
    }

    const matched = startSearching(socket);

    callback?.({
      ok: true,
      searching: !matched
    });
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

    waiting.delete(socket.id);
    startSearching(socket);
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

    const text =
      typeof payload?.text === "string" ? payload.text.trim() : "";

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

    const roomId = user.roomId;
    removeFromRoom(socket.id);

    const partner = users.get(partnerId);
    if (partner) partner.roomId = null;

    const partnerSocket = io.sockets.sockets.get(partnerId);
    partnerSocket?.leave(roomId);
    partnerSocket?.emit("partner-left");

    socket.leave(roomId);
    socket.emit("blocked");

    startSearching(socket);
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
  console.log(`NearChat server running on port ${PORT}`);
});

import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import crypto from "crypto";

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();

const allowedOrigins = CLIENT_ORIGIN === "*"
  ? true
  : CLIENT_ORIGIN.split(",").map((v) => v.trim()).filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "near-chat-server",
    onlineUsers: users.size,
    waitingUsers: waiting.size,
    activeChats: rooms.size,
    time: new Date().toISOString()
  });
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 20000
});

// This server supports many simultaneous users on one Render instance.
// For horizontal scaling across multiple server instances, add Redis later.
const users = new Map();       // socketId -> user
const waiting = new Set();     // socket IDs waiting for a stranger
const rooms = new Map();       // roomId -> Set(socketId)
const blocked = new Map();     // socketId -> Set(socketId)
const reports = [];
const lastMessageAt = new Map();

function roomId() {
  return `room_${crypto.randomUUID()}`;
}

function emitOnlineCount() {
  io.emit("online-count", users.size);
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

function leaveRoom(socketId, notifyPartner = true) {
  const user = users.get(socketId);
  if (!user?.roomId) return null;

  const currentRoom = user.roomId;
  const partnerId = getPartner(socketId);
  const room = rooms.get(currentRoom);

  if (room) {
    room.delete(socketId);
    if (room.size === 0) rooms.delete(currentRoom);
  }

  user.roomId = null;
  user.searching = false;

  const socket = io.sockets.sockets.get(socketId);
  socket?.leave(currentRoom);

  if (notifyPartner && partnerId) {
    const partner = users.get(partnerId);
    if (partner) partner.roomId = null;

    const partnerSocket = io.sockets.sockets.get(partnerId);
    partnerSocket?.leave(currentRoom);
    partnerSocket?.emit("partner-left");
  }

  return { roomId: currentRoom, partnerId };
}

function isBlocked(a, b) {
  const aBlocks = blocked.get(a) || new Set();
  const bBlocks = blocked.get(b) || new Set();
  return aBlocks.has(b) || bBlocks.has(a);
}

function canMatch(a, b) {
  return Boolean(
    a &&
    b &&
    a.id !== b.id &&
    !a.roomId &&
    !b.roomId &&
    waiting.has(a.id) &&
    waiting.has(b.id) &&
    !isBlocked(a.id, b.id)
  );
}

function findRandomPartner(socketId) {
  const current = users.get(socketId);
  if (!current) return null;

  const candidates = [];

  for (const id of waiting) {
    if (id === socketId) continue;
    const candidate = users.get(id);

    if (canMatch(current, candidate)) {
      candidates.push(candidate);
    }
  }

  if (!candidates.length) return null;

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function matchUsers(aId, bId) {
  const a = users.get(aId);
  const b = users.get(bId);

  if (!canMatch(a, b)) return false;

  waiting.delete(aId);
  waiting.delete(bId);

  a.searching = false;
  b.searching = false;

  const newRoom = roomId();

  rooms.set(newRoom, new Set([aId, bId]));
  a.roomId = newRoom;
  b.roomId = newRoom;

  const aSocket = io.sockets.sockets.get(aId);
  const bSocket = io.sockets.sockets.get(bId);

  aSocket?.join(newRoom);
  bSocket?.join(newRoom);

  aSocket?.emit("matched", { roomId: newRoom });
  bSocket?.emit("matched", { roomId: newRoom });

  return true;
}

function tryMatch(socketId) {
  const partner = findRandomPartner(socketId);

  if (!partner) return false;

  return matchUsers(socketId, partner.id);
}

function startSearching(socket) {
  const user = users.get(socket.id);

  if (!user) return false;

  waiting.add(socket.id);
  user.searching = true;

  if (tryMatch(socket.id)) {
    return true;
  }

  socket.emit("searching", {
    message: `Searching ${waiting.size} people waiting for a chat...`
  });

  return false;
}

io.on("connection", (socket) => {
  users.set(socket.id, {
    id: socket.id,
    roomId: null,
    searching: false,
    connectedAt: Date.now()
  });

  blocked.set(socket.id, new Set());
  emitOnlineCount();

  socket.emit("ready", {
    socketId: socket.id
  });

  socket.on("find-stranger", (callback) => {
    const user = users.get(socket.id);

    if (!user) {
      callback?.({ ok: false, error: "Session not found." });
      return;
    }

    if (user.roomId) {
      callback?.({ ok: false, error: "You are already chatting." });
      return;
    }

    if (waiting.has(socket.id)) {
      callback?.({ ok: true, searching: true });
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

    waiting.delete(socket.id);

    if (user.roomId) {
      leaveRoom(socket.id, true);
      socket.emit("chat-ended");
    }

    startSearching(socket);
  });

  socket.on("leave", () => {
    const user = users.get(socket.id);
    if (!user) return;

    waiting.delete(socket.id);
    user.searching = false;

    if (user.roomId) {
      leaveRoom(socket.id, true);
    }

    socket.emit("chat-ended");
  });

  socket.on("message", (payload, callback) => {
    const user = users.get(socket.id);

    if (!user?.roomId) {
      callback?.({ ok: false, error: "You are not in a chat." });
      return;
    }

    const now = Date.now();
    const previous = lastMessageAt.get(socket.id) || 0;

    if (now - previous < 350) {
      callback?.({ ok: false, error: "Please slow down." });
      return;
    }

    const text =
      typeof payload?.text === "string"
        ? payload.text.trim()
        : "";

    if (!text) {
      callback?.({ ok: false, error: "Message is empty." });
      return;
    }

    if (text.length > 1000) {
      callback?.({
        ok: false,
        error: "Message cannot exceed 1000 characters."
      });
      return;
    }

    lastMessageAt.set(socket.id, now);

    io.to(user.roomId).emit("message", {
      id: crypto.randomUUID(),
      sender: socket.id,
      text,
      createdAt: new Date().toISOString()
    });

    callback?.({ ok: true });
  });

  socket.on("typing", (value) => {
    const user = users.get(socket.id);

    if (!user?.roomId) return;

    socket.to(user.roomId).emit("typing", Boolean(value));
  });

  socket.on("report", (payload) => {
    const user = users.get(socket.id);
    const partnerId = getPartner(socket.id);

    if (!user || !partnerId) return;

    reports.push({
      id: crypto.randomUUID(),
      reporter: socket.id,
      reported: partnerId,
      reason:
        typeof payload?.reason === "string"
          ? payload.reason.slice(0, 200)
          : "No reason provided",
      createdAt: new Date().toISOString()
    });

    socket.emit("reported");
  });

  socket.on("block", () => {
    const partnerId = getPartner(socket.id);

    if (!partnerId) return;

    const set = blocked.get(socket.id) || new Set();
    set.add(partnerId);
    blocked.set(socket.id, set);

    leaveRoom(socket.id, true);

    socket.emit("blocked");

    startSearching(socket);
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);

    if (!user) return;

    waiting.delete(socket.id);

    if (user.roomId) {
      leaveRoom(socket.id, true);
    }

    blocked.delete(socket.id);
    lastMessageAt.delete(socket.id);
    users.delete(socket.id);

    emitOnlineCount();
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`NearChat server listening on ${PORT}`);
});

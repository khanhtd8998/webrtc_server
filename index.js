import { Server } from "socket.io";
import http from "http";
import { randomUUID } from "crypto";

const server = http.createServer();
const io = new Server(server, {
  cors: { origin: "*" },
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // ✅ CREATE MEETING
  socket.on("create-room", () => {
    const roomId = randomUUID().slice(0, 8);

    rooms.set(roomId, new Set([socket.id]));
    socket.join(roomId);

    console.log("room created:", roomId);

    socket.emit("room-created", { roomId });
  });

  // ✅ JOIN MEETING
socket.on("join-room", ({ roomId }) => {
  const room = rooms.get(roomId);
  if (!room) {
    socket.emit("room-error", { message: "Room not found" });
    return;
  }

  if (room.size >= 2) {
    socket.emit("room-error", { message: "Room full" });
    return;
  }

  room.add(socket.id);
  socket.join(roomId);

  console.log("joined room:", roomId);

  // 1️⃣ Notify existing peers that a new peer has joined
  socket.to(roomId).emit("peer-joined", { socketId: socket.id });

  // 2️⃣ Send peer-info of existing peers to the new peer
  room.forEach((peerId) => {
    if (peerId !== socket.id) {
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket && peerSocket.displayName) {
        socket.emit("peer-info", { displayName: peerSocket.displayName });
      }
    }
  });

  // 3️⃣ Notify the new peer that join was successful
  socket.emit("room-joined");
});

// Khi peer gửi displayName
socket.on("peer-info", ({ displayName }) => {
  socket.displayName = displayName; // lưu tạm ở socket

  // gửi cho tất cả peer khác trong phòng
  const roomsOfSocket = Array.from(socket.rooms).filter((r) => r !== socket.id);
  roomsOfSocket.forEach((roomId) => {
    socket.to(roomId).emit("peer-info", { displayName });
  });
});


  socket.on("signal", ({ roomId, data }) => {
    // gửi cho peer còn lại trong phòng
    socket.to(roomId).emit("signal", {
      from: socket.id,
      data,
    });
  });

  socket.on("disconnect", () => {
    for (const [roomId, members] of rooms) {
      if (members.has(socket.id)) {
        members.delete(socket.id);
        socket.to(roomId).emit("peer-left");

        if (members.size === 0) {
          rooms.delete(roomId);
        }
      }
    }
  });
});

server.listen(3001, () => {
  console.log("signaling server running on :3001");
});

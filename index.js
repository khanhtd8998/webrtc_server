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

    socket.emit("room-joined");
    socket.to(roomId).emit("peer-joined");
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

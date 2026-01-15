import { Server } from "socket.io";
import http from "http";
import { randomUUID } from "crypto";

const server = http.createServer();
const io = new Server(server, {
  cors: { origin: "*" },
});

const rooms = new Map();
const joinedRooms = new Set();

function emitRoomPeers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const peers = Array.from(room).map((peerId) => {
    const ps = io.sockets.sockets.get(peerId);
    return {
      socketId: peerId,
      displayName: ps ? (ps.displayName ?? null) : null,
    };
  });
  // Phát cho toàn bộ phòng để mọi người nhận cùng dữ liệu
  io.to(roomId).emit("room-peers", { peers });
}

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // CREATE MEETING
  socket.on("create-room", () => {
    const roomId = randomUUID().slice(0, 8);

    rooms.set(roomId, new Set([socket.id]));
    socket.join(roomId);

    console.log("room created:", roomId);

    socket.emit("room-created", { roomId });
    emitRoomPeers(roomId);
  });

  // JOIN MEETING
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

    // 1) Thông báo đến peer cũ là có người mới
    socket.to(roomId).emit("peer-joined", { socketId: socket.id });

    // 2) (Tuỳ chọn) Gửi peer-info của peer cũ cho người mới nếu đã có tên
    room.forEach((peerId) => {
      if (peerId !== socket.id) {
        const peerSocket = io.sockets.sockets.get(peerId);
        const displayName = peerSocket ? peerSocket.displayName : null;

        if (displayName) {
          socket.emit("peer-info", {
            socketId: peerId,
            displayName,
          });
        }
      }
    });

    // 3) Xác nhận join
    socket.emit("room-joined");
    emitRoomPeers(roomId);
  });

  // PULL API: client yêu cầu danh sách peers
  socket.on("get-room-peers", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("room-error", { message: "Room not found" });
      return;
    }

    const peers = Array.from(room).map((peerId) => {
      const ps = io.sockets.sockets.get(peerId);
      return {
        socketId: peerId,
        displayName: ps ? (ps.displayName ?? null) : null,
      };
    });

    socket.emit("room-peers", { peers });
  });

  // leave room
  socket.on("leave-room", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.has(socket.id)) {
      room.delete(socket.id);
      socket.leave(roomId);
      console.log("left room:", roomId, "by", socket.id);

      // Thông báo cho phần còn lại
      socket.to(roomId).emit("peer-left", { socketId: socket.id });

      // Cập nhật danh sách phòng cho tất cả còn lại
      emitRoomPeers(roomId);

      // Nếu phòng trống, xoá phòng
      if (room.size === 0) {
        rooms.delete(roomId);
      }
    }
  });

  // Khi peer gửi displayName
  socket.on("peer-info", ({ displayName }) => {
    socket.displayName = displayName;

    // gửi cho tất cả peer khác trong phòng
    const roomsOfSocket = Array.from(socket.rooms).filter(
      (r) => r !== socket.id
    );
    roomsOfSocket.forEach((roomId) => {
      socket.to(roomId).emit("peer-info", {
        socketId: socket.id,
        displayName,
      });
    });
  });

  socket.on("chat-message", ({ roomId, message }) => {
    if (!roomId || !message) return;

    socket.to(roomId).emit("chat-message", {
      message,
      from: socket.id,
      timestamp: Date.now(),
    });
  });

  //=======================WEbRTC==========================//
  socket.on("webrtc:join", ( roomId ) => {
    if (!roomId) return;
    socket.join(roomId);
    joinedRooms.add(roomId);
    console.log(joinedRooms)

    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room) return;
    const peers = Array.from(room);
    console.log("webrtc peer", roomId, peers);

    if (peers.length === 1) {
      socket.emit("webrtc:role", { isOfferer: true });
      console.log("offerer", socket.id);
    }

    if (peers.length === 2) {
      const offererId = peers.find((peerId) => peerId !== socket.id);
      if (offererId) {
        io.to(offererId).emit("webrtc:role", { isOfferer: true });
      }
      console.log("answerer", socket.id);

      socket.emit("webrtc:role", { isOfferer: false });
      io.to(roomId).emit("webrtc:peer-ready", roomId);
      console.log("peer reday", roomId);
    }

    if (peers.length > 2) {
      socket.leave(roomId);
      socket.emit("room-full");
    }
  });

  socket.on("webrtc:offer", ({ roomId, sdp }) => {
    console.log(" realy offer from", socket.id);
    socket.to(roomId).emit("webrtc:offer", { sdp });
  });

  socket.on("webrtc:answer", ({ roomId, sdp }) => {
    console.log(" realy answer from", socket.id);
    socket.to(roomId).emit("webrtc:answer", { sdp });
  });

  socket.on("webrtc:ice", ({ roomId, candidate }) => {
    socket.to(roomId).emit("webrtc:ice", candidate);
  });

  socket.on("webrtc:leave", ({ roomId }) => {
    if (!roomId) return;

    console.log("leave room", roomId, socket.id);
    socket.leave(roomId);
    joinedRooms.delete(roomId);

    socket.to(roomId).emit("webrtc:peer-left");
  });

  socket.on("disconnect", () => {
    for (const [roomId, members] of rooms) {
      if (members.has(socket.id)) {
        members.delete(socket.id);
        socket.to(roomId).emit("peer-left", { socketId: socket.id });
        emitRoomPeers(roomId);
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

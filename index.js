import { Server } from "socket.io";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";

dotenv.config();

const app = express();
const server = createServer(app); // Create HTTP server

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL?.replace(/\/$/, ""), // Remove trailing slash if present
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
});



app.get("/", (req, res) => {
  res.send("hello");
});

const emailToSocketMap = new Map();
const socketidToEmailMap = new Map();
const roomToUsersMap = new Map(); // Track all users in each room

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("room:join", ({ email, roomId }) => {
    if (!email || !roomId) {
      console.error("Missing email or roomId:", { email, roomId });
      return;
    }

    console.log(`User ${email} is joining room ${roomId}`);

    emailToSocketMap.set(email, socket.id);
    socketidToEmailMap.set(socket.id, email);
    
    // Get existing users in the room
    const existingUsers = roomToUsersMap.get(roomId) || [];
    
    // Notify the new user about all existing users
    io.to(socket.id).emit("room:users", { users: existingUsers });

    // Notify all existing users about the new user
    existingUsers.forEach((user) => {
      io.to(user.id).emit("user:joined", { 
        email: email, 
        id: socket.id 
      });
    });

    socket.join(roomId);
    
    // Add new user to room tracking
    existingUsers.push({ email, id: socket.id });
    roomToUsersMap.set(roomId, existingUsers);
    
    // Store roomId in socket for cleanup
    socket.roomId = roomId;

    io.to(socket.id).emit("room:join", {
      message: `You joined room ${roomId}`,
      roomId,
      email,
    });

    socket.on("user:call", ({ to, offer }) => {
      io.to(to).emit("incoming:call", { from: socket.id, offer });
    });

    socket.on("call:accepted", ({ to, answer }) => {
      io.to(to).emit("call:accepted", { from: socket.id, answer });
    });

    socket.on("peer:nego:needed", ({ to, offer }) => {
      io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
    });

    socket.on("peer:nego:done", ({ to, answer }) => {
      io.to(to).emit("peer:nego:final", { from: socket.id, answer });
    });

    socket.to(roomId).emit("room:join", {
      message: `${email} has joined the room`,
      email,
      roomId,
    });
  });

  socket.on("disconnect", () => {
    const email = socketidToEmailMap.get(socket.id);
    const roomId = socket.roomId;
    
    if (email) {
      console.log(`User disconnected: ${email} (${socket.id})`);
      emailToSocketMap.delete(email);
      socketidToEmailMap.delete(socket.id);
      
      // Remove user from room tracking
      if (roomId) {
        const users = roomToUsersMap.get(roomId) || [];
        const updatedUsers = users.filter((user) => user.id !== socket.id);
        
        if (updatedUsers.length > 0) {
          roomToUsersMap.set(roomId, updatedUsers);
        } else {
          roomToUsersMap.delete(roomId);
        }
        
        // Notify remaining users
        updatedUsers.forEach((user) => {
          io.to(user.id).emit("user:left", { 
            email: email, 
            id: socket.id 
          });
        });
      }
    } else {
      console.log(`User disconnected: undefined (${socket.id})`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

{\rtf1\ansi\ansicpg1252\cocoartf2761
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 const express = require("express");\
const http = require("http");\
const socketIO = require("socket.io");\
\
const app = express();\
const server = http.createServer(app);\
const io = socketIO(server);\
\
io.on("connection", (socket) => \{\
  console.log("\uc0\u9989  Usuario conectado:", socket.id);\
\
  socket.on("mensaje", (data) => \{\
    console.log("\uc0\u55357 \u56552  Mensaje recibido:", data);\
    io.emit("mensaje", data); // lo reenv\'eda a todos\
  \});\
\
  socket.on("disconnect", () => \{\
    console.log("\uc0\u10060  Usuario desconectado:", socket.id);\
  \});\
\});\
\
server.listen(process.env.PORT || 3000, () => \{\
  console.log("\uc0\u55357 \u56960  Servidor Socket.IO corriendo en puerto 3000");\
\});\
}
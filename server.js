import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

import express from "express";
import { WebSocketServer, WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 10000);

const ANALYTICS_SECRET = process.env.ANALYTICS_SECRET;

if (!ANALYTICS_SECRET) {
  console.error("");
  console.error("========================================");
  console.error("ERRO: ANALYTICS_SECRET NÃO CONFIGURADO");
  console.error("========================================");
  console.error("");
  console.error(
    "Configure ANALYTICS_SECRET nas Environment Variables do Render."
  );
  console.error("");

  process.exit(1);
}

/*
==================================================
EXPRESS
==================================================
*/

const app = express();

app.use(express.static(path.join(__dirname, "public")));

/*
==================================================
ESTADO DA SALA
==================================================
*/

const state = {
  connected: false,

  roomName: "Analytics Test Room",

  roomLink: null,

  score: {
    red: 0,
    blue: 0,
    time: 0
  },

  game: {
    state: "waiting",
    time: 0
  },

  players: [],

  ball: {
    x: 0,
    y: 0
  },

  lastEvent: "Aguardando Headless Host...",

  updatedAt: Date.now()
};

/*
==================================================
SERVIDOR HTTP
==================================================
*/

const server = http.createServer(app);

/*
==================================================
WEBSOCKETS
==================================================
*/

/*
Dashboard:
 /ws

Headless:
 /host
*/

const wss = new WebSocketServer({
  noServer: true
});

const dashboardClients = new Set();

let headlessSocket = null;

/*
==================================================
AUTENTICAÇÃO
==================================================
*/

function checkSecret(request) {
  try {
    const url = new URL(
      request.url,
      "http://" + (request.headers.host || "localhost")
    );

    const secret = url.searchParams.get("key");

    return secret === ANALYTICS_SECRET;
  } catch {
    return false;
  }
}

/*
==================================================
BROADCAST DASHBOARD
==================================================
*/

function broadcastDashboard() {
  const message = JSON.stringify(state);

  for (const socket of dashboardClients) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(message);
      } catch {
        dashboardClients.delete(socket);
      }
    }
  }
}

/*
==================================================
DADOS RECEBIDOS DO HEADLESS
==================================================
*/

function processHeadlessMessage(message) {
  let data;

  try {
    data = JSON.parse(message);
  } catch {
    console.error("Headless enviou JSON inválido.");
    return;
  }

  if (!data || typeof data !== "object") {
    return;
  }

  /*
  Só aceitamos dados com o formato esperado.
  */

  if (data.type === "state") {
    if (data.state && typeof data.state === "object") {
      Object.assign(state, data.state);

      state.connected = true;

      state.updatedAt = Date.now();

      broadcastDashboard();
    }

    return;
  }

  /*
  Ping do Headless
  */

  if (data.type === "ping") {
    if (
      headlessSocket &&
      headlessSocket.readyState === WebSocket.OPEN
    ) {
      headlessSocket.send(
        JSON.stringify({
          type: "pong",
          time: Date.now()
        })
      );
    }

    state.connected = true;

    state.updatedAt = Date.now();

    broadcastDashboard();

    return;
  }
}

/*
==================================================
UPGRADE WEBSOCKET
==================================================
*/

server.on("upgrade", function (request, socket, head) {
  try {
    const url = new URL(
      request.url,
      "http://" + (request.headers.host || "localhost")
    );

    const pathname = url.pathname;

    /*
    ================================================
    HEADLESS HOST
    ================================================
    */

    if (pathname === "/host") {
      if (!checkSecret(request)) {
        socket.write(
          "HTTP/1.1 401 Unauthorized\r\n" +
          "Connection: close\r\n" +
          "\r\n"
        );

        socket.destroy();

        return;
      }

      wss.handleUpgrade(
        request,
        socket,
        head,
        function (ws) {
          wss.emit("connection", ws, request);
        }
      );

      return;
    }

    /*
    ================================================
    DASHBOARD
    ================================================
    */

    if (pathname === "/ws") {
      wss.handleUpgrade(
        request,
        socket,
        head,
        function (ws) {
          wss.emit("connection", ws, request);
        }
      );

      return;
    }

    socket.destroy();
  } catch {
    socket.destroy();
  }
});

/*
==================================================
CONEXÃO WEBSOCKET
==================================================
*/

wss.on("connection", function (socket, request) {
  const url = new URL(
    request.url,
    "http://" + (request.headers.host || "localhost")
  );

  /*
  ================================================
  HEADLESS
  ================================================
  */

  if (url.pathname === "/host") {
    console.log("");
    console.log("========================================");
    console.log("HEADLESS HOST CONECTADO");
    console.log("========================================");
    console.log("");

    /*
    Se outro Headless conectar,
    desconectamos o anterior.
    */

    if (
      headlessSocket &&
      headlessSocket !== socket &&
      headlessSocket.readyState === WebSocket.OPEN
    ) {
      try {
        headlessSocket.close();
      } catch {}
    }

    headlessSocket = socket;

    state.connected = true;

    state.lastEvent = "Headless Host conectado.";

    state.updatedAt = Date.now();

    broadcastDashboard();

    /*
    Receber dados
    */

    socket.on("message", function (message) {
      processHeadlessMessage(message.toString());
    });

    /*
    Desconectou
    */

    socket.on("close", function () {
      if (headlessSocket === socket) {
        headlessSocket = null;

        state.connected = false;

        state.lastEvent = "Headless Host desconectado.";

        state.updatedAt = Date.now();

        broadcastDashboard();

        console.log("");
        console.log("Headless Host desconectado.");
        console.log("");
      }
    });

    socket.on("error", function (error) {
      console.error("Erro no WebSocket do Headless:", error);
    });

    /*
    Mandar confirmação
    */

    socket.send(
      JSON.stringify({
        type: "connected",
        message: "Render Analytics conectado."
      })
    );

    return;
  }

  /*
  ================================================
  DASHBOARD
  ================================================
  */

  if (url.pathname === "/ws") {
    console.log("Novo dashboard conectado.");

    dashboardClients.add(socket);

    /*
    Envia estado atual imediatamente.
    */

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(state));
    }

    socket.on("close", function () {
      dashboardClients.delete(socket);

      console.log("Dashboard desconectado.");
    });

    socket.on("error", function () {
      dashboardClients.delete(socket);
    });

    return;
  }
});

/*
==================================================
LIMPEZA DE DASHBOARDS
==================================================
*/

setInterval(function () {
  for (const socket of dashboardClients) {
    if (socket.readyState !== WebSocket.OPEN) {
      dashboardClients.delete(socket);
    }
  }
}, 10000);

/*
==================================================
STATUS DO HEADLESS
==================================================
*/

setInterval(function () {
  if (
    headlessSocket &&
    headlessSocket.readyState === WebSocket.OPEN
  ) {
    state.connected = true;
  } else {
    state.connected = false;
  }

  state.updatedAt = Date.now();

  broadcastDashboard();
}, 5000);

/*
==================================================
START
==================================================
*/

server.listen(PORT, "0.0.0.0", function () {
  console.log("");
  console.log("========================================");
  console.log("HAXBALL ANALYTICS DASHBOARD");
  console.log("========================================");
  console.log("");
  console.log("Porta:", PORT);
  console.log("");
  console.log("Dashboard:");
  console.log("https://haxball-analitic.onrender.com");
  console.log("");
  console.log("Host endpoint:");
  console.log("/host");
  console.log("");
  console.log("Servidor pronto.");
  console.log("========================================");
  console.log("");
});

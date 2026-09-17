import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

import express from "express";
import HaxballJS from "haxball.js";
import { WebSocketServer, WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.HAXBALL_TOKEN;

if (!TOKEN) {
  console.error("========================================");
  console.error("ERRO: HAXBALL_TOKEN não foi configurado.");
  console.error("Configure HAXBALL_TOKEN nas Environment");
  console.error("Variables do Render.");
  console.error("========================================");
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
ESTADO
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

  lastEvent: "Iniciando sala..."
};

/*
==================================================
HTTP
==================================================
*/

const server = http.createServer(app);

/*
==================================================
WEBSOCKET
==================================================
*/

const wss = new WebSocketServer({
  server,
  path: "/ws"
});

const clients = new Set();

/*
==================================================
BROADCAST
==================================================
*/

function broadcast() {
  const message = JSON.stringify(state);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error("Erro enviando WebSocket:", error);
      }
    }
  }
}

/*
==================================================
PLAYERS
==================================================
*/

function updatePlayers(room) {
  try {
    const players = room.getPlayerList();

    state.players = players.map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      admin: Boolean(player.admin)
    }));
  } catch (error) {
    console.error("Erro ao atualizar jogadores:", error);
  }
}

/*
==================================================
BALL
==================================================
*/

function updateBall(room) {
  try {
    const ball = room.getBallPosition();

    if (ball) {
      state.ball = {
        x: Math.round(ball.x),
        y: Math.round(ball.y)
      };
    }
  } catch (error) {
    console.error("Erro ao atualizar bola:", error);
  }
}

/*
==================================================
SCORE
==================================================
*/

function updateScore(room) {
  try {
    const scores = room.getScores();

    if (!scores) {
      return;
    }

    state.score = {
      red: Number(scores.red || 0),
      blue: Number(scores.blue || 0),
      time: Math.round(Number(scores.time || 0))
    };

    state.game.time = Math.round(Number(scores.time || 0));
  } catch (error) {
    console.error("Erro ao atualizar placar:", error);
  }
}

/*
==================================================
CRIAR SALA
==================================================
*/

async function createRoom(HBInit) {
  console.log("");
  console.log("========================================");
  console.log("CRIANDO SALA HAXBALL");
  console.log("========================================");

  const room = HBInit({
    roomName: "Analytics Test Room",
    maxPlayers: 8,
    public: true,
    noPlayer: true,
    token: TOKEN
  });

  /*
  CONFIGURAÇÃO
  */

  room.setDefaultStadium("Big");

  room.setScoreLimit(5);

  room.setTimeLimit(5);

  /*
  ESTADO
  */

  state.connected = true;

  state.lastEvent = "Sala HaxBall criada.";

  updatePlayers(room);

  updateScore(room);

  updateBall(room);

  broadcast();

  console.log("");
  console.log("========================================");
  console.log("SALA HAXBALL CRIADA");
  console.log("========================================");
  console.log("");

  /*
  LINK
  */

  room.onRoomLink = function (url) {
    console.log("");
    console.log("========================================");
    console.log("LINK DA SALA HAXBALL:");
    console.log(url);
    console.log("========================================");
    console.log("");

    state.roomLink = url;

    state.lastEvent = "Sala criada.";

    broadcast();
  };

  /*
  PLAYER JOIN
  */

  room.onPlayerJoin = function (player) {
    console.log(
      "Jogador entrou:",
      player.name,
      "(" + player.id + ")"
    );

    state.lastEvent = player.name + " entrou na sala.";

    updatePlayers(room);

    broadcast();
  };

  /*
  PLAYER LEAVE
  */

  room.onPlayerLeave = function (player) {
    console.log(
      "Jogador saiu:",
      player.name,
      "(" + player.id + ")"
    );

    state.lastEvent = player.name + " saiu da sala.";

    updatePlayers(room);

    broadcast();
  };

  /*
  GAME START
  */

  room.onGameStart = function () {
    console.log("Partida começou.");

    state.game.state = "playing";

    state.lastEvent = "Partida começou.";

    updateScore(room);

    broadcast();
  };

  /*
  GAME STOP
  */

  room.onGameStop = function () {
    console.log("Partida terminou.");

    state.game.state = "waiting";

    state.lastEvent = "Partida terminou.";

    updateScore(room);

    broadcast();
  };

  /*
  GOAL
  */

  room.onTeamGoal = function (team) {
    updateScore(room);

    if (team === 1) {
      state.lastEvent = "Gol do RED!";
    } else if (team === 2) {
      state.lastEvent = "Gol do BLUE!";
    } else {
      state.lastEvent = "Gol!";
    }

    broadcast();
  };

  /*
  VITÓRIA
  */

  room.onTeamVictory = function (scores) {
    state.score = {
      red: Number(scores.red || 0),
      blue: Number(scores.blue || 0),
      time: Math.round(Number(scores.time || 0))
    };

    state.game.time = Math.round(Number(scores.time || 0));

    state.game.state = "waiting";

    state.lastEvent = "Fim da partida.";

    broadcast();
  };

  /*
  GAME TICK
  */

  let lastBroadcast = 0;

  room.onGameTick = function () {
    const now = Date.now();

    updateScore(room);

    updateBall(room);

    /*
    Atualiza o dashboard no máximo
    20 vezes por segundo.
    */

    if (now - lastBroadcast >= 50) {
      updatePlayers(room);

      broadcast();

      lastBroadcast = now;
    }
  };

  /*
  ESTADO INICIAL
  */

  updatePlayers(room);

  updateScore(room);

  updateBall(room);

  broadcast();

  return room;
}

/*
==================================================
WEBSOCKET CONNECTION
==================================================
*/

wss.on("connection", function (socket) {
  console.log("Novo dashboard conectado.");

  clients.add(socket);

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(state));
  }

  socket.on("close", function () {
    clients.delete(socket);

    console.log("Dashboard desconectado.");
  });

  socket.on("error", function (error) {
    console.error("Erro no WebSocket:", error);

    clients.delete(socket);
  });
});

/*
==================================================
START
==================================================
*/

server.listen(PORT, "0.0.0.0", async function () {
  console.log("");
  console.log("========================================");
  console.log("HAXBALL ANALYTICS");
  console.log("========================================");
  console.log("Servidor iniciado na porta:", PORT);
  console.log("========================================");
  console.log("");

  try {
    console.log("Carregando HaxBall...");

    /*
    haxball.js atual:
    
    HaxballJS() -> Promise
    Promise -> HBInit
    */

    if (typeof HaxballJS !== "function") {
      console.error("ERRO: haxball.js não exportou uma função.");

      console.error(
        "Tipo recebido:",
        typeof HaxballJS
      );

      console.error(
        "Valor recebido:",
        HaxballJS
      );

      process.exit(1);
    }

    const HBInit = await HaxballJS();

    if (typeof HBInit !== "function") {
      console.error(
        "ERRO: HaxballJS foi carregado, mas não retornou HBInit."
      );

      console.error(
        "Tipo de HBInit:",
        typeof HBInit
      );

      process.exit(1);
    }

    console.log("HaxBall carregado.");

    await createRoom(HBInit);

  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("ERRO AO INICIAR HAXBALL");
    console.error("========================================");

    console.error(error);

    if (error && error.stack) {
      console.error("");
      console.error("STACK:");
      console.error(error.stack);
    }

    console.error("========================================");

    process.exit(1);
  }
});

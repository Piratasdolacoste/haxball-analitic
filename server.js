const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const HaxballJS = require("haxball.js").default;

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

const app = express();

app.use(express.static(path.join(__dirname, "public")));

const state = {
  connected: false,
  roomName: "Analytics Test Room",

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

const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

const clients = new Set();

function broadcast() {
  const message = JSON.stringify(state);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function updatePlayers(room) {
  const players = room.getPlayerList();

  state.players = players.map((player) => ({
    id: player.id,
    name: player.name,
    team: player.team,
    admin: !!player.admin
  }));

  broadcast();
}

function updateBall(room) {
  const ball = room.getBallPosition();

  if (ball) {
    state.ball = {
      x: Math.round(ball.x),
      y: Math.round(ball.y)
    };
  }
}

async function createRoom(HBInit) {
  console.log("Criando sala HaxBall...");

  const room = HBInit({
    roomName: "Analytics Test Room",
    maxPlayers: 8,
    public: true,
    noPlayer: true,
    token: TOKEN
  });

  room.setDefaultStadium("Big");

  room.setScoreLimit(5);

  room.setTimeLimit(5);

  state.connected = true;

  state.lastEvent = "Sala HaxBall criada.";

  broadcast();

  console.log("Sala HaxBall criada!");

  room.onRoomLink = function (url) {
    console.log("");
    console.log("========================================");
    console.log("LINK DA SALA HAXBALL:");
    console.log(url);
    console.log("========================================");
    console.log("");

    state.lastEvent = "Sala criada: " + url;

    broadcast();
  };

  room.onPlayerJoin = function (player) {
    console.log("Jogador entrou:", player.name);

    state.lastEvent = player.name + " entrou na sala.";

    updatePlayers(room);
  };

  room.onPlayerLeave = function (player) {
    console.log("Jogador saiu:", player.name);

    state.lastEvent = player.name + " saiu da sala.";

    updatePlayers(room);
  };

  room.onGameStart = function () {
    console.log("Partida começou.");

    state.game.state = "playing";

    state.lastEvent = "Partida começou.";

    broadcast();
  };

  room.onGameStop = function () {
    console.log("Partida terminou.");

    state.game.state = "waiting";

    state.lastEvent = "Partida terminou.";

    broadcast();
  };

  room.onTeamGoal = function (team) {
    const scores = room.getScores();

    if (scores) {
      state.score = {
        red: scores.red,
        blue: scores.blue,
        time: Math.round(scores.time || 0)
      };
    }

    state.lastEvent =
      team === 1
        ? "Gol do RED!"
        : "Gol do BLUE!";

    broadcast();
  };

  room.onTeamVictory = function (scores) {
    state.score = {
      red: scores.red,
      blue: scores.blue,
      time: Math.round(scores.time || 0)
    };

    state.game.state = "waiting";

    state.lastEvent = "Fim da partida.";

    broadcast();
  };

  room.onGameTick = function () {
    const scores = room.getScores();

    if (scores) {
      state.score = {
        red: scores.red,
        blue: scores.blue,
        time: Math.round(scores.time || 0)
      };

      state.game.time = Math.round(scores.time || 0);
    }

    updateBall(room);

    updatePlayers(room);

    broadcast();
  };

  updatePlayers(room);
}

wss.on("connection", function (socket) {
  console.log("Novo dashboard conectado.");

  clients.add(socket);

  socket.send(JSON.stringify(state));

  socket.on("close", function () {
    clients.delete(socket);

    console.log("Dashboard desconectado.");
  });
});

server.listen(PORT, "0.0.0.0", async function () {
  console.log("========================================");
  console.log("HAXBALL ANALYTICS");
  console.log("Servidor iniciado na porta:", PORT);
  console.log("========================================");

  try {
    console.log("Carregando HaxBall...");

    const HBInit = await HaxballJS();

    console.log("HaxBall carregado.");

    await createRoom(HBInit);
  } catch (error) {
    console.error("ERRO AO INICIAR HAXBALL:");
    console.error(error);

    process.exit(1);
  }
});

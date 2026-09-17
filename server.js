\
const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const HBInit = require("haxball.js");

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.HAXBALL_TOKEN;

if (!TOKEN) {
  console.error("ERRO: HAXBALL_TOKEN não foi configurado.");
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (_req, res) => {
  res.json(state);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

let room;
const clients = new Set();

const state = {
  connected: false,
  roomName: "Analytics Test Room",
  score: { red: 0, blue: 0, time: 0 },
  game: { state: "waiting", time: 0 },
  players: [],
  ball: { x: 0, y: 0 },
  lastEvent: "Iniciando sala..."
};

function broadcast() {
  const msg = JSON.stringify(state);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function updatePlayers() {
  if (!room) return;
  state.players = room.getPlayerList().map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    admin: !!p.admin
  }));
  broadcast();
}

function updateBall() {
  if (!room) return;
  const b = room.getBallPosition();
  if (b) state.ball = { x: Math.round(b.x), y: Math.round(b.y) };
}

function createRoom() {
  room = HBInit({
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
  state.lastEvent = "Sala HaxBall criada";
  broadcast();

  room.onPlayerJoin = player => {
    state.lastEvent = `${player.name} entrou`;
    updatePlayers();
  };

  room.onPlayerLeave = player => {
    state.lastEvent = `${player.name} saiu`;
    updatePlayers();
  };

  room.onGameStart = byPlayer => {
    state.game.state = "playing";
    state.lastEvent = "Jogo começou";
    broadcast();
  };

  room.onGameStop = byPlayer => {
    state.game.state = "waiting";
    state.lastEvent = "Jogo terminou";
    broadcast();
  };

  room.onTeamGoal = team => {
    state.score = room.getScores() || state.score;
    state.lastEvent = team === 1 ? "Gol RED" : "Gol BLUE";
    broadcast();
  };

  room.onTeamVictory = scores => {
    state.score = scores;
    state.lastEvent = "Fim da partida";
    broadcast();
  };

  room.onGameTick = () => {
    const scores = room.getScores();
    if (scores) {
      state.score = {
        red: scores.red,
        blue: scores.blue,
        time: Math.round(scores.time || 0)
      };
      state.game.time = Math.round(scores.time || 0);
    }
    updateBall();
    // Evita spam excessivo: os clientes recebem aproximadamente 20 atualizações/s.
    if ((Date.now() % 50) < 18) broadcast();
  };

  room.onRoomLink = url => {
    state.lastEvent = `Link da sala: ${url}`;
    console.log("LINK DA SALA:", url);
    broadcast();
  };

  console.log("Sala HaxBall iniciada.");
}

wss.on("connection", ws => {
  clients.add(ws);
  ws.send(JSON.stringify(state));
  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard: http://0.0.0.0:${PORT}`);
  createRoom();
});

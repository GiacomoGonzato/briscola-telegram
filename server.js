const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// 40 Italian Cards (Rank, Points, and Power hierarchy for winning tricks)
const SUITS = ['Coppe', 'Bastoni', 'Denari', 'Spade'];
const CARDS = [
  { rank: '1', name: 'Asso', points: 11, power: 10 },
  { rank: '3', name: '3', points: 10, power: 9 },
  { rank: '10', name: 'Re', points: 4, power: 8 },
  { rank: '9', name: 'Cavallo', points: 3, power: 7 },
  { rank: '8', name: 'Fante', points: 2, power: 6 },
  { rank: '7', name: '7', points: 0, power: 5 },
  { rank: '6', name: '6', points: 0, power: 4 },
  { rank: '5', name: '5', points: 0, power: 3 },
  { rank: '4', name: '4', points: 0, power: 2 },
  { rank: '2', name: '2', points: 0, power: 1 },
];

function createShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const card of CARDS) {
      deck.push({ ...card, suit, id: `${suit}_${card.rank}` });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

// Compare two cards to determine the winner of a trick
function getTrickWinner(cardA, cardB, briscolaSuit) {
  if (cardB.suit === briscolaSuit && cardA.suit !== briscolaSuit) return 1;
  if (cardA.suit === briscolaSuit && cardB.suit !== briscolaSuit) return 0;
  if (cardA.suit === cardB.suit) return cardB.power > cardA.power ? 1 : 0;
  return 0; // Lead card wins if non-briscola and different suit
}

const rooms = {};

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);
    socket.playerName = playerName || 'Player';

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [socket],
        deck: [],
        briscola: null,
        hands: {},
        table: [],
        scores: [0, 0],
        turn: 0
      };
      socket.emit('waiting', 'Waiting for an opponent to join...');
    } else if (rooms[roomId].players.length === 1) {
      rooms[roomId].players.push(socket);
      startMatch(roomId);
    }
  });

  socket.on('playCard', ({ roomId, cardId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const pIndex = room.players.indexOf(socket);
    if (pIndex !== room.turn) return; // Not this player's turn

    const hand = room.hands[socket.id];
    const cardIdx = hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;

    const playedCard = hand.splice(cardIdx, 1)[0];
    room.table.push({ pIndex, card: playedCard });
    io.to(roomId).emit('cardPlayed', { pIndex, card: playedCard });

    // When both players have played their card
    if (room.table.length === 2) {
      const [playA, playB] = room.table;
      const winnerOffset = getTrickWinner(playA.card, playB.card, room.briscola.suit);
      const winnerIndex = winnerOffset === 0 ? playA.pIndex : playB.pIndex;
      const points = playA.card.points + playB.card.points;

      room.scores[winnerIndex] += points;
      room.turn = winnerIndex; // Winner leads next trick

      setTimeout(() => {
        // Draw 1 card each if cards remain
        if (room.deck.length > 0) {
          room.hands[room.players[winnerIndex].id].push(room.deck.pop());
          room.hands[room.players[1 - winnerIndex].id].push(room.deck.pop());
        }

        room.table = [];

        // Check for Game Over
        const p1Cards = room.hands[room.players[0].id];
        const p2Cards = room.hands[room.players[1].id];
        if (p1Cards.length === 0 && p2Cards.length === 0) {
          io.to(roomId).emit('gameOver', { scores: room.scores });
          delete rooms[roomId];
        } else {
          syncGameState(roomId);
        }
      }, 1500);
    } else {
      room.turn = 1 - room.turn;
      io.to(roomId).emit('turnChanged', { turn: room.turn });
    }
  });

  socket.on('disconnect', () => {
    // If a player disconnects, cleanup can be added here
  });
});

function startMatch(roomId) {
  const room = rooms[roomId];
  room.deck = createShuffledDeck();
  room.briscola = room.deck.pop(); // The Briscola card
  room.deck.unshift(room.briscola); // Placed at the bottom of the deck

  const p1 = room.players[0];
  const p2 = room.players[1];

  room.hands[p1.id] = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
  room.hands[p2.id] = [room.deck.pop(), room.deck.pop(), room.deck.pop()];

  syncGameState(roomId);
}

function syncGameState(roomId) {
  const room = rooms[roomId];
  room.players.forEach((playerSocket, idx) => {
    playerSocket.emit('gameState', {
      myIndex: idx,
      myHand: room.hands[playerSocket.id],
      briscola: room.briscola,
      cardsLeft: room.deck.length,
      turn: room.turn,
      scores: room.scores
    });
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Briscola server active on port ${PORT}`));

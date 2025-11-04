// server.js (Node + Express + Socket.IO) with houses, auctions, income-tax 10% and Free Parking jackpot
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 6;
const START_MONEY = 1500;
const PASS_GO = 200;
const NUM_SQUARES = 40;
const AUCTION_TIMEOUT_MS = 30000; // 30s inactivity timeout

app.use('/static', express.static(path.join(__dirname, 'static')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = {};

function createSquares() {
  // add a groupId to properties so we can define monopolies
  return Array.from({ length: NUM_SQUARES }, (_, i) => {
    const corner = (i % 10 === 0);
    const basePrice = corner ? 0 : 100 + (i % 5) * 20;
    // define group by (i % 10) / simple groups so there are repeating groups around board
    const groupId = corner ? null : Math.floor((i % 10) / 2); // group ids 0..4 per side -> simplified

    // special named squares for some indices
    let name = '';
    if (i === 0) name = 'Start';
    else if (i === 10) name = 'Gevangenis';
    else if (i === 20) name = 'Free Parking';
    else if (i === 30) name = 'Ga naar Gevangenis';
    else if (i === 4) name = 'Income Tax';
    else if (i === 38) name = 'Luxury Tax';
    else name = `Vak ${i}`;

    return {
      id: i,
      name,
      price: basePrice,
      rent: corner ? 0 : Math.max(10, Math.floor(basePrice / 10)),
      owner: null,
      houses: 0,
      housePrice: Math.max(50, Math.floor(basePrice / 4)),
      groupId
    };
  });
}

function createRoomIfNotExists(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      squares: createSquares(),
      players: [],
      currentPlayer: 0,
      rolled: false,
      auction: null, // { propertyId, highestBid, highestBidderIndex, passed: Set, timer }
      parkingPool: 0
    };
  }
  return rooms[roomId];
}

function computeNetWorth(room, player) {
  // contant + properties (price) + houses value
  let worth = player.money;
  for (const s of room.squares) {
    if (s.owner === player.index) {
      worth += s.price;
      worth += s.houses * s.housePrice;
    }
  }
  return worth;
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const payload = {
    squares: room.squares,
    players: room.players.map(p => ({
      index: p.index,
      name: p.name,
      pos: p.pos,
      money: p.money,
      connected: p.connected
    })),
    currentPlayer: room.currentPlayer,
    rolled: room.rolled,
    auction: room.auction ? {
      propertyId: room.auction.propertyId,
      highestBid: room.auction.highestBid,
      highestBidderIndex: room.auction.highestBidderIndex,
      active: true,
      passed: Array.from(room.auction.passed)
    } : null,
    parkingPool: room.parkingPool || 0
  };
  io.to(roomId).emit('game_update', payload);
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('create_room', ({ roomId, name }, cb) => {
    if (!roomId || !name) return cb && cb({ error: 'missing parameters' });
    createRoomIfNotExists(roomId);
    const room = rooms[roomId];
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      return cb && cb({ error: 'room full' });
    }
    const player = {
      index: room.players.length,
      name,
      pos: 0,
      money: START_MONEY,
      socketId: socket.id,
      connected: true
    };
    room.players.push(player);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerIndex = player.index;
    cb && cb({ ok: true, playerIndex: player.index });
    broadcastRoomState(roomId);
    console.log(`${name} created/joined room ${roomId} as player ${player.index}`);
  });

  socket.on('join_room', ({ roomId, name }, cb) => {
    if (!roomId || !name) return cb && cb({ error: 'missing parameters' });
    const room = createRoomIfNotExists(roomId);
    if (room.players.length >= MAX_PLAYERS_PER_ROOM) {
      return cb && cb({ error: 'room full' });
    }
    const player = {
      index: room.players.length,
      name,
      pos: 0,
      money: START_MONEY,
      socketId: socket.id,
      connected: true
    };
    room.players.push(player);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerIndex = player.index;
    cb && cb({ ok: true, playerIndex: player.index });
    broadcastRoomState(roomId);
    console.log(`${name} joined room ${roomId} as player ${player.index}`);
  });

  socket.on('roll', () => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    if (!roomId && pIndex === undefined) return;
    const room = rooms[roomId];
    if (!room) return;
    if (room.currentPlayer !== pIndex) {
      socket.emit('action_error', { message: 'Niet jouw beurt.' });
      return;
    }
    if (room.rolled) {
      socket.emit('action_error', { message: 'Al gedobbeld deze beurt.' });
      return;
    }

    const die1 = 1 + Math.floor(Math.random() * 6);
    const die2 = 1 + Math.floor(Math.random() * 6);
    const steps = die1 + die2;

    const player = room.players[pIndex];
    const from = player.pos;
    player.pos = (player.pos + steps) % NUM_SQUARES;
    if (player.pos < from) {
      player.money += PASS_GO;
      io.to(roomId).emit('action_notice', { message: `${player.name} passeerde START en ontvangt €${PASS_GO}.` });
    }

    // landing logic
    const sq = room.squares[player.pos];

    // Income Tax (index 4) - 10% of net worth -> to parkingPool
    if (player.pos === 4) {
      const net = computeNetWorth(room, player);
      const tax = Math.ceil(net * 0.10);
      const pay = Math.min(player.money, tax); // if not enough, take what they have (bankruptcy handled elsewhere)
      player.money -= pay;
      room.parkingPool = (room.parkingPool || 0) + pay;
      io.to(roomId).emit('action_notice', { message: `${player.name} betaalt Income Tax (10% van nettowaarde = €${tax}). €${pay} gaat naar Free Parking-pot.` });
    }
    // Luxury Tax (index 38) - fixed €75 -> to parkingPool
    else if (player.pos === 38) {
      const tax = 75;
      const pay = Math.min(player.money, tax);
      player.money -= pay;
      room.parkingPool = (room.parkingPool || 0) + pay;
      io.to(roomId).emit('action_notice', { message: `${player.name} betaalt Luxury Tax (€${tax}). €${pay} gaat naar Free Parking-pot.` });
    }
    // Free Parking (index 20) - collect parking pool
    else if (player.pos === 20) {
      const pool = room.parkingPool || 0;
      if (pool > 0) {
        player.money += pool;
        room.parkingPool = 0;
        io.to(roomId).emit('action_notice', { message: `${player.name} landde op Free Parking en ontvangt de pot van €${pool}!` });
      } else {
        io.to(roomId).emit('action_notice', { message: `${player.name} landde op Free Parking, maar de pot is leeg.` });
      }
    }

    // property logic (if not taxes/freeparking)
    if (sq.owner === null && sq.price > 0) {
      // can buy -> client will call buy or start_auction
    } else if (sq.owner !== null && sq.owner !== pIndex) {
      // pay rent - rent increases with houses
      const rent = sq.rent * (1 + sq.houses);
      const pay = Math.min(player.money, rent);
      player.money -= pay;
      const owner = room.players[sq.owner];
      if (owner) owner.money += pay;
      io.to(roomId).emit('action_notice', { message: `${player.name} betaalt €${pay} huur aan ${owner ? owner.name : 'onbekend'}.` });
    } else {
      io.to(roomId).emit('action_notice', { message: `${player.name} landde op ${sq.name}.` });
    }

    room.rolled = true;
    broadcastRoomState(roomId);
    io.to(socket.id).emit('rolled', { die1, die2, steps });
  });

  socket.on('buy', () => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    if (!roomId && pIndex === undefined) return;
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[pIndex];
    const sq = room.squares[player.pos];
    if (!sq || sq.price === 0 || sq.owner !== null) {
      socket.emit('action_error', { message: 'Niet te koop.' });
      return;
    }
    if (player.money < sq.price) {
      socket.emit('action_error', { message: 'Onvoldoende geld.' });
      return;
    }
    player.money -= sq.price;
    sq.owner = pIndex;
    broadcastRoomState(roomId);
    io.to(roomId).emit('action_notice', { message: `${player.name} kocht ${sq.name} voor €${sq.price}.` });
  });

  // build house/hotel
  socket.on('build_house', () => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    if (!roomId && pIndex === undefined) return;
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players[pIndex];
    const sq = room.squares[player.pos];
    if (!sq || sq.owner !== pIndex) {
      socket.emit('action_error', { message: 'Je moet eigenaar zijn van dit vak om te bouwen.' });
      return;
    }
    if (sq.groupId === null) {
      socket.emit('action_error', { message: 'Op dit vak kun je geen huizen bouwen.' });
      return;
    }
    // check monopoly: player must own all properties with same groupId
    const groupProps = room.squares.filter(s => s.groupId === sq.groupId);
    const ownsAll = groupProps.every(s => s.owner === pIndex);
    if (!ownsAll) {
      socket.emit('action_error', { message: 'Je moet een monopolie hebben om huizen te bouwen.' });
      return;
    }
    // enforce even-building rule: difference between min and max houses in group <= 1 after build
    const housesCounts = groupProps.map(s => s.houses);
    const minH = Math.min(...housesCounts);
    const maxH = Math.max(...housesCounts);
    if (sq.houses > minH) {
      // building here would create difference >1
      socket.emit('action_error', { message: 'Je moet gelijkmatig bouwen over de groep. Bouw op een eigendom met het minst aantal huizen eerst.' });
      return;
    }
    const maxHouses = 5; // 4 huizen + hotel
    if (sq.houses >= maxHouses) {
      socket.emit('action_error', { message: 'Maximaal aantal huizen bereikt.' });
      return;
    }
    const price = sq.housePrice;
    if (player.money < price) {
      socket.emit('action_error', { message: 'Onvoldoende geld om een huis te bouwen.' });
      return;
    }
    // check house supply: simple model - count total houses in play vs bank limit 32 houses and 12 hotels
    // For simplicity: we treat houses as unlimited in this MVP. (You can add global counts if desired.)
    player.money -= price;
    sq.houses += 1;
    broadcastRoomState(roomId);
    io.to(roomId).emit('action_notice', { message: `${player.name} bouwde een huis op ${sq.name} voor €${price}.` });
  });

  // auction events (unchanged from earlier implementation)
  socket.on('start_auction', ({ propertyId }, cb) => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    if (!roomId && pIndex === undefined) return cb && cb({ error: 'missing context' });
    const room = rooms[roomId];
    if (!room) return cb && cb({ error: 'no room' });
    if (room.auction) return cb && cb({ error: 'auction already active' });
    const sq = room.squares[propertyId];
    if (!sq) return cb && cb({ error: 'invalid property' });

    room.auction = {
      propertyId,
      highestBid: 0,
      highestBidderIndex: null,
      passed: new Set(),
      timer: null,
      lastActivity: Date.now()
    };

    const resetTimeout = () => {
      if (room.auction && room.auction.timer) clearTimeout(room.auction.timer);
      room.auction.timer = setTimeout(() => {
        endAuction(roomId);
      }, AUCTION_TIMEOUT_MS);
    };
    resetTimeout();

    room.auction.touch = () => {
      room.auction.lastActivity = Date.now();
      resetTimeout();
    };

    io.to(roomId).emit('auction_started', {
      propertyId,
      startingPrice: sq.price,
      housePrice: sq.housePrice
    });
    broadcastRoomState(roomId);
    cb && cb({ ok: true });
  });

  socket.on('auction_bid', ({ amount }, cb) => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    if (!roomId && pIndex === undefined) return cb && cb({ error: 'missing context' });
    const room = rooms[roomId];
    if (!room || !room.auction) return cb && cb({ error: 'no auction active' });
    const auction = room.auction;
    const player = room.players[pIndex];
    if (!player) return cb && cb({ error: 'invalid player' });
    if (auction.passed.has(pIndex)) return cb && cb({ error: 'you passed' });
    if (amount <= auction.highestBid) return cb && cb({ error: 'bid too low' });
    if (player.money < amount) return cb && cb({ error: 'insufficient funds' });

    auction.highestBid = amount;
    auction.highestBidderIndex = pIndex;
    auction.touch();
    io.to(roomId).emit('auction_bid_update', {
      highestBid: auction.highestBid,
      highestBidderIndex: auction.highestBidderIndex
    });
    broadcastRoomState(roomId);
    cb && cb({ ok: true });
  });

  socket.on('auction_pass', (cb) => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    if (!roomId && pIndex === undefined) return cb && cb({ error: 'missing context' });
    const room = rooms[roomId];
    if (!room || !room.auction) return cb && cb({ error: 'no auction active' });
    const auction = room.auction;
    auction.passed.add(pIndex);
    auction.touch();
    io.to(roomId).emit('auction_passed', { playerIndex: pIndex });
    broadcastRoomState(roomId);
    const activeBidders = room.players.filter(p => !auction.passed.has(p.index));
    if (activeBidders.length <= 1 && auction.highestBidderIndex !== null) {
      endAuction(roomId);
    }
    cb && cb({ ok: true });
  });

  function endAuction(roomId) {
    const room = rooms[roomId];
    if (!room || !room.auction) return;
    const auction = room.auction;
    clearTimeout(auction.timer);
    const propId = auction.propertyId;
    if (auction.highestBidderIndex !== null) {
      const winner = room.players[auction.highestBidderIndex];
      const sq = room.squares[propId];
      if (winner.money >= auction.highestBid) {
        winner.money -= auction.highestBid;
        sq.owner = auction.highestBidderIndex;
        io.to(roomId).emit('auction_ended', {
          winnerIndex: auction.highestBidderIndex,
          amount: auction.highestBid,
          propertyId: propId
        });
      } else {
        io.to(roomId).emit('auction_ended', {
          winnerIndex: null,
          amount: 0,
          propertyId: propId,
          reason: 'winner insufficient funds'
        });
      }
    } else {
      io.to(roomId).emit('auction_ended', {
        winnerIndex: null,
        amount: 0,
        propertyId: propId
      });
    }
    room.auction = null;
    broadcastRoomState(roomId);
  }

  socket.on('end_turn', () => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    if (!roomId && pIndex === undefined) return;
    const room = rooms[roomId];
    if (!room) return;
    let next = (room.currentPlayer + 1) % room.players.length;
    room.currentPlayer = next;
    room.rolled = false;
    broadcastRoomState(roomId);
  });

  socket.on('get_state', () => {
    const roomId = socket.data.roomId;
    if (roomId) broadcastRoomState(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const pIndex = socket.data.playerIndex;
    console.log('disconnect', socket.id, roomId, pIndex);
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (player) player.connected = false;
    broadcastRoomState(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

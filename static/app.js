// Client-side app using Socket.IO with houses, auctions, income-tax 10% and Free Parking jackpot
const socket = io();

// DOM
const lobbySection = document.getElementById('lobby');
const inputName = document.getElementById('inputName');
const inputRoom = document.getElementById('inputRoom');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const lobbyMsg = document.getElementById('lobbyMsg');

const gameSection = document.getElementById('game');
const boardEl = document.getElementById('board');
const turnEl = document.getElementById('turn');
const diceEl = document.getElementById('dice');
const parkingPoolEl = document.getElementById('parkingPool');
const messageEl = document.getElementById('message');
const rollBtn = document.getElementById('rollBtn');
const buyBtn = document.getElementById('buyBtn');
const buildBtn = document.getElementById('buildBtn');
const auctionBtn = document.getElementById('auctionBtn');
const endBtn = document.getElementById('endBtn');
const leaveBtn = document.getElementById('leaveBtn');
const playersList = document.getElementById('playersList');

const auctionArea = document.getElementById('auctionArea');
const auctionInfo = document.getElementById('auctionInfo');
const auctionBidBtn = document.getElementById('auctionBidBtn');
const auctionPassBtn = document.getElementById('auctionPassBtn');

let myIndex = null;
let currentRoom = null;
let lastRoll = [0, 0];
let localState = {
  squares: [],
  players: [],
  currentPlayer: 0,
  rolled: false,
  auction: null,
  parkingPool: 0
};

const PLAYER_COLORS = ['p0','p1','p2','p3','p2','p3'];

createBtn.addEventListener('click', () => {
  const name = inputName.value || 'Speler';
  const room = inputRoom.value || 'room1';
  socket.emit('create_room', { roomId: room, name }, (res) => {
    if (res && res.error) { lobbyMsg.textContent = res.error; return; }
    myIndex = res.playerIndex;
    currentRoom = room;
    enterGame();
  });
});

joinBtn.addEventListener('click', () => {
  const name = inputName.value || 'Speler';
  const room = inputRoom.value || 'room1';
  socket.emit('join_room', { roomId: room, name }, (res) => {
    if (res && res.error) { lobbyMsg.textContent = res.error; return; }
    myIndex = res.playerIndex;
    currentRoom = room;
    enterGame();
  });
});

function enterGame() {
  lobbySection.style.display = 'none';
  gameSection.style.display = 'flex';
  lobbyMsg.textContent = '';
  socket.emit('get_state');
}

// Board UI creation (fixed 40 squares into 11x11 grid)
function createBoardUI(){
  boardEl.innerHTML = '';
  for(let i=0;i<40;i++){
    const el = document.createElement('div');
    el.className = 'square';
    el.dataset.idx = i;
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = (i) + ' - ';
    el.appendChild(label);
    const side = document.createElement('div');
    side.className = 'side-info';
    el.appendChild(side);

    const pos = indexToGrid(i);
    el.style.gridColumn = pos.col;
    el.style.gridRow = pos.row;
    boardEl.appendChild(el);
  }
}

function indexToGrid(i){
  if(i<=10) return {row:11, col: 11 - i};
  else if(i<=19) return {row: 11 - (i-10), col:1};
  else if(i<=30) return {row:1, col: 1 + (i-20)};
  else return {row: 1 + (i-30), col:11};
}

function updateAll(){
  // Update square labels/prices/owners/houses
  document.querySelectorAll('.square').forEach(sq => {
    const idx = Number(sq.dataset.idx);
    const s = localState.squares[idx] || {};
    const label = sq.querySelector('.label');
    label.textContent = `${idx} - ${s.name || ''}`;
    const side = sq.querySelector('.side-info');
    side.textContent = s.price ? `€${s.price}` : '';
    sq.querySelectorAll('.token').forEach(t => t.remove());
    sq.querySelectorAll('.owner-tag').forEach(t => t.remove());
    sq.querySelectorAll('.houses-tag').forEach(t => t.remove());
    if(s.owner !== null && s.owner !== undefined){
      const tag = document.createElement('div');
      tag.className = 'owner-tag';
      tag.style.position = 'absolute';
      tag.style.top = '18px';
      tag.style.right = '4px';
      tag.style.fontSize = '10px';
      tag.textContent = `P:${s.owner+1}`;
      sq.appendChild(tag);
    }
    if(s.houses){
      const ht = document.createElement('div');
      ht.className = 'houses-tag';
      ht.style.position = 'absolute';
      ht.style.bottom = '18px';
      ht.style.left = '4px';
      ht.style.fontSize = '10px';
      ht.textContent = `H:${s.houses}`;
      sq.appendChild(ht);
    }
  });

  // tokens
  (localState.players || []).forEach(p => {
    const el = document.querySelector(`.square[data-idx='${p.pos}']`);
    if(el){
      const token = document.createElement('div');
      token.className = `token ${PLAYER_COLORS[p.index] || ''}`;
      token.title = p.name;
      el.appendChild(token);
    }
  });

  // players list
  playersList.innerHTML = '';
  (localState.players || []).forEach(p=>{
    const pc = document.createElement('div');
    pc.className = 'playerCard';
    pc.innerHTML = `<strong>${p.name}</strong> <span style="float:right">€${p.money}</span><br/>Pos: ${p.pos}`;
    if(p.index === myIndex) pc.style.border = '2px solid #2b7a78';
    playersList.appendChild(pc);
  });

  turnEl.textContent = `Beurt: ${ (localState.players[localState.currentPlayer] || {}).name || '-' }`;
  diceEl.textContent = `Dobbelstenen: ${lastRoll[0]} + ${lastRoll[1]}`;
  parkingPoolEl.textContent = `Free Parking-pot: €${localState.parkingPool || 0}`;

  // enable/disable buttons based on server state
  const amTurn = (localState.currentPlayer === myIndex);
  rollBtn.disabled = !amTurn || localState.rolled;
  buyBtn.disabled = !amTurn || !localState.rolled || !canBuyHere();
  buildBtn.disabled = !amTurn || !canBuildHere();
  auctionBtn.disabled = !canStartAuctionHere();
  endBtn.disabled = !amTurn;

  // auction UI
  if(localState.auction && localState.auction.active){
    auctionArea.style.display = 'block';
    auctionInfo.textContent = `Veiling: Vak ${localState.auction.propertyId} - Hoogste bod: €${localState.auction.highestBid || 0} door P:${localState.auction.highestBidderIndex !== null ? localState.auction.highestBidderIndex+1 : '-'}`;
    const amPassed = localState.auction.passed && localState.auction.passed.includes(myIndex);
    auctionBidBtn.disabled = amPassed;
    auctionPassBtn.disabled = amPassed;
  } else {
    auctionArea.style.display = 'none';
  }
}

function canBuyHere(){
  const p = localState.players.find(x=>x.index===myIndex);
  if(!p) return false;
  const sq = localState.squares[p.pos];
  return sq && sq.price > 0 && (sq.owner === null || sq.owner === undefined);
}

function canBuildHere(){
  const p = localState.players.find(x=>x.index===myIndex);
  if(!p) return false;
  const sq = localState.squares[p.pos];
  if(!sq || sq.owner !== myIndex) return false;
  if(sq.groupId === null) return false;
  // must own all in group
  const groupProps = (localState.squares || []).filter(s => s.groupId === sq.groupId);
  return groupProps.length > 0 && groupProps.every(s => s.owner === myIndex);
}

function canStartAuctionHere(){
  const p = localState.players.find(x=>x.index===myIndex);
  if(!p) return false;
  const sq = localState.squares[p.pos];
  if(!sq) return false;
  return sq.owner === null || sq.owner === undefined;
}

// events
rollBtn.addEventListener('click', () => {
  socket.emit('roll');
});
buyBtn.addEventListener('click', () => {
  socket.emit('buy');
});
buildBtn.addEventListener('click', () => {
  socket.emit('build_house');
});
auctionBtn.addEventListener('click', () => {
  const p = localState.players.find(x=>x.index===myIndex);
  const sq = localState.squares[p.pos];
  if(!sq) return;
  socket.emit('start_auction', { propertyId: p.pos }, (res) => {
    if(res && res.error) setMessage(res.error);
  });
});
endBtn.addEventListener('click', () => {
  socket.emit('end_turn');
});
leaveBtn.addEventListener('click', () => {
  window.location.reload();
});

// auction UI buttons
auctionBidBtn.addEventListener('click', () => {
  const bidStr = prompt('Voer je bod in (EUR):', `${(localState.auction.highestBid || 0) + 10}`);
  if(!bidStr) return;
  const amount = parseInt(bidStr, 10);
  if(Number.isNaN(amount)) return alert('Ongeldige waarde');
  socket.emit('auction_bid', { amount }, (res) => {
    if(res && res.error) setMessage(res.error);
  });
});
auctionPassBtn.addEventListener('click', () => {
  socket.emit('auction_pass', (res) => {
    if(res && res.error) setMessage(res.error);
  });
});

// socket handlers
socket.on('connect', () => {
  console.log('connected', socket.id);
});

socket.on('game_update', (payload) => {
  localState.squares = payload.squares || [];
  localState.players = payload.players || [];
  localState.currentPlayer = payload.currentPlayer ?? 0;
  localState.rolled = payload.rolled ?? false;
  localState.auction = payload.auction ? {
    propertyId: payload.auction.propertyId,
    highestBid: payload.auction.highestBid,
    highestBidderIndex: payload.auction.highestBidderIndex,
    active: payload.auction.active,
    passed: payload.auction.passed || []
  } : null;
  localState.parkingPool = payload.parkingPool || 0;
  updateAll();
});

socket.on('rolled', ({ die1, die2, steps }) => {
  lastRoll = [die1, die2];
  updateAll();
});

socket.on('auction_started', ({ propertyId, startingPrice }) => {
  setMessage(`Veiling gestart voor vak ${propertyId} (startprijs €${startingPrice}).`);
  socket.emit('get_state');
});

socket.on('auction_bid_update', ({ highestBid, highestBidderIndex }) => {
  setMessage(`Nieuw hoogste bod: €${highestBid} door P:${highestBidderIndex+1}`);
  socket.emit('get_state');
});

socket.on('auction_passed', ({ playerIndex }) => {
  setMessage(`Speler ${playerIndex+1} heeft gepast.`);
  socket.emit('get_state');
});

socket.on('auction_ended', ({ winnerIndex, amount, propertyId, reason }) => {
  if(winnerIndex !== null) {
    setMessage(`Veiling gewonnen: P:${winnerIndex+1} voor €${amount} op vak ${propertyId}.`);
  } else {
    setMessage(`Veiling beëindigd zonder winnaar${reason ? ' ('+reason+')' : ''}.`);
  }
  socket.emit('get_state');
});

socket.on('action_error', ({ message }) => {
  setMessage(message);
});

socket.on('action_notice', ({ message }) => {
  setMessage(message);
});

function setMessage(text){
  messageEl.textContent = text || '';
}

// initial UI
createBoardUI();

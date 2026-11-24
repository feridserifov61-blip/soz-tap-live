const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

const PORT = Number(process.env.PORT) || 3004;
const DEFAULT_TIKTOK_USER = (process.env.TIKTOK_USER || 'bakuremixlab').trim().replace(/^@+/, '').toLowerCase();
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const WORDS_PATH = path.join(DATA_DIR, 'words_50k.txt');
const PROGRESS_PATH = path.join(DATA_DIR, 'progress.json');
const MUSIC_META_PATH = path.join(DATA_DIR, 'music.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ==================== AZERBAIJANI ALPHABET & SOFT MATCHING ====================
const SOFT_MAP = {
  'Ə': 'E', 'Ş': 'S', 'Ç': 'C', 'Ğ': 'G', 'Ö': 'O', 'Ü': 'U', 'I': 'I', 'İ': 'I'
};
const VALID_LETTER_RE = /^[A-ZÇƏĞHXİIQLMNOÖPRSŞTUÜVYZ]+$/;

function toAzUpper(str) {
  return String(str || '').trim().toLocaleUpperCase('az');
}

function toSoftChar(ch) {
  return SOFT_MAP[ch] || ch;
}

function toSoftWord(word) {
  return [...word].map(toSoftChar).join('');
}

function charsEqual(a, b, softAz) {
  if (a === b) return true;
  if (!softAz) return false;
  return toSoftChar(a) === toSoftChar(b);
}

// ==================== 50,000 NON-REPEATING WORD BANK ====================
const ALL_WORDS = fs.readFileSync(WORDS_PATH, 'utf8')
  .split(/\r?\n/)
  .map((w) => w.trim())
  .filter(Boolean);

const WORD_POOLS = {
  all: ALL_WORDS,
  classic: ALL_WORDS.filter((w) => w.length >= 4 && w.length <= 7),
  five: ALL_WORDS.filter((w) => w.length === 5),
  hard: ALL_WORDS.filter((w) => w.length >= 8 && w.length <= 14)
};

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) || fallback;
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (_) {}
}

const savedProgress = loadJson(PROGRESS_PATH, {
  wordMode: 'classic',
  softAz: true,
  autoBotDemo: false,
  usedWords: []
});

const usedWordsSet = new Set(Array.isArray(savedProgress.usedWords) ? savedProgress.usedWords : []);

function persistProgress() {
  saveJson(PROGRESS_PATH, {
    wordMode: game.wordMode,
    softAz: game.softAz,
    autoBotDemo: game.autoBotDemo,
    usedWords: [...usedWordsSet]
  });
}

// ==================== MUSIC STATE ====================
function extractYoutubeId(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : '';
}

const savedMusic = loadJson(MUSIC_META_PATH, {
  sourceType: 'preset', // 'preset' | 'upload' | 'url' | 'youtube'
  presetId: 'lofi',
  customUrl: '',
  youtubeId: '',
  uploadedFile: '',
  uploadedMime: '',
  title: 'Gecə Studiyası (Chill Lofi)',
  volume: 0.45,
  playing: false,
  loop: true,
  playOnOverlay: true
});

function persistMusic() {
  saveJson(MUSIC_META_PATH, musicState);
}

const musicState = { ...savedMusic };

// ==================== EXPRESS + SOCKET SERVER ====================
const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Upload custom audio track (MP3 / WAV / OGG / M4A / AAC)
app.post('/api/music', (req, res) => {
  try {
    const { filename, mimeType, dataBase64, title } = req.body || {};
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res.status(400).json({ ok: false, error: 'Audio faylı boşdur.' });
    }
    const cleanB64 = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
    const buf = Buffer.from(cleanB64, 'base64');
    if (buf.length < 100 || buf.length > 20 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: 'Fayl ölçüsü 20MB-dan az olmalıdır.' });
    }
    const safeExt = (path.extname(filename || '') || '.mp3').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp3';
    const destName = `custom_track${safeExt}`;
    const destPath = path.join(UPLOAD_DIR, destName);
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (_) {}
    }
    fs.writeFileSync(destPath, buf);

    musicState.sourceType = 'upload';
    musicState.uploadedFile = destName;
    musicState.uploadedMime = mimeType || 'audio/mpeg';
    musicState.title = (title || filename || 'Mənim Musiqim').replace(/\.[^.]+$/, '');
    musicState.playing = true;
    persistMusic();
    broadcastMusic();
    return res.json({ ok: true, music: getPublicMusicState() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/music-file', (_req, res) => {
  if (!musicState.uploadedFile) return res.status(404).send('No uploaded track');
  const full = path.join(UPLOAD_DIR, musicState.uploadedFile);
  if (!fs.existsSync(full)) return res.status(404).send('Track missing');
  res.setHeader('Content-Type', musicState.uploadedMime || 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(full).pipe(res);
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    connected: tiktok.connected,
    phase: game.phase,
    totalWords: ALL_WORDS.length,
    usedWords: usedWordsSet.size,
    round: game.round,
    wordLen: game.targetWord.length
  });
});

// ==================== GAME ENGINE STATE ====================
const BOT_SAMPLES = [
  { name: '🤖 Elvin', words: ['QALMAQ', 'SALAM', 'KİTAB', 'VƏTƏN', 'BAHAR', 'GECƏ', 'DƏNİZ'] },
  { name: '🤖 Aynur', words: ['GÜNƏŞ', 'MASA', 'SÜRƏT', 'ŞƏHƏR', 'QƏLB', 'PLAN', 'TƏZƏ'] },
  { name: '🤖 Tural', words: ['DOST', 'ZAMAN', 'MUSİQİ', 'XƏZƏR', 'TOXUM', 'AXŞAM', 'AĞIZ'] }
];

const game = {
  phase: 'playing', // 'playing' | 'won' | 'timeout'
  round: 0,
  wordMode: WORD_POOLS[savedProgress.wordMode] ? savedProgress.wordMode : 'classic',
  softAz: savedProgress.softAz !== undefined ? !!savedProgress.softAz : true,
  autoBotDemo: savedProgress.autoBotDemo !== undefined ? !!savedProgress.autoBotDemo : false,
  targetWord: '',
  revealedSet: new Set(),
  guesses: [], // { id, uniqueId, nickname, letters: [{ ch, status }], exactSolved, isBot, isVip, pointsEarned, ts }
  guessedKeys: new Set(),
  keyboard: {}, // letter -> 'correct' | 'present' | 'absent'
  winner: null, // { nickname, word, points, streak }
  likeEnergy: 0,
  roundStartedAt: Date.now(),
  roundDurationSec: 75,
  nextHintAt: 0,
  leaderboard: new Map(),
  streaks: new Map(),
  feed: [],
  nextGuessId: 1,
  tickTimer: null,
  nextRoundTimer: null,
  botTimer: null
};

const tiktok = {
  username: DEFAULT_TIKTOK_USER,
  conn: null,
  connecting: false,
  connected: false,
  viewerCount: 0,
  error: '',
  reconnectTimer: null
};

function pushFeed(text, kind = 'info') {
  game.feed.unshift({ id: Date.now() + Math.random(), text, kind });
  if (game.feed.length > 6) game.feed.length = 6;
}

function getPublicMusicState() {
  return {
    sourceType: musicState.sourceType,
    presetId: musicState.presetId,
    customUrl: musicState.customUrl,
    youtubeId: musicState.youtubeId || '',
    audioSrc: musicState.sourceType === 'upload' && musicState.uploadedFile
      ? `/api/music-file?v=${encodeURIComponent(musicState.uploadedFile + '_' + musicState.title)}`
      : (musicState.sourceType === 'url' ? musicState.customUrl : ''),
    title: musicState.title,
    volume: musicState.volume,
    playing: musicState.playing,
    loop: musicState.loop,
    playOnOverlay: musicState.playOnOverlay
  };
}

function broadcastMusic() {
  io.emit('music-state', getPublicMusicState());
}

function pickNextNonRepeatingWord() {
  const pool = WORD_POOLS[game.wordMode] || WORD_POOLS.classic;
  for (const w of pool) {
    if (!usedWordsSet.has(w)) return w;
  }
  // Fallback: if chosen sub-mode exhausted, pull from full 50,000 pool
  for (const w of ALL_WORDS) {
    if (!usedWordsSet.has(w)) return w;
  }
  // Only if all 50,000 words have genuinely been played
  usedWordsSet.clear();
  pushFeed('🎉 50,000 sözün hamısı tamamlandı — dövr yenidən başladı!', 'win');
  return pool[0] || ALL_WORDS[0];
}

function startNewRound() {
  clearTimeout(game.nextRoundTimer);
  const nextWord = pickNextNonRepeatingWord();
  usedWordsSet.add(nextWord);
  persistProgress();

  game.round += 1;
  game.phase = 'playing';
  game.targetWord = nextWord;
  game.revealedSet = new Set();
  game.guesses = [];
  game.guessedKeys = new Set();
  game.keyboard = {};
  game.winner = null;
  game.roundStartedAt = Date.now();
  game.roundDurationSec = nextWord.length >= 8 ? 90 : 75;
  game.nextHintAt = Date.now() + 20000;

  // Reveal 1 starter letter (2 for 8+ letters) so viewers immediately have an anchor
  const initialReveals = nextWord.length >= 8 ? 2 : 1;
  const indices = Array.from({ length: nextWord.length }, (_, i) => i);
  for (let r = 0; r < initialReveals && indices.length > 1; r++) {
    const pickIdx = Math.floor(Math.random() * indices.length);
    const pos = indices.splice(pickIdx, 1)[0];
    game.revealedSet.add(pos);
  }

  pushFeed(`🔤 Yeni Söz #${game.round} (${nextWord.length} hərf) — Təxminini yaz!`, 'info');
  broadcastState();
}

function revealOneHiddenLetter(reason = 'İpucu açıldı!') {
  if (game.phase !== 'playing') return false;
  const locked = [];
  for (let i = 0; i < game.targetWord.length; i++) {
    if (!game.revealedSet.has(i)) locked.push(i);
  }
  // Keep at least 1 hidden letter unless forced by timeout
  if (locked.length <= 1) return false;
  const pos = locked[Math.floor(Math.random() * locked.length)];
  game.revealedSet.add(pos);
  const ch = game.targetWord[pos];
  game.keyboard[ch] = 'correct';
  pushFeed(`💡 ${reason} (${pos + 1}-ci hərf: ${ch})`, 'hint');
  io.emit('word-fx', { type: 'hint', pos, letter: ch });
  broadcastState();
  return true;
}

function evaluateGuess(rawGuess) {
  const target = game.targetWord;
  const n = target.length;
  const guessChars = [...rawGuess];
  const targetChars = [...target];
  const result = new Array(n);
  const remaining = {};

  // Pass 1: exact positional matches
  for (let i = 0; i < n; i++) {
    if (charsEqual(guessChars[i], targetChars[i], game.softAz)) {
      result[i] = { ch: targetChars[i], status: 'correct' };
    } else {
      const key = game.softAz ? toSoftChar(targetChars[i]) : targetChars[i];
      remaining[key] = (remaining[key] || 0) + 1;
    }
  }

  // Pass 2: wrong position / absent
  for (let i = 0; i < n; i++) {
    if (result[i]) continue;
    const key = game.softAz ? toSoftChar(guessChars[i]) : guessChars[i];
    if (remaining[key] > 0) {
      remaining[key] -= 1;
      result[i] = { ch: guessChars[i], status: 'present' };
    } else {
      result[i] = { ch: guessChars[i], status: 'absent' };
    }
  }

  return result;
}

function addScore(uniqueId, nickname, delta, solved = false) {
  let row = game.leaderboard.get(uniqueId);
  if (!row) {
    row = { uniqueId, nickname, solvedCount: 0, score: 0, bestStreak: 0 };
    game.leaderboard.set(uniqueId, row);
  }
  row.nickname = nickname || row.nickname;
  row.score += delta;
  if (solved) {
    row.solvedCount += 1;
    const st = (game.streaks.get(uniqueId) || 0) + 1;
    game.streaks.set(uniqueId, st);
    if (st > row.bestStreak) row.bestStreak = st;
    return st;
  }
  return 0;
}

function submitGuess({ uniqueId, nickname, word, isBot = false, isVip = false }) {
  if (game.phase !== 'playing') return { accepted: false, reason: 'round_ended' };
  const clean = toAzUpper(word);
  if (!VALID_LETTER_RE.test(clean) || clean.length !== game.targetWord.length) {
    return { accepted: false, reason: 'length_or_chars' };
  }

  const dedupKey = game.softAz ? toSoftWord(clean) : clean;
  if (game.guessedKeys.has(dedupKey)) {
    return { accepted: false, reason: 'already_guessed' };
  }
  game.guessedKeys.add(dedupKey);

  const tiles = evaluateGuess(clean);
  let newGreens = 0;
  let yellows = 0;
  const allCorrect = tiles.every((t) => t.status === 'correct');

  const priority = { absent: 1, present: 2, correct: 3 };
  tiles.forEach((tile, idx) => {
    const prev = game.keyboard[tile.ch];
    if (!prev || priority[tile.status] > priority[prev]) {
      game.keyboard[tile.ch] = tile.status;
    }
    if (tile.status === 'correct') {
      if (!game.revealedSet.has(idx)) {
        game.revealedSet.add(idx);
        newGreens += 1;
      }
    } else if (tile.status === 'present') {
      yellows += 1;
    }
  });

  let pointsEarned = newGreens * 15 + yellows * 5 + (isVip ? 20 : 0);
  if (allCorrect) pointsEarned += 100;

  const displayName = (nickname || 'Oyunçu').slice(0, 22);
  let streak = 0;
  if (!isBot && pointsEarned > 0) {
    streak = addScore(uniqueId, displayName, pointsEarned, allCorrect);
    if (streak > 1) {
      const bonus = (streak - 1) * 25;
      pointsEarned += bonus;
      addScore(uniqueId, displayName, bonus, false);
    }
  } else if (isBot && allCorrect) {
    // Bots don't pollute top scorers leaderboard unless real players haven't joined
    streak = 1;
  }

  const entry = {
    id: game.nextGuessId++,
    uniqueId,
    nickname: displayName,
    letters: tiles,
    exactSolved: allCorrect,
    isBot,
    isVip,
    pointsEarned,
    ts: Date.now()
  };

  game.guesses.unshift(entry);
  if (game.guesses.length > 7) game.guesses.length = 7;

  if (allCorrect) {
    game.phase = 'won';
    game.winner = {
      nickname: displayName,
      word: game.targetWord,
      points: pointsEarned,
      streak
    };
    for (let i = 0; i < game.targetWord.length; i++) game.revealedSet.add(i);
    pushFeed(`🏆 ${displayName} "${game.targetWord}" sözünü TAPDI! (+${pointsEarned} xal)`, 'win');
    io.emit('word-fx', { type: 'win', winner: game.winner });
    broadcastState();
    clearTimeout(game.nextRoundTimer);
    game.nextRoundTimer = setTimeout(() => startNewRound(), 4200);
  } else {
    if (newGreens > 0) {
      pushFeed(`🟩 ${displayName}: ${newGreens} düzgün hərf açdı! (+${pointsEarned})`, 'hit');
      io.emit('word-fx', { type: 'hit', newGreens });
    } else {
      io.emit('word-fx', { type: 'tile' });
    }
    broadcastState();
  }

  return { accepted: true, entry };
}

function handleViewerChat({ uniqueId, nickname, comment }) {
  const raw = String(comment || '').trim();
  if (!raw) return;
  // Support single-word guess directly or prefixed with ! / .
  const cleaned = raw.replace(/^[!.]+/, '').trim();
  // Take first token if user wrote just one word (or word + punctuation like "kitab!")
  const match = cleaned.match(/^([a-zA-ZçəğıöşüÇƏĞİIÖŞÜ]+)[!?.,]*$/);
  if (!match) return;
  const word = match[1];
  submitGuess({ uniqueId, nickname, word, isBot: false });
}

function getMaskedPattern() {
  return [...game.targetWord].map((ch, idx) => (game.revealedSet.has(idx) ? ch : ''));
}

function getStatePayload() {
  const top3 = [...game.leaderboard.values()]
    .sort((a, b) => b.score - a.score || b.solvedCount - a.solvedCount)
    .slice(0, 5);
  const elapsedSec = Math.floor((Date.now() - game.roundStartedAt) / 1000);
  const timeLeft = game.phase === 'playing' ? Math.max(0, game.roundDurationSec - elapsedSec) : 0;

  return {
    phase: game.phase,
    round: game.round,
    wordLength: game.targetWord.length,
    mask: getMaskedPattern(),
    answer: game.phase !== 'playing' ? game.targetWord : null,
    guesses: game.guesses,
    keyboard: game.keyboard,
    winner: game.winner,
    timeLeft,
    roundDuration: game.roundDurationSec,
    likeEnergy: game.likeEnergy,
    wordMode: game.wordMode,
    softAz: game.softAz,
    autoBotDemo: game.autoBotDemo,
    totalWords: ALL_WORDS.length,
    usedWordsCount: usedWordsSet.size,
    remainingWordsCount: Math.max(0, ALL_WORDS.length - usedWordsSet.size),
    modeTotal: (WORD_POOLS[game.wordMode] || ALL_WORDS).length,
    leaderboard: top3,
    feed: game.feed,
    tiktok: {
      username: tiktok.username,
      connected: tiktok.connected,
      connecting: tiktok.connecting,
      viewerCount: tiktok.viewerCount,
      error: tiktok.error
    }
  };
}

function broadcastState() {
  io.emit('word-state', getStatePayload());
}

// Game tick: auto-hint every 20s and round timeout at 0s
game.tickTimer = setInterval(() => {
  if (game.phase !== 'playing') return;
  const now = Date.now();
  const elapsedSec = (now - game.roundStartedAt) / 1000;
  if (now >= game.nextHintAt) {
    game.nextHintAt = now + 20000;
    revealOneHiddenLetter('Avtomatik ipucu');
  }
  if (elapsedSec >= game.roundDurationSec) {
    game.phase = 'timeout';
    for (let i = 0; i < game.targetWord.length; i++) game.revealedSet.add(i);
    pushFeed(`⏱️ Vaxt bitdi! Doğru söz: "${game.targetWord}"`, 'timeout');
    io.emit('word-fx', { type: 'timeout', word: game.targetWord });
    broadcastState();
    clearTimeout(game.nextRoundTimer);
    game.nextRoundTimer = setTimeout(() => startNewRound(), 3800);
  }
}, 1000);

// Optional Bot Demo loop (only when host turns Demo Bot ON)
game.botTimer = setInterval(() => {
  if (!game.autoBotDemo || game.phase !== 'playing') return;
  const bot = BOT_SAMPLES[Math.floor(Math.random() * BOT_SAMPLES.length)];
  const pool = WORD_POOLS[game.wordMode] || ALL_WORDS;
  const matchingLen = pool.filter((w) => w.length === game.targetWord.length && !game.guessedKeys.has(w));
  if (matchingLen.length === 0) return;
  const pick = matchingLen[Math.floor(Math.random() * Math.min(250, matchingLen.length))];
  submitGuess({ uniqueId: `bot_${bot.name}`, nickname: bot.name, word: pick, isBot: true });
}, 4800);

// ==================== TIKTOK LIVE CONNECTOR ====================
function disconnectTikTok(manual = false) {
  clearTimeout(tiktok.reconnectTimer);
  if (tiktok.conn) {
    try { tiktok.conn.disconnect(); } catch (_) {}
    tiktok.conn = null;
  }
  tiktok.connecting = false;
  tiktok.connected = false;
  tiktok.viewerCount = 0;
  if (manual) tiktok.error = '';
  broadcastState();
}

async function connectTikTok(username, isManual = false) {
  const cleanUser = (username || DEFAULT_TIKTOK_USER).trim().replace(/^@+/, '').toLowerCase();
  if (!cleanUser) return;

  disconnectTikTok(false);
  tiktok.username = cleanUser;
  tiktok.connecting = true;
  tiktok.error = '';
  broadcastState();

  try {
    const conn = new TikTokLiveConnection(cleanUser, {
      processInitialData: false,
      enableExtendedGiftInfo: true
    });
    tiktok.conn = conn;

    conn.on(WebcastEvent.CHAT, (data) => {
      const uniqueId = data?.user?.uniqueId || data?.uniqueId || `u_${Math.random()}`;
      const nickname = data?.user?.nickname || data?.nickname || uniqueId;
      const comment = data?.comment || '';
      handleViewerChat({ uniqueId, nickname, comment });
    });

    conn.on(WebcastEvent.LIKE, (data) => {
      const count = Number(data?.likeCount || 1);
      game.likeEnergy = Math.min(100, game.likeEnergy + count * 2);
      if (game.likeEnergy >= 100) {
        game.likeEnergy = 0;
        revealOneHiddenLetter('❤️ Bəyənmə 100% oldu — Hərf açıldı!');
      } else {
        broadcastState();
      }
    });

    conn.on(WebcastEvent.GIFT, (data) => {
      if (data?.giftType === 1 && !data?.repeatEnd) return;
      const uniqueId = data?.user?.uniqueId || data?.uniqueId || `gift_${Date.now()}`;
      const nickname = data?.user?.nickname || data?.nickname || 'VIP';
      const giftName = data?.giftName || 'Hədiyyə';
      addScore(uniqueId, nickname, 50, false);
      revealOneHiddenLetter(`🎁 ${nickname} (${giftName})`);
      pushFeed(`🎁 ${nickname} ${giftName} göndərdi (+50 xal & ipucu!)`, 'vip');
      broadcastState();
    });

    conn.on(WebcastEvent.ROOM_USER, (data) => {
      tiktok.viewerCount = Number(data?.viewerCount || 0);
      broadcastState();
    });

    conn.on(ControlEvent.DISCONNECTED, () => {
      if (tiktok.conn !== conn) return;
      tiktok.connected = false;
      tiktok.connecting = false;
      broadcastState();
      clearTimeout(tiktok.reconnectTimer);
      tiktok.reconnectTimer = setTimeout(() => connectTikTok(tiktok.username, false), 15000);
    });

    await conn.connect();
    if (tiktok.conn !== conn) return;
    tiktok.connected = true;
    tiktok.connecting = false;
    tiktok.error = '';
    pushFeed(`🔴 @${cleanUser} TikTok LIVE-a qoşuldu!`, 'win');
    broadcastState();
  } catch (err) {
    tiktok.connected = false;
    tiktok.connecting = false;
    tiktok.error = isManual ? (err?.message || 'Yayım tapılmadı (Offline?)') : 'Yayım gözlənilir...';
    broadcastState();
    clearTimeout(tiktok.reconnectTimer);
    tiktok.reconnectTimer = setTimeout(() => connectTikTok(tiktok.username, false), 15000);
  }
}

// ==================== SOCKET.IO HOST CONTROLS ====================
io.on('connection', (socket) => {
  socket.emit('word-state', getStatePayload());
  socket.emit('music-state', getPublicMusicState());

  socket.on('next-word', () => startNewRound());
  socket.on('reveal-hint', () => revealOneHiddenLetter('Aparıcı ipucu açdı'));
  socket.on('set-word-mode', ({ mode } = {}) => {
    if (!WORD_POOLS[mode]) return;
    game.wordMode = mode;
    persistProgress();
    startNewRound();
  });
  socket.on('toggle-soft-az', ({ enabled } = {}) => {
    game.softAz = !!enabled;
    persistProgress();
    broadcastState();
  });
  socket.on('toggle-bots', ({ enabled } = {}) => {
    game.autoBotDemo = !!enabled;
    persistProgress();
    broadcastState();
  });
  socket.on('manual-guess', ({ nickname, word, isVip } = {}) => {
    const clean = toAzUpper(word);
    if (!clean) return;
    submitGuess({
      uniqueId: `host_${Date.now()}_${Math.random()}`,
      nickname: nickname || 'Aparıcı',
      word: clean,
      isVip: !!isVip
    });
  });
  socket.on('reset-scores', () => {
    game.leaderboard.clear();
    game.streaks.clear();
    game.feed = [];
    pushFeed('🔄 Xallar sıfırlandı (söz növbəsi davam edir)', 'info');
    broadcastState();
  });
  socket.on('reset-word-cycle', () => {
    usedWordsSet.clear();
    persistProgress();
    pushFeed('♻️ 50,000 söz dövrü sıfırlandı!', 'info');
    startNewRound();
  });
  socket.on('connect-tiktok', ({ username } = {}) => connectTikTok(username, true));
  socket.on('disconnect-tiktok', () => disconnectTikTok(true));

  // Music control events
  socket.on('music-update', async (patch = {}) => {
    if (patch.sourceType && ['preset', 'upload', 'url', 'youtube'].includes(patch.sourceType)) {
      musicState.sourceType = patch.sourceType;
    }
    if (typeof patch.presetId === 'string') {
      musicState.presetId = patch.presetId;
      if (musicState.sourceType === 'preset') {
        const names = { lofi: 'Gecə Studiyası (Chill Lofi)', pulse: 'Quiz Pulse (Canlı Ritm)', synth: 'Çempion Synth (Enerji)' };
        musicState.title = names[patch.presetId] || 'Studiya Musiqisi';
      }
    }
    if (typeof patch.customUrl === 'string') {
      musicState.customUrl = patch.customUrl.trim();
      const ytId = extractYoutubeId(musicState.customUrl);
      if (ytId) {
        musicState.sourceType = 'youtube';
        musicState.youtubeId = ytId;
        musicState.title = `YouTube (${ytId})`;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2200);
          const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + ytId)}&format=json`, { signal: ctrl.signal });
          clearTimeout(t);
          if (r.ok) {
            const meta = await r.json();
            if (meta && meta.title) musicState.title = `YouTube: ${meta.title.slice(0, 42)}`;
          }
        } catch (_) {}
      } else if (musicState.customUrl && musicState.sourceType === 'url') {
        musicState.youtubeId = '';
        musicState.title = patch.title || 'Xarici Musiqi (URL)';
      }
    }
    if (typeof patch.playing === 'boolean') musicState.playing = patch.playing;
    if (typeof patch.loop === 'boolean') musicState.loop = patch.loop;
    if (typeof patch.playOnOverlay === 'boolean') musicState.playOnOverlay = patch.playOnOverlay;
    if (patch.volume !== undefined) {
      const v = Number(patch.volume);
      if (!Number.isNaN(v)) musicState.volume = Math.max(0, Math.min(1, v));
    }
    persistMusic();
    broadcastMusic();
  });
});

// ==================== BOOT ====================
startNewRound();

server.listen(PORT, () => {
  console.log(`\n================================================`);
  console.log(`  Canli Soz Tap (50,000 Soz) Server isleyir!`);
  console.log(`  Aparici Studiyasi : http://localhost:${PORT}`);
  console.log(`  OBS / Studio Link : http://localhost:${PORT}/?overlay=1`);
  console.log(`  Soz Banki         : ${ALL_WORDS.length} unikal soz`);
  console.log(`================================================\n`);
  connectTikTok(DEFAULT_TIKTOK_USER, false);
});

process.on('uncaughtException', (err) => console.error('[UncaughtException]', err?.stack || err));
process.on('unhandledRejection', (reason) => console.error('[UnhandledRejection]', reason));

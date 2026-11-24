(() => {
  const params = new URLSearchParams(window.location.search);
  const isOverlay = params.get('overlay') === '1';
  if (isOverlay) document.body.classList.add('overlay-mode');

  const socket = io();

  const AZ_ROWS = [
    ['Q', 'Ü', 'E', 'R', 'T', 'Y', 'U', 'İ', 'O', 'P', 'Ö', 'Ğ'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'I', 'Ə', 'Ş'],
    ['Z', 'X', 'C', 'Ç', 'V', 'B', 'N', 'M']
  ];

  const el = {
    wordCounter: document.getElementById('wordCounter'),
    timerPill: document.getElementById('timerPill'),
    timeLeft: document.getElementById('timeLeft'),
    timerFill: document.getElementById('timerFill'),
    clueLabel: document.getElementById('clueLabel'),
    likePct: document.getElementById('likePct'),
    masterTiles: document.getElementById('masterTiles'),
    hintGuide: document.getElementById('hintGuide'),
    guessRows: document.getElementById('guessRows'),
    roundOverlay: document.getElementById('roundOverlay'),
    overlayBadge: document.getElementById('overlayBadge'),
    overlayWord: document.getElementById('overlayWord'),
    overlaySub: document.getElementById('overlaySub'),
    azKeyboard: document.getElementById('azKeyboard'),
    feedText: document.getElementById('feedText'),
    overlayMusicBadge: document.getElementById('overlayMusicBadge'),
    liveBadge: document.getElementById('liveBadge'),
    lbList: document.getElementById('lbList'),
    confettiCanvas: document.getElementById('confettiCanvas'),
    bgAudioEl: document.getElementById('bgAudioEl'),
    ytPlayerBox: document.getElementById('ytPlayerBox'),
    // Host panel
    obsUrlInput: document.getElementById('obsUrlInput'),
    btnCopyUrl: document.getElementById('btnCopyUrl'),
    tiktokUserInput: document.getElementById('tiktokUserInput'),
    btnConnect: document.getElementById('btnConnect'),
    btnDisconnect: document.getElementById('btnDisconnect'),
    hostStatus: document.getElementById('hostStatus'),
    poolStats: document.getElementById('poolStats'),
    btnRevealHint: document.getElementById('btnRevealHint'),
    btnNextWord: document.getElementById('btnNextWord'),
    btnToggleSoftAz: document.getElementById('btnToggleSoftAz'),
    btnToggleBots: document.getElementById('btnToggleBots'),
    testWordInput: document.getElementById('testWordInput'),
    btnSendTestWord: document.getElementById('btnSendTestWord'),
    testFeedback: document.getElementById('testFeedback'),
    musicNowLabel: document.getElementById('musicNowLabel'),
    btnMusicPlayPause: document.getElementById('btnMusicPlayPause'),
    btnMusicLoop: document.getElementById('btnMusicLoop'),
    musicVolume: document.getElementById('musicVolume'),
    volVal: document.getElementById('volVal'),
    chkOverlayMusic: document.getElementById('chkOverlayMusic'),
    musicFileInput: document.getElementById('musicFileInput'),
    btnUploadMusic: document.getElementById('btnUploadMusic'),
    uploadStatus: document.getElementById('uploadStatus'),
    musicUrlInput: document.getElementById('musicUrlInput'),
    btnApplyMusicUrl: document.getElementById('btnApplyMusicUrl'),
    urlStatus: document.getElementById('urlStatus'),
    btnSfxMute: document.getElementById('btnSfxMute'),
    btnResetScores: document.getElementById('btnResetScores'),
    btnResetCycle: document.getElementById('btnResetCycle')
  };

  if (el.obsUrlInput) {
    el.obsUrlInput.value = `${window.location.origin}/?overlay=1`;
  }

  // ==================== BUILD AZ KEYBOARD ====================
  const keyMap = new Map();
  AZ_ROWS.forEach((row) => {
    const rDiv = document.createElement('div');
    rDiv.className = 'kb-row';
    row.forEach((ch) => {
      const k = document.createElement('div');
      k.className = 'kb-key';
      k.textContent = ch;
      rDiv.appendChild(k);
      keyMap.set(ch, k);
    });
    el.azKeyboard.appendChild(rDiv);
  });

  // ==================== CONFETTI ENGINE ====================
  const confetti = [];
  function burstConfetti(count = 75) {
    const colors = ['#22c55e', '#f5c542', '#38bdf8', '#f43f5e', '#ffffff'];
    for (let i = 0; i < count; i++) {
      confetti.push({
        x: Math.random(),
        y: -0.05 - Math.random() * 0.25,
        vx: (Math.random() - 0.5) * 0.28,
        vy: 0.25 + Math.random() * 0.45,
        size: 5 + Math.random() * 6,
        color: colors[i % colors.length],
        life: 1
      });
    }
  }

  let lastTs = performance.now();
  function animLoop(now) {
    const dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;
    const c = el.confettiCanvas;
    const rect = c.getBoundingClientRect();
    if (rect.width > 0) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 0.28;
        if (p.life <= 0 || p.y > 1.05) {
          confetti.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x * w, p.y * h, p.size, p.size * 1.35);
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(animLoop);
  }
  requestAnimationFrame(animLoop);

  // ==================== SFX + AMBIENT MUSIC STUDIO ====================
  let sfxMuted = false;
  let audioCtx = null;
  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, dur, type = 'sine', gainVal = 0.08, delay = 0) {
    if (sfxMuted) return;
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  const Sfx = {
    tile: () => playTone(440, 0.07, 'triangle', 0.05),
    hit: () => { playTone(587.3, 0.11, 'sine', 0.08); playTone(784, 0.16, 'sine', 0.08, 0.08); },
    hint: () => { playTone(660, 0.1, 'triangle', 0.07); playTone(880, 0.18, 'sine', 0.08, 0.07); },
    win: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playTone(f, 0.22, 'triangle', 0.11, i * 0.09)); },
    timeout: () => { playTone(320, 0.18, 'sawtooth', 0.06); playTone(240, 0.3, 'sawtooth', 0.06, 0.16); }
  };

  // Built-in ambient music synthesizer (for preset mode when no custom MP3 uploaded)
  let musicState = null;
  let presetTimer = null;
  let presetStep = 0;

  function stopPresetSynth() {
    if (presetTimer) {
      clearInterval(presetTimer);
      presetTimer = null;
    }
  }

  function startPresetSynth() {
    stopPresetSynth();
    const ctx = getCtx();
    if (!ctx) return;
    const patterns = {
      lofi: { ms: 520, scale: [261.63, 329.63, 392.0, 493.88, 392.0, 329.63, 293.66, 349.23], wave: 'sine' },
      pulse: { ms: 340, scale: [220, 261.63, 329.63, 261.63, 246.94, 293.66, 392.0, 293.66], wave: 'triangle' },
      synth: { ms: 300, scale: [293.66, 369.99, 440, 587.33, 440, 369.99, 329.63, 493.88], wave: 'triangle' }
    };
    const cfg = patterns[(musicState && musicState.presetId) || 'lofi'] || patterns.lofi;
    presetTimer = setInterval(() => {
      if (!musicState || !musicState.playing || musicState.sourceType !== 'preset') return;
      if (isOverlay && !musicState.playOnOverlay) return;
      const c = getCtx();
      if (!c || c.state !== 'running') return;
      const vol = Math.max(0, Math.min(1, Number(musicState.volume ?? 0.45))) * 0.07;
      if (vol <= 0.001) return;
      const freq = cfg.scale[presetStep % cfg.scale.length];
      presetStep += 1;
      const t = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = cfg.wave;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.ms / 1000 * 1.15);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t);
      osc.stop(t + cfg.ms / 1000 * 1.2);
    }, cfg.ms);
  }

  let currentAudioSrc = '';
  let ytApiRequested = false;
  let ytApiReady = false;
  let ytPlayer = null;
  let ytReady = false;
  let currentYtId = '';

  function setUrlHint(msg) {
    if (el.urlStatus) el.urlStatus.textContent = msg;
  }

  el.bgAudioEl.addEventListener('error', () => {
    if (musicState && musicState.sourceType === 'url') {
      setUrlHint('❌ Bu link birbaşa MP3/audio deyil. YouTube və ya birbaşa .mp3 linki istifadə et!');
    }
  });

  function ensureYoutubeApi() {
    if (window.YT && window.YT.Player) {
      ytApiReady = true;
      return;
    }
    if (ytApiRequested) return;
    ytApiRequested = true;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      if (typeof prev === 'function') prev();
      syncYoutubePlayer();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  function syncYoutubePlayer() {
    if (!musicState || musicState.sourceType !== 'youtube' || !musicState.youtubeId) {
      if (el.ytPlayerBox) el.ytPlayerBox.classList.add('hidden');
      if (ytPlayer && ytReady && typeof ytPlayer.pauseVideo === 'function') {
        try { ytPlayer.pauseVideo(); } catch (_) {}
      }
      return;
    }

    const shouldPlayHere = !!musicState.playing && (!isOverlay || !!musicState.playOnOverlay);
    if (el.ytPlayerBox) el.ytPlayerBox.classList.toggle('hidden', !shouldPlayHere);

    if (!shouldPlayHere) {
      if (ytPlayer && ytReady && typeof ytPlayer.pauseVideo === 'function') {
        try { ytPlayer.pauseVideo(); } catch (_) {}
      }
      return;
    }

    ensureYoutubeApi();
    if (!ytApiReady) return;

    const vid = musicState.youtubeId;
    const volPct = Math.round(Math.max(0, Math.min(1, Number(musicState.volume ?? 0.45))) * 100);

    if (!ytPlayer) {
      currentYtId = vid;
      ytPlayer = new window.YT.Player('ytPlayerMount', {
        width: isOverlay ? '2' : '240',
        height: isOverlay ? '2' : '135',
        videoId: vid,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          loop: musicState.loop ? 1 : 0,
          playlist: vid,
          origin: window.location.origin
        },
        events: {
          onReady: (ev) => {
            ytReady = true;
            ev.target.setVolume(volPct);
            ev.target.unMute();
            if (musicState && musicState.playing) ev.target.playVideo();
          },
          onStateChange: (ev) => {
            if (ev.data === window.YT.PlayerState.ENDED && musicState && musicState.loop && musicState.playing) {
              ev.target.seekTo(0);
              ev.target.playVideo();
            }
          },
          onError: (ev) => {
            if (ev.data === 101 || ev.data === 150) {
              setUrlHint('⚠️ Bu YouTube videosu kənar saytda oxunmağa qapalıdır — başqa link və ya MP3 seç!');
            } else {
              setUrlHint('⚠️ YouTube videosu yüklənmədi (linki yoxla).');
            }
          }
        }
      });
      return;
    }

    if (!ytReady) return;
    ytPlayer.setVolume(volPct);
    if (vid !== currentYtId) {
      currentYtId = vid;
      ytPlayer.loadVideoById(vid);
      setUrlHint(`✅ YouTube qoşuldu: ${vid}`);
    } else if (typeof ytPlayer.getPlayerState === 'function' && ytPlayer.getPlayerState() !== 1) {
      ytPlayer.playVideo();
    }
  }

  function syncAudioPlayback() {
    if (!musicState) return;
    const shouldPlayHere = !!musicState.playing && (!isOverlay || !!musicState.playOnOverlay);

    if (el.overlayMusicBadge) {
      el.overlayMusicBadge.classList.toggle('hidden', !musicState.playing);
      el.overlayMusicBadge.textContent = `🎵 ${musicState.title || 'Musiqi'}`;
    }

    if (musicState.sourceType === 'preset') {
      el.bgAudioEl.pause();
      syncYoutubePlayer();
      if (shouldPlayHere) startPresetSynth();
      else stopPresetSynth();
    } else if (musicState.sourceType === 'youtube') {
      stopPresetSynth();
      el.bgAudioEl.pause();
      syncYoutubePlayer();
    } else {
      stopPresetSynth();
      syncYoutubePlayer();
      const src = musicState.audioSrc || '';
      if (src !== currentAudioSrc) {
        currentAudioSrc = src;
        el.bgAudioEl.src = src;
      }
      el.bgAudioEl.loop = !!musicState.loop;
      el.bgAudioEl.volume = Math.max(0, Math.min(1, Number(musicState.volume ?? 0.45)));
      if (shouldPlayHere && src) {
        el.bgAudioEl.play().catch(() => {});
      } else {
        el.bgAudioEl.pause();
      }
    }

    // Host studio controls UI sync
    if (el.musicNowLabel) {
      el.musicNowLabel.textContent = `${musicState.playing ? '▶️ Çalır' : '⏸️ Dayandırılıb'}: ${musicState.title || 'Musiqi'}`;
    }
    if (el.btnMusicPlayPause) {
      el.btnMusicPlayPause.textContent = musicState.playing ? '⏸️ Dayandır' : '▶ Başlat';
      el.btnMusicPlayPause.className = musicState.playing ? 'btn btn-red' : 'btn btn-green';
    }
    if (el.btnMusicLoop) {
      el.btnMusicLoop.textContent = `🔁 Təkrar: ${musicState.loop ? 'AÇIQ' : 'BAĞLI'}`;
    }
    if (el.musicVolume) {
      const pct = Math.round((musicState.volume ?? 0.45) * 100);
      el.musicVolume.value = pct;
      if (el.volVal) el.volVal.textContent = `${pct}%`;
    }
    if (el.chkOverlayMusic) el.chkOverlayMusic.checked = !!musicState.playOnOverlay;
    document.querySelectorAll('.preset-btn').forEach((b) => {
      b.classList.toggle('active', musicState.sourceType === 'preset' && b.dataset.preset === musicState.presetId);
    });
  }

  // Unlock audio on user interaction in Host Studio
  window.addEventListener('pointerdown', () => {
    getCtx();
    if (musicState && musicState.playing && musicState.sourceType !== 'preset' && el.bgAudioEl.paused && currentAudioSrc) {
      el.bgAudioEl.play().catch(() => {});
    }
  }, { once: false });

  // ==================== STATE RENDERING ====================
  let latestState = null;
  let lastGuessTopId = 0;

  function tileSizeClass(len) {
    if (len >= 11) return 'ultra-compact';
    if (len >= 8) return 'compact';
    return '';
  }

  function renderState(st) {
    latestState = st;
    const len = st.wordLength || 5;
    const szClass = tileSizeClass(len);

    el.wordCounter.textContent = `#${st.usedWordsCount || 1} / ${(st.totalWords || 50000).toLocaleString('en-US')}`;
    el.clueLabel.textContent = `🎯 ${len} HƏRFLİ SÖZÜ TAP!`;
    el.hintGuide.textContent = `Çatda ${len} hərfli söz yaz!`;
    el.likePct.textContent = `${st.likeEnergy || 0}%`;

    // Timer
    el.timeLeft.textContent = st.timeLeft;
    el.timerPill.classList.toggle('urgent', st.phase === 'playing' && st.timeLeft <= 12);
    const pct = st.roundDuration ? Math.max(0, Math.min(100, (st.timeLeft / st.roundDuration) * 100)) : 0;
    el.timerFill.style.width = `${pct}%`;

    // Master revealed letters bar
    el.masterTiles.innerHTML = '';
    (st.mask || []).forEach((ch) => {
      const tile = document.createElement('div');
      tile.className = `m-tile ${szClass} ${ch ? 'revealed' : 'empty'}`;
      tile.textContent = ch || '?';
      el.masterTiles.appendChild(tile);
    });

    // Interactive viewer guesses table (6 fixed slots)
    const guesses = st.guesses || [];
    const topId = guesses[0] ? guesses[0].id : 0;
    const hasNewTop = topId && topId !== lastGuessTopId;
    lastGuessTopId = topId;

    el.guessRows.innerHTML = '';
    const MAX_ROWS = 6;
    for (let r = 0; r < MAX_ROWS; r++) {
      const g = guesses[r];
      const rowEl = document.createElement('div');
      if (g) {
        const rowSz = tileSizeClass(Math.max(len, (g.letters || []).length));
        rowEl.className = `guess-row${r === 0 && hasNewTop ? ' is-new' : ''}${g.exactSolved ? ' is-win' : ''}${g.lengthMismatch ? ' is-wrong-len' : ''}`;
        const info = document.createElement('div');
        info.className = 'guesser-info';
        const nm = document.createElement('div');
        nm.className = `guesser-name${g.isVip ? ' vip' : ''}`;
        nm.textContent = `${g.isVip ? '👑 ' : ''}${g.nickname}`;
        const pts = document.createElement('div');
        pts.className = `guesser-pts${g.lengthMismatch ? ' warn' : ''}`;
        if (g.exactSolved) pts.textContent = `🏆 TAPDI (+${g.pointsEarned})`;
        else if (g.lengthMismatch) pts.textContent = `📏 ${g.typedLen}/${g.targetLen} hərf`;
        else pts.textContent = g.pointsEarned > 0 ? `+${g.pointsEarned} xal` : 'Cəhd';
        info.append(nm, pts);

        const tilesWrap = document.createElement('div');
        tilesWrap.className = 'row-tiles';
        (g.letters || []).forEach((item) => {
          const t = document.createElement('div');
          t.className = `g-tile ${rowSz} ${item.status}`;
          t.textContent = item.ch;
          tilesWrap.appendChild(t);
        });
        rowEl.append(info, tilesWrap);
      } else {
        rowEl.className = 'guess-row placeholder';
        const info = document.createElement('div');
        info.className = 'guesser-info';
        info.innerHTML = `<div class="guesser-name">Gözlənilir...</div><div class="guesser-pts" style="color:#64748b">${len} hərf yaz</div>`;
        const tilesWrap = document.createElement('div');
        tilesWrap.className = 'row-tiles';
        for (let i = 0; i < len; i++) {
          const t = document.createElement('div');
          t.className = `g-tile ${szClass} empty-slot`;
          tilesWrap.appendChild(t);
        }
        rowEl.append(info, tilesWrap);
      }
      el.guessRows.appendChild(rowEl);
    }

    // Round Win / Timeout overlay
    if (st.phase === 'won' && st.winner) {
      el.roundOverlay.className = 'round-overlay';
      el.overlayBadge.textContent = '🏆 SÖZ TAPILDI!';
      el.overlayWord.textContent = st.winner.word;
      el.overlaySub.textContent = `${st.winner.nickname} • +${st.winner.points} xal${st.winner.streak > 1 ? ` (🔥×${st.winner.streak})` : ''}`;
    } else if (st.phase === 'timeout') {
      el.roundOverlay.className = 'round-overlay timeout';
      el.overlayBadge.textContent = '⏱️ VAXT BİTDİ!';
      el.overlayWord.textContent = st.answer || '';
      el.overlaySub.textContent = 'Növbəti söz gəlir...';
    } else {
      el.roundOverlay.className = 'round-overlay hidden';
    }

    // Keyboard colors
    const kb = st.keyboard || {};
    keyMap.forEach((node, ch) => {
      node.className = `kb-key${kb[ch] ? ' ' + kb[ch] : ''}`;
    });

    // Feed + Live Tag + Leaderboard
    if (st.feed && st.feed[0]) el.feedText.textContent = st.feed[0].text;

    const tt = st.tiktok || {};
    if (tt.connected) {
      el.liveBadge.className = 'live-tag on';
      el.liveBadge.textContent = `🔴 @${tt.username} • ${tt.viewerCount || 0}`;
    } else if (tt.connecting) {
      el.liveBadge.className = 'live-tag';
      el.liveBadge.textContent = `🟡 @${tt.username}...`;
    } else {
      el.liveBadge.className = 'live-tag';
      el.liveBadge.textContent = `⚫ @${tt.username || 'offline'}`;
    }

    const lb = st.leaderboard || [];
    if (lb.length === 0) {
      el.lbList.innerHTML = '<div class="lb-empty">İlk tapan lider olur! 👑</div>';
    } else {
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      el.lbList.innerHTML = lb.slice(0, 3).map((r, i) => `
        <div class="lb-row">
          <span>${medals[i]} ${r.nickname}</span>
          <span>🔤 ${r.solvedCount} • ${r.score} xal</span>
        </div>
      `).join('');
    }

    // Host studio controls
    if (el.hostStatus) {
      el.hostStatus.textContent = tt.connected
        ? `🟢 Canlı Qoşulu: @${tt.username} (${tt.viewerCount} izləyici)`
        : (tt.error || `⚪ Gözlənilir: @${tt.username}`);
    }
    if (el.poolStats) {
      el.poolStats.textContent = `İstifadə: ${st.usedWordsCount} / ${st.totalWords} | Qalan: ${st.remainingWordsCount}`;
    }
    if (el.btnToggleSoftAz) {
      el.btnToggleSoftAz.textContent = `✨ Yumşaq Əlifba: ${st.softAz ? 'AÇIQ' : 'BAĞLI'}`;
    }
    if (el.btnToggleBots) {
      el.btnToggleBots.textContent = `🤖 Demo Botlar: ${st.autoBotDemo ? 'AÇIQ' : 'BAĞLI'}`;
    }
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === st.wordMode);
    });
  }

  // Smooth local countdown tick between server pushes
  setInterval(() => {
    if (!latestState || latestState.phase !== 'playing' || latestState.timeLeft <= 0) return;
    latestState.timeLeft -= 1;
    el.timeLeft.textContent = latestState.timeLeft;
    el.timerPill.classList.toggle('urgent', latestState.timeLeft <= 12);
    const pct = latestState.roundDuration ? Math.max(0, Math.min(100, (latestState.timeLeft / latestState.roundDuration) * 100)) : 0;
    el.timerFill.style.width = `${pct}%`;
  }, 1000);

  // ==================== SOCKET LISTENERS ====================
  socket.on('word-state', renderState);
  socket.on('guess-feedback', (fb) => {
    if (el.testFeedback && fb && fb.msg) {
      el.testFeedback.textContent = fb.msg;
      el.testFeedback.style.color = fb.ok ? '#4ade80' : '#fca5a5';
    }
  });
  socket.on('music-state', (m) => {
    musicState = m;
    syncAudioPlayback();
  });
  socket.on('word-fx', (fx) => {
    if (!fx) return;
    if (fx.type === 'win') {
      burstConfetti(90);
      Sfx.win();
    } else if (fx.type === 'hit') {
      Sfx.hit();
    } else if (fx.type === 'hint') {
      Sfx.hint();
    } else if (fx.type === 'timeout') {
      Sfx.timeout();
    } else if (fx.type === 'tile') {
      Sfx.tile();
    }
  });

  // ==================== HOST PANEL EVENTS ====================
  if (el.btnCopyUrl && el.obsUrlInput) {
    el.btnCopyUrl.addEventListener('click', () => {
      navigator.clipboard?.writeText(el.obsUrlInput.value).catch(() => {});
      el.btnCopyUrl.textContent = '✅ Kopyalandı!';
      setTimeout(() => { el.btnCopyUrl.textContent = '📋 Kopyala'; }, 1500);
    });
  }
  if (el.btnConnect) el.btnConnect.addEventListener('click', () => socket.emit('connect-tiktok', { username: el.tiktokUserInput.value.trim() }));
  if (el.btnDisconnect) el.btnDisconnect.addEventListener('click', () => socket.emit('disconnect-tiktok'));
  if (el.btnRevealHint) el.btnRevealHint.addEventListener('click', () => socket.emit('reveal-hint'));
  if (el.btnNextWord) el.btnNextWord.addEventListener('click', () => socket.emit('next-word'));
  if (el.btnToggleSoftAz) {
    el.btnToggleSoftAz.addEventListener('click', () => socket.emit('toggle-soft-az', { enabled: !(latestState && latestState.softAz) }));
  }
  if (el.btnToggleBots) {
    el.btnToggleBots.addEventListener('click', () => socket.emit('toggle-bots', { enabled: !(latestState && latestState.autoBotDemo) }));
  }
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => socket.emit('set-word-mode', { mode: b.dataset.mode }));
  });
  if (el.btnSendTestWord && el.testWordInput) {
    const sendTest = () => {
      const w = el.testWordInput.value.trim();
      if (!w) return;
      socket.emit('manual-guess', { nickname: 'Aparıcı_Test', word: w });
      el.testWordInput.value = '';
    };
    el.btnSendTestWord.addEventListener('click', sendTest);
    el.testWordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTest(); });
  }

  // Music events
  if (el.btnMusicPlayPause) {
    el.btnMusicPlayPause.addEventListener('click', () => {
      getCtx();
      socket.emit('music-update', { playing: !(musicState && musicState.playing) });
    });
  }
  if (el.btnMusicLoop) {
    el.btnMusicLoop.addEventListener('click', () => socket.emit('music-update', { loop: !(musicState && musicState.loop) }));
  }
  if (el.musicVolume) {
    el.musicVolume.addEventListener('input', () => {
      const v = Number(el.musicVolume.value) / 100;
      if (el.volVal) el.volVal.textContent = `${el.musicVolume.value}%`;
      socket.emit('music-update', { volume: v });
    });
  }
  if (el.chkOverlayMusic) {
    el.chkOverlayMusic.addEventListener('change', () => socket.emit('music-update', { playOnOverlay: el.chkOverlayMusic.checked }));
  }
  document.querySelectorAll('.preset-btn').forEach((b) => {
    b.addEventListener('click', () => {
      getCtx();
      socket.emit('music-update', { sourceType: 'preset', presetId: b.dataset.preset, playing: true });
    });
  });
  if (el.btnApplyMusicUrl && el.musicUrlInput) {
    const applyUrl = () => {
      const url = el.musicUrlInput.value.trim();
      if (!url) return;
      getCtx();
      setUrlHint('⏳ Link qoşulur...');
      socket.emit('music-update', { sourceType: 'url', customUrl: url, playing: true });
    };
    el.btnApplyMusicUrl.addEventListener('click', applyUrl);
    el.musicUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyUrl(); });
  }
  if (el.btnUploadMusic && el.musicFileInput) {
    el.btnUploadMusic.addEventListener('click', () => el.musicFileInput.click());
    el.musicFileInput.addEventListener('change', () => {
      const file = el.musicFileInput.files && el.musicFileInput.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        el.uploadStatus.textContent = '❌ Fayl 20MB-dan böyükdür!';
        return;
      }
      el.uploadStatus.textContent = `⏳ Yüklənir: ${file.name}...`;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const resp = await fetch('/api/music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              mimeType: file.type || 'audio/mpeg',
              dataBase64: reader.result,
              title: file.name.replace(/\.[^.]+$/, '')
            })
          });
          const data = await resp.json();
          if (data.ok) {
            el.uploadStatus.textContent = `✅ Yükləndi: ${file.name}`;
          } else {
            el.uploadStatus.textContent = `❌ Xəta: ${data.error || 'Yüklənmədi'}`;
          }
        } catch (err) {
          el.uploadStatus.textContent = `❌ Xəta: ${err.message}`;
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (el.btnSfxMute) {
    el.btnSfxMute.addEventListener('click', () => {
      sfxMuted = !sfxMuted;
      el.btnSfxMute.textContent = `🔔 Effekt Səsi: ${sfxMuted ? 'BAĞLI' : 'AÇIQ'}`;
    });
  }
  if (el.btnResetScores) el.btnResetScores.addEventListener('click', () => socket.emit('reset-scores'));
  if (el.btnResetCycle) el.btnResetCycle.addEventListener('click', () => socket.emit('reset-word-cycle'));
})();

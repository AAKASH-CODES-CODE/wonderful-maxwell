// DEATHLY SILENCE: Multiplayer 3D Horror Game Engine & Client
// Built with Three.js & Peer-to-Peer WebRTC

const Game = {
  // Network & Lobby States
  peerId: 'P_' + Math.random().toString(36).substring(2, 9),
  playerName: 'Survivor',
  roomCode: 'default',
  isHost: false,
  eventSource: null,
  peers: {}, // id -> { pc, dc, stream, playerMesh, name, volumeNode, audioEl }
  localStream: null,
  micAnalyser: null,
  micVolume: 0,
  micThreshold: 15,
  isMuted: false,
  isMobileDevice: false,
  touchLookId: null,
  joystickTouchId: null,
  joystickVector: new THREE.Vector2(),

  // Three.js Core
  scene: null,
  camera: null,
  renderer: null,
  clock: null,
  lights: {},
  
  // Game Systems
  players: {}, // id -> { name, x, y, z, ry, action, flashlight, health }
  localPlayer: {
    x: 0, y: 1.6, z: 0,
    rx: 0, ry: 0,
    velocity: new THREE.Vector3(),
    onGround: true,
    isCrouching: false,
    heldItem: null, // 'key', 'crowbar', 'code'
    isStunned: false,
    isUnconscious: false
  },
  
  // Controls
  keys: {},
  mouseSensitivity: 0.002,
  isLocked: false,
  
  // Map & Environment
  mapData: [],
  walls: [],
  interactives: [], // { mesh, type, id, state, itemType, distance }
  doors: {}, // doorId -> { mesh, isOpen, hinge, isExitDoor }
  items: {}, // itemId -> { mesh, type, pickedUp, x, y, z }
  exitLocks: {
    padlock: true,   // Requires Brass Key
    code: true,      // Requires Code Note
    planks: true     // Requires Crowbar
  },
  codeSolution: '1984',

  // Granny AI
  granny: {
    mesh: null,
    x: 0, y: 0, z: -10,
    ry: 0,
    state: 'patrol', // 'patrol', 'search', 'chase', 'attack'
    targetPos: new THREE.Vector3(),
    speed: 1.8,
    chaseSpeed: 3.5,
    patrolNodes: [],
    currentNodeIndex: 0,
    sightAngle: 0.8, // Radian vision cone
    sightDistance: 12,
    soundHearingDistance: 15,
    animTime: 0
  },

  // State Management
  gameState: 'menu', // 'menu', 'lobby', 'playing', 'victory', 'caught'

  // Initialize Web Audio and Mic testing
  async setupMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream = stream;
      
      // Setup Analyser
      AudioAssets.init();
      const audioCtx = AudioAssets.ctx;
      const source = audioCtx.createMediaStreamSource(stream);
      this.micAnalyser = audioCtx.createAnalyser();
      this.micAnalyser.fftSize = 256;
      source.connect(this.micAnalyser);
      
      // Enable visualizer & buttons
      document.getElementById('mic-visualizer-container').classList.remove('disabled');
      document.getElementById('btn-go-lobby').removeAttribute('disabled');
      document.getElementById('btn-request-mic').style.display = 'none';
      const skipBtn = document.getElementById('btn-skip-mic');
      if (skipBtn) skipBtn.style.display = 'none';

      // Start drawing test visualizer
      this.drawMicVisualizer();
      console.log("[Mic] Microphone setup successful.");
    } catch (err) {
      alert("Microphone access failed. You can still play by clicking the 'PLAY WITHOUT MIC' button.");
      console.error("[Mic] Error obtaining microphone:", err);
    }
  },

  proceedWithoutMic() {
    this.localStream = null;
    this.micAnalyser = null;
    
    AudioAssets.init(); // Initialize audio context anyway for sound synthesizers!

    document.getElementById('btn-go-lobby').removeAttribute('disabled');
    document.getElementById('btn-request-mic').style.display = 'none';
    const skipBtn = document.getElementById('btn-skip-mic');
    if (skipBtn) skipBtn.style.display = 'none';
    
    const micText = document.getElementById('mic-status-text');
    if (micText) micText.innerText = "MIC DISABLED";
    const micDot = document.getElementById('mic-status-dot');
    if (micDot) {
      micDot.className = "status-dot red";
    }

    console.log("[Mic] Proceeding without microphone.");
  },

  drawMicVisualizer() {
    const canvas = document.getElementById('mic-visualizer');
    const ctx = canvas.getContext('2d');
    const bufferLength = this.micAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      if (this.gameState !== 'menu') return; // Stop drawing when in game to save CPU
      requestAnimationFrame(draw);
      
      this.micAnalyser.getByteFrequencyData(dataArray);
      
      ctx.fillStyle = '#0d0d11';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      this.micVolume = average; // 0 to 255
      
      // Draw volume fill
      const fillWidth = (average / 128) * canvas.width;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, '#0ca678');
      gradient.addColorStop(0.6, '#f59f00');
      gradient.addColorStop(1, '#9c1c1c');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, Math.min(canvas.width, fillWidth), canvas.height);
      
      // Draw threshold line
      const thresholdPct = document.getElementById('mic-threshold').value;
      this.micThreshold = parseFloat(thresholdPct);
      const thresholdX = (this.micThreshold / 100) * canvas.width;
      
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(thresholdX, 0);
      ctx.lineTo(thresholdX, canvas.height);
      ctx.stroke();
    };
    
    draw();
  },

  // Monitor Mic inside Game Loop
  monitorGameVoice() {
    if (!this.micAnalyser || this.localPlayer.isUnconscious) return;
    
    const bufferLength = this.micAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.micAnalyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const volume = sum / bufferLength; // 0 - 255
    const volumePct = Math.min(100, (volume / 80) * 100);
    
    // Update HUD indicator
    const fillEl = document.getElementById('mini-volume-fill');
    if (fillEl) fillEl.style.width = volumePct + '%';
    
    // Trigger noise alert if speaking louder than threshold
    if (volumePct > this.micThreshold) {
      this.triggerPlayerNoise(this.localPlayer.x, this.localPlayer.z, 'voice');
    }
  },

  // Trigger noise alert that travels to Granny
  triggerPlayerNoise(x, z, type = 'footstep') {
    // Show HUD visual indicator briefly
    if (type === 'voice') {
      const warnEl = document.getElementById('noise-warning');
      warnEl.style.display = 'block';
      clearTimeout(this.warnTimeout);
      this.warnTimeout = setTimeout(() => { warnEl.style.display = 'none'; }, 800);
    }
    
    // Send to Host (or process locally if Host)
    if (this.isHost) {
      this.alertGranny(x, z, type);
    } else {
      this.sendNetworkPacket({
        type: 'noise',
        x: x,
        z: z,
        noiseType: type
      });
    }
  },

  alertGranny(x, z, type) {
    if (!this.isHost || !this.granny.mesh) return;
    
    const dist = this.granny.mesh.position.distanceTo(new THREE.Vector3(x, this.granny.mesh.position.y, z));
    const maxHear = type === 'voice' ? this.granny.soundHearingDistance * 1.5 : this.granny.soundHearingDistance;
    
    if (dist < maxHear) {
      console.log(`[Granny AI] Heard ${type} noise at (${x.toFixed(1)}, ${z.toFixed(1)}). Investigating.`);
      
      // Granny switches to searching state if not already chasing a player
      if (this.granny.state !== 'chase' && this.granny.state !== 'attack') {
        this.granny.state = 'search';
        this.granny.targetPos.set(x, this.granny.mesh.position.y, z);
      }
    }
  },

  // ==========================================
  // LOBBY & SSE SIGNALING MANAGEMENT
  // ==========================================
  initLobby() {
    this.playerName = document.getElementById('player-name').value.trim() || 'Survivor';
    
    document.getElementById('setup-panel').classList.remove('active');
    document.getElementById('lobby-panel').classList.add('active');
  },

  registerPeerJS(roomCode, isHost) {
    this.roomCode = roomCode.toUpperCase();
    this.isHost = isHost;

    // Reset local state to clear out old names and peers
    this.peers = {};
    this.players = {};
    this.exitLocks = { padlock: true, code: true, planks: true };
    this.localPlayer.heldItem = null;
    this.localPlayer.isUnconscious = false;

    // Reset DOM elements
    const lobbyList = document.getElementById('connected-players-list');
    if (lobbyList) lobbyList.innerHTML = '';
    const hudList = document.getElementById('hud-players-list');
    if (hudList) hudList.innerHTML = '';
    
    const heldItemLabel = document.getElementById('held-item-name');
    if (heldItemLabel) heldItemLabel.innerText = "EMPTY HANDS";
    const startBtn = document.getElementById('btn-start-game');
    if (startBtn) {
      if (isHost) {
        startBtn.removeAttribute('disabled'); // Allow starting solo to test!
      } else {
        startBtn.setAttribute('disabled', 'true');
      }
    }
    
    document.getElementById('display-room-code').innerText = this.roomCode;
    document.getElementById('hud-room-code').innerText = this.roomCode;

    // Use a unique prefix to prevent conflict on PeerJS public cloud
    const hostPeerId = 'DS-' + this.roomCode;
    const clientPeerId = 'DS-CLI-' + Math.random().toString(36).substring(2, 9);
    
    this.peer = new Peer(isHost ? hostPeerId : clientPeerId);

    this.peer.on('open', (id) => {
      console.log(`[PeerJS] Opened connection with ID: ${id}`);
      this.peerId = id;
      if (!isHost) {
        this.connectToHost();
      }
    });

    this.peer.on('error', (err) => {
      console.error('[PeerJS] Global error:', err);
      if (err.type === 'unavailable-id' && isHost) {
        alert("This Room Code is already active! Please try hosting again with a new code.");
        window.location.reload();
      } else if (err.type === 'peer-not-found') {
        alert("Room not found! Ensure the Host has created the room first.");
        window.location.reload();
      }
    });

    // Accept incoming data connections
    this.peer.on('connection', (conn) => {
      this.setupPeerConnection(conn);
    });

    // Accept incoming voice calls
    this.peer.on('call', (call) => {
      console.log(`[PeerJS] Voice call received from: ${call.peer}`);
      if (this.localStream) {
        call.answer(this.localStream);
      } else {
        call.answer();
      }
      
      call.on('stream', (remoteStream) => {
        this.setupSpatialVoiceFromCall(call.peer, remoteStream);
      });
    });
  },

  connectToHost() {
    const hostId = 'DS-' + this.roomCode;
    console.log(`[PeerJS] Connecting to host peer: ${hostId}`);
    
    const conn = this.peer.connect(hostId, {
      metadata: { name: this.playerName }
    });
    this.setupPeerConnection(conn);

    // Call host for voice
    if (this.localStream) {
      const call = this.peer.call(hostId, this.localStream);
      call.on('stream', (remoteStream) => {
        this.setupSpatialVoiceFromCall(hostId, remoteStream);
      });
    }
  },

  setupPeerConnection(conn) {
    const targetId = conn.peer;
    
    if (!this.peers[targetId]) {
      this.peers[targetId] = {
        conn: conn,
        name: conn.metadata ? conn.metadata.name : 'Survivor',
        playerMesh: null,
        audioEl: null
      };
    } else {
      this.peers[targetId].conn = conn;
    }

    conn.on('open', () => {
      console.log(`[PeerJS] Data channel open with ${targetId}`);
      conn.send({ type: 'greet', name: this.playerName });
    });

    conn.on('data', (data) => {
      this.handleNetworkPacket(targetId, data);
    });

    conn.on('close', () => {
      console.log(`[PeerJS] Connection closed with ${targetId}`);
      this.removePlayerFromLobbyUI(targetId);
      this.cleanupPeer(targetId);
    });
  },

  setupSpatialVoiceFromCall(targetId, stream) {
    console.log(`[PeerJS] Received spatial audio stream from ${targetId}`);
    const audio = new Audio();
    audio.srcObject = stream;
    audio.volume = 0;
    audio.play().catch(e => console.warn("Audio autoplay blocked, requires interaction."));
    
    if (this.peers[targetId]) {
      this.peers[targetId].audioEl = audio;
    }
  },

  updateVoiceChatVolumes() {
    // Scale peer volumes based on distance to local player
    const localPos = new THREE.Vector3(this.localPlayer.x, this.localPlayer.y, this.localPlayer.z);
    
    Object.keys(this.peers).forEach(id => {
      const peer = this.peers[id];
      if (!peer.playerMesh || !peer.audioEl) return;
      
      const dist = peer.playerMesh.position.distanceTo(localPos);
      const maxDistance = 20.0; // Voice dropoff distance
      
      let volume = 0;
      if (dist < maxDistance) {
        // Linear dropoff to 0
        volume = 1.0 - (dist / maxDistance);
        // Exponential feel
        volume = Math.pow(volume, 2);
      }
      
      // Update voice indicator in top right list
      const playerLi = document.getElementById(`hud-p-${id}`);
      if (playerLi) {
        if (volume > 0.05) {
          playerLi.classList.add('speaker-active');
        } else {
          playerLi.classList.remove('speaker-active');
        }
      }
      
      peer.audioEl.volume = volume * 0.9; // max 90% volume
    });
  },

  cleanupPeer(id) {
    const peer = this.peers[id];
    if (peer) {
      if (peer.conn) peer.conn.close();
      if (peer.audioEl) {
        peer.audioEl.pause();
        peer.audioEl.remove();
      }
      // Remove visual mesh from scene
      if (peer.playerMesh) {
        this.scene.remove(peer.playerMesh);
      }
      delete this.peers[id];
    }
    delete this.players[id];
    
    // Update HUD players
    this.updateHUDPlayersList();
  },

  // ==========================================
  // STATE SYNCING & NETWORK PACKETS
  // ==========================================
  sendNetworkPacket(packet) {
    Object.values(this.peers).forEach(peer => {
      if (peer.conn && peer.conn.open) {
        peer.conn.send(packet);
      }
    });
  },

  handleNetworkPacket(senderId, packet) {
    const peer = this.peers[senderId];
    if (!peer) return;

    if (packet.type === 'start') {
      this.startGame();
      return;
    }

    if (packet.type === 'victory_reached' && this.isHost) {
      this.triggerVictory(true);
      return;
    }

    if (packet.type === 'lobby_players') {
      console.log(`[Network] Connected to room ${packet.roomCode}. Lobby players:`, packet.players);
      document.getElementById('display-room-code').innerText = packet.roomCode;
      document.getElementById('hud-room-code').innerText = packet.roomCode;
      
      this.updateLobbyList(packet.players);
      
      packet.players.forEach(p => {
        if (p.id !== this.peer.id && !this.peers[p.id]) {
          const conn = this.peer.connect(p.id, { metadata: { name: this.playerName } });
          this.setupPeerConnection(conn);

          if (this.localStream) {
            const call = this.peer.call(p.id, this.localStream);
            call.on('stream', (remoteStream) => {
              this.setupSpatialVoiceFromCall(p.id, remoteStream);
            });
          }
        }
      });
      return;
    }

    if (packet.type === 'peer_joined') {
      console.log(`[Network] Player preparing to join: ${packet.name} (${packet.id})`);
      this.addPlayerToLobbyUI(packet.id, packet.name);
      
      this.players[packet.id] = {
        name: packet.name,
        x: 0, y: 1.6, z: 0,
        ry: 0,
        action: 'idle',
        flashlight: false
      };
      
      this.createRemotePlayerMesh(packet.id, packet.name);
      this.updateHUDPlayersList();
      return;
    }

    if (packet.type === 'greet') {
      peer.name = packet.name;
      this.players[senderId] = {
        name: packet.name,
        x: 0, y: 1.6, z: 0,
        ry: 0,
        action: 'idle',
        flashlight: false
      };
      
      // Update lobby UI list with actual player name
      this.addPlayerToLobbyUI(senderId, packet.name);

      if (this.isHost) {
        // Send list of current players in room to this new client
        const existing = [];
        Object.keys(this.peers).forEach(id => {
          if (id !== senderId) {
            existing.push({ id: id, name: this.peers[id].name });
          }
        });
        // Add Host
        existing.push({ id: this.peer.id, name: this.playerName });
        
        peer.conn.send({
          type: 'lobby_players',
          roomCode: this.roomCode,
          players: existing
        });

        // Notify other clients about the new peer
        this.sendNetworkPacket({
          type: 'peer_joined',
          id: senderId,
          name: packet.name
        });
      }

      // Create 3D capsule mesh for remote player
      this.createRemotePlayerMesh(senderId, packet.name);
      this.updateHUDPlayersList();
      return;
    }

    if (packet.type === 'move') {
      // Sync coordinates
      const p = this.players[senderId];
      if (p) {
        p.x = packet.x;
        p.y = packet.y;
        p.z = packet.z;
        p.ry = packet.ry;
        p.action = packet.action;
        p.flashlight = packet.flashlight;

        // Update 3D mesh
        if (peer.playerMesh) {
          peer.playerMesh.position.set(packet.x, packet.y - 0.8, packet.z);
          peer.playerMesh.rotation.y = packet.ry;
          
          // Flashlight sync
          const spot = peer.playerMesh.getObjectByName('flashlight');
          if (spot) spot.visible = packet.flashlight;
        }
      }
      return;
    }

    if (packet.type === 'noise' && this.isHost) {
      // Alert AI Granny
      this.alertGranny(packet.x, packet.z, packet.noiseType);
      return;
    }

    if (packet.type === 'interact') {
      this.handleInteractEvent(packet.interactId, packet.itemType, senderId);
      return;
    }

    if (packet.type === 'sync' && !this.isHost) {
      // CLIENT RECEIVES GAME STATE FROM HOST
      // 1. Sync Granny
      if (this.granny.mesh) {
        this.granny.mesh.position.set(packet.granny.x, packet.granny.y, packet.granny.z);
        this.granny.mesh.rotation.y = packet.granny.ry;
        this.granny.state = packet.granny.state;
      }

      // 2. Sync Items
      Object.keys(packet.items).forEach(id => {
        const itemState = packet.items[id];
        const item = this.items[id];
        if (item) {
          item.pickedUp = itemState.pickedUp;
          if (itemState.pickedUp) {
            item.mesh.visible = false;
          } else {
            item.mesh.visible = true;
            if (itemState.x !== undefined) {
              item.mesh.position.set(itemState.x, itemState.y, itemState.z);
            }
          }
        }
      });

      // 3. Sync Doors
      Object.keys(packet.doors).forEach(id => {
        const doorState = packet.doors[id];
        const door = this.doors[id];
        if (door && door.isOpen !== doorState.isOpen) {
          door.isOpen = doorState.isOpen;
          // Animate door rotate
          this.animateDoor(id, doorState.isOpen);
        }
      });

      // 4. Sync Exit Locks
      this.exitLocks = packet.locks;
      this.updateHUDObjectiveList();
      
      // 5. Check Game Over
      if (packet.victory) {
        this.triggerVictory(false);
      }
      return;
    }

    if (packet.type === 'attacked') {
      if (packet.playerId === this.peerId) {
        this.triggerLocalKnockout();
      } else {
        // Put remote player in knocked out pose or hide
        const remotePeer = this.peers[packet.playerId];
        if (remotePeer && remotePeer.playerMesh) {
          remotePeer.playerMesh.visible = false;
          setTimeout(() => { remotePeer.playerMesh.visible = true; }, 5000);
        }
      }
      return;
    }
  },

  // ==========================================
  // LOBBY UI UTILITIES
  // ==========================================
  updateLobbyList(playersList) {
    const list = document.getElementById('connected-players-list');
    list.innerHTML = '';
    
    // Add self
    const selfLi = document.createElement('li');
    selfLi.innerText = `${this.playerName} (YOU)`;
    selfLi.style.borderLeftColor = 'var(--green-accent)';
    list.appendChild(selfLi);

    playersList.forEach(p => {
      const li = document.createElement('li');
      li.innerText = p.name;
      list.appendChild(li);
    });
  },

  addPlayerToLobbyUI(id, name) {
    const list = document.getElementById('connected-players-list');
    if (!list) return;
    
    // check if already listed, if so update the name text (greet packet update)
    let li = document.getElementById(`lobby-p-${id}`);
    if (li) {
      li.innerText = name;
      return;
    }
    
    li = document.createElement('li');
    li.id = `lobby-p-${id}`;
    li.innerText = name;
    list.appendChild(li);
    
    // Host controls enable
    if (this.isHost && this.gameState === 'lobby') {
      const startBtn = document.getElementById('btn-start-game');
      if (startBtn) startBtn.removeAttribute('disabled');
    }
  },

  removePlayerFromLobbyUI(id) {
    const li = document.getElementById(`lobby-p-${id}`);
    if (li) li.remove();
  },

  updateHUDPlayersList() {
    const hudList = document.getElementById('hud-players-list');
    if (!hudList) return;
    hudList.innerHTML = '';

    // Add self
    const selfLi = document.createElement('li');
    selfLi.innerHTML = `<span>👤 ${this.playerName}</span>`;
    hudList.appendChild(selfLi);

    // Add peers
    Object.keys(this.peers).forEach(id => {
      const peer = this.peers[id];
      const li = document.createElement('li');
      li.id = `hud-p-${id}`;
      li.innerHTML = `<span>👤 ${peer.name}</span> <span class="voice-ico">🎤</span>`;
      hudList.appendChild(li);
    });
  },

  updateHUDObjectiveList() {
    const p = document.getElementById('obj-padlock');
    const c = document.getElementById('obj-code');
    const pl = document.getElementById('obj-planks');

    if (!p) return;

    if (!this.exitLocks.padlock) { p.innerText = '🔓 Padlock Unlocked'; p.classList.add('done'); }
    if (!this.exitLocks.code) { c.innerText = '📟 Code Correct'; c.classList.add('done'); }
    if (!this.exitLocks.planks) { pl.innerText = '🚧 Wooden Planks Removed'; pl.classList.add('done'); }
  },

  // ==========================================
  // HOST GAME START TRIGGER
  // ==========================================
  hostStartGame() {
    this.sendNetworkPacket({ type: 'start' });
    this.startGame();
  },

  // ==========================================
  // 3D GAME GRAPHICS & MECHANICS
  // ==========================================
  startGame() {
    this.gameState = 'playing';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('game-hud').style.display = 'block';
    
    // Initialize procedural audio heartbeat (Temporarily disabled for map design)
    // AudioAssets.startHeartbeat();
    AudioAssets.setHeartbeatBpm(60);

    // Initialize clock
    this.clock = new THREE.Clock();

    // 1. Build Scene
    this.initThree();
    
    // 2. Build Spooky House
    this.buildHouseMap();

    // 3. Spawn Items
    this.spawnEscapeItems();

    // 4. Create local flashlight
    this.setupFlashlight();

    // 5. Initialize Granny (Temporarily commented out to disable Granny)
    /*
    if (this.isHost) {
      this.spawnGrannyAI();
    } else {
      // Clients spawn dummy Granny mesh that gets synced
      this.spawnGrannyVisualDummy();
    }
    */

    // 6. Request Pointer Lock (Only on Desktop)
    this.detectAndSetupMobile();
    if (!this.isMobileDevice) {
      this.lockPointer();
    }

    // 7. Update player lists
    this.updateHUDPlayersList();
    this.updateHUDObjectiveList();

    // 8. Start loop
    this.animate();
  },

  detectAndSetupMobile() {
    // Detect mobile touch devices or small screens
    this.isMobileDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth < 1024);
    
    if (this.isMobileDevice) {
      document.getElementById('mobile-controls').style.display = 'block';
      this.setupMobileControls();
    }
  },

  setupMobileControls() {
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    
    // Get base position info
    let baseRect = base.getBoundingClientRect();
    let centerX = baseRect.left + baseRect.width / 2;
    let centerY = baseRect.top + baseRect.height / 2;
    let maxRadius = baseRect.width / 2;

    // Refresh layout center on resize
    window.addEventListener('resize', () => {
      baseRect = base.getBoundingClientRect();
      centerX = baseRect.left + baseRect.width / 2;
      centerY = baseRect.top + baseRect.height / 2;
      maxRadius = baseRect.width / 2;
    });

    // Joystick touch movement handling
    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.targetTouches[0];
      this.joystickTouchId = touch.identifier;
      this.updateJoystick(touch, centerX, centerY, maxRadius, knob);
    });

    base.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === this.joystickTouchId) {
          this.updateJoystick(e.touches[i], centerX, centerY, maxRadius, knob);
        }
      }
    });

    const resetJoystick = () => {
      this.joystickTouchId = null;
      this.joystickVector.set(0, 0);
      knob.style.transform = 'translate(-50%, -50%)';
    };
    
    base.addEventListener('touchend', resetJoystick);
    base.addEventListener('touchcancel', resetJoystick);

    // Screen swiping for camera rotation
    const canvasContainer = document.getElementById('game-canvas-container');
    let prevTouchX = 0;
    let prevTouchY = 0;
    
    canvasContainer.addEventListener('touchstart', (e) => {
      const touch = e.changedTouches[0];
      // Do not rotate camera if touch is in the bottom-left joystick quadrant
      if (touch.clientX < window.innerWidth / 2 && touch.clientY > window.innerHeight / 2) return;
      
      this.touchLookId = touch.identifier;
      prevTouchX = touch.clientX;
      prevTouchY = touch.clientY;
    });

    canvasContainer.addEventListener('touchmove', (e) => {
      if (this.touchLookId === null) return;
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (touch.identifier === this.touchLookId) {
          const deltaX = touch.clientX - prevTouchX;
          const deltaY = touch.clientY - prevTouchY;
          
          this.localPlayer.ry -= deltaX * 0.006;
          this.localPlayer.rx -= deltaY * 0.006; // Restore normal Y-axis look with YXZ rotation order
          this.localPlayer.rx = Math.max(-Math.PI/2.5, Math.min(Math.PI/2.5, this.localPlayer.rx));
          
          this.camera.rotation.set(0, 0, 0);
          this.camera.rotation.y = this.localPlayer.ry;
          this.camera.rotation.x = this.localPlayer.rx;
          
          prevTouchX = touch.clientX;
          prevTouchY = touch.clientY;
        }
      }
    });

    canvasContainer.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.touchLookId) {
          this.touchLookId = null;
        }
      }
    });

    // Bind Mobile Action Buttons
    document.getElementById('btn-mobile-flashlight').addEventListener('click', () => {
      this.handleKeyDown('KeyF');
    });

    document.getElementById('btn-mobile-crouch').addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.keys['KeyC'] = !this.keys['KeyC'];
    });

    document.getElementById('btn-mobile-interact').addEventListener('click', () => {
      this.performInteraction();
    });
  },

  updateJoystick(touch, centerX, centerY, maxRadius, knob) {
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }
    
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    
    // Normalize movement vectors
    this.joystickVector.set(dx / maxRadius, -dy / maxRadius);
  },

  initThree() {
    const container = document.getElementById('game-canvas-container');
    
    this.scene = new THREE.Scene();
    
    // Spooky dense exponential fog - reduced density so players can see clearly
    this.scene.background = new THREE.Color(0x050507);
    this.scene.fog = new THREE.FogExp2(0x050507, 0.025); // Thinner fog for better visibility

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ'; // Set rotation order to YXZ to prevent tilting/roll and pitch inversion
    
    // Start position: in bedroom (living area helper)
    this.camera.position.set(0, 1.6, 6);
    this.localPlayer.x = 0;
    this.localPlayer.y = 1.6;
    this.localPlayer.z = 6;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    // Ambient light - slightly brighter so rooms are visible
    const ambient = new THREE.AmbientLight(0x555566, 1.2); // Brighter ambient light
    this.scene.add(ambient);

    // Handle resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Keyboard handlers
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; this.handleKeyDown(e.code); });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  },

  lockPointer() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = (document.pointerLockElement === canvas);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked || this.localPlayer.isUnconscious) return;

      // Rotate camera
      this.localPlayer.ry -= e.movementX * this.mouseSensitivity;
      this.localPlayer.rx -= e.movementY * this.mouseSensitivity; // Restore normal Y-axis look with YXZ rotation order

      // Clamp vertical look
      this.localPlayer.rx = Math.max(-Math.PI/2.5, Math.min(Math.PI/2.5, this.localPlayer.rx));

      this.camera.rotation.set(0, 0, 0); // Reset
      this.camera.rotation.y = this.localPlayer.ry;
      this.camera.rotation.x = this.localPlayer.rx;
    });
  },

  handleKeyDown(code) {
    if (code === 'KeyF') {
      // Toggle flashlight
      const light = this.lights.flashlight;
      if (light) {
        light.visible = !light.visible;
        AudioAssets.playClick();
        document.getElementById('slot-flashlight').classList.toggle('active', light.visible);
      }
    }
    
    if (code === 'KeyE') {
      this.performInteraction();
    }
  },

  setupFlashlight() {
    const spot = new THREE.SpotLight(0xfff8e7, 6.0, 32, Math.PI / 4, 0.8, 1.0); // Boosted range, intensity, and cone
    spot.castShadow = true;
    spot.shadow.mapSize.width = 512;
    spot.shadow.mapSize.height = 512;
    spot.shadow.camera.near = 0.5;
    spot.shadow.camera.far = 20;
    
    // Add light to camera so it moves with vision
    this.camera.add(spot);
    this.camera.add(spot.target);
    spot.target.position.set(0, 0, -1);
    this.scene.add(this.camera);
    
    this.lights.flashlight = spot;
    document.getElementById('slot-flashlight').classList.add('active');
  },

  // ==========================================
  // BUILDING THE 3D MAP
  // ==========================================
  buildHouseMap() {
    this.mapDataFloor0 = [
      [1, 1, 1, 1, 1, 1, 3, 1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 5, 1],
      [1, 0, 6, 0, 1, 0, 1, 1, 0, 1],
      [1, 0, 0, 0, 2, 0, 2, 0, 0, 1],
      [1, 1, 2, 1, 1, 0, 1, 1, 2, 1],
      [1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
      [1, 0, 5, 0, 2, 0, 1, 0, 6, 1],
      [1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
      [1, 1, 1, 1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    ];

    this.mapDataFloor1 = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 5, 1],
      [1, 0, 0, 0, 1, 0, 1, 1, 0, 1],
      [1, 0, 0, 0, 2, 0, 2, 0, 0, 1],
      [1, 1, 2, 1, 1, 0, 1, 1, 2, 1],
      [1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
      [1, 0, 5, 0, 2, 0, 1, 0, 0, 1],
      [1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
      [1, 1, 1, 1, 1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    ];

    // Load textures
    const textureLoader = new THREE.TextureLoader();
    this.wallTexture = textureLoader.load('wall_texture.png');
    this.wallTexture.wrapS = THREE.RepeatWrapping;
    this.wallTexture.wrapT = THREE.RepeatWrapping;
    this.wallTexture.repeat.set(1, 1);

    this.doorTexture = textureLoader.load('door_texture.png');

    const wallGeo = new THREE.BoxGeometry(4, 4, 0.3);
    const wallMat = new THREE.MeshStandardMaterial({ 
      map: this.wallTexture, 
      roughness: 0.9, 
      metalness: 0.1 
    });
    
    const floorGeo = new THREE.BoxGeometry(40, 0.2, 40);
    const floorMat = new THREE.MeshStandardMaterial({ 
      color: 0x181212, 
      roughness: 0.8 
    });
    
    const ceilingGeo = new THREE.BoxGeometry(40, 0.2, 40);
    const ceilingMat = new THREE.MeshStandardMaterial({ 
      color: 0x0c0808, 
      roughness: 0.9 
    });

    this.walkableObjects = [];

    // Floor Mesh (Ground Floor)
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, -0.1, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.walkableObjects.push(floor);

    // First floor tiles (placed at y = 3.9 so top matches y = 4.0)
    // Omit Column 5, Row 8 for the stairs hole
    const tileGeo = new THREE.BoxGeometry(4, 0.2, 4);
    const cellSize = 4;
    const offset = -20 + cellSize/2; // -18 starting point

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (r === 8 && c === 5) continue; // Staircase hole
        
        const x = offset + c * cellSize;
        const z = offset + r * cellSize;
        const tile = new THREE.Mesh(tileGeo, floorMat);
        tile.position.set(x, 3.9, z);
        tile.receiveShadow = true;
        this.scene.add(tile);
        this.walkableObjects.push(tile);
      }
    }

    // Ceiling Mesh (above Floor 1)
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.position.set(0, 8.0, 0);
    this.scene.add(ceiling);

    // Build Ground Floor walls & elements (height 0 to 4)
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const val = this.mapDataFloor0[r][c];
        const x = offset + c * cellSize;
        const z = offset + r * cellSize;

        if (val === 1) {
          const wall = new THREE.Mesh(wallGeo, wallMat);
          wall.position.set(x, 2, z);
          wall.castShadow = true;
          wall.receiveShadow = true;
          wall.userData.isCollisionWall = true;
          this.scene.add(wall);
        } 
        else if (val === 2) {
          this.createDoor(r + '_' + c, x, z, false, 0.0);
        }
        else if (val === 3) {
          this.createDoor('exit', x, z, true, 0.0);
        }
        else if (val === 5) {
          this.createDrawerCabinet(r + '_' + c, x, z, 0.0);
        }
        else if (val === 6) {
          this.createTable(x, z, 0.0);
        }
      }
    }

    // Build First Floor walls & elements (height 4 to 8)
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const val = this.mapDataFloor1[r][c];
        const x = offset + c * cellSize;
        const z = offset + r * cellSize;

        if (val === 1) {
          const wall = new THREE.Mesh(wallGeo, wallMat);
          wall.position.set(x, 6, z); // center y = 6 (ranges from 4 to 8)
          wall.castShadow = true;
          wall.receiveShadow = true;
          wall.userData.isCollisionWall = true;
          this.scene.add(wall);
        } 
        else if (val === 2) {
          this.createDoor('f1_' + r + '_' + c, x, z, false, 4.0);
        }
        else if (val === 5) {
          this.createDrawerCabinet('f1_' + r + '_' + c, x, z, 4.0);
        }
      }
    }

    // Build Staircase (Column 5, Row 8 to 7, going from z = 16 to z = 8, y = 0 to y = 4)
    const stairX = 2;
    const stepsCount = 12;
    const stairZStart = 16;
    const stairZEnd = 8;
    const stepWidth = 3.2;
    const stepHeight = 0.25;
    const stepDepth = 0.75;
    const stairMat = new THREE.MeshStandardMaterial({ color: 0x3d281a, roughness: 0.9 });

    for (let i = 0; i < stepsCount; i++) {
      const t = i / (stepsCount - 1);
      const stepY = t * 4.0;
      const stepZ = stairZStart - t * (stairZStart - stairZEnd);

      const stepGeo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
      const step = new THREE.Mesh(stepGeo, stairMat);
      step.position.set(stairX, stepY - stepHeight / 2, stepZ);
      step.castShadow = true;
      step.receiveShadow = true;
      this.scene.add(step);
      this.walkableObjects.push(step);
    }

    // Set patrol nodes for Granny based on empty cells
    this.granny.patrolNodes = [
      new THREE.Vector3(-14, 0.8, -14),
      new THREE.Vector3(14, 0.8, -14),
      new THREE.Vector3(14, 0.8, 2),
      new THREE.Vector3(-6, 0.8, 2),
      new THREE.Vector3(-14, 0.8, 14),
      new THREE.Vector3(14, 0.8, 14)
    ];
  },

  createDoor(id, x, z, isExit = false, yOffset = 0.0) {
    const hinge = new THREE.Group();
    hinge.position.set(x - 2, yOffset, z); // pivot at left edge
    
    const doorGeo = new THREE.BoxGeometry(3.8, 3.2, 0.15);
    const doorMat = new THREE.MeshStandardMaterial({ 
      map: this.doorTexture,
      color: isExit ? 0x6e1b1b : 0xffffff, 
      roughness: 0.8 
    });
    
    const doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.set(1.9, 1.6, 0); // Shift so hinge rotates left edge
    doorMesh.castShadow = true;
    doorMesh.receiveShadow = true;
    hinge.add(doorMesh);
    
    // Visual handle
    const handleGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xc4a429, metalness: 0.8, roughness: 0.2 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(3.4, 1.5, 0.1);
    hinge.add(handle);
 
    // If main exit door, visually add barricade planks, padlock chain
    if (isExit) {
      // Wood plank
      const plankGeo = new THREE.BoxGeometry(3.2, 0.3, 0.15);
      const plankMat = new THREE.MeshStandardMaterial({ color: 0x54361c, roughness: 0.9 });
      const plank = new THREE.Mesh(plankGeo, plankMat);
      plank.name = 'plank';
      plank.position.set(1.9, 1.8, 0.2);
      hinge.add(plank);
 
      // Padlock
      const padlockGeo = new THREE.BoxGeometry(0.25, 0.3, 0.1);
      const padlockMat = new THREE.MeshStandardMaterial({ color: 0xdcae1d, metalness: 0.8 });
      const padlock = new THREE.Mesh(padlockGeo, padlockMat);
      padlock.name = 'padlock';
      padlock.position.set(1.9, 1.3, 0.2);
      hinge.add(padlock);
    }
 
    this.scene.add(hinge);
    
    this.doors[id] = {
      mesh: hinge,
      isOpen: false,
      isExit: isExit,
      x, z,
      yOffset
    };
 
    // Add to interactives raycast target
    this.interactives.push({
      mesh: doorMesh,
      type: 'door',
      id: id,
      distance: 3.5
    });
 
    // Add box to physics walls (only if door is shut)
    const box = new THREE.Box3().setFromObject(doorMesh);
    this.walls.push(box);
  },
 
  createDrawerCabinet(id, x, z, yOffset = 0.0) {
    const cabinet = new THREE.Group();
    cabinet.position.set(x, yOffset, z);
 
    const frameGeo = new THREE.BoxGeometry(2, 2.5, 1.5);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d281a, roughness: 0.9 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 1.25, 0);
    frame.castShadow = true;
    frame.userData.isCollisionWall = true;
    cabinet.add(frame);
 
    // Interactive drawer face
    const drawerGeo = new THREE.BoxGeometry(1.8, 0.8, 1.4);
    const drawerMat = new THREE.MeshStandardMaterial({ color: 0x5e3f2b, roughness: 0.8 });
    const drawer = new THREE.Mesh(drawerGeo, drawerMat);
    drawer.name = 'drawer_slide';
    drawer.position.set(0, 0.6, 0.1); // slightly forward
    drawer.castShadow = true;
    cabinet.add(drawer);
 
    const handleGeo = new THREE.BoxGeometry(0.4, 0.1, 0.1);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x000, metalness: 0.6 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, 0.6, 0.85);
    cabinet.add(handle);
 
    this.scene.add(cabinet);
 
    this.interactives.push({
      mesh: drawer,
      type: 'drawer',
      id: id,
      state: 'closed', // 'closed', 'open'
      group: cabinet
    });
 
    // Add collision block
    this.walls.push(new THREE.Box3().setFromObject(frame));
  },
 
  createTable(x, z, yOffset = 0.0) {
    const table = new THREE.Group();
    table.position.set(x, yOffset, z);
 
    const topGeo = new THREE.BoxGeometry(2.5, 0.15, 1.5);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x473224 });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(0, 1.0, 0);
    top.castShadow = true;
    top.userData.isCollisionWall = true;
    table.add(top);
 
    // Leg mesh
    const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 1.0);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2d1d14 });
    
    const offsets = [
      [-1.1, -0.6], [1.1, -0.6],
      [-1.1, 0.6], [1.1, 0.6]
    ];
    offsets.forEach(off => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(off[0], 0.5, off[1]);
      leg.castShadow = true;
      table.add(leg);
    });
 
    this.scene.add(table);
    this.walls.push(new THREE.Box3().setFromObject(top));
  },

  // ==========================================
  // SPAWNING GAME ESCAPE ITEMS
  // ==========================================
  spawnEscapeItems() {
    // Spawns items at pre-defined search drawer locations (some on Floor 0, some on Floor 1)
    const spawnPoints = [
      { x: -14, y: 1.2, z: -14, id: 'key' },
      { x: 14, y: 5.2, z: 2, id: 'crowbar' }, // Floor 1
      { x: -6, y: 5.2, z: 6, id: 'code' }   // Floor 1
    ];

    // Shuffle spawn points slightly if host
    if (this.isHost) {
      spawnPoints.sort(() => Math.random() - 0.5);
    }

    // 1. Brass Key (Yellow)
    const keyLoc = spawnPoints[0];
    const keyGroup = new THREE.Group();
    keyGroup.position.set(keyLoc.x, keyLoc.y - 0.7, keyLoc.z);
    
    const ringGeo = new THREE.TorusGeometry(0.12, 0.04, 8, 16);
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xdcae1d, metalness: 0.8, roughness: 0.2 });
    const ring = new THREE.Mesh(ringGeo, metalMat);
    ring.rotation.x = Math.PI / 2;
    keyGroup.add(ring);

    const shaftGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4);
    const shaft = new THREE.Mesh(shaftGeo, metalMat);
    shaft.position.set(0, 0, -0.2);
    shaft.rotation.x = Math.PI / 2;
    keyGroup.add(shaft);

    this.scene.add(keyGroup);
    this.items['key'] = { mesh: keyGroup, type: 'key', pickedUp: false, x: keyLoc.x, y: keyLoc.y - 0.7, z: keyLoc.z };
    this.interactives.push({ mesh: ring, type: 'item', id: 'key', itemType: 'Brass Key' });

    // 2. Crowbar (Blue metal)
    const barLoc = spawnPoints[1];
    const barGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x1f5f8a, metalness: 0.9, roughness: 0.3 });
    const barMesh = new THREE.Mesh(barGeo, barMat);
    barMesh.position.set(barLoc.x, barLoc.y - 0.8, barLoc.z);
    barMesh.rotation.z = Math.PI / 4;
    this.scene.add(barMesh);
    
    this.items['crowbar'] = { mesh: barMesh, type: 'crowbar', pickedUp: false, x: barLoc.x, y: barLoc.y - 0.8, z: barLoc.z };
    this.interactives.push({ mesh: barMesh, type: 'item', id: 'crowbar', itemType: 'Crowbar' });

    // 3. Code Note (Paper flat plane)
    const noteLoc = spawnPoints[2];
    const noteGeo = new THREE.PlaneGeometry(0.3, 0.4);
    const noteMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, side: THREE.DoubleSide, roughness: 1.0 });
    const noteMesh = new THREE.Mesh(noteGeo, noteMat);
    noteMesh.position.set(noteLoc.x, noteLoc.y - 0.6, noteLoc.z);
    noteMesh.rotation.x = Math.PI / 2;
    this.scene.add(noteMesh);

    this.items['code'] = { mesh: noteMesh, type: 'code', pickedUp: false, x: noteLoc.x, y: noteLoc.y - 0.6, z: noteLoc.z };
    this.interactives.push({ mesh: noteMesh, type: 'item', id: 'code', itemType: 'Code Note' });
  },

  createRemotePlayerMesh(id, name) {
    const group = new THREE.Group();
    
    // Torso (Spooky grey raincoat cylinder)
    const bodyGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.6, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a5a66, roughness: 0.9 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Mask / Head (Creepy white sphere)
    const headGeo = new THREE.SphereGeometry(0.35, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.7;
    group.add(head);

    // Glowing white eyes
    const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.12, 1.75, 0.28);
    group.add(eyeL);

    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.12, 1.75, 0.28);
    group.add(eyeR);

    // Sync Spotlight for flashlight
    const spot = new THREE.SpotLight(0xfff8e7, 3.0, 22, Math.PI / 4, 0.8, 1.0); // Boosted remote player spotlight
    spot.name = 'flashlight';
    spot.position.set(0, 1.4, 0.2);
    spot.visible = false;
    group.add(spot);
    
    const target = new THREE.Object3D();
    target.position.set(0, 1.4, 5);
    group.add(target);
    spot.target = target;

    this.scene.add(group);
    this.peers[id].playerMesh = group;
  },

  // ==========================================
  // GRANNY AI IMPLEMENTATION (HOST ONLY)
  // ==========================================
  spawnGrannyAI() {
    const group = new THREE.Group();
    group.position.set(this.granny.x, 0.8, this.granny.z);

    // Granny Gown (cylinder)
    const bodyGeo = new THREE.CylinderGeometry(0.4, 0.7, 1.8, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x42403b, roughness: 1.0 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);

    // Scary Pale Head
    const headGeo = new THREE.SphereGeometry(0.38, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x757a6b, roughness: 0.9 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.95;
    group.add(head);

    // Glowing blood-red eyes
    const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.12, 2.05, 0.32);
    group.add(eyeL);
    
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.12, 2.05, 0.32);
    group.add(eyeR);

    // A wooden bat weapon (capsule)
    const batGeo = new THREE.CylinderGeometry(0.08, 0.05, 1.2);
    const batMat = new THREE.MeshStandardMaterial({ color: 0x2b1a0d, roughness: 0.9 });
    const bat = new THREE.Mesh(batGeo, batMat);
    bat.name = 'bat';
    bat.position.set(0.6, 1.0, 0.4);
    bat.rotation.x = Math.PI / 4;
    group.add(bat);

    this.scene.add(group);
    this.granny.mesh = group;
  },

  spawnGrannyVisualDummy() {
    this.spawnGrannyAI(); // Same geometry, but positioning is updated via host packets
  },

  updateGrannyAI(delta) {
    if (!this.isHost || !this.granny.mesh) return;

    try {
      const grannyPos = this.granny.mesh.position;
      
      // Check line of sight to players
      let visiblePlayer = null;
      let closestDist = Infinity;

      // 1. Check local player
      const localVec = new THREE.Vector3(this.localPlayer ? this.localPlayer.x : 0, grannyPos.y, this.localPlayer ? this.localPlayer.z : 0);
      let distLocal = grannyPos.distanceTo(localVec);
      
      if (this.localPlayer && distLocal < this.granny.sightDistance && !this.localPlayer.isUnconscious) {
        if (this.checkLineOfSight(grannyPos, localVec)) {
          visiblePlayer = { pos: localVec, id: this.peerId };
          closestDist = distLocal;
        }
      }

      // 2. Check remote peers
      Object.keys(this.peers).forEach(id => {
        const peer = this.peers[id];
        if (!peer.playerMesh || !this.players[id] || this.players[id].isUnconscious) return;
        
        const peerVec = new THREE.Vector3(peer.playerMesh.position.x, grannyPos.y, peer.playerMesh.position.z);
        const dist = grannyPos.distanceTo(peerVec);
        
        if (dist < this.granny.sightDistance && dist < closestDist) {
          if (this.checkLineOfSight(grannyPos, peerVec)) {
            visiblePlayer = { pos: peerVec, id: id };
            closestDist = dist;
          }
        }
      });

      // Handle states
      if (visiblePlayer) {
        // Switch to chasing
        if (this.granny.state !== 'chase') {
          // Play stinger or scream dynamically
          AudioAssets.playJumpscare();
        }
        this.granny.state = 'chase';
        this.granny.targetPos.copy(visiblePlayer.pos);
        
        // Heartbeat pulse speedup for nearby local player
        if (visiblePlayer.id === this.peerId) {
          const speedPct = Math.max(0, 1 - (distLocal / 12));
          AudioAssets.setHeartbeatBpm(60 + speedPct * 90); // upto 150 bpm!
          const hbVig = document.getElementById('heartbeat-vignette');
          if (hbVig) hbVig.classList.add('danger');
        }
      } else {
        if (this.granny.state === 'chase') {
          // Lost player, search last known position
          this.granny.state = 'search';
        }
        
        // Standard slow heartbeat
        AudioAssets.setHeartbeatBpm(60);
        const hbVig = document.getElementById('heartbeat-vignette');
        if (hbVig) hbVig.classList.remove('danger');
      }

      // Move towards target
      let speed = this.granny.state === 'chase' ? this.granny.chaseSpeed : this.granny.speed;
      let target = this.granny.targetPos;

      if (this.granny.state === 'patrol') {
        // Pick patrol nodes
        if (this.granny.patrolNodes && this.granny.patrolNodes.length > 0) {
          target = this.granny.patrolNodes[this.granny.currentNodeIndex];
          const distToNode = grannyPos.distanceTo(target);
          if (distToNode < 1.0) {
            this.granny.currentNodeIndex = (this.granny.currentNodeIndex + 1) % this.granny.patrolNodes.length;
          }
        }
      } else if (this.granny.state === 'search') {
        const distToSearch = grannyPos.distanceTo(target);
        if (distToSearch < 1.0) {
          // Finished searching noise source, return to patrol
          this.granny.state = 'patrol';
        }
      }

      // Simple pathing towards target - secure against NaN divide-by-zero
      const distToTarget = grannyPos.distanceTo(target);
      if (distToTarget > 0.05) {
        const dir = new THREE.Vector3().subVectors(target, grannyPos).normalize();
        grannyPos.addScaledVector(dir, Math.min(distToTarget, speed * delta));
        
        // Rotate to face direction of travel
        if (dir.lengthSq() > 0.01) {
          const angle = Math.atan2(dir.x, dir.z);
          this.granny.mesh.rotation.y = angle;
          this.granny.ry = angle;
        }
      }

      // Sync coordinates
      this.granny.x = grannyPos.x;
      this.granny.y = grannyPos.y;
      this.granny.z = grannyPos.z;

      // Check hit condition
      const attackRange = 1.5;
      if (this.localPlayer && distLocal < attackRange && !this.localPlayer.isUnconscious) {
        this.grannyTriggerAttack(this.peerId);
      }
      Object.keys(this.peers).forEach(id => {
        const peer = this.peers[id];
        if (peer.playerMesh && this.players[id] && !this.players[id].isUnconscious) {
          const d = grannyPos.distanceTo(peer.playerMesh.position);
          if (d < attackRange) {
            this.grannyTriggerAttack(id);
          }
        }
      });

      // Bat swing animation (cos swing)
      this.granny.animTime += delta * 5;
      const bat = this.granny.mesh.getObjectByName('bat');
      if (bat) {
        bat.rotation.x = (Math.PI / 4) + Math.cos(this.granny.animTime) * 0.3;
      }
    } catch (e) {
      console.error("[Game AI] updateGrannyAI error:", e);
    }
  },

  checkLineOfSight(from, to) {
    try {
      const dist = from.distanceTo(to);
      if (dist < 0.2) return true; // Too close, instantly visible!
      
      // Basic direction check - secure against NaN divide-by-zero
      const dir = new THREE.Vector3().subVectors(to, from).normalize();
      const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.granny.ry || 0);
      
      const dot = forward.dot(dir);
      if (dot < Math.cos(this.granny.sightAngle)) return false; // Out of visual cone

      // Check physics walls intersection (simplified ray intersect)
      const ray = new THREE.Raycaster(from, dir, 0.1, dist);
      const intersects = ray.intersectObjects(this.scene.children, true);
      
      // If any intersection is a wall, block sight
      for (let i = 0; i < intersects.length; i++) {
        const obj = intersects[i].object;
        if (!obj || !obj.geometry) continue;

        if (obj.geometry.type === 'BoxGeometry') {
          const mat = obj.material;
          if (mat) {
            let colors = [];
            if (Array.isArray(mat)) {
              colors = mat.map(m => m.color).filter(Boolean);
            } else if (mat.color) {
              colors = [mat.color];
            }

            const isWallColor = colors.some(c => typeof c.getHex === 'function' && c.getHex() === 0x241d1d);
            if (isWallColor) {
              return false; // wall blocks sight!
            }
          }
        }
      }
      return true;
    } catch (e) {
      console.error("[Game AI] checkLineOfSight error:", e);
      return false; // Fallback to not visible to prevent freeze
    }
  },

  grannyTriggerAttack(playerId) {
    console.log(`[Granny AI] Catching player ${playerId}!`);
    
    // Broadcast attack trigger
    this.sendNetworkPacket({
      type: 'attacked',
      playerId
    });

    if (playerId === this.peerId) {
      this.triggerLocalKnockout();
    }
  },

  // ==========================================
  // JUMPSCARE & RESPOND RECOVERY
  // ==========================================
  triggerLocalKnockout() {
    if (this.localPlayer.isUnconscious) return;
    this.localPlayer.isUnconscious = true;
    
    // Trigger scary screen
    AudioAssets.playJumpscare();
    document.getElementById('jumpscare-overlay').style.display = 'flex';
    document.getElementById('game-hud').style.display = 'none';
    
    // Pointer unlock
    document.exitPointerLock();

    setTimeout(() => {
      // Hide jumpscare, fade to blackout unconscious mode
      document.getElementById('jumpscare-overlay').style.display = 'none';
      document.getElementById('knockout-overlay').style.display = 'flex';
      
      let timer = 5;
      const countInterval = setInterval(() => {
        timer--;
        document.getElementById('knockout-timer').innerText = timer;
        if (timer <= 0) {
          clearInterval(countInterval);
          this.wakeUpLocalPlayer();
        }
      }, 1000);
    }, 1500);
  },

  wakeUpLocalPlayer() {
    document.getElementById('knockout-overlay').style.display = 'none';
    document.getElementById('game-hud').style.display = 'block';
    
    // Spawn back in bedroom
    this.camera.position.set(0, 1.6, 6);
    this.localPlayer.x = 0;
    this.localPlayer.z = 6;
    this.localPlayer.isUnconscious = false;
    
    this.lockPointer();
  },

  // ==========================================
  // INTERACTION RAYCAST & SOLVE
  // ==========================================
  updateInteractionPrompt() {
    if (this.localPlayer.isUnconscious) {
      document.getElementById('interaction-prompt').style.display = 'none';
      return;
    }

    // Cast ray from camera center
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    
    const intersects = raycaster.intersectObjects(this.scene.children, true);
    
    let foundInteract = null;
    for (let i = 0; i < intersects.length; i++) {
      const obj = intersects[i].object;
      const dist = intersects[i].distance;
      
      // Search interactives map
      const inter = this.interactives.find(item => item.mesh === obj);
      if (inter && dist < 3.0) {
        foundInteract = inter;
        break;
      }
    }

    const prompt = document.getElementById('interaction-prompt');
    if (foundInteract) {
      let label = "PRESS E TO INTERACT";
      if (foundInteract.type === 'door') {
        const door = this.doors[foundInteract.id];
        if (foundInteract.id === 'exit') {
          if (this.exitLocks.padlock) label = "PADLOCK LOCKED (NEED BRASS KEY)";
          else if (this.exitLocks.code) label = "CODE LOCKED (NEED CODE)";
          else if (this.exitLocks.planks) label = "BARRIER PLANKED (NEED CROWBAR)";
          else label = door.isOpen ? "E TO CLOSE EXIT" : "E TO OPEN EXIT";
        } else {
          label = door.isOpen ? "E TO CLOSE DOOR" : "E TO OPEN DOOR";
        }
      }
      else if (foundInteract.type === 'drawer') {
        label = foundInteract.state === 'open' ? "E TO CLOSE DRAWER" : "E TO SEARCH DRAWER";
      }
      else if (foundInteract.type === 'item') {
        label = `E TO PICK UP ${foundInteract.itemType}`;
      }

prompt.innerHTML = label;
      prompt.style.display = 'block';
      this.activeInteract = foundInteract;
    } else {
      prompt.style.display = 'none';
      this.activeInteract = null;
    }
  },

  performInteraction() {
    if (!this.activeInteract) return;

    const inter = this.activeInteract;
    
    if (inter.type === 'item') {
      // Pick up item locally, place in heldItem slot
      if (this.localPlayer.heldItem) {
        // Automatically drop currently held item
        this.dropHeldItem();
      }
      
      this.localPlayer.heldItem = inter.id;
      document.getElementById('held-item-name').innerText = inter.itemType.toUpperCase();
      
      // Audio click
      AudioAssets.playClick();

      // Trigger network event to hide item from scene
      if (this.isHost) {
        this.handleInteractEvent(inter.id, 'pickup', this.peerId);
      } else {
        this.sendNetworkPacket({
          type: 'interact',
          interactId: inter.id,
          itemType: 'pickup'
        });
      }
    }
    
    else if (inter.type === 'drawer') {
      const newState = inter.state === 'open' ? 'closed' : 'open';
      inter.state = newState;
      
      // Animate drawer group
      const drawerMesh = inter.group.getObjectByName('drawer_slide');
      if (drawerMesh) {
        AudioAssets.playDoorCreak();
        drawerMesh.position.z = newState === 'open' ? 0.6 : 0.1; // slide out/in
      }
    }
    
    else if (inter.type === 'door') {
      const doorId = inter.id;
      const door = this.doors[doorId];

      if (door.isExit) {
        // Handle locks check
        if (this.exitLocks.padlock) {
          if (this.localPlayer.heldItem === 'key') {
            this.localPlayer.heldItem = null;
            document.getElementById('held-item-name').innerText = "EMPTY HANDS";
            AudioAssets.playUnlock();
            
            if (this.isHost) this.handleInteractEvent('exit', 'unlock_padlock', this.peerId);
            else this.sendNetworkPacket({ type: 'interact', interactId: 'exit', itemType: 'unlock_padlock' });
          }
        }
        else if (this.exitLocks.code) {
          if (this.localPlayer.heldItem === 'code') {
            // Prompt electronic input
            const code = prompt("ENTER 4-DIGIT DOOR CODE:");
            if (code === this.codeSolution) {
              this.localPlayer.heldItem = null;
              document.getElementById('held-item-name').innerText = "EMPTY HANDS";
              AudioAssets.playUnlock();
              
              if (this.isHost) this.handleInteractEvent('exit', 'unlock_code', this.peerId);
              else this.sendNetworkPacket({ type: 'interact', interactId: 'exit', itemType: 'unlock_code' });
            } else {
              alert("INCORRECT CODE. ALARM TRIGGERED!");
              this.triggerPlayerNoise(this.localPlayer.x, this.localPlayer.z, 'voice');
            }
          }
        }
        else if (this.exitLocks.planks) {
          if (this.localPlayer.heldItem === 'crowbar') {
            this.localPlayer.heldItem = null;
            document.getElementById('held-item-name').innerText = "EMPTY HANDS";
            AudioAssets.playDoorCreak();
            
            if (this.isHost) this.handleInteractEvent('exit', 'unlock_planks', this.peerId);
            else this.sendNetworkPacket({ type: 'interact', interactId: 'exit', itemType: 'unlock_planks' });
          }
        }
        else {
          // Open exit door - VICTORY!
          if (this.isHost) this.handleInteractEvent('exit', 'open', this.peerId);
          else this.sendNetworkPacket({ type: 'interact', interactId: 'exit', itemType: 'open' });
        }
      } else {
        // Normal door toggle
        const openState = !door.isOpen;
        if (this.isHost) {
          this.handleInteractEvent(doorId, openState ? 'open' : 'close', this.peerId);
        } else {
          this.sendNetworkPacket({
            type: 'interact',
            interactId: doorId,
            itemType: openState ? 'open' : 'close'
          });
        }
      }
    }
  },

  dropHeldItem() {
    try {
      const itemId = this.localPlayer.heldItem;
      if (!itemId) return;

      this.localPlayer.heldItem = null;
      const heldItemLabel = document.getElementById('held-item-name');
      if (heldItemLabel) heldItemLabel.innerText = "EMPTY HANDS";

      // Drop position: at player's current location, near the ground
      const dropX = this.camera.position.x;
      let groundY = 0;
      if (this.walkableObjects && this.walkableObjects.length > 0) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(dropX, 20.0, this.camera.position.z),
          new THREE.Vector3(0, -1, 0)
        );
        const intersects = ray.intersectObjects(this.walkableObjects, true);
        if (intersects.length > 0) {
          groundY = intersects[0].point.y;
        }
      }
      
      const dropY = groundY + 0.3;
      const dropZ = this.camera.position.z;

      // Update locally
      const item = this.items[itemId];
      if (item) {
        item.pickedUp = false;
        item.mesh.position.set(dropX, dropY, dropZ);
        item.mesh.visible = true;
      }

      // Sync with host/network
      if (this.isHost) {
        this.handleInteractEvent(itemId, 'drop', this.peerId, dropX, dropY, dropZ);
      } else {
        this.sendNetworkPacket({
          type: 'interact',
          interactId: itemId,
          itemType: 'drop',
          x: dropX,
          y: dropY,
          z: dropZ
        });
      }
    } catch (e) {
      console.error("[Game Interaction] dropHeldItem error:", e);
    }
  },

  handleInteractEvent(interactId, itemType, senderId, dropX, dropY, dropZ) {
    if (!this.isHost) return; // Host has state authority

    if (itemType === 'pickup') {
      const item = this.items[interactId];
      if (item) {
        item.pickedUp = true;
        item.mesh.visible = false;
      }
    }
    else if (itemType === 'drop') {
      const item = this.items[interactId];
      if (item) {
        item.pickedUp = false;
        const x = dropX !== undefined ? dropX : 0;
        const y = dropY !== undefined ? dropY : 0.5;
        const z = dropZ !== undefined ? dropZ : 0;
        item.mesh.position.set(x, y, z);
        item.mesh.visible = true;
      }
    }
    
    else if (itemType === 'unlock_padlock') {
      this.exitLocks.padlock = false;
      const door = this.doors['exit'];
      // Hide lock visual
      const pad = door.mesh.getObjectByName('padlock');
      if (pad) pad.visible = false;
    }
    
    else if (itemType === 'unlock_code') {
      this.exitLocks.code = false;
    }
    
    else if (itemType === 'unlock_planks') {
      this.exitLocks.planks = false;
      const door = this.doors['exit'];
      // Hide wooden plank visual
      const pl = door.mesh.getObjectByName('plank');
      if (pl) pl.visible = false;
    }
    
    else if (interactId === 'exit' && itemType === 'open') {
      const door = this.doors['exit'];
      door.isOpen = true;
      this.animateDoor('exit', true);
      // Trigger Game Won!
      this.triggerVictory(true);
    }
    else if (this.doors[interactId]) {
      const openState = (itemType === 'open');
      this.doors[interactId].isOpen = openState;
      
      // Sync to everyone
      this.animateDoor(interactId, openState);
    }

    // Force network state sync broadcast
    this.broadcastGameState();
  },

  animateDoor(id, isOpen) {
    const door = this.doors[id];
    if (!door) return;

    AudioAssets.playDoorCreak();
    
    // Rotate hinge pivot (open 90 degrees)
    const targetRot = isOpen ? -Math.PI / 2 : 0;
    
    // Simple instant transition (or linear tween)
    door.mesh.rotation.y = targetRot;

    // Update collision boundary list
    this.recalculateCollisionWalls();
  },

  recalculateCollisionWalls() {
    try {
      this.walls = [];
      
      // Recursively traverse scene to find all static collision walls and cabinet frames
      this.scene.traverse(child => {
        if (child && child.userData && child.userData.isCollisionWall) {
          this.walls.push(new THREE.Box3().setFromObject(child));
        }
      });

      // Add closed doors to block movement
      Object.keys(this.doors).forEach(id => {
        const door = this.doors[id];
        if (door && !door.isOpen && door.mesh) {
          const doorMesh = door.mesh.children[0];
          if (doorMesh) {
            this.walls.push(new THREE.Box3().setFromObject(doorMesh));
          }
        }
      });
    } catch (e) {
      console.error("[Game Physics] recalculateCollisionWalls error:", e);
    }
  },

  // ==========================================
  // PHYSICS & PLAYER COLLISION CHECK
  // ==========================================
  updatePlayerMovement(delta) {
    if (this.localPlayer.isUnconscious) return;

    const speed = this.localPlayer.isCrouching ? 1.5 : (this.keys['ShiftLeft'] ? 4.5 : 3.0);
    
    // Calculate direction vectors relative to look angle
    const forwardVec = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.localPlayer.ry).normalize();
    const rightVec = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.localPlayer.ry).normalize();
    
    const moveDir = new THREE.Vector3();
    if (this.isMobileDevice && this.joystickVector && this.joystickVector.lengthSq() > 0.01) {
      const fMove = forwardVec.clone().multiplyScalar(this.joystickVector.y);
      const rMove = rightVec.clone().multiplyScalar(this.joystickVector.x);
      moveDir.add(fMove).add(rMove);
    } else {
      if (this.keys['KeyW']) moveDir.add(forwardVec);
      if (this.keys['KeyS']) moveDir.sub(forwardVec);
      if (this.keys['KeyD']) moveDir.add(rightVec);
      if (this.keys['KeyA']) moveDir.sub(rightVec);
      moveDir.normalize();
    }

    // Check crouch camera offset
    if (this.keys['KeyC']) {
      if (!this.localPlayer.isCrouching) {
        this.localPlayer.isCrouching = true;
        this.camera.position.y = 1.0; // lower down
        document.getElementById('slot-hand').classList.add('active');
      }
    } else {
      if (this.localPlayer.isCrouching) {
        this.localPlayer.isCrouching = false;
        this.camera.position.y = 1.6; // standard height
        document.getElementById('slot-hand').classList.remove('active');
      }
    }

    // Apply movement with wall collisions
    const velocity = moveDir.multiplyScalar(speed * delta);
    
    // Test X collision
    const testPosX = this.camera.position.x + velocity.x;
    if (!this.checkWallCollision(testPosX, this.camera.position.z)) {
      this.camera.position.x = testPosX;
    }
    
    // Test Z collision
    const testPosZ = this.camera.position.z + velocity.z;
    if (!this.checkWallCollision(this.camera.position.x, testPosZ)) {
      this.camera.position.z = testPosZ;
    }

    // Snapping height physics (gravity and stairs climbing)
    let groundY = 0;
    if (this.walkableObjects && this.walkableObjects.length > 0) {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(this.camera.position.x, 20.0, this.camera.position.z),
        new THREE.Vector3(0, -1, 0)
      );
      const intersects = ray.intersectObjects(this.walkableObjects, true);
      if (intersects.length > 0) {
        groundY = intersects[0].point.y;
      }
    }
    const eyeHeight = this.localPlayer.isCrouching ? 1.0 : 1.6;
    // Smoothly snap player's Y coordinate to groundY + eyeHeight
    this.camera.position.y += (groundY + eyeHeight - this.camera.position.y) * 0.15;

    // Sync variables
    this.localPlayer.x = this.camera.position.x;
    this.localPlayer.y = this.camera.position.y;
    this.localPlayer.z = this.camera.position.z;

    // Trigger footstep sound and sound attraction if moving
    if (velocity.lengthSq() > 0.00001) {
      if (!this.footstepTimer) {
        const rate = this.localPlayer.isCrouching ? 800 : (this.keys['ShiftLeft'] ? 300 : 500);
        AudioAssets.playFootstep(this.localPlayer.isCrouching);
        
        // Attract AI (silent crouch doesn't attract, walk alerts close, run alerts wide)
        if (!this.localPlayer.isCrouching) {
          const alertType = this.keys['ShiftLeft'] ? 'run' : 'walk';
          this.triggerPlayerNoise(this.localPlayer.x, this.localPlayer.z, alertType);
        }
        
        this.footstepTimer = setTimeout(() => { this.footstepTimer = null; }, rate);
      }
    }

    // Check escape trigger (reached exit door coordinates while open)
    const exitDoor = this.doors['exit'];
    if (exitDoor && exitDoor.isOpen) {
      const exitPos = new THREE.Vector3(exitDoor.x, this.camera.position.y, exitDoor.z);
      if (this.camera.position.distanceTo(exitPos) < 2.0) {
        if (this.isHost) this.triggerVictory(true);
        else this.sendNetworkPacket({ type: 'victory_reached' });
      }
    }
  },

  checkWallCollision(x, z) {
    const playerRadius = 0.4;
    // Simple bounding box for the player
    const playerBox = new THREE.Box3(
      new THREE.Vector3(x - playerRadius, 0.1, z - playerRadius),
      new THREE.Vector3(x + playerRadius, 3.0, z + playerRadius)
    );

    // Check intersection with any wall
    for (let i = 0; i < this.walls.length; i++) {
      if (playerBox.intersectsBox(this.walls[i])) {
        return true;
      }
    }
    return false;
  },

  // ==========================================
  // HOST STATE SYNC BROADCASTER
  // ==========================================
  broadcastGameState() {
    if (!this.isHost) return;

    const itemsState = {};
    Object.keys(this.items).forEach(id => {
      itemsState[id] = { 
        pickedUp: this.items[id].pickedUp,
        x: this.items[id].mesh.position.x,
        y: this.items[id].mesh.position.y,
        z: this.items[id].mesh.position.z
      };
    });

    const doorsState = {};
    Object.keys(this.doors).forEach(id => {
      doorsState[id] = { isOpen: this.doors[id].isOpen };
    });

    this.sendNetworkPacket({
      type: 'sync',
      granny: {
        x: this.granny.x,
        y: this.granny.y,
        z: this.granny.z,
        ry: this.granny.ry,
        state: this.granny.state
      },
      items: itemsState,
      doors: doorsState,
      locks: this.exitLocks,
      victory: (this.gameState === 'victory')
    });
  },

  // ==========================================
  // VICTORY ENGINE OVERLAYS
  // ==========================================
  triggerVictory(fromLocal = true) {
    this.gameState = 'victory';
    AudioAssets.stopHeartbeat();
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('victory-overlay').style.display = 'flex';
    document.exitPointerLock();

    if (fromLocal && this.isHost) {
      this.sendNetworkPacket({ type: 'sync', victory: true });
    }
  },

  // ==========================================
  // MAIN ANIMATION LOOP
  // ==========================================
  animate() {
    if (this.gameState !== 'playing') return;
    
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    // 1. Local Player Movement & Physics
    this.updatePlayerMovement(delta);

    // 2. Local Raycast for Interaction hud
    this.updateInteractionPrompt();

    // 3. AI Granny Behavior (Host controls)
    if (this.isHost) {
      this.updateGrannyAI(delta);
    }

    // 4. Update voice chat levels dynamically (spatialized decay)
    this.updateVoiceChatVolumes();

    // 5. Monitor real world voice levels
    this.monitorGameVoice();

    // 6. Network Position Broadcast (20 updates/sec throttle)
    if (!this.lastPosBroadcast || Date.now() - this.lastPosBroadcast > 50) {
      this.sendNetworkPacket({
        type: 'move',
        x: this.localPlayer.x,
        y: this.localPlayer.y,
        z: this.localPlayer.z,
        ry: this.localPlayer.ry,
        action: this.localPlayer.isCrouching ? 'crouch' : (this.keys['KeyW'] || this.keys['KeyS'] ? 'walk' : 'idle'),
        flashlight: this.lights.flashlight ? this.lights.flashlight.visible : false
      });
      
      // Host broadcasts full state sync
      if (this.isHost) {
        this.broadcastGameState();
      }

      this.lastPosBroadcast = Date.now();
    }

    // 7. Render 3D Frame
    this.renderer.render(this.scene, this.camera);
  }
};

// ==========================================
// BIND MENU BUTTONS & TRIGGERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Microphone Request
  document.getElementById('btn-request-mic').addEventListener('click', () => {
    Game.setupMicrophone();
  });

  // Skip Microphone
  const skipBtn = document.getElementById('btn-skip-mic');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      Game.proceedWithoutMic();
    });
  }

  // 2. Proceed to Lobby Panel
  document.getElementById('btn-go-lobby').addEventListener('click', () => {
    Game.initLobby();
  });

  // 3. Back button
  document.getElementById('btn-back-setup').addEventListener('click', () => {
    document.getElementById('lobby-panel').classList.remove('active');
    document.getElementById('setup-panel').classList.add('active');
  });

  // 4. Host Escape Room
  document.getElementById('btn-host-room').addEventListener('click', () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    Game.isHost = true;
    
    document.getElementById('lobby-panel').classList.remove('active');
    document.getElementById('waiting-panel').classList.add('active');
    
    document.getElementById('btn-start-game').style.display = 'block'; // Show start button for host
    
    Game.registerPeerJS(code, true);
  });

  // 5. Join Escape Room
  document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = document.getElementById('join-room-code').value.trim();
    if (!code) {
      alert("Please enter a valid room code.");
      return;
    }
    Game.isHost = false;
    
    document.getElementById('lobby-panel').classList.remove('active');
    document.getElementById('waiting-panel').classList.add('active');
    
    document.getElementById('btn-start-game').style.display = 'none'; // Hide for clients
    
    Game.registerPeerJS(code, false);
  });

  // 6. Leave waiting lobby
  document.getElementById('btn-leave-lobby').addEventListener('click', () => {
    if (Game.peer) {
      Game.peer.destroy();
    }
    document.getElementById('waiting-panel').classList.remove('active');
    document.getElementById('lobby-panel').classList.add('active');
  });

  // 7. Host starts game
  document.getElementById('btn-start-game').addEventListener('click', () => {
    Game.hostStartGame();
  });

  // 8. Play Again button
  document.getElementById('btn-restart').addEventListener('click', () => {
    window.location.reload();
  });
});

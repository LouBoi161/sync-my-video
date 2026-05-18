const socket = io();

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const roleSelection = document.getElementById('role-selection');
const hostPanel = document.getElementById('host-panel');
const clientPanel = document.getElementById('client-panel');
const playerPanel = document.getElementById('player-panel');

const btnHost = document.getElementById('btn-host');
const btnClient = document.getElementById('btn-client');
const usernameInput = document.getElementById('username-input');

const btnToggleCam = document.getElementById('btn-toggle-cam');
const videoGrid = document.getElementById('video-grid');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnSendChat = document.getElementById('btn-send-chat');

const networkSelect = document.getElementById('network-select');
const networkLinkDisplay = document.getElementById('network-link-display');
const playbackModeSelect = document.getElementById('playback-mode-select');

const videoInput = document.getElementById('video-input');
const btnSelectFile = document.getElementById('btn-select-file');
const playlistFilesContainer = document.getElementById('playlist-files');
const btnUpload = document.getElementById('btn-upload');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');

const downloadProgressContainer = document.getElementById('download-progress-container');
const downloadProgressFill = document.getElementById('download-progress-fill');
const downloadStatusText = document.getElementById('download-status-text');

const videoPlayer = document.getElementById('sync-video');
const videoWrapper = document.getElementById('video-wrapper');
const sidebarPlaylist = document.getElementById('sidebar-playlist');
const btnPrevVideo = document.getElementById('btn-prev-video');
const btnNextVideo = document.getElementById('btn-next-video');
const btnEndSession = document.getElementById('btn-end-session');

// Custom Controls Elements
const btnPlayPause = document.getElementById('btn-play-pause');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const progressBarPlayer = document.getElementById('progress-bar-player');
const progressFillPlayer = document.getElementById('progress-fill-player');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');
const btnMute = document.getElementById('btn-mute');
const volumeOnIcon = document.getElementById('volume-on-icon');
const volumeOffIcon = document.getElementById('volume-off-icon');
const volumeSlider = document.getElementById('volume-slider');
const btnFullscreen = document.getElementById('btn-fullscreen');

// Overlay Elements
const overlayCams = document.getElementById('overlay-cams');
const chatBubble = document.getElementById('chat-bubble');
const chatOverlayInputContainer = document.getElementById('chat-overlay-input-container');
const chatOverlayInput = document.getElementById('chat-overlay-input');
const overlayNotifications = document.getElementById('overlay-notifications');

const appendVideoInput = document.getElementById('append-video-input');
const btnAppendFile = document.getElementById('btn-append-file');
const btnUploadAppend = document.getElementById('btn-upload-append');
const appendProgressContainer = document.getElementById('append-progress-container');
const appendProgressFill = document.getElementById('append-progress-fill');

const waitOverlay = document.createElement('div');
waitOverlay.style.position = 'absolute';
waitOverlay.style.top = '0';
waitOverlay.style.left = '0';
waitOverlay.style.width = '100%';
waitOverlay.style.height = '100%';
waitOverlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
waitOverlay.style.color = 'white';
waitOverlay.style.display = 'flex';
waitOverlay.style.alignItems = 'center';
waitOverlay.style.justifyContent = 'center';
waitOverlay.style.fontSize = '1.2rem';
waitOverlay.style.fontWeight = 'bold';
waitOverlay.style.zIndex = '100';
waitOverlay.style.display = 'none';
waitOverlay.textContent = 'Warte auf andere Teilnehmer (Laden/Spulen)...';
// We will append it to the body or player container later

// Cleanup previous IndexedDB attempts so we don't spam the user's storage
try {
  indexedDB.deleteDatabase('SyncVideoDB');
} catch (e) {}

// Cleanup OPFS just in case it was used previously
async function clearOPFSDirectory() {
  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true });
      }
    }
  } catch (e) { }
}
clearOPFSDirectory();

async function downloadVideoWithProgress(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    
    xhr.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };
    
    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(xhr.response);
      } else {
        reject(new Error(`Failed to download: ${xhr.status}`));
      }
    };
    
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}

// State
let isHost = false;
let isSeeking = false;
let ignoreNextPlayPauseEvent = false;
let isForcePaused = false;

// Emit Heartbeat for Sync Scanner
setInterval(() => {
  if (!videoPlayer.src) return;
  socket.emit('sync-heartbeat', {
    currentTime: videoPlayer.currentTime,
    isPlaying: !videoPlayer.paused && !isForcePaused
  });
}, 1000);

// Host File Management
let selectedFiles = [];

// Playlist State
let currentPlaylist = [];
let downloadedBlobs = {}; // Map of index -> blob url
let currentPlayingIndex = 0;
let currentPlaybackMode = 'stream';

// Socket Connection Status
socket.on('connect', () => {
  statusIndicator.classList.remove('offline');
  statusIndicator.classList.add('online');
  statusIndicator.querySelector('.text').textContent = 'Verbunden';
});

socket.on('disconnect', () => {
  statusIndicator.classList.remove('online');
  statusIndicator.classList.add('offline');
  statusIndicator.querySelector('.text').textContent = 'Getrennt';
});

// Load Networks globally for QR Code
async function initNetworkAndQR() {
  try {
    const res = await fetch('/api/network');
    const data = await res.json();
    networkSelect.innerHTML = '';
    
    const welcomeLinkText = document.getElementById('welcome-link-text');
    const qrDivWelcome = document.getElementById('qrcode-welcome');

    if (data.networks.length > 0) {
      data.networks.forEach(net => {
        const option = document.createElement('option');
        option.value = `https://${net.ip}:${data.port}`;
        option.textContent = `${net.type} (${net.name})`;
        networkSelect.appendChild(option);
      });

      const updateLinkAndQR = () => {
        const currentUrl = networkSelect.value;
        if (welcomeLinkText) welcomeLinkText.textContent = currentUrl;
        
        if (qrDivWelcome && typeof QRCode !== 'undefined') {
          qrDivWelcome.innerHTML = '';
          new QRCode(qrDivWelcome, {
            text: currentUrl,
            width: 80, // Slightly smaller for the header
            height: 80,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.L
          });
        }
      };
      
      networkSelect.addEventListener('change', updateLinkAndQR);
      updateLinkAndQR();
    } else {
      if (welcomeLinkText) welcomeLinkText.textContent = 'Kein Netzwerk gefunden';
    }
  } catch (e) {
    console.warn('Network load failed', e);
  }
}
initNetworkAndQR();

// Role Selection
let myUsername = '';
function joinWithUsername() {
  myUsername = usernameInput.value.trim();
  if (!myUsername) myUsername = 'Gast-' + Math.floor(Math.random() * 1000);
  socket.emit('join-room', myUsername);
}

btnHost.addEventListener('click', () => {
  joinWithUsername();
  isHost = true;
  roleSelection.classList.add('hidden');
  hostPanel.classList.remove('hidden');
});

btnClient.addEventListener('click', () => {
  joinWithUsername();
  isHost = false;
  roleSelection.classList.add('hidden');
  clientPanel.classList.remove('hidden');
});

// Host File Selection
btnSelectFile.addEventListener('click', () => {
  videoInput.click();
});

videoInput.addEventListener('change', () => {
  if (videoInput.files.length > 0) {
    selectedFiles = Array.from(videoInput.files);
    renderHostPlaylist();
    btnUpload.classList.remove('hidden');
  } else {
    selectedFiles = [];
    playlistFilesContainer.innerHTML = '';
    btnUpload.classList.add('hidden');
  }
});

function renderHostPlaylist() {
  playlistFilesContainer.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'playlist-item-name';
    nameSpan.textContent = `${index + 1}. ${file.name}`;
    
    const controls = document.createElement('div');
    controls.className = 'playlist-controls';
    
    const btnUp = document.createElement('button');
    btnUp.className = 'btn-icon';
    btnUp.innerHTML = '⬆️';
    btnUp.onclick = () => moveFile(index, -1);
    btnUp.disabled = index === 0;
    
    const btnDown = document.createElement('button');
    btnDown.className = 'btn-icon';
    btnDown.innerHTML = '⬇️';
    btnDown.onclick = () => moveFile(index, 1);
    btnDown.disabled = index === selectedFiles.length - 1;
    
    controls.appendChild(btnUp);
    controls.appendChild(btnDown);
    li.appendChild(nameSpan);
    li.appendChild(controls);
    playlistFilesContainer.appendChild(li);
  });
}

function moveFile(index, direction) {
  if (index + direction >= 0 && index + direction < selectedFiles.length) {
    const temp = selectedFiles[index];
    selectedFiles[index] = selectedFiles[index + direction];
    selectedFiles[index + direction] = temp;
    renderHostPlaylist();
  }
}

// Host File Upload
btnUpload.addEventListener('click', () => {
  if (selectedFiles.length === 0) return;

  const formData = new FormData();
  selectedFiles.forEach(file => {
    formData.append('videos', file);
  });
  formData.append('playbackMode', playbackModeSelect.value);

  btnUpload.disabled = true;
  btnSelectFile.disabled = true;
  uploadProgressContainer.classList.remove('hidden');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload-playlist', true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percentComplete = (e.loaded / e.total) * 100;
      uploadProgressFill.style.width = percentComplete + '%';
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      uploadProgressFill.style.width = '100%';
    } else {
      alert('Fehler beim Hochladen!');
      btnUpload.disabled = false;
      btnSelectFile.disabled = false;
      uploadProgressContainer.classList.add('hidden');
    }
  };

  xhr.send(formData);
});

// Receive Playlist
socket.on('playlist-ready', async (data) => {
  console.log('New playlist available:', data.playlist);
  
  currentPlaylist = data.playlist;
  currentPlayingIndex = data.currentIndex;
  currentPlaybackMode = data.playbackMode || 'stream';
  downloadedBlobs = {};
  
  roleSelection.classList.add('hidden');
  hostPanel.classList.add('hidden');
  clientPanel.classList.remove('hidden');
  downloadProgressContainer.classList.remove('hidden');

  renderSidebar();

  // Load the current video directly (crucial for late joiners!)
  await downloadVideo(currentPlayingIndex, true);
  
  // Show player for the current video
  setupVideoPlayer(currentPlayingIndex);
  
  // Ask server for exact current time and playback state
  socket.emit('request-sync');
  
  // Start background loading for the rest
  startBackgroundDownloads();
});

async function downloadVideo(index, showProgress = false) {
  if (index >= currentPlaylist.length) return;
  if (downloadedBlobs[index]) return; // Already downloaded

  if (currentPlaybackMode === 'stream') {
    downloadedBlobs[index] = currentPlaylist[index].url;
    updateSidebarStatus(index, 'ready');
    
    if (showProgress) {
      downloadProgressFill.style.width = '100%';
      downloadStatusText.textContent = 'Bereit (Streaming)';
    }
    return;
  }

  updateSidebarStatus(index, 'downloading');

  try {
    const url = currentPlaylist[index].url;
    
    const onProgress = showProgress ? (percent) => {
      downloadProgressFill.style.width = percent + '%';
      downloadStatusText.textContent = percent + '%';
    } : null;

    if (currentPlaybackMode === 'disk' || currentPlaybackMode === 'ram') {
      // Use XHR to natively spool large blobs to disk without JS heap RAM spike.
      // This is the most efficient way to pre-download gigabyte files over HTTP local networks.
      // It fulfills both "disk" (spools to temp disk natively) and "ram" (pre-loads entirely before playback) 
      // without actually crashing the RAM or requiring HTTPS or freezing the IndexedDB process.
      const blob = await downloadVideoWithProgress(url, onProgress);
      downloadedBlobs[index] = URL.createObjectURL(blob);
      updateSidebarStatus(index, 'ready');
      return;
    }

  } catch (error) {
    console.error(`Error downloading video ${index}:`, error);
    updateSidebarStatus(index, 'error');
  }
}

async function startBackgroundDownloads() {
  // First download upcoming videos
  for (let i = currentPlayingIndex + 1; i < currentPlaylist.length; i++) {
    if (!downloadedBlobs[i]) {
      await downloadVideo(i, false);
    }
  }
  // Then download previous videos (in case user seeks backwards)
  for (let i = 0; i < currentPlayingIndex; i++) {
    if (!downloadedBlobs[i]) {
      await downloadVideo(i, false);
    }
  }
}

function renderSidebar() {
  sidebarPlaylist.innerHTML = '';
  currentPlaylist.forEach((video, index) => {
    const li = document.createElement('li');
    li.className = 'sidebar-item';
    li.id = `sidebar-item-${index}`;
    
    const infoDiv = document.createElement('div');
    infoDiv.style.flex = "1";
    infoDiv.style.marginRight = "10px";
    
    const name = document.createElement('strong');
    name.textContent = `${index + 1}. ${video.filename}`;
    name.style.display = "block";
    
    const status = document.createElement('span');
    status.className = 'sidebar-status';
    status.id = `sidebar-status-${index}`;
    status.textContent = downloadedBlobs[index] ? 'Fertig geladen' : 'Wartet...';
    
    infoDiv.appendChild(name);
    infoDiv.appendChild(status);
    
    const controls = document.createElement('div');
    controls.className = 'playlist-controls';
    
    const btnUp = document.createElement('button');
    btnUp.className = 'btn-icon';
    btnUp.innerHTML = '⬆️';
    btnUp.onclick = () => moveSidebarFile(index, -1);
    btnUp.disabled = index === 0;
    
    const btnDown = document.createElement('button');
    btnDown.className = 'btn-icon';
    btnDown.innerHTML = '⬇️';
    btnDown.onclick = () => moveSidebarFile(index, 1);
    btnDown.disabled = index === currentPlaylist.length - 1;

    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn-icon';
    btnRemove.innerHTML = '❌';
    btnRemove.onclick = () => removeSidebarFile(index);
    
    controls.appendChild(btnUp);
    controls.appendChild(btnDown);
    controls.appendChild(btnRemove);
    
    li.appendChild(infoDiv);
    li.appendChild(controls);
    sidebarPlaylist.appendChild(li);
    
    if (index === currentPlayingIndex) {
      updateSidebarStatus(index, 'playing');
    }
  });
}

function moveSidebarFile(index, direction) {
  if (index + direction >= 0 && index + direction < currentPlaylist.length) {
    const newPlaylist = [...currentPlaylist];
    const temp = newPlaylist[index];
    newPlaylist[index] = newPlaylist[index + direction];
    newPlaylist[index + direction] = temp;
    
    let newCurrentIndex = currentPlayingIndex;
    if (currentPlayingIndex === index) {
      newCurrentIndex = index + direction;
    } else if (currentPlayingIndex === index + direction) {
      newCurrentIndex = index;
    }
    
    socket.emit('update-playlist', { newPlaylist, newCurrentIndex });
  }
}

function removeSidebarFile(index) {
  if (confirm("Dieses Video wirklich aus der Playlist entfernen?")) {
    const newPlaylist = [...currentPlaylist];
    newPlaylist.splice(index, 1);
    
    let newCurrentIndex = currentPlayingIndex;
    
    if (index === currentPlayingIndex) {
      if (newPlaylist.length === 0) {
        newCurrentIndex = 0;
        videoPlayer.src = "";
        videoPlayer.pause();
      } else if (newCurrentIndex >= newPlaylist.length) {
        newCurrentIndex = newPlaylist.length - 1;
      }
      
      if (isHost && newPlaylist.length > 0) {
        setTimeout(() => {
          socket.emit('change-video', newCurrentIndex);
        }, 500);
      }
    } else if (index < currentPlayingIndex) {
      newCurrentIndex--;
    }
    
    socket.emit('update-playlist', { newPlaylist, newCurrentIndex });
  }
}

function updateSidebarStatus(index, status) {
  const item = document.getElementById(`sidebar-item-${index}`);
  const statusText = document.getElementById(`sidebar-status-${index}`);
  if (!item || !statusText) return;

  item.classList.remove('playing', 'downloading');

  if (status === 'playing') {
    item.classList.add('playing');
    statusText.textContent = 'Läuft gerade';
  } else if (status === 'downloading') {
    item.classList.add('downloading');
    statusText.textContent = 'Wird geladen...';
  } else if (status === 'ready') {
    statusText.textContent = 'Fertig geladen';
  } else if (status === 'error') {
    statusText.textContent = 'Fehler beim Laden';
  } else {
    statusText.textContent = 'Wartet...';
  }
}

function setupVideoPlayer(index) {
  currentPlayingIndex = index;
  
  if (!downloadedBlobs[index]) {
    // If we reach a video that is not yet downloaded (should rarely happen),
    // we would need to wait. For simplicity, just alert.
    alert('Video ist noch nicht fertig geladen! Bitte kurz warten.');
    return;
  }

  videoPlayer.src = downloadedBlobs[index];
  
  clientPanel.classList.add('hidden');
  playerPanel.classList.remove('hidden');

  // Update sidebar UI
  for (let i = 0; i < currentPlaylist.length; i++) {
    if (i === index) {
      updateSidebarStatus(i, 'playing');
    } else if (downloadedBlobs[i]) {
      updateSidebarStatus(i, 'ready');
    }
  }

  // Append wait overlay to video wrapper if not already there
  const wrapper = document.querySelector('.video-wrapper');
  if (wrapper && !wrapper.contains(waitOverlay)) {
    wrapper.appendChild(waitOverlay);
  }
}

// Custom Controls Logic
function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

// Optimized Time Update (Throttle to save CPU)
let lastTimeUpdate = 0;
videoPlayer.addEventListener('timeupdate', () => {
  const now = Date.now();
  if (now - lastTimeUpdate < 250) return; // Only update every 250ms
  lastTimeUpdate = now;

  if (videoPlayer.duration) {
    const percent = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    progressFillPlayer.style.width = percent + '%';
    currentTimeEl.textContent = formatTime(videoPlayer.currentTime);
  }
});

// Watchdog: Ensure remote videos don't freeze/pause due to browser throttling
setInterval(() => {
  document.querySelectorAll('.cam-wrapper video').forEach(video => {
    if (video.paused && video.srcObject && !video.id.includes('local')) {
      console.log('Watchdog: Remote video was paused, restarting...');
      video.play().catch(() => {});
    }
  });
}, 2000);

videoPlayer.addEventListener('loadedmetadata', () => {
  durationEl.textContent = formatTime(videoPlayer.duration);
});

btnPlayPause.addEventListener('click', () => {
  if (videoPlayer.paused) {
    videoPlayer.play();
  } else {
    videoPlayer.pause();
  }
});

videoPlayer.addEventListener('play', () => {
  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');
});

videoPlayer.addEventListener('pause', () => {
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
});

progressBarPlayer.addEventListener('click', (e) => {
  const rect = progressBarPlayer.getBoundingClientRect();
  const pos = (e.clientX - rect.left) / rect.width;
  videoPlayer.currentTime = pos * videoPlayer.duration;
});

volumeSlider.addEventListener('input', () => {
  videoPlayer.volume = volumeSlider.value;
  videoPlayer.muted = (videoPlayer.volume === 0);
  updateVolumeIcons();
});

btnMute.addEventListener('click', () => {
  videoPlayer.muted = !videoPlayer.muted;
  updateVolumeIcons();
});

function updateVolumeIcons() {
  if (videoPlayer.muted || videoPlayer.volume === 0) {
    volumeOnIcon.classList.add('hidden');
    volumeOffIcon.classList.remove('hidden');
  } else {
    volumeOnIcon.classList.remove('hidden');
    volumeOffIcon.classList.add('hidden');
  }
}

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    videoWrapper.requestFullscreen().catch(err => {
      alert(`Fehler beim Fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
});

// Chat Overlay Logic
chatBubble.addEventListener('click', (e) => {
  e.stopPropagation();
  chatOverlayInputContainer.classList.toggle('hidden');
  if (!chatOverlayInputContainer.classList.contains('hidden')) {
    chatOverlayInput.focus();
  }
});

chatOverlayInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const text = chatOverlayInput.value.trim();
    if (text) {
      socket.emit('chat-message', text);
      chatOverlayInput.value = '';
      chatOverlayInputContainer.classList.add('hidden');
    }
  }
});

// Close chat input when clicking outside
document.addEventListener('click', (e) => {
  if (!chatOverlayInputContainer.contains(e.target) && e.target !== chatBubble) {
    chatOverlayInputContainer.classList.add('hidden');
  }
});

function showMessagePopup(sender, text) {
  const popup = document.createElement('div');
  popup.className = 'msg-popup';
  popup.innerHTML = `<strong>${sender}:</strong> ${text}`;
  overlayNotifications.appendChild(popup);
  
  // Remove after animation
  setTimeout(() => {
    popup.remove();
  }, 4500);
}

// Auto-play Next Video
videoPlayer.addEventListener('ended', () => {
  if (isHost) {
    if (currentPlayingIndex + 1 < currentPlaylist.length) {
      socket.emit('change-video', currentPlayingIndex + 1);
    }
  }
});

// Manual Skip Buttons (Anyone can click)
btnPrevVideo.addEventListener('click', () => {
  if (currentPlayingIndex > 0) {
    socket.emit('change-video', currentPlayingIndex - 1);
  }
});

btnNextVideo.addEventListener('click', () => {
  if (currentPlayingIndex + 1 < currentPlaylist.length) {
    socket.emit('change-video', currentPlayingIndex + 1);
  }
});

// Player Synchronization Logic
videoPlayer.addEventListener('play', () => {
  if (isForcePaused) {
    videoPlayer.pause();
    return;
  }
  if (ignoreNextPlayPauseEvent) {
    ignoreNextPlayPauseEvent = false;
    return;
  }
  socket.emit('play', videoPlayer.currentTime);
});

videoPlayer.addEventListener('pause', () => {
  if (isForcePaused) return;
  if (ignoreNextPlayPauseEvent) {
    ignoreNextPlayPauseEvent = false;
    return;
  }
  socket.emit('pause', videoPlayer.currentTime);
});

videoPlayer.addEventListener('seeked', () => {
  if (isSeeking) {
    isSeeking = false;
    return;
  }
  socket.emit('seek', videoPlayer.currentTime);
});

videoPlayer.addEventListener('waiting', () => {
  socket.emit('buffer-state-change', true);
});

videoPlayer.addEventListener('canplay', () => {
  socket.emit('buffer-state-change', false);
});

videoPlayer.addEventListener('playing', () => {
  socket.emit('buffer-state-change', false);
});

// Incoming Sync Events
socket.on('play', (time) => {
  if (Math.abs(videoPlayer.currentTime - time) > 0.5) {
    videoPlayer.currentTime = time;
  }
  ignoreNextPlayPauseEvent = true;
  videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
});

socket.on('pause', (time) => {
  ignoreNextPlayPauseEvent = true;
  videoPlayer.pause();
  if (Math.abs(videoPlayer.currentTime - time) > 0.5) {
    videoPlayer.currentTime = time;
  }
});

socket.on('seek', (time) => {
  isSeeking = true;
  videoPlayer.currentTime = time;
});

socket.on('change-video', (index) => {
  setupVideoPlayer(index);
  ignoreNextPlayPauseEvent = true;
  videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
});

socket.on('sync-state', (state) => {
  // If force is true, we strictly follow the server (happens on join/reload)
  const drift = Math.abs(videoPlayer.currentTime - state.currentTime);
  if (state.force || drift > 1.0) {
    videoPlayer.currentTime = state.currentTime;
  }
  
  if (state.isPlaying && !isForcePaused) {
    if (videoPlayer.paused) {
      ignoreNextPlayPauseEvent = true;
      videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
    }
  } else {
    if (!videoPlayer.paused) {
      ignoreNextPlayPauseEvent = true;
      videoPlayer.pause();
    }
  }
});

socket.on('force-pause-sync', (data) => {
  if (!videoPlayer.paused) {
    ignoreNextPlayPauseEvent = true;
    videoPlayer.pause();
  }
  isForcePaused = true;
  waitOverlay.style.display = 'flex';
});

socket.on('force-resume-sync', (data) => {
  if (isForcePaused) {
    isForcePaused = false;
    waitOverlay.style.display = 'none';
    
    const shouldPlay = data && data.autoPlay !== undefined ? data.autoPlay : true;
    
    if (shouldPlay) {
      ignoreNextPlayPauseEvent = true;
      videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
    }
  }
});

socket.on('force-seek-sync', (time) => {
  isSeeking = true;
  videoPlayer.currentTime = time;
  waitOverlay.style.display = 'flex'; // It will go away when buffer finishes and resume fires
});

// New Socket Events
socket.on('playlist-updated', (data) => {
  console.log('Playlist updated:', data.playlist);
  currentPlaylist = data.playlist;
  currentPlayingIndex = data.currentIndex;
  currentPlaybackMode = data.playbackMode || 'stream';
  
  renderSidebar();
  startBackgroundDownloads();
});

socket.on('session-ended', () => {
  videoPlayer.pause();
  videoPlayer.src = "";
  currentPlaylist = [];
  downloadedBlobs = {};
  currentPlayingIndex = 0;
  isHost = false;
  
  playerPanel.classList.add('hidden');
  hostPanel.classList.add('hidden');
  clientPanel.classList.add('hidden');
  roleSelection.classList.remove('hidden');
  statusIndicator.querySelector('.text').textContent = 'Verbunden';
});

// UI Actions
btnEndSession.addEventListener('click', () => {
  if (confirm("Möchtest du diese Sitzung für alle Teilnehmer beenden?")) {
    socket.emit('end-session');
  }
});

let appendFiles = [];

btnAppendFile.addEventListener('click', () => {
  appendVideoInput.click();
});

appendVideoInput.addEventListener('change', () => {
  if (appendVideoInput.files.length > 0) {
    appendFiles = Array.from(appendVideoInput.files);
    btnUploadAppend.classList.remove('hidden');
    btnUploadAppend.textContent = `${appendFiles.length} Video(s) hochladen`;
  } else {
    appendFiles = [];
    btnUploadAppend.classList.add('hidden');
  }
});

btnUploadAppend.addEventListener('click', () => {
  if (appendFiles.length === 0) return;

  const formData = new FormData();
  appendFiles.forEach(file => {
    formData.append('videos', file);
  });

  btnUploadAppend.disabled = true;
  btnAppendFile.disabled = true;
  appendProgressContainer.classList.remove('hidden');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/append-playlist', true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percentComplete = (e.loaded / e.total) * 100;
      appendProgressFill.style.width = percentComplete + '%';
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      appendProgressFill.style.width = '100%';
      setTimeout(() => {
        appendProgressContainer.classList.add('hidden');
        btnUploadAppend.classList.add('hidden');
        btnUploadAppend.disabled = false;
        btnAppendFile.disabled = false;
        appendFiles = [];
        appendVideoInput.value = '';
      }, 1000);
    } else {
      alert('Fehler beim Hochladen!');
      btnUploadAppend.disabled = false;
      btnAppendFile.disabled = false;
      appendProgressContainer.classList.add('hidden');
    }
  };

  xhr.send(formData);
});

// ==========================================
// CHAT & WEBRTC FACECAM LOGIC
// ==========================================

// Chat
btnSendChat.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (text) {
    socket.emit('chat-message', text);
    chatInput.value = '';
  }
});

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') btnSendChat.click();
});

socket.on('chat-message', (data) => {
  const li = document.createElement('li');
  li.innerHTML = `<span style="font-size: 0.7rem; color: #94a3b8; display: block;">${data.time}</span> <strong>${data.sender}:</strong> ${data.text}`;
  chatMessages.appendChild(li);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Show popup if it's not from me
  if (data.sender !== myUsername) {
    showMessagePopup(data.sender, data.text);
  }
});

// Inactivity Hiding Logic
let inactivityTimer;
function resetInactivityTimer() {
  videoWrapper.classList.remove('inactive');
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    // Only hide if video is playing AND chat input is hidden AND no one is hovering the controls
    const isChatOpen = !chatOverlayInputContainer.classList.contains('hidden');
    const isHoveringControls = document.querySelector('.custom-controls:hover') || document.querySelector('.overlay-chat:hover');
    
    if (!videoPlayer.paused && !isChatOpen && !isHoveringControls) {
      videoWrapper.classList.add('inactive');
    }
  }, 7000); // 7 seconds
}

videoWrapper.addEventListener('mousemove', resetInactivityTimer);
videoWrapper.addEventListener('touchstart', resetInactivityTimer);
videoPlayer.addEventListener('play', resetInactivityTimer);
videoPlayer.addEventListener('pause', () => {
  videoWrapper.classList.remove('inactive');
  clearTimeout(inactivityTimer);
});

// WebRTC Facecam
const peerConnections = {};
let localStream = null;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

function createCamWrapper(id, username, isLocal = false) {
  const wrapper = document.createElement('div');
  wrapper.id = isLocal ? 'wrapper-local' : `wrapper-${id}`;
  wrapper.className = 'cam-wrapper';
  
  const videoEl = document.createElement('video');
  videoEl.id = isLocal ? 'local-video' : `cam-${id}`;
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  if (isLocal) videoEl.muted = true;
  
  // Resize Logic
  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  
  let isResizing = false;
  const startResize = (e) => {
    isResizing = true;
    e.preventDefault();
    const startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const startWidth = wrapper.offsetWidth;
    
    const onMove = (moveEvent) => {
      if (!isResizing) return;
      const currentX = moveEvent.type === 'touchmove' ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const newWidth = startWidth + (currentX - startX);
      wrapper.style.width = `${Math.max(80, Math.min(400, newWidth))}px`;
    };
    
    const stopResize = () => {
      isResizing = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
    };
    
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('touchend', stopResize);
  };
  
  handle.addEventListener('mousedown', startResize);
  handle.addEventListener('touchstart', startResize);

  // Rotation Logic
  let rotation = 0;
  const rotate = () => {
    rotation = (rotation + 90) % 360;
    videoEl.style.transform = `rotate(${rotation}deg)`;
    videoEl.style.objectFit = (rotation % 180 === 0) ? 'cover' : 'contain';
  };

  const nameEl = document.createElement('span');
  nameEl.className = 'cam-name';
  nameEl.textContent = username || (isLocal ? 'Du' : 'Gast');
  nameEl.style.cursor = 'pointer';
  nameEl.title = 'Klick zum Rotieren';
  nameEl.onclick = rotate;
  
  wrapper.appendChild(videoEl);
  wrapper.appendChild(nameEl);
  wrapper.appendChild(handle);
  
  return { wrapper, videoEl };
}

function createPeerConnection(targetId, targetUsername) {
  if (peerConnections[targetId]) return peerConnections[targetId];

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[targetId] = pc;
  
  // Track signaling state to avoid collisions
  pc.makingOffer = false;
  pc.ignoreOffer = false;
  pc.candidatesQueue = [];

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', { target: targetId, candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state with ${targetId}: ${pc.connectionState}`);
    if (pc.connectionState === 'failed') {
      console.log('Restarting failed connection...');
      pc.restartIce();
    }
  };

  pc.onnegotiationneeded = async () => {
    try {
      pc.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { target: targetId, offer: pc.localDescription });
    } catch (e) {
      console.error('Negotiation error:', e);
    } finally {
      pc.makingOffer = false;
    }
  };

  pc.ontrack = event => {
    console.log('Received remote track from', targetId, event.streams[0]);
    let wrapper = document.getElementById(`wrapper-${targetId}`);
    if (!wrapper) {
      const { wrapper: newWrapper } = createCamWrapper(targetId, targetUsername);
      overlayCams.appendChild(newWrapper);
    }
    const videoEl = document.getElementById(`cam-${targetId}`);
    if (videoEl && videoEl.srcObject !== event.streams[0]) {
      videoEl.srcObject = event.streams[0];
      videoEl.play().catch(e => console.warn('Auto-play remote video failed:', e));
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  return pc;
}

async function startLocalVideo() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("⚠️ Kamera Fehler!\n\nDein Browser blockiert die Kamera.\nBitte stelle sicher, dass du auf der Seite 'Erweitert -> Risiko akzeptieren' geklickt hast, da Kameras nur über verschlüsselte HTTPS Verbindungen funktionieren.");
      return;
    }
    
    // Optimized constraints for performance: Lower resolution & FPS is enough for face cams
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: { ideal: 320 }, 
        height: { ideal: 240 }, 
        frameRate: { ideal: 20 },
        facingMode: "user" 
      }, 
      audio: true 
    });
    
    let localWrapper = document.getElementById('wrapper-local');
    if (!localWrapper) {
      const { wrapper, videoEl } = createCamWrapper('local', myUsername, true);
      overlayCams.insertBefore(wrapper, overlayCams.firstChild);
    }
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;

    for (const id in peerConnections) {
      const pc = peerConnections[id];
      localStream.getTracks().forEach(track => {
        const senders = pc.getSenders();
        const hasTrack = senders.find(s => s.track === track);
        if (!hasTrack) pc.addTrack(track, localStream);
      });
    }

    btnToggleCam.textContent = 'Kamera Aus';
    btnToggleCam.style.background = '#ff4d4d';
    btnToggleCam.style.borderColor = '#ff4d4d';
    btnToggleCam.style.color = 'white';
  } catch (e) {
    console.error('Kamera-Fehler:', e);
    alert('Kamera konnte nicht gestartet werden: ' + e.message);
  }
}

function stopLocalVideo() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    
    const wrapper = document.getElementById('wrapper-local');
    if (wrapper) wrapper.remove();

    Object.values(peerConnections).forEach(pc => {
      const senders = pc.getSenders();
      senders.forEach(sender => pc.removeTrack(sender));
    });

    btnToggleCam.textContent = 'Kamera An';
    btnToggleCam.style.background = 'transparent';
    btnToggleCam.style.borderColor = 'var(--primary-color)';
    btnToggleCam.style.color = 'var(--primary-color)';
  }
}

btnToggleCam.addEventListener('click', () => {
  if (localStream) {
    stopLocalVideo();
  } else {
    startLocalVideo();
  }
});

// Fix for camera freeze on orientation change
let orientationTimeout;
window.addEventListener('orientationchange', () => {
  if (localStream) {
    console.log('Orientation change detected, restarting camera to prevent freeze...');
    clearTimeout(orientationTimeout);
    orientationTimeout = setTimeout(async () => {
      // Restart local video to adapt to new orientation
      const wasActive = !!localStream;
      if (wasActive) {
        stopLocalVideo();
        await startLocalVideo();
      }
    }, 500); // Wait for rotation to finish
  }
});

// Signaling Events
socket.on('existing-peers', (peers) => {
  peers.forEach(peer => {
    // Initiate connection to existing peers
    createPeerConnection(peer.id, peer.username);
    // onnegotiationneeded will handle the rest
  });
});

socket.on('user-joined', (peer) => {
  const li = document.createElement('li');
  li.innerHTML = `<span style="font-size: 0.8rem; color: var(--success-color);">👋 ${peer.username} ist beigetreten</span>`;
  chatMessages.appendChild(li);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // If we have a local stream, we initiate a connection to the new user
  // to ensure they see us immediately.
  if (localStream) {
    console.log('Initiating connection to newcomer:', peer.id);
    const pc = createPeerConnection(peer.id, peer.username);
    // Negotiation will be triggered by pc.onnegotiationneeded when tracks are added
  }
});

socket.on('user-left', (id) => {
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  const wrapper = document.getElementById(`wrapper-${id}`);
  if (wrapper) wrapper.remove();
});

socket.on('webrtc-offer', async (data) => {
  let pc = peerConnections[data.sender];
  if (!pc) {
    pc = createPeerConnection(data.sender, data.username);
  }

  try {
    const offerCollision = (data.offer.type === 'offer') && 
                           (pc.makingOffer || pc.signalingState !== 'stable');
    
    pc.ignoreOffer = !isHost && offerCollision; 
    if (pc.ignoreOffer) {
      console.log('Collision detected, ignoring offer (polite)');
      return;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    if (data.offer.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { target: data.sender, answer: pc.localDescription });
    }
    
    while (pc.candidatesQueue.length > 0) {
      const candidate = pc.candidatesQueue.shift();
      await pc.addIceCandidate(candidate);
    }
  } catch (e) {
    console.error('Error handling offer:', e);
  }
});

socket.on('webrtc-answer', async (data) => {
  const pc = peerConnections[data.sender];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (e) {
      console.error('Error handling answer:', e);
    }
  }
});

socket.on('webrtc-ice-candidate', async (data) => {
  const pc = peerConnections[data.sender];
  if (pc) {
    try {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        pc.candidatesQueue.push(new RTCIceCandidate(data.candidate));
      }
    } catch(e) {
      console.error('Error adding ice candidate:', e);
    }
  }
});

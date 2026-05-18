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

// Emoji Board Logic
function setupEmojiBoard(boardId) {
  const board = document.getElementById(boardId);
  if (board) {
    board.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent closing overlay if in overlay
        const emoji = btn.getAttribute('data-emoji');
        socket.emit('emoji-reaction', emoji);
      });
    });
  }
}

setupEmojiBoard('emoji-board');
setupEmojiBoard('emoji-board-overlay');

socket.on('emoji-reaction', (emoji) => {
  spawnFlyingEmoji(emoji);
});

function spawnFlyingEmoji(emoji) {
  const emojiEl = document.createElement('div');
  emojiEl.className = 'flying-emoji';
  emojiEl.textContent = emoji;
  
  // Random horizontal position (10% to 90%)
  const randomX = Math.floor(Math.random() * 80) + 10;
  emojiEl.style.left = `${randomX}%`;
  
  // Add to player wrapper so it flies over the video
  const playerWrapper = document.getElementById('video-wrapper');
  if (playerWrapper) {
    playerWrapper.appendChild(emojiEl);
    
    // Cleanup after animation
    setTimeout(() => {
      emojiEl.remove();
    }, 4000);
  }
}

socket.on('user-muted', (data) => {
  const wrapper = document.getElementById(`wrapper-${data.id}`);
  if (wrapper) {
    wrapper.classList.toggle('user-muted', data.isMuted);
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
videoWrapper.addEventListener('pause', () => {
  videoWrapper.classList.remove('inactive');
  clearTimeout(inactivityTimer);
});

socket.on('user-joined', (peer) => {

  const li = document.createElement('li');
  li.innerHTML = `<span style="font-size: 0.8rem; color: var(--success-color);">👋 ${peer.username} ist beigetreten</span>`;
  chatMessages.appendChild(li);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('user-left', (id) => {
  // Logic for user leaving (could add a chat message here if desired)
});



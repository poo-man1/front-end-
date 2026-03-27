// ===== Brand & Server Settings =====
const APP_NAME = "Omingle";
// NOTE: Keeping your existing server to avoid breaking connections.
// If you've renamed the backend, update the URL below once.
const SERVER_URL = "https://gaaji-server.onrender.com";

// ===== Socket.IO Connection =====
const socket = io(SERVER_URL, {
  transports: ["websocket"]
});

const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages = document.getElementById("messages");

let pc = null;
let localStream = null;
let micOn = true;
let camOn = true;

// ICE config (STUN only for now – TURN optional)
const iceConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/* ==============================
   1️⃣ GET CAMERA FIRST (FIX)
================================ */
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.srcObject = localStream;
    localVideo.muted = true; // 🔴 VERY IMPORTANT (prevents echo)
    
    // Update UI to show camera is ready
    showStatus("Camera & mic ready! Looking for a match...");
  } catch (err) {
    alert(`Camera or mic permission denied on ${APP_NAME}`);
    console.error(err);
    showStatus("Camera/Mic access denied. Please enable permissions.");
  }
}

initMedia();

/* ==============================
   2️⃣ CREATE PEER CONNECTION
================================ */
function createPeerConnection() {
  if (!localStream) {
    console.warn("No local stream yet");
    return;
  }
  
  pc = new RTCPeerConnection(iceConfig);

  // Add local tracks ONLY after stream exists
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    showStatus("✅ Connected! You're now chatting with a stranger");
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", event.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Connection state:", pc.connectionState);
    if (pc.connectionState === "connected") {
      showStatus("🎉 Connected! Enjoy your chat!");
    } else if (pc.connectionState === "failed") {
      showStatus("Connection failed. Finding new match...");
      resetConnection();
    } else if (pc.connectionState === "disconnected") {
      showStatus("Partner disconnected. Reconnecting...");
    }
  };
  
  pc.oniceconnectionstatechange = () => {
    console.log("ICE connection state:", pc.iceConnectionState);
  };
}

/* ==============================
   3️⃣ SOCKET EVENTS
================================ */
socket.on("connect", () => {
  console.log("✅ Connected to server:", socket.id);
  showStatus("Connected to server. Waiting for match...");
});

socket.on("matched", async ({ initiator }) => {
  console.log("Matched! Initiator:", initiator);
  showStatus("Partner found! Connecting...");
  
  if (!localStream) {
    console.warn("Waiting for local stream...");
    setTimeout(() => {
      if (localStream) {
        createPeerConnection();
        if (initiator) {
          initiateOffer();
        }
      }
    }, 1000);
    return;
  }
  
  createPeerConnection();

  if (initiator) {
    await initiateOffer();
  }
});

async function initiateOffer() {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", offer);
  } catch (err) {
    console.error("Error creating offer:", err);
  }
}

socket.on("signal", async (data) => {
  if (!pc) {
    if (!localStream) {
      console.warn("No local stream, waiting...");
      setTimeout(() => {
        if (localStream) {
          createPeerConnection();
          handleSignal(data);
        }
      }, 500);
      return;
    }
    createPeerConnection();
  }
  await handleSignal(data);
});

async function handleSignal(data) {
  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(data);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", answer);
    } else if (data.type === "answer") {
      await pc.setRemoteDescription(data);
    } else if (data.candidate) {
      await pc.addIceCandidate(data);
    }
  } catch (err) {
    console.error("Signal handling error:", err);
  }
}

socket.on("chat", (msg) => {
  messages.innerHTML += `<div>Stranger: ${escapeHtml(msg)}</div>`;
  scrollMessagesToBottom();
});

socket.on("peer-disconnected", () => {
  console.log("Peer disconnected");
  showStatus("Partner left the chat. Finding new match...");
  resetConnection();
});

socket.on("reported", () => {
  alert(`You were reported on ${APP_NAME}`);
  showStatus("You were reported. Please follow community guidelines.");
});

socket.on("banned", () => {
  alert(`You are temporarily banned from ${APP_NAME}`);
  showStatus("You are temporarily banned.");
});

// ===== ONLINE COUNT (REAL-TIME) =====
socket.on("onlineCount", (count) => {
  const onlineCountElement = document.getElementById("onlineCount");
  if (onlineCountElement) {
    onlineCountElement.innerText = count;
  }
  console.log("Online users:", count);
});

/* ==============================
   4️⃣ CONTROLS
================================ */
function send() {
  const input = document.getElementById("text");
  if (!input.value) return;

  messages.innerHTML += `<div>You: ${escapeHtml(input.value)}</div>`;
  socket.emit("chat", input.value);
  input.value = "";
  scrollMessagesToBottom();
}

function toggleMic() {
  if (!localStream) return;
  micOn = !micOn;
  const tracks = localStream.getAudioTracks();
  if (tracks[0]) {
    tracks[0].enabled = micOn;
    const micBtn = document.querySelector("button[onclick='toggleMic()']");
    if (micBtn) {
      micBtn.textContent = micOn ? "Mic" : "Mic 🔇";
      micBtn.style.opacity = micOn ? "1" : "0.6";
    }
    showStatus(micOn ? "Microphone on" : "Microphone off");
  }
}

function toggleCam() {
  if (!localStream) return;
  camOn = !camOn;
  const tracks = localStream.getVideoTracks();
  if (tracks[0]) {
    tracks[0].enabled = camOn;
    const camBtn = document.querySelector("button[onclick='toggleCam()']");
    if (camBtn) {
      camBtn.textContent = camOn ? "Cam" : "Cam ❌";
      camBtn.style.opacity = camOn ? "1" : "0.6";
    }
    showStatus(camOn ? "Camera on" : "Camera off");
  }
}

function report() {
  if (confirm("Report this user?")) {
    socket.emit("report");
    showStatus("Reported. Finding a new match…");
    resetConnection();
  }
}

function next() {
  showStatus("Skipping to next match…");
  resetConnection();
}

/* ==============================
   5️⃣ RESET (SAFE)
================================ */
function resetConnection() {
  try {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
  } catch (e) {
    console.warn("Peer close error", e);
  }

  // Clear remote video
  if (remoteVideo) {
    remoteVideo.srcObject = null;
  }

  // Request a new match
  setTimeout(() => {
    socket.emit("findPartner");
  }, 500);
}

/* ==============================
   6️⃣ Small Helpers
================================ */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scrollMessagesToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function showStatus(text) {
  // Quick transient banner above controls
  const id = "omingle-status";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.bottom = "50px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.background = "rgba(0,0,0,0.7)";
    el.style.color = "#fff";
    el.style.padding = "8px 12px";
    el.style.borderRadius = "6px";
    el.style.fontSize = "14px";
    el.style.zIndex = "1000";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 2000);
}

// Add window reload on error recovery
window.addEventListener('beforeunload', () => {
  if (pc) {
    pc.close();
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
});

// Request a match after media is ready
socket.on("connect", () => {
  setTimeout(() => {
    if (localStream) {
      socket.emit("findPartner");
      showStatus("Looking for a random partner...");
    }
  }, 1000);
});/* ==============================
   4️⃣ CONTROLS
================================ */
function send() {
  const input = document.getElementById("text");
  if (!input.value) return;

  messages.innerHTML += `<div>You: ${escapeHtml(input.value)}</div>`;
  socket.emit("chat", input.value);
  input.value = "";
  scrollMessagesToBottom();
}

function toggleMic() {
  micOn = !micOn;
  const tracks = localStream.getAudioTracks();
  if (tracks[0]) tracks[0].enabled = micOn;
}

function toggleCam() {
  camOn = !camOn;
  const tracks = localStream.getVideoTracks();
  if (tracks[0]) tracks[0].enabled = camOn;
}

function report() {
  if (confirm("Report this user?")) {
    socket.emit("report");
    showStatus("Reported. Finding a new match…");
    resetConnection();
  }
}

function next() {
  showStatus("Connecting to the next match…");
  resetConnection();
}

/* ==============================
   5️⃣ RESET (SAFE)
================================ */
function resetConnection() {
  try {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
  } catch (e) {
    console.warn("Peer close error", e);
  }

  // Reconnect to server fresh for a new match
  try {
    socket.disconnect();
  } catch (e) {}
  setTimeout(() => location.reload(), 400);
}

/* ==============================
   6️⃣ Small Helpers
================================ */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scrollMessagesToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function showStatus(text) {
  // Quick transient banner above controls
  const id = "omingle-status";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.bottom = "50px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.background = "rgba(0,0,0,0.7)";
    el.style.color = "#fff";
    el.style.padding = "8px 12px";
    el.style.borderRadius = "6px";
    el.style.fontSize = "14px";
    el.style.zIndex = "1000";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 1800);
}

const socket = io("https://gaaji-server.onrender.com", {
  transports: ["websocket"],
  secure: true
});


const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages = document.getElementById("messages");

let pc, localStream;
let micOn = true;
let camOn = true;

const iceConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "YOUR_TURN_USERNAME",
      credential: "YOUR_TURN_PASSWORD"
    }
  ]
};

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
.then(stream => {
  localStream = stream;
  localVideo.srcObject = stream;
});

socket.on("matched", async ({ initiator }) => {
  pc = new RTCPeerConnection(iceConfig);

  localStream.getTracks().forEach(t =>
    pc.addTrack(t, localStream)
  );

  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", e.candidate);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") reset();
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", offer);
  }
});

socket.on("signal", async data => {
  if (data.type === "offer") {
    await pc.setRemoteDescription(data);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", answer);
  } else if (data.type === "answer") {
    await pc.setRemoteDescription(data);
  } else {
    await pc.addIceCandidate(data);
  }
});

socket.on("chat", msg => {
  messages.innerHTML += `<div>Stranger: ${msg}</div>`;
});

socket.on("peer-disconnected", reset);
socket.on("reported", () => alert("You were reported and blocked"));
socket.on("banned", () => alert("You are temporarily banned"));

function send() {
  const t = text.value;
  if (!t) return;
  messages.innerHTML += `<div>You: ${t}</div>`;
  socket.emit("chat", t);
  text.value = "";
}

function toggleMic() {
  micOn = !micOn;
  localStream.getAudioTracks()[0].enabled = micOn;
}

function toggleCam() {
  camOn = !camOn;
  localStream.getVideoTracks()[0].enabled = camOn;
}

function report() {
  if (confirm("Report this user?")) socket.emit("report");
}

function next() {
  reset();
}

function reset() {
  if (pc) pc.close();
  socket.disconnect();
  setTimeout(() => location.reload(), 500);
}
iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject"
  }
]



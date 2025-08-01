

//NextJS
import Head from "next/head";

import { useRef, useState } from "react";
import io from "socket.io-client";

const SIGNALING_SERVER_URL = "http://localhost:3001";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const [inCall, setInCall] = useState(false);
  const [isCaller, setIsCaller] = useState(false);
  const [status, setStatus] = useState("");
  const [chatMessages, setChatMessages] = useState<{ sender: string; message: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<any>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Utility: Generate random room ID
  function generateRoomId() {
    return Math.random().toString(36).substring(2, 10);
  }

  // Start signaling and media
  const startCall = async () => {
    if (!username.trim()) {
      setUsernameError("Please enter your name before creating a call.");
      return;
    }
    setUsernameError("");
    const newRoomId = generateRoomId();
    setRoomId(newRoomId);
    setIsCaller(true);
    setStatus("Waiting for someone to join...");
    await startMediaAndSocket(newRoomId, true);
  };

  // Join existing call
  const joinCall = async () => {
    if (!username.trim()) {
      setUsernameError("Please enter your name before joining a call.");
      return;
    }
    setUsernameError("");
    if (!roomId) return;
    setIsCaller(false);
    setStatus("Joining call...");
    await startMediaAndSocket(roomId, false);
  };

  // Setup local media, socket, and peer connection
  const startMediaAndSocket = async (roomId: string, isCaller: boolean) => {
    // Get local media
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    // Connect to signaling server
    const socket = io(SIGNALING_SERVER_URL);
    socketRef.current = socket;
    socket.emit("join", roomId);
    // Setup peer connection
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    });
    peerRef.current = peer;
    // Send local tracks
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    // ICE candidate to signaling
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", { roomId, data: { type: "candidate", candidate: event.candidate } });
      }
    };
    // Remote stream
    peer.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    // Signaling handlers
    socket.on("peer-joined", async () => {
      setStatus("Peer joined! Creating offer...");
      if (isCaller) {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit("signal", { roomId, data: { type: "offer", offer } });
      }
    });
    socket.on("signal", async (data: any) => {
      if (data.type === "offer") {
        setStatus("Received offer. Sending answer...");
        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("signal", { roomId, data: { type: "answer", answer } });
      } else if (data.type === "answer") {
        setStatus("Received answer. Connecting...");
        await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.type === "candidate") {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error("Error adding ICE candidate", err);
        }
      }
    });
    socket.on("peer-left", () => {
      setStatus("Peer left the call.");
      cleanup();
    });
    // Chat message handler
    socket.on("chat-message", ({ message, sender }) => {
      setChatMessages(prev => [...prev, { sender, message }]);
    });
    setInCall(true);
    setStatus(isCaller ? "Waiting for peer..." : "Connected!");
  };

  // Send chat message
  const sendChatMessage = () => {
    if (chatInput.trim() && socketRef.current && roomId) {
      const senderName = username || "Anonymous";
      socketRef.current.emit("chat-message", { roomId, message: chatInput, sender: senderName });
      setChatMessages(prev => [...prev, { sender: senderName, message: chatInput }]);
      setChatInput("");
    }
  };

  const cleanup = () => {
    setInCall(false);
    setStatus("");
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  };

  // UI
  return (
    <>
      <Head>
        <title>Next.js WebRTC Template</title>
        <meta name="description" content="A simple Next.js WebRTC starter template." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charSet="UTF-8" />
      </Head>
      <main>
        <div className={`h-screen flex flex-col gap-4 items-center justify-center`}>
          <div className="flex flex-col gap-4 items-center">
            <h1 className="text-2xl font-bold mb-2">WebRTC Template</h1>
            {!inCall ? (
              <>
                <input
                  type="text"
                  className="px-2 py-1 rounded border mb-2"
                  placeholder="Your name (required)"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setUsernameError(""); }}
                />
                {usernameError && <div className="text-red-600 text-sm mb-2">{usernameError}</div>}
                <button
                  className="bg-blue-600 text-white px-4 py-2 rounded-xl mb-2 disabled:opacity-50"
                  onClick={startCall}
                  disabled={!username.trim()}
                >
                  Create Call
                </button>
                <div className="flex gap-2 mb-2 bg-gray-100 p-2 rounded-xl">
                  <input
                    type="text"
                    className="px-2 py-1 rounded"
                    placeholder="Enter Call ID"
                    value={roomId}
                    onChange={e => setRoomId(e.target.value)}
                  />
                  <button
                    className="bg-cyan-500 text-white px-4 py-2 rounded-xl disabled:opacity-50"
                    onClick={joinCall}
                    disabled={!username.trim()}
                  >
                    Join Call
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-2">Call ID: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{roomId}</span></div>
                <button className="bg-red-600 text-white px-4 py-2 rounded mb-2" onClick={cleanup}>Leave Call</button>
              </>
            )}
            <div className="mb-2 text-blue-700 min-h-[24px]">{status}</div>
            <div className="flex gap-4">
              <div>
                <div className="font-bold text-center">Local Video</div>
                <video ref={localVideoRef} autoPlay muted playsInline className="w-64 h-48 bg-black rounded" />
              </div>
              <div>
                <div className="font-bold text-center">Remote Video</div>
                <video ref={remoteVideoRef} autoPlay playsInline className="w-64 h-48 bg-black rounded" />
              </div>
            </div>
            {/* Chat UI */}
            {inCall && (
              <div className="w-full max-w-md mt-4 bg-white border rounded-xl shadow p-4 flex flex-col gap-2">
                <div className="font-bold mb-2">Live Chat</div>
                <div className="flex flex-col gap-1 h-40 overflow-y-auto bg-gray-50 p-2 rounded">
                  {chatMessages.length === 0 && <div className="text-gray-400 text-sm">No messages yet.</div>}
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className="text-sm">
                      <span className="font-semibold text-blue-700">{msg.sender}:</span> {msg.message}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    className="flex-1 px-2 py-1 rounded border"
                    placeholder="Type a message..."
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendChatMessage(); }}
                  />
                  <button
                    className="bg-blue-500 text-white px-4 py-1 rounded"
                    onClick={sendChatMessage}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

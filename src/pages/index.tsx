

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
    const newRoomId = generateRoomId();
    setRoomId(newRoomId);
    setIsCaller(true);
    setStatus("Waiting for someone to join...");
    await startMediaAndSocket(newRoomId, true);
  };

  // Join existing call
  const joinCall = async () => {
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
    setInCall(true);
    setStatus(isCaller ? "Waiting for peer..." : "Connected!");
  };

  // Cleanup
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
              <button className="bg-blue-600 text-white px-4 py-2 rounded-xl mb-2" onClick={startCall}>Create Call</button>
              <div className="flex gap-2 mb-2 bg-gray-100 p-2 rounded-xl">
                <input
                  type="text"
                  className="px-2 py-1 rounded"
                  placeholder="Enter Call ID"
                  value={roomId}
                  onChange={e => setRoomId(e.target.value)}
                />
                <button className="bg-cyan-500 text-white px-4 py-2 rounded-xl" onClick={joinCall}>Join Call</button>
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
        </div>
      </div>
      </main>
    </>
  );
}


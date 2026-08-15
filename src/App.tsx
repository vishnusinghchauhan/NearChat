import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type Status = "home" | "searching" | "chatting";
type Message = {
  id: string;
  sender: string;
  text: string;
  createdAt: string;
};

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState<Status>("home");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [distance, setDistance] = useState<number | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("Inappropriate behavior");

  const mySocketId = socketRef.current?.id;

  const statusText = useMemo(() => {
    if (status === "searching") return "Looking for someone nearby...";
    if (status === "chatting") return "Connected to a stranger";
    return "Ready to meet someone new";
  }, [status]);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"]
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setError("");
      requestLocation(socket);
    });

    socket.on("connect_error", () => {
      setError("Could not connect to the chat server.");
    });

    socket.on("matched", (data: { approximateDistanceKm?: number }) => {
      setStatus("chatting");
      setMessages([]);
      setTyping(false);
      setInfo("You found someone nearby.");
      setDistance(
        typeof data.approximateDistanceKm === "number"
          ? data.approximateDistanceKm
          : null
      );
    });

    socket.on("searching", (data: { message?: string }) => {
      setStatus("searching");
      setInfo(data.message || "Searching...");
      setDistance(null);
    });

    socket.on("message", (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("typing", (value: boolean) => {
      setTyping(value);
    });

    socket.on("partner-left", () => {
      setStatus("home");
      setInfo("The stranger left the chat.");
      setDistance(null);
      setTyping(false);
    });

    socket.on("chat-ended", () => {
      setStatus("home");
      setMessages([]);
      setDistance(null);
      setTyping(false);
    });

    socket.on("blocked", () => {
      setInfo("User blocked. Finding another person...");
      setMessages([]);
      setReportOpen(false);
    });

    socket.on("reported", () => {
      setInfo("Report submitted.");
      setReportOpen(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function requestLocation(socket: Socket) {
    if (!navigator.geolocation) {
      setError("Your browser does not support location services.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        // We send coordinates only to our server for matching.
        // The server never sends exact coordinates to another user.
        socket.emit(
          "set-location",
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          },
          (result: { ok: boolean; error?: string }) => {
            if (!result?.ok) {
              setError(result?.error || "Could not set location.");
              return;
            }
            setLocationReady(true);
            setError("");
          }
        );
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setError(
            "Location permission is required because this app matches nearby people."
          );
        } else {
          setError("Could not determine your location.");
        }
      },
      {
        enableHighAccuracy: false,
        maximumAge: 5 * 60 * 1000,
        timeout: 10000
      }
    );
  }

  function findStranger() {
    const socket = socketRef.current;

    if (!socket) {
      setError("Not connected to the server.");
      return;
    }

    if (!locationReady) {
      requestLocation(socket);
      return;
    }

    setError("");
    setInfo("Searching...");
    setStatus("searching");

    socket.emit(
      "find-stranger",
      (result: { ok: boolean; searching?: boolean; error?: string }) => {
        if (!result?.ok) {
          setStatus("home");
          setError(result?.error || "Could not start matching.");
        }
      }
    );
  }

  function nextStranger() {
    const socket = socketRef.current;
    if (!socket) return;

    setMessages([]);
    setTyping(false);
    setInfo("Finding another person...");
    setStatus("searching");
    socket.emit("next");
  }

  function leaveChat() {
    socketRef.current?.emit("leave");
  }

  function sendMessage() {
    const socket = socketRef.current;
    const text = message.trim();

    if (!socket || !text || status !== "chatting") return;

    socket.emit(
      "message",
      { text },
      (result: { ok: boolean; error?: string }) => {
        if (!result?.ok) {
          setError(result?.error || "Message could not be sent.");
          return;
        }
        setMessage("");
        socket.emit("typing", false);
      }
    );
  }

  function handleTyping(value: string) {
    setMessage(value);
    socketRef.current?.emit("typing", value.trim().length > 0);
  }

  function submitReport() {
    socketRef.current?.emit("report", { reason: reportReason });
  }

  function blockUser() {
    if (
      window.confirm(
        "Block this person and find someone else?"
      )
    ) {
      socketRef.current?.emit("block");
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">NearChat</div>
          <div className="tagline">Meet someone nearby</div>
        </div>

        {status !== "home" && (
          <div className="status-pill">
            <span className="status-dot" />
            {status === "searching" ? "Searching" : "Connected"}
          </div>
        )}
      </header>

      <main className="container">
        {error && <div className="alert error">{error}</div>}
        {info && !error && <div className="alert info">{info}</div>}

        {status === "home" && (
          <section className="hero card">
            <div className="hero-icon">📍</div>
            <h1>Chat with someone nearby</h1>
            <p>
              NearChat finds an available stranger close to your location
              first, then expands the search when nobody nearby is available.
            </p>

            <div className="privacy">
              <span>🔒</span>
              <div>
                <strong>Your exact location stays private</strong>
                <small>
                  Location is used only by the server for matching. Other
                  users never receive your coordinates.
                </small>
              </div>
            </div>

            <button
              className="primary-button"
              onClick={findStranger}
              disabled={!locationReady}
            >
              {locationReady ? "Find Stranger" : "Allow Location First"}
            </button>

            {!locationReady && (
              <button
                className="link-button"
                onClick={() => socketRef.current && requestLocation(socketRef.current)}
              >
                Request location permission
              </button>
            )}

            <div className="rules">
              <span>Be respectful</span>
              <span>•</span>
              <span>Don't share private information</span>
              <span>•</span>
              <span>Report abuse</span>
            </div>
          </section>
        )}

        {status === "searching" && (
          <section className="search card">
            <div className="loader" />
            <h2>Finding a stranger</h2>
            <p>
              We are looking for someone nearby. If nobody is available,
              we'll gradually expand the search.
            </p>
            <button className="secondary-button" onClick={leaveChat}>
              Cancel
            </button>
          </section>
        )}

        {status === "chatting" && (
          <section className="chat card">
            <div className="chat-header">
              <div>
                <div className="stranger-name">
                  <span className="online-dot" />
                  Stranger
                </div>
                <div className="distance">
                  {distance !== null
                    ? distance < 1
                      ? "Nearby"
                      : `Approximately ${distance} km away`
                    : "Nearby"}
                </div>
              </div>

              <div className="chat-actions">
                <button onClick={() => setReportOpen(true)}>Report</button>
                <button onClick={blockUser}>Block</button>
              </div>
            </div>

            <div className="messages">
              {messages.length === 0 && (
                <div className="empty-chat">
                  <div className="empty-icon">👋</div>
                  <strong>Say hello!</strong>
                  <span>Start the conversation with a simple hello.</span>
                </div>
              )}

              {messages.map((msg) => {
                const mine = msg.sender === mySocketId;

                return (
                  <div
                    key={msg.id}
                    className={`message-row ${mine ? "mine" : "theirs"}`}
                  >
                    <div className="bubble">{msg.text}</div>
                  </div>
                );
              })}

              {typing && (
                <div className="typing">Stranger is typing...</div>
              )}

              <div ref={bottomRef} />
            </div>

            <div className="composer">
              <input
                value={message}
                onChange={(e) => handleTyping(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage();
                }}
                placeholder="Type a message..."
                maxLength={1000}
              />
              <button onClick={sendMessage} disabled={!message.trim()}>
                Send
              </button>
            </div>

            <div className="bottom-actions">
              <button className="next-button" onClick={nextStranger}>
                🔄 Next Stranger
              </button>
              <button className="leave-button" onClick={leaveChat}>
                Leave
              </button>
            </div>
          </section>
        )}

        <div className="status-text">{statusText}</div>
      </main>

      {reportOpen && (
        <div className="modal-backdrop" onClick={() => setReportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Report this user</h2>
            <p>Why are you reporting this person?</p>

            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
            >
              <option>Inappropriate behavior</option>
              <option>Harassment</option>
              <option>Spam</option>
              <option>Threatening behavior</option>
              <option>Other</option>
            </select>

            <div className="modal-actions">
              <button onClick={() => setReportOpen(false)}>Cancel</button>
              <button className="danger" onClick={submitReport}>
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}

      <footer>
        <span>NearChat MVP</span>
        <span>•</span>
        <span>Never share sensitive personal information with strangers.</span>
      </footer>
    </div>
  );
}

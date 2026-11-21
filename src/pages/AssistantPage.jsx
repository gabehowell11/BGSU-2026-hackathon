import React, { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";

export default function AssistantPage({ setItems }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pendingActions, setPendingActions] = useState([]);
  const [rejectedActions, setRejectedActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState(null);
  const scrollRef = useRef(null);

  async function refreshHistory() {
    if (!window.database?.listChatMessages) return;
    setMessages(await window.database.listChatMessages());
  }

  useEffect(() => {
    refreshHistory().catch((nextError) => setError(nextError.message));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pendingActions, loading]);

  useEffect(() => {
    if (streamText) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [streamText]);

  async function send(event) {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) return;

    const optimisticMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticMessage]);
    setInput("");
    setLoading(true);
    setError("");
    setPendingActions([]);
    setRejectedActions([]);
    setStreamText("");

    try {
      let response;
      if (window.aivana?.chatStream) {
        response = await window.aivana.chatStream(content, (piece) => {
          setStreamText((current) => (current || "") + piece);
        });
      } else if (window.aivana?.chat) {
        response = await window.aivana.chat(content);
      } else {
        throw new Error("The assistant API is unavailable.");
      }
      setMessages(await window.database.listChatMessages());
      setPendingActions(response.actions || []);
      setRejectedActions(response.rejected || []);
    } catch (nextError) {
      setMessages((current) => current.filter((message) => message.id !== optimisticMessage.id));
      setInput(content);
      setError(nextError.message || "The assistant could not respond.");
    } finally {
      setStreamText(null);
      setLoading(false);
    }
  }

  async function applyActions() {
    if (!pendingActions.length || loading) return;
    setLoading(true);
    setError("");
    try {
      await window.aivana.applyChatActions(pendingActions);
      setPendingActions([]);
      setItems(await window.database.listItems());
      await refreshHistory();
    } catch (nextError) {
      setError(nextError.message || "The proposed changes could not be applied.");
    } finally {
      setLoading(false);
    }
  }

  async function clearChat() {
    if (!window.database?.clearChatMessages) return;
    try {
      await window.database.clearChatMessages();
      setMessages([]);
      setPendingActions([]);
      setRejectedActions([]);
      setError("");
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  return (
    <>
      <header className="page-header assistant-header">
        <div>
          <span className="eyebrow">Planning assistant</span>
          <h1>Assistant</h1>
        </div>
        <button className="secondary-button" type="button" onClick={clearChat} disabled={!messages.length}>
          Clear chat
        </button>
      </header>

      <div className="assistant-layout">
        <section className="chat-panel">
          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && !loading && (
              <div className="chat-empty">
                <h2>Plan with your assignment data</h2>
                <p>Ask about deadlines, workload, or changes you want to make.</p>
                <div className="chat-suggestions">
                  <button type="button" onClick={() => setInput("What is due this week?")}>What is due this week?</button>
                  <button type="button" onClick={() => setInput("Which assignments should I prioritize?")}>Which should I prioritize?</button>
                  <button type="button" onClick={() => setInput("Summarize my upcoming workload.")}>Summarize my workload</button>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={`chat-message ${message.role}`}>
                <span className="chat-role">{message.role === "user" ? "You" : "Assistant"}</span>
                <p>{message.content}</p>
              </div>
            ))}

            {(pendingActions.length > 0 || rejectedActions.length > 0) && (
              <div className="chat-proposals">
                {pendingActions.length > 0 && (
                  <div className="proposal-card">
                    <div className="proposal-heading">
                      <span>Proposed changes</span>
                      <small>Nothing is applied yet</small>
                    </div>
                    {pendingActions.map((action) => (
                      <div className="proposal-row" key={action.actionId}>
                        <span className={`proposal-op ${action.op}`}>{action.op}</span>
                        <p>{action.summary}</p>
                      </div>
                    ))}
                    <div className="proposal-actions">
                      <button className="secondary-button" type="button" onClick={() => setPendingActions([])} disabled={loading}>Cancel</button>
                      <button className="primary-button" type="button" onClick={applyActions} disabled={loading}>
                        {loading ? "Applying..." : "Apply changes"}
                      </button>
                    </div>
                  </div>
                )}
                {rejectedActions.map((action, index) => (
                  <div className="proposal-rejected" key={`${action.summary}-${index}`}>
                    <strong>{action.summary}</strong>
                    <span>{action.reason}</span>
                  </div>
                ))}
              </div>
            )}

            {loading && streamText !== null && (
              <div className="chat-message assistant streaming" aria-live="polite">
                <span className="chat-role">Assistant</span>
                {streamText.trim()
                  ? <p>{streamText.trimStart()}<span className="chat-caret" aria-hidden="true" /></p>
                  : <p className="chat-loading"><span /><span /><span /></p>}
              </div>
            )}
          </div>

          {error && <div className="chat-error" role="alert">{error}</div>}
          <form className="chat-composer" onSubmit={send}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(event);
                }
              }}
              rows="2"
              placeholder="Ask about assignments or plan a change..."
            />
            <button className="primary-button" type="submit" disabled={!input.trim() || loading} aria-label="Send message">
              <Icon name="send" size={17} />
            </button>
          </form>
        </section>
      </div>
    </>
  );
}

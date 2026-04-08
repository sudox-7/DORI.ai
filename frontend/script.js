const textarea = document.querySelector(".user-input");
const btn = document.querySelector(".send-button");
const messagesContainer = document.getElementById("messages-container");
const hey_msg = document.querySelector(".heym");
const chatContainer = document.querySelector(".chat");

// ✅ Track first message
let isFirstMessage = true;

// ✅ Style hey_msg fully in JS
hey_msg.style.position = "fixed";
hey_msg.style.top = "28%";
hey_msg.style.left = "50%";
hey_msg.style.transform = "translate(-50%, -50%)";
hey_msg.style.color = "antiquewhite";
hey_msg.style.fontSize = "33px";
hey_msg.style.fontWeight = "600";
hey_msg.style.zIndex = "999";
hey_msg.style.whiteSpace = "nowrap";
hey_msg.style.pointerEvents = "none";
hey_msg.style.opacity = "1";

// ✅ Set chat to center on load
chatContainer.style.position = "fixed";
chatContainer.style.top = "50%";
chatContainer.style.left = "50%";
chatContainer.style.transform = "translate(-50%, -50%)";
chatContainer.style.bottom = "unset";
chatContainer.style.opacity = "1";

// ✅ Move chat to bottom and hide hey_msg on first message
function setBottomState() {
  // hide hey_msg
  hey_msg.style.opacity = "0";

  // move chat back to bottom
  chatContainer.style.top = "unset";
  chatContainer.style.bottom = "15px";
  chatContainer.style.left = "50%";
  chatContainer.style.transform = "translateX(-50%)";
  chatContainer.style.opacity = "1";
}

// ✅ Real streaming function
async function mainStream(prompt, thinkingDiv) {
  const res = await fetch("http://localhost:3000/api/agent/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) throw new Error("Server error");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let firstToken = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const raw = decoder.decode(value);
    const lines = raw.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;

      let json;
      try {
        json = JSON.parse(line.slice(6));
      } catch {
        continue;
      }

      if (json.error) throw new Error(json.error);

      if (json.token) {
        if (firstToken) {
          thinkingDiv.innerHTML = "";
          firstToken = false;
        }

        fullText += json.token;

        if (fullText.length % 5 === 0) {
          thinkingDiv.innerHTML = marked.parse(fullText);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }

      if (json.done) {
        thinkingDiv.innerHTML = marked.parse(fullText);

        thinkingDiv.querySelectorAll("pre code").forEach((block) => {
          hljs.highlightElement(block);

          const pre = block.parentElement;
          pre.style.position = "relative";

          const copyBtn = document.createElement("button");
          copyBtn.innerText = "Copy";
          copyBtn.style.cssText = `
            position: absolute; top: 10px; right: 10px;
            background: rgba(255,255,255,0.08);
            color: #fff; border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px; padding: 4px 10px;
            font-size: 12px; cursor: pointer; z-index: 10;
          `;
          copyBtn.addEventListener("click", () => {
            navigator.clipboard.writeText(block.innerText).then(() => {
              copyBtn.innerText = "Copied!";
              copyBtn.style.color = "#4ade80";
              setTimeout(() => {
                copyBtn.innerText = "Copy";
                copyBtn.style.color = "#fff";
              }, 2000);
            });
          });
          pre.appendChild(copyBtn);
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return;
      }
    }
  }

  if (fullText) {
    thinkingDiv.innerHTML = marked.parse(fullText);
    thinkingDiv.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightElement(block);
    });
  }
}

function appendMessage(role, text) {
  const div = document.createElement("div");
  div.classList.add(role);
  const p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);
  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return div;
}

function appendThinking() {
  const div = document.createElement("div");
  div.classList.add("ai");
  div.innerHTML = `
    <div class="thinking-container">
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
      <div class="thinking-dot"></div>
    </div>
  `;
  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return div;
}

textarea.addEventListener("input", () => {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
});

btn.addEventListener("click", async () => {
  const prompt = textarea.value.trim();
  if (!prompt) return;

  // ✅ First message only — animate to bottom
  if (isFirstMessage) {
    isFirstMessage = false;
    setBottomState();
  }

  textarea.disabled = true;
  btn.disabled = true;

  appendMessage("user", prompt);
  textarea.value = "";
  textarea.style.height = "auto";

  const thinkingDiv = appendThinking();

  try {
    await mainStream(prompt, thinkingDiv);
  } catch (error) {
    thinkingDiv.innerHTML = `<p style="color: #ff00009a; font-weight:400;">⚠️ No response — please try again.</p>`;
    console.error("Fetch error:", error);
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  textarea.disabled = false;
  btn.disabled = false;
  textarea.focus();
});

textarea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    btn.click();
  }
});

import aiWeb from "./aiweb.js"; // بدّل path إذا مختلف

async function test() {
  const prompt = `Jack Dorsey's AI layoffs - Block Inc. is cutting jobs while framing it as an AI transition, exposing a pattern where tech companies use AI as justification for workforce reductions..`;

  const result = await aiWeb.askChatGPTWeb("chatgpt", prompt, {
    timeoutMs: 60000,
  });

  console.log("\nRESULT:\n");
  console.log(result);
}

test();

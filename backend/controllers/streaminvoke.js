import { runAgentStream } from "../../Agents/agent.js";
import agentCallValidation from "../middlewares/agentCallValidation.js";

const streamInvoke = async (req, res) => {
    const validationResult = agentCallValidation.safeParse(req.body);
  
    if (!validationResult.success) {
      return res.status(400).json({
        message: "Invalid request body",
        data: validationResult.error.errors.map((err) => err.message),
      });
    }

    const prompt = validationResult.data.prompt;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    await runAgentStream(prompt, (token) => {
      // ✅ Send each token immediately
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Stream error:", error);
    res.write(`data: ${JSON.stringify({ error: "Agent error" })}\n\n`);
    res.end();
  }
};
export default streamInvoke;

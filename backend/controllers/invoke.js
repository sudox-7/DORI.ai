import { runAgent } from "../../Agents/agent.js";
import agentCallValidation from "../middlewares/agentCallValidation.js";

const invokeAgent = async (req, res) => {
  const validationResult = agentCallValidation.safeParse(req.body);

  if (!validationResult.success) {
    return res.status(400).json({
      message: "Invalid request body",
      data: validationResult.error.errors.map((err) => err.message),
    });
  }

  const prompt = validationResult.data.prompt;
  const finalMessage = await runAgent(prompt);
  const data = finalMessage.messages[finalMessage.messages.length - 1].content;

  if (!data) {
    return res.status(500).json({
      message: "No response from agent",
      data: "No data received from agent.",
    });
  }
  res.status(200).json({ message: "Agent response received", data });
};
export default invokeAgent;

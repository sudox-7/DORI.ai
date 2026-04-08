import {z} from "zod";


const agentCallValidation = z.object({
  prompt: z.string().min(1, "Prompt is required").trim(),
});
export default agentCallValidation;
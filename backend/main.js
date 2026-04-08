import express from "express";
import helmet from "helmet";
import agentRoutes from "./routers/agentroutes.js";
import cors from "cors";
import routerHandler from './middlewares/globalErrorRouteHandler.js';

// creat express app
const app = express();

// use helmet  middlewares for security
app.use(helmet());

// use cors middlewares for cross-origin requests
app.use(cors());

// use json middleware to parse incoming JSON requests
app.use(express.json());

//health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" }); // ✅ useful for deployment monitoring
});

// use agent routes
app.use("/api/agent", agentRoutes);

// global error route handler for invalid routes
app.use(routerHandler);


export { app };


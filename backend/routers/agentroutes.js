import express from "express";
import streamInvoke from "../controllers/streaminvoke.js";
import invokeAgent from "../controllers/invoke.js";


const app = express();

const router = express.Router();

router.route('/stream')
    .post(streamInvoke);

router.route('/')
    .post(invokeAgent);

export default router;



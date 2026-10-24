import express from "express";
import connectDb from "./config/db.js";
import dns from "node:dns"
import dotenv from "dotenv";
import cors from "cors";


dotenv.config();
dns.setServers(["8.8.8.8", "1.1.1.1"]);

// port listening
const PORT = process.env.PORT || 8000;
const app = express();
app.use(cors());

// db connect
app.use(express.json());
connectDb()






app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

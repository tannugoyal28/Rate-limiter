import express from "express";
import { getRedisClient , isRedisHealthy } from "./redis/client";
import {createRateLimiterMiddleware} from "./middleware/rateLimiter";

const app = express();
app.use(express.json());

getRedisClient()

app.get('/',async (req,res)=>{
    const isRedisAlive =  await isRedisHealthy();
    return res.json({
        status: "ok",
        redis: isRedisAlive ? "connected" : "down"
    })

})

const limiter = createRateLimiterMiddleware();

app.get("/api/search", limiter, (req, res) => {
  res.json({ message: "search results here" });
});

app.listen(3000,()=>{
    console.log(`Listening at port 3000`);
})

import express from "express";
import { getRedisClient , isRedisHealthy } from "./redis/client";

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

app.listen(3000,()=>{
    console.log(`Listening at port 3000`);
})

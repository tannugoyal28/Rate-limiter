import Redis from "ioredis";

let client:Redis | null = null;

export function getRedisClient():Redis {
    if(client) return client;

    client = new Redis({
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        enableOfflineQueue: false
    })

    client.on("connect", () => {
        console.log("[Redis] Connected");
    });

    client.on("error", (error:any) => {
        console.error("[Redis] Error:", error.message);
    });

    client.on("close", () => {
        console.warn("[Redis] Connection closed");
    });

    return client;
}

    export async function isRedisHealthy(): Promise<boolean> {
        try {
            const redis = getRedisClient();
            const result = await redis.ping();
            return result === "PONG";
        } catch {
             return false;
        }
    }
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedisClient(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return null;
  }

  if (!client) {
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true
    });
  }

  return client;
}

export async function redisHealth(): Promise<{ configured: boolean; ok: boolean; error?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    return { configured: false, ok: false };
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    const pong = await redis.ping();
    return { configured: true, ok: pong === "PONG" };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown redis error"
    };
  }
}

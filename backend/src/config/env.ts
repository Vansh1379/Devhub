import dotenv from "dotenv";

dotenv.config();

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const env = {
  port: Number(process.env.PORT) || 4000,
  dbUrl: required(process.env.DATABASE_URL, "DATABASE_URL"),
  jwtSecret: required(process.env.JWT_SECRET, "JWT_SECRET"),
  dyteAuthHeader: process.env.DYTE_AUTH_HEADER ?? "",
  dyteOrgId: process.env.DYTE_ORG_ID ?? "",
  dyteApiKey: process.env.DYTE_API_KEY ?? "",
  dytePresetName: process.env.DYTE_PRESET_NAME ?? "group_call",
  redisUrl: process.env.REDIS_URL ?? "",
};


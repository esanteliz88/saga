import pino from "pino";
const pretty = process.env.NODE_ENV !== "production";
export const logger = pino(
  pretty
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } } }
    : {}
);

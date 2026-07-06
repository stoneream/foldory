import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  level: "http",
  defaultMeta: {
    service: "foldory",
  },
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [
    new transports.Console({
      stderrLevels: ["error", "warn", "http"],
    }),
  ],
});

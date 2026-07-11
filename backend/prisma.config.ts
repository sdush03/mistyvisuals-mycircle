import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrate: {
    url: process.env.DATABASE_URL!,
  },
});

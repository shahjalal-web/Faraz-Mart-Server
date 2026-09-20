import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { createApp } from "./app";
import { ensureDefaultRoles } from "./routes/roles.routes";

const PORT = Number(process.env.PORT) || 4000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Faraz Mart backend listening on http://localhost:${PORT}`);

  // Built-in roles must exist in the database so the Roles page can list and edit them.
  ensureDefaultRoles().catch((error) => console.error("Couldn't ensure default roles:", error));
});

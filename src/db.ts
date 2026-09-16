import dns from "node:dns";
import mongoose from "mongoose";

// mongodb+srv:// needs a DNS SRV lookup to find the cluster's real hosts.
// Node's own resolver (c-ares) can fail that lookup with ECONNREFUSED on
// networks where a VPN/virtual adapter's DNS server (visible to the OS
// resolver, e.g. via `nslookup`) doesn't answer c-ares' query the same way —
// a known Node-on-VPN issue. Pointing Node at public DNS resolvers sidesteps
// it without needing a different connection string.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

let connected = false;

/**
 * Backend runs as one long-lived Node process (unlike the Next.js frontend,
 * which can hot-reload modules in dev), so a simple boolean flag is enough —
 * no need for the global-cache pattern Next.js + Mongoose setups usually need.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  if (connected) return mongoose;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to backend/.env before using the database.");
  }

  await mongoose.connect(uri);
  connected = true;
  return mongoose;
}

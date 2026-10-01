import net from "node:net";
import dns from "node:dns";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

export function assertLocalHost(host) {
  if (host === undefined || host === "localhost" || host === "::1" || host === "127.0.0.1") return;
  const error = new Error("ローカルモードで外部通信を拒否しました。");
  error.code = "ORBIT_LOCAL_NETWORK_DENIED";
  throw error;
}

// Node CLI children only. workerd requires independent OS-level verification.
if (process.env.ORBIT_LOCAL_MODE === "1") {
  const check = (host) => {
    try {
      assertLocalHost(host);
    } catch (error) {
      appendFileSync(
        `${process.env.ORBIT_LOCAL_DATA_DIR}.network-denied.log`,
        `${new Date().toISOString()} ${error.code}\n`,
      );
      process.stderr.write(`${error.message}\n`);
      throw error;
    }
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const second = Array.isArray(args[0]) ? args[0][1] : args[1];
    if (typeof first === "object") {
      if (!first.path) check(first.host);
    } else if (typeof first === "number") check(typeof second === "string" ? second : undefined);
    // A string first argument is a Unix-domain socket path.
    return connect.apply(this, args);
  };
  const lookup = dns.lookup;
  dns.lookup = function (host, ...args) {
    // A wildcard bind resolves this numeric address without an external DNS query.
    if (host !== "0.0.0.0") check(host);
    return lookup.call(this, host, ...args);
  };
  const promiseLookup = dns.promises.lookup;
  dns.promises.lookup = function (host, ...args) {
    if (host !== "0.0.0.0") check(host);
    return promiseLookup.call(this, host, ...args);
  };
  syncBuiltinESMExports();
}

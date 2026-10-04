import assert from "node:assert/strict";
import { configureProxyFromEnv, resolveProxyConfig } from "../server/proxyConfig.js";

const direct = resolveProxyConfig({});
assert.equal(direct.status.code, "DIRECT");
assert.equal(direct.status.enabled, false);

const https = resolveProxyConfig({
  HTTPS_PROXY: "http://proxy-user:proxy-password@127.0.0.1:7890",
  NO_PROXY: "localhost,127.0.0.1",
});
assert.equal(https.status.enabled, true);
assert.equal(https.status.source, "HTTPS_PROXY");
assert.equal(https.status.protocol, "http");
assert.equal(JSON.stringify(https.status).includes("proxy-user"), false, "公开状态不能包含代理用户名");
assert.equal(JSON.stringify(https.status).includes("proxy-password"), false, "公开状态不能包含代理密码");
assert.equal(JSON.stringify(https.status).includes("7890"), false, "公开状态不能包含代理端口");

const lowerCaseWins = resolveProxyConfig({
  HTTPS_PROXY: "http://127.0.0.1:7890",
  https_proxy: "https://127.0.0.1:7891",
});
assert.equal(lowerCaseWins.status.protocol, "https");

const allHttp = resolveProxyConfig({ ALL_PROXY: "http://127.0.0.1:7890" });
assert.equal(allHttp.status.enabled, true);
assert.equal(allHttp.status.source, "ALL_PROXY");
assert.equal(allHttp.proxyEnv.https_proxy, "http://127.0.0.1:7890");

const socks = resolveProxyConfig({ ALL_PROXY: "socks5://127.0.0.1:1080" });
assert.equal(socks.status.code, "SOCKS_PROXY_UNSUPPORTED");
assert.equal(socks.status.enabled, false);

const httpOnly = resolveProxyConfig({ HTTP_PROXY: "http://127.0.0.1:7890" });
assert.equal(httpOnly.status.code, "HTTPS_PROXY_MISSING");

let applied = null;
const configured = configureProxyFromEnv(
  { HTTPS_PROXY: "http://127.0.0.1:7890", NO_PROXY: "localhost" },
  (proxyEnv) => { applied = proxyEnv; },
);
assert.equal(configured.code, "PROXY_ENABLED");
assert.deepEqual(applied, { https_proxy: "http://127.0.0.1:7890", no_proxy: "localhost" });

let socksApplied = false;
configureProxyFromEnv({ ALL_PROXY: "socks5://127.0.0.1:1080" }, () => { socksApplied = true; });
assert.equal(socksApplied, false, "不支持的 SOCKS 地址不能安装到全局网络栈");

console.log("Proxy config tests passed: direct, HTTP(S), ALL_PROXY mapping, SOCKS rejection and redaction verified.");

const supportedProtocols = new Set(["http:", "https:"]);

function pickEnv(env, lowerName, upperName) {
  if (typeof env[lowerName] === "string" && env[lowerName].trim()) {
    return { key: upperName, value: env[lowerName].trim() };
  }
  if (typeof env[upperName] === "string" && env[upperName].trim()) {
    return { key: upperName, value: env[upperName].trim() };
  }
  return null;
}

function proxyProtocol(value) {
  if (!value) return null;
  try {
    return new URL(value).protocol.toLowerCase();
  } catch {
    return "invalid:";
  }
}

function publicProtocol(protocol) {
  return protocol ? protocol.replace(":", "") : null;
}

// 只返回代理类型和来源，不返回主机、端口、用户名、密码或完整 URL。
export function resolveProxyConfig(env = process.env) {
  const http = pickEnv(env, "http_proxy", "HTTP_PROXY");
  let https = pickEnv(env, "https_proxy", "HTTPS_PROXY");
  const all = pickEnv(env, "all_proxy", "ALL_PROXY");
  const noProxy = pickEnv(env, "no_proxy", "NO_PROXY");
  let source = https?.key ?? null;

  // Node 24 的内置代理不读取 ALL_PROXY；仅当它是 HTTP(S) URL 时安全映射给 HTTPS_PROXY。
  if (!https && all) {
    https = all;
    source = "ALL_PROXY";
  }

  const httpsProtocol = proxyProtocol(https?.value);
  const httpProtocol = proxyProtocol(http?.value);
  const proxyEnv = {};
  if (http?.value && supportedProtocols.has(httpProtocol)) proxyEnv.http_proxy = http.value;
  if (https?.value && supportedProtocols.has(httpsProtocol)) proxyEnv.https_proxy = https.value;
  if (noProxy?.value) proxyEnv.no_proxy = noProxy.value;

  if (httpsProtocol === "socks:" || httpsProtocol === "socks4:" || httpsProtocol === "socks5:" || httpsProtocol === "socks5h:") {
    return {
      proxyEnv,
      status: {
        enabled: false,
        configured: true,
        source,
        protocol: publicProtocol(httpsProtocol),
        code: "SOCKS_PROXY_UNSUPPORTED",
      },
    };
  }
  if (httpsProtocol === "invalid:") {
    return {
      proxyEnv,
      status: {
        enabled: false,
        configured: true,
        source,
        protocol: null,
        code: "INVALID_PROXY_URL",
      },
    };
  }
  if (https?.value && !supportedProtocols.has(httpsProtocol)) {
    return {
      proxyEnv,
      status: {
        enabled: false,
        configured: true,
        source,
        protocol: publicProtocol(httpsProtocol),
        code: "UNSUPPORTED_PROXY_PROTOCOL",
      },
    };
  }
  if (!https && http) {
    return {
      proxyEnv,
      status: {
        enabled: false,
        configured: true,
        source: "HTTP_PROXY",
        protocol: publicProtocol(httpProtocol),
        code: "HTTPS_PROXY_MISSING",
      },
    };
  }
  if (https?.value) {
    return {
      proxyEnv,
      status: {
        enabled: true,
        configured: true,
        source,
        protocol: publicProtocol(httpsProtocol),
        code: "PROXY_ENABLED",
      },
    };
  }
  return {
    proxyEnv,
    status: {
      enabled: false,
      configured: false,
      source: null,
      protocol: null,
      code: "DIRECT",
    },
  };
}

export function configureProxyFromEnv(env = process.env, applyProxy) {
  const resolved = resolveProxyConfig(env);
  if (resolved.status.enabled && typeof applyProxy === "function") {
    applyProxy(resolved.proxyEnv);
  }
  return resolved.status;
}

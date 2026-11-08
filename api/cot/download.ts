/**
 * Binary download for the CFTC archives.
 *
 * www.cftc.gov sits behind a bot layer that fingerprint-blocks Node's default
 * TLS ClientHello (the sandbox reproduces this: plain `fetch` gets 403 while
 * a browser-like cipher/curve/ALPN profile gets 200). The profile below is
 * applied at this single provider boundary only; everything else in the
 * worker uses plain fetch.
 */
import https from "node:https";
import type { ConnectionOptions } from "node:tls";

const CHROME_LIKE_CIPHERS =
  "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:" +
  "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:" +
  "ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:" +
  "ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:" +
  "ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";

const MAX_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

export async function fetchBinary(url: string, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions & Pick<ConnectionOptions, "ALPNProtocols"> = {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      ciphers: CHROME_LIKE_CIPHERS,
      ecdhCurve: "X25519:P-256:P-384",
      ALPNProtocols: ["http/1.1"],
      timeout: TIMEOUT_MS,
    };
    const req = https.request(
      url,
      options,
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 3) {
            reject(new Error(`too many redirects fetching ${url}`));
            return;
          }
          const next = new URL(res.headers.location, url).toString();
          fetchBinary(next, redirects + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`download failed: HTTP ${status} for ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error(`download exceeds size limit for ${url}`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`download timed out for ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

import "@tanstack/react-start/server-only";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const MAX_REDIRECTS = 4;
const DEFAULT_MAX_BYTES = 1_000_000;

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second, third] = parts as [number, number, number, number];
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function ipv6Groups(input: string): number[] | null {
  let address = input.toLowerCase();
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    const ipv4 = address.slice(separator + 1);
    if (!isPublicIpv4(ipv4) && isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    address = `${address.slice(0, separator)}:${(((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parse = (parts: string[]) =>
    parts.map((part) => (/^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : NaN));
  const before = parse(left);
  const after = parse(right);
  const missing = 8 - before.length - after.length;
  if (
    before.some(Number.isNaN) ||
    after.some(Number.isNaN) ||
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  return [...before, ...Array<number>(missing).fill(0), ...after];
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family !== 6) return false;

  const groups = ipv6Groups(normalized);
  if (!groups) return false;
  if (groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff) {
    return isPublicIpv4(
      `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`,
    );
  }
  const first = groups[0]!;
  const second = groups[1]!;
  return (
    (first & 0xe000) === 0x2000 &&
    !(first === 0x2001 && second <= 0x01ff) &&
    !(first === 0x2001 && second === 0x0db8) &&
    first !== 0x2002
  );
}

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.endsWith(".") ||
    (url.port !== "" && url.port !== (url.protocol === "https:" ? "443" : "80"))
  ) {
    throw new Error("URL target is not allowed.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".onion")
  ) {
    throw new Error("URL target is not allowed.");
  }
  return url;
}

async function resolvePublicAddresses(
  url: URL,
): Promise<Array<{ address: string; family: number }>> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses =
    literalFamily === 4 || literalFamily === 6
      ? [{ address: hostname, family: literalFamily }]
      : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("URL target is not allowed.");
  }
  return addresses;
}

function requestOnce(
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ status: number; headers: Headers; text: string }> {
  return new Promise((resolve, reject) => {
    void resolvePublicAddresses(url)
      .then((addresses) => {
        const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
          if (options.all) {
            callback(null, addresses);
          } else {
            const address = addresses[0]!;
            callback(null, address.address, address.family);
          }
        };
        const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
        const request = requester(
          {
            protocol: url.protocol,
            hostname: url.hostname.replace(/^\[|\]$/g, ""),
            port: url.port || undefined,
            method: "GET",
            path: `${url.pathname}${url.search}`,
            headers: { "User-Agent": "LORD-AI/1.0", Accept: "text/html,text/plain,*/*;q=0.5" },
            lookup: pinnedLookup,
            signal,
          },
          (response) => {
            const chunks: Buffer[] = [];
            let bytesRead = 0;
            response.on("data", (chunk: Buffer) => {
              bytesRead += chunk.length;
              if (bytesRead > maxBytes) {
                request.destroy(new Error("The remote page exceeded the allowed size."));
                return;
              }
              chunks.push(chunk);
            });
            response.once("error", reject);
            response.once("end", () => {
              const headers = new Headers();
              for (const [name, value] of Object.entries(response.headers)) {
                if (typeof value === "string") headers.set(name, value);
                else if (Array.isArray(value)) headers.set(name, value.join(", "));
              }
              resolve({
                status: response.statusCode ?? 502,
                headers,
                text: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        request.once("error", reject);
        request.setTimeout(15_000, () =>
          request.destroy(new Error("The remote page request timed out.")),
        );
        request.end();
      })
      .catch(reject);
  });
}

export async function safeFetchText(
  input: string,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<{ ok: boolean; status: number; headers: Headers; text: string }> {
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(15_000),
  ]);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  let url = parseHttpUrl(input);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await requestOnce(url, signal, maxBytes);
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      return { ...response, ok: response.status >= 200 && response.status < 300 };
    }
    if (redirectCount >= MAX_REDIRECTS)
      throw new Error("The remote page redirected too many times.");
    url = parseHttpUrl(new URL(location, url).toString());
  }
}

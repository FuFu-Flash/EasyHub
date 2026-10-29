import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_DEBUG_CERTIFICATE,
  isPublicDebugCertificate,
  parseCertificateDigests,
} from "../../../scripts/verify-android-signature.mjs";

const output = (digest) => `Signer #1 certificate DN: CN=Android Debug, O=Android, C=US
Signer #1 certificate SHA-256 digest: ${digest}
Signer #1 certificate SHA-1 digest: 5e8f16062ea3cd2c4a0d547876baa6f38cabf625
`;

test("the known public debug certificate is recognised in either digest format", () => {
  assert.equal(PUBLIC_DEBUG_CERTIFICATE.length, 64);
  assert.ok(isPublicDebugCertificate(PUBLIC_DEBUG_CERTIFICATE));
  assert.ok(
    isPublicDebugCertificate(
      "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
    ),
  );
  assert.ok(!isPublicDebugCertificate("0".repeat(64)));
});

test("apksigner output yields only the SHA-256 digests, so a SHA-1 line is never mistaken for a certificate", () => {
  assert.deepEqual(parseCertificateDigests(output(PUBLIC_DEBUG_CERTIFICATE)), [PUBLIC_DEBUG_CERTIFICATE]);
  assert.deepEqual(parseCertificateDigests(`${output("AA".repeat(32))}${output("BB".repeat(32))}`), [
    "aa".repeat(32),
    "bb".repeat(32),
  ]);
  assert.deepEqual(parseCertificateDigests("no certificates here"), []);
});

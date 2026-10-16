import { createPrivateKey } from 'node:crypto';

// Supplement the recommended detector's >=100 Base64-character heuristic:
// a real PKCS#8 Ed25519 private key can be shorter. Values are never in messages.
export const creator = {
  meta: {
    id: 'lifestyle/parseable-private-key', type: 'scanner',
    supportedContentTypes: ['text']
  },
  create(context) {
    return {
      file(source) {
        const pattern = /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----[A-Za-z0-9+/=\s\\]{1,10000}-----END (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g;
        for (const match of source.content.matchAll(pattern)) {
          try {
            createPrivateKey(match[0].replace(/\\n/g, '\n').replace(/\\r/g, '\r'));
          } catch {
            continue; // Not a parseable unencrypted key; other detectors still run.
          }
          context.report({ range: [match.index, match.index + match[0].length],
            message: 'Parseable private-key material found; value omitted.' });
        }
      }
    };
  }
};

import { describe, it, expect } from "vitest";
import {
    computeCommitmentHex,
    findMatchingScoreForCommitment,
} from "$lib/common/commitment";
import { stringifyForChecksum, sha256 } from "$lib/common/utils";

describe("Commitment helpers", () => {
    const solverIdHex = "0102030405060708";
    const seedHex = "0a0b0c0d0e0f";
    const hashLogsHex = "aa11bb22cc33";
    const ergoTreeHex = "00112233445566778899aabbccddeeff";
    const secretHex = "deadbeefdeadbeefdeadbeefdeadbeef";

    it("returns valid when a score reproduces the commitment", () => {
        const score = 42n;
        const commitment = computeCommitmentHex(
            solverIdHex,
            seedHex,
            score,
            hashLogsHex,
            ergoTreeHex,
            secretHex,
        );
        expect(commitment).not.toBeNull();
        const res = findMatchingScoreForCommitment({
            declaredCommitmentHex: commitment!,
            solverIdHex,
            seedHex,
            scoreList: [1n, 2n, 42n, 100n],
            hashLogsHex,
            ergoTreeHex,
            secretHex,
        });
        expect(res.isValid).toBe(true);
        expect(res.matchedScore).toBe(42n);
    });

    it("returns invalid with incorrect secret", () => {
        const score = 7n;
        const commitment = computeCommitmentHex(
            solverIdHex,
            seedHex,
            score,
            hashLogsHex,
            ergoTreeHex,
            secretHex,
        );
        expect(commitment).not.toBeNull();
        const res = findMatchingScoreForCommitment({
            declaredCommitmentHex: commitment!,
            solverIdHex,
            seedHex,
            scoreList: [7n],
            hashLogsHex,
            ergoTreeHex,
            secretHex: "00".repeat(16), // wrong secret
        });
        expect(res.isValid).toBe(false);
    });

    it("returns invalid when no score matches", () => {
        const score = 123n;
        const commitment = computeCommitmentHex(
            solverIdHex,
            seedHex,
            score,
            hashLogsHex,
            ergoTreeHex,
            secretHex,
        );
        expect(commitment).not.toBeNull();
        const res = findMatchingScoreForCommitment({
            declaredCommitmentHex: commitment!,
            solverIdHex,
            seedHex,
            scoreList: [1n, 2n, 3n],
            hashLogsHex,
            ergoTreeHex,
            secretHex,
        });
        expect(res.isValid).toBe(false);
        expect(res.reason).toBe("no_match");
    });

    it("fails cleanly with invalid hex or missing fields", () => {
        const res = findMatchingScoreForCommitment({
            declaredCommitmentHex: null,
            solverIdHex: "zz",
            seedHex: "",
            scoreList: null,
            hashLogsHex: "gg",
            ergoTreeHex: "00",
            secretHex: "aa",
        });
        expect(res.isValid).toBe(false);
    });
});

describe("Checksum canonicalization", () => {
    it("accepts JSON with correct checksum", async () => {
        const data = { a: 1, b: [2, 3], z: "x" };
        const canonical = stringifyForChecksum(data);
        const checksum = await sha256(canonical);
        const payload = { ...data, checksum };

        // Simulate verification: remove checksum and recompute
        const { checksum: _, ...rest } = payload;
        const canonical2 = stringifyForChecksum(rest as Record<string, unknown>);
        const computed = await sha256(canonical2);
        expect(computed).toBe(checksum);
    });

    it("rejects JSON with manipulated checksum", async () => {
        const data = { x: 1, y: 2 };
        const canonical = stringifyForChecksum(data);
        const checksum = await sha256(canonical);
        const payload = { ...data, checksum: checksum.slice(0, -2) + "00" };

        const { checksum: expected, ...rest } = payload;
        const canonical2 = stringifyForChecksum(rest as Record<string, unknown>);
        const computed = await sha256(canonical2);
        expect(computed).not.toBe(expected);
    });
});

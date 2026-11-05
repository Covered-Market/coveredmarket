#!/usr/bin/env python3
"""Convert Bitcoin Core `gettxoutproof` (merkleblock) into the contract's Proof JSON.
Usage: txoutproof.py <merkleblock_hex> <txid> <tx_raw_hex> <block_hash>"""
import hashlib, json, sys

def sha256d(b): return hashlib.sha256(hashlib.sha256(b).digest()).digest()

def parse(hexs):
    b = bytes.fromhex(hexs); o = 80
    ntx = int.from_bytes(b[o:o+4], "little"); o += 4
    def varint():
        nonlocal o
        f = b[o]; o += 1
        if f < 0xfd: return f
        if f == 0xfd: v = int.from_bytes(b[o:o+2], "little"); o += 2; return v
        if f == 0xfe: v = int.from_bytes(b[o:o+4], "little"); o += 4; return v
        v = int.from_bytes(b[o:o+8], "little"); o += 8; return v
    nh = varint(); hashes = [b[o+32*i:o+32*(i+1)] for i in range(nh)]; o += 32*nh
    nf = varint(); flags = b[o:o+nf]
    bits = [(flags[i//8] >> (i % 8)) & 1 for i in range(nf*8)]
    return ntx, hashes, bits

def branch_for(ntx, hashes, bits, target):
    """Walk the partial merkle tree; return (index, branch_internal_order)."""
    import math
    height = 0
    while (1 << height) < ntx: height += 1
    hi = iter(hashes); bi = iter(bits)
    found = {}
    def rec(h, pos):
        flag = next(bi)
        if h == 0 or not flag:
            x = next(hi)
            if h == 0 and flag: found[x] = pos
            return x
        left = rec(h-1, pos*2)
        right = rec(h-1, pos*2+1) if pos*2+1 < math.ceil(ntx / (1 << (h-1))) else left
        return sha256d(left + right)
    root = rec(height, 0)
    idx = found[target]
    # rebuild the branch by re-walking with knowledge of idx
    hi = iter(hashes); bi = iter(bits); branch = []
    def rec2(h, pos):
        flag = next(bi)
        if h == 0 or not flag:
            return next(hi)
        lo = pos << h; hi_ = ((pos+1) << h) - 1
        left = rec2(h-1, pos*2)
        right = rec2(h-1, pos*2+1) if pos*2+1 < math.ceil(ntx / (1 << (h-1))) else left
        if lo <= idx <= hi_:
            mid = lo + (1 << (h-1))
            branch.append(right if idx < mid else left)
        return sha256d(left + right)
    rec2(height, 0)
    return idx, branch, root

mb, txid, raw, block = sys.argv[1:5]
ntx, hashes, bits = parse(mb)
target = bytes.fromhex(txid)[::-1]
idx, branch, root = branch_for(ntx, hashes, bits, target)
print(json.dumps({"tx_raw": raw, "block_hash": block, "tx_index": idx, "merkle_proof": [h[::-1].hex() for h in branch]}))

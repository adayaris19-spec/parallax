# Parse heavy atoms of PDB 3J3Q (HIV-1 capsid) into numpy arrays; find which protein rings are hexamers and which are pentamers.
import sys, gzip, numpy as np
src, out = sys.argv[1], sys.argv[2]
cols, xs, el, res, ch = [], [], [], [], []
chain_ids = {}; in_loop = False; title = []
with gzip.open(src, "rt") as f:
    for line in f:
        if line.startswith("_struct.title") or line.startswith("_citation.title") or line.startswith("_citation.journal_abbrev") or line.startswith("_citation.year"): title.append(line.strip()[:200])
        if line.startswith("_atom_site."): cols.append(line.strip().split(".")[1]); in_loop = True; continue
        if in_loop and (line.startswith("ATOM") or line.startswith("HETATM")):
            p = line.split()
            if not xs: ix = {c: i for i, c in enumerate(cols)}; cx, cy, cz, ce, cr, cc = ix["Cartn_x"], ix["Cartn_y"], ix["Cartn_z"], ix["type_symbol"], ix["label_seq_id"], ix["label_asym_id"]
            if p[ce] == "H": continue
            xs.append((float(p[cx]), float(p[cy]), float(p[cz]))); el.append(p[ce]); res.append(int(p[cr]) if p[cr].isdigit() else 0)
            ch.append(chain_ids.setdefault(p[cc], len(chain_ids)))
        elif in_loop and xs and line.startswith("#"): in_loop = False
P = np.array(xs, np.float32); res = np.array(res, np.int16); ch = np.array(ch, np.int32)
rad = np.array([{"C": 1.7, "N": 1.55, "O": 1.52, "S": 1.8}.get(e, 1.7) for e in el], np.float32)
print("\n".join(title)); print("atoms", len(P), "chains", len(chain_ids), "residues", res.min(), res.max(), "extent A", P.max(0) - P.min(0))
# principal axes
c = P.mean(0); ev, evec = np.linalg.eigh(np.cov((P[::50] - c).T)); print("principal sd (A)", np.sqrt(ev))
# ring membership from the N-terminal domain's innermost helix (residues 1-20 line the ring's central pore)
nch = len(chain_ids); cen = np.zeros((nch, 3), np.float32)
m = (res >= 1) & (res <= 20)
for k in range(3): cen[:, k] = np.bincount(ch[m], P[m, k], nch) / np.maximum(np.bincount(ch[m], minlength=nch), 1)
from scipy.spatial import cKDTree
from scipy.sparse.csgraph import connected_components
from scipy.sparse import coo_matrix
t = cKDTree(cen); best = None
for thr in (14, 16, 18, 20, 22, 24):
    pr = t.query_pairs(thr, output_type="ndarray")
    g = coo_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), shape=(nch, nch)); n, lab = connected_components(g, directed=False)
    sizes = np.bincount(np.bincount(lab)); print("thr", thr, "rings", n, "size histogram", {i: int(s) for i, s in enumerate(sizes) if s})
    if n == 228 and best is None: best = lab
ring = best if best is not None else lab; rs = np.bincount(ring)[ring]
np.savez(out, P=P, rad=rad, res=res, ch=ch, ring_size=rs.astype(np.int8), ring=ring.astype(np.int32), center=c, axes=evec)
print("pentamer chains:", int((rs == 5).sum()), "hexamer chains:", int((rs == 6).sum()))

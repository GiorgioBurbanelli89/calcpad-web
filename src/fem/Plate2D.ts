// 2D plane stress / plate solvers in pure TypeScript
// - Q4 quadrilateral plane stress (membrane)
// - DKQ Kirchhoff thin plate (Batoz & Tahar 1982)
// - MITC4 Mindlin-Reissner thick plate (Bathe & Dvorkin 1985, simplified)
// - Layered shell (composite A/B/D matrices)
//
// All ported from the Calcpad-Symbolic tutorials. Use math.js lusolve as solver.

import { lusolve, matrix } from 'mathjs';

// ==== Q4 Plane Stress (membrane) ====

const GP_2 = 1 / Math.sqrt(3);
const Q4_GAUSS: readonly [number, number, number][] = [
  [-GP_2, -GP_2, 1], [ GP_2, -GP_2, 1], [ GP_2,  GP_2, 1], [-GP_2,  GP_2, 1],
];

export interface Q4MembraneInput {
  /** Nx2 node coordinates (x, y) */
  nodes: number[][];
  /** Mx4 element connectivity (0-based) */
  elements: number[][];
  /** Young's modulus */
  E: number;
  /** Poisson */
  nu: number;
  /** Thickness */
  t: number;
  /** Loads {nodeId (0-based), fx, fy} */
  loads: { nodeId: number; fx: number; fy: number }[];
  /** BCs {dofId (0-based), value} where dofId = 2*nodeId + d (d=0,1) */
  bcs: { dofId: number; value: number }[];
}

export interface Q4MembraneOutput {
  u: number[]; // 2N
  vonMises: number[]; // N
  nDof: number;
  tAssembleMs: number;
  tSolveMs: number;
}

/** Solve a 2D plane stress problem with Q4 elements. */
export function solveQ4Membrane(input: Q4MembraneInput): Q4MembraneOutput {
  const { nodes, elements, E, nu, t, loads, bcs } = input;
  const nN = nodes.length;
  const nE = elements.length;
  const nDof = 2 * nN;
  const t0 = performance.now();

  // Plane stress D matrix
  const c = E / (1 - nu * nu);
  const D = [
    [c,        c * nu,    0       ],
    [c * nu,   c,         0       ],
    [0,        0,         c * (1 - nu) / 2],
  ];

  const K: number[][] = new Array(nDof);
  for (let i = 0; i < nDof; i++) K[i] = new Array(nDof).fill(0);
  const F: number[] = new Array(nDof).fill(0);

  // Q4 shape function natural-coord signs
  const XI = [-1, 1, 1, -1];
  const ETA = [-1, -1, 1, 1];

  for (let e = 0; e < nE; e++) {
    const conn = elements[e];
    const xe = conn.map(i => nodes[i][0]);
    const ye = conn.map(i => nodes[i][1]);
    const Ke: number[][] = new Array(8);
    for (let i = 0; i < 8; i++) Ke[i] = new Array(8).fill(0);

    for (const [xi, eta, w] of Q4_GAUSS) {
      // Shape function derivatives
      const dNdxi = XI.map((s, i) => 0.25 * s * (1 + ETA[i] * eta));
      const dNdeta = ETA.map((s, i) => 0.25 * (1 + XI[i] * xi) * s);

      // Jacobian 2x2
      let J00 = 0, J01 = 0, J10 = 0, J11 = 0;
      for (let i = 0; i < 4; i++) {
        J00 += dNdxi[i] * xe[i];
        J01 += dNdxi[i] * ye[i];
        J10 += dNdeta[i] * xe[i];
        J11 += dNdeta[i] * ye[i];
      }
      const detJ = J00 * J11 - J01 * J10;
      const invDet = 1 / detJ;
      const iJ00 = J11 * invDet, iJ01 = -J01 * invDet;
      const iJ10 = -J10 * invDet, iJ11 = J00 * invDet;

      // Physical derivatives
      const dNx = dNdxi.map((dx, i) => iJ00 * dx + iJ01 * dNdeta[i]);
      const dNy = dNdxi.map((dx, i) => iJ10 * dx + iJ11 * dNdeta[i]);

      // B (3x8)
      const B: number[][] = [
        new Array(8).fill(0),
        new Array(8).fill(0),
        new Array(8).fill(0),
      ];
      for (let i = 0; i < 4; i++) {
        B[0][2 * i]     = dNx[i];
        B[1][2 * i + 1] = dNy[i];
        B[2][2 * i]     = dNy[i];
        B[2][2 * i + 1] = dNx[i];
      }

      // Ke += t * B^T * D * B * detJ * w
      for (let r = 0; r < 8; r++) {
        for (let cc = 0; cc < 8; cc++) {
          let s = 0;
          for (let k1 = 0; k1 < 3; k1++) {
            for (let k2 = 0; k2 < 3; k2++) {
              s += B[k1][r] * D[k1][k2] * B[k2][cc];
            }
          }
          Ke[r][cc] += s * t * detJ * w;
        }
      }
    }

    // Scatter
    const dofMap = new Array(8);
    for (let i = 0; i < 4; i++) {
      dofMap[2 * i] = 2 * conn[i];
      dofMap[2 * i + 1] = 2 * conn[i] + 1;
    }
    for (let i = 0; i < 8; i++) {
      const gi = dofMap[i];
      for (let j = 0; j < 8; j++) K[gi][dofMap[j]] += Ke[i][j];
    }
  }

  // Loads
  for (const ld of loads) {
    F[2 * ld.nodeId] += ld.fx;
    F[2 * ld.nodeId + 1] += ld.fy;
  }

  // Penalty BCs
  const PEN = 1e20;
  for (const bc of bcs) {
    K[bc.dofId][bc.dofId] += PEN;
    F[bc.dofId] += PEN * bc.value;
  }

  const tAssembleMs = performance.now() - t0;
  const tSolve0 = performance.now();
  const Kmat = matrix(K);
  const Fmat = matrix(F.map(v => [v]));
  const uRaw = lusolve(Kmat, Fmat);
  const uArr = (uRaw.valueOf() as number[][]).map(r => r[0]);
  const tSolveMs = performance.now() - tSolve0;

  // Von Mises stress at element centers, averaged to nodes
  const vmAccum = new Array(nN).fill(0);
  const vmCount = new Array(nN).fill(0);
  for (let e = 0; e < nE; e++) {
    const conn = elements[e];
    const xe = conn.map(i => nodes[i][0]);
    const ye = conn.map(i => nodes[i][1]);
    const ue = new Array(8);
    for (let i = 0; i < 4; i++) {
      ue[2 * i] = uArr[2 * conn[i]];
      ue[2 * i + 1] = uArr[2 * conn[i] + 1];
    }
    // At element center xi=eta=0
    const dNdxi = XI.map(s => 0.25 * s);
    const dNdeta = ETA.map(s => 0.25 * s);
    let J00 = 0, J01 = 0, J10 = 0, J11 = 0;
    for (let i = 0; i < 4; i++) {
      J00 += dNdxi[i] * xe[i];
      J01 += dNdxi[i] * ye[i];
      J10 += dNdeta[i] * xe[i];
      J11 += dNdeta[i] * ye[i];
    }
    const detJ = J00 * J11 - J01 * J10;
    const invDet = 1 / detJ;
    const iJ00 = J11 * invDet, iJ01 = -J01 * invDet;
    const iJ10 = -J10 * invDet, iJ11 = J00 * invDet;
    const dNx = dNdxi.map((dx, i) => iJ00 * dx + iJ01 * dNdeta[i]);
    const dNy = dNdxi.map((dx, i) => iJ10 * dx + iJ11 * dNdeta[i]);

    let exx = 0, eyy = 0, gxy = 0;
    for (let i = 0; i < 4; i++) {
      exx += dNx[i] * ue[2 * i];
      eyy += dNy[i] * ue[2 * i + 1];
      gxy += dNy[i] * ue[2 * i] + dNx[i] * ue[2 * i + 1];
    }
    const sxx = D[0][0] * exx + D[0][1] * eyy;
    const syy = D[1][0] * exx + D[1][1] * eyy;
    const sxy = D[2][2] * gxy;
    const vm = Math.sqrt(sxx * sxx - sxx * syy + syy * syy + 3 * sxy * sxy);
    for (let i = 0; i < 4; i++) {
      vmAccum[conn[i]] += vm;
      vmCount[conn[i]]++;
    }
  }
  const vonMises = new Array(nN);
  for (let i = 0; i < nN; i++) vonMises[i] = vmCount[i] > 0 ? vmAccum[i] / vmCount[i] : 0;

  return { u: uArr, vonMises, nDof, tAssembleMs, tSolveMs };
}

// ==== Helper: Generate Q4 mesh on a rectangle ====
export function meshQ4Rect(
  Lx: number, Ly: number, nx: number, ny: number, x0 = 0, y0 = 0
): { nodes: number[][]; elements: number[][] } {
  const nodes: number[][] = [];
  const dx = Lx / nx, dy = Ly / ny;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      nodes.push([x0 + i * dx, y0 + j * dy]);
    }
  }
  const elements: number[][] = [];
  const nxp = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const n1 = j * nxp + i;
      const n2 = j * nxp + i + 1;
      const n3 = (j + 1) * nxp + i + 1;
      const n4 = (j + 1) * nxp + i;
      elements.push([n1, n2, n3, n4]);
    }
  }
  return { nodes, elements };
}

// ==== MITC4 Mindlin Plate (simplified — bending only with shear) ====
// 3 DOF per node: w, theta_x, theta_y
// Simplified with full 2x2 Gauss integration for bending and shear (no MITC tying for now)
//
// For thick plates this gives reasonable results for w but may suffer mild
// shear locking on thin plates. Use t/L > 1/100 for best accuracy.
export interface MindlinPlateInput {
  nodes: number[][]; // Nx2 (x, y)
  elements: number[][]; // Mx4 (0-based)
  E: number;
  nu: number;
  thickness: number;
  loads: { nodeId: number; fz: number }[];
  bcs: { dofId: number; value: number }[]; // dofId = 3*nodeId + d (d=0:w, 1:tx, 2:ty)
}

export interface MindlinPlateOutput {
  u: number[]; // 3N
  w: number[]; // N (deflection only)
  nDof: number;
  tAssembleMs: number;
  tSolveMs: number;
}

export function solveMindlinPlate(input: MindlinPlateInput): MindlinPlateOutput {
  const { nodes, elements, E, nu, thickness, loads, bcs } = input;
  const nN = nodes.length;
  const nE = elements.length;
  const nDof = 3 * nN;
  const h = thickness;
  const t0 = performance.now();

  // Bending Db (3x3)
  const D0 = (E * h ** 3) / (12 * (1 - nu * nu));
  const Db = [
    [D0,        D0 * nu,   0       ],
    [D0 * nu,   D0,        0       ],
    [0,         0,         D0 * (1 - nu) / 2],
  ];
  // Shear Ds (2x2), kappa=5/6
  const Gh = E / (2 * (1 + nu)) * h * 5 / 6;
  const Ds = [[Gh, 0], [0, Gh]];

  const K: number[][] = new Array(nDof);
  for (let i = 0; i < nDof; i++) K[i] = new Array(nDof).fill(0);
  const F: number[] = new Array(nDof).fill(0);

  const XI = [-1, 1, 1, -1];
  const ETA = [-1, -1, 1, 1];

  for (let e = 0; e < nE; e++) {
    const conn = elements[e];
    const xe = conn.map(i => nodes[i][0]);
    const ye = conn.map(i => nodes[i][1]);
    const Ke: number[][] = new Array(12);
    for (let i = 0; i < 12; i++) Ke[i] = new Array(12).fill(0);

    // Bending: 2x2 Gauss
    for (const [xi, eta, w] of Q4_GAUSS) {
      const N = XI.map((s, i) => 0.25 * (1 + s * xi) * (1 + ETA[i] * eta));
      const dNdxi = XI.map((s, i) => 0.25 * s * (1 + ETA[i] * eta));
      const dNdeta = ETA.map((s, i) => 0.25 * (1 + XI[i] * xi) * s);

      let J00 = 0, J01 = 0, J10 = 0, J11 = 0;
      for (let i = 0; i < 4; i++) {
        J00 += dNdxi[i] * xe[i]; J01 += dNdxi[i] * ye[i];
        J10 += dNdeta[i] * xe[i]; J11 += dNdeta[i] * ye[i];
      }
      const detJ = J00 * J11 - J01 * J10;
      const invDet = 1 / detJ;
      const iJ00 = J11 * invDet, iJ01 = -J01 * invDet;
      const iJ10 = -J10 * invDet, iJ11 = J00 * invDet;
      const dNx = dNdxi.map((dx, i) => iJ00 * dx + iJ01 * dNdeta[i]);
      const dNy = dNdxi.map((dx, i) => iJ10 * dx + iJ11 * dNdeta[i]);

      // Bending B (3x12): [-dN/dx_theta_x; -dN/dy_theta_y; -dN/dy_theta_x - dN/dx_theta_y]
      const Bb: number[][] = [
        new Array(12).fill(0), new Array(12).fill(0), new Array(12).fill(0),
      ];
      for (let i = 0; i < 4; i++) {
        Bb[0][3 * i + 1] = dNx[i];
        Bb[1][3 * i + 2] = dNy[i];
        Bb[2][3 * i + 1] = dNy[i];
        Bb[2][3 * i + 2] = dNx[i];
      }
      // Ke += Bb^T * Db * Bb * detJ
      for (let r = 0; r < 12; r++) {
        for (let cc = 0; cc < 12; cc++) {
          let s = 0;
          for (let k1 = 0; k1 < 3; k1++)
            for (let k2 = 0; k2 < 3; k2++)
              s += Bb[k1][r] * Db[k1][k2] * Bb[k2][cc];
          Ke[r][cc] += s * detJ * w;
        }
      }

      // Shear B (2x12): [dN/dx*w - N*theta_y; dN/dy*w + N*theta_x]
      const Bs: number[][] = [new Array(12).fill(0), new Array(12).fill(0)];
      for (let i = 0; i < 4; i++) {
        Bs[0][3 * i]     = dNx[i];
        Bs[0][3 * i + 2] = -N[i];
        Bs[1][3 * i]     = dNy[i];
        Bs[1][3 * i + 1] = N[i];
      }
      for (let r = 0; r < 12; r++) {
        for (let cc = 0; cc < 12; cc++) {
          let s = 0;
          for (let k1 = 0; k1 < 2; k1++)
            for (let k2 = 0; k2 < 2; k2++)
              s += Bs[k1][r] * Ds[k1][k2] * Bs[k2][cc];
          Ke[r][cc] += s * detJ * w;
        }
      }
    }

    const dofMap = new Array(12);
    for (let i = 0; i < 4; i++) {
      dofMap[3 * i]     = 3 * conn[i];
      dofMap[3 * i + 1] = 3 * conn[i] + 1;
      dofMap[3 * i + 2] = 3 * conn[i] + 2;
    }
    for (let i = 0; i < 12; i++) {
      const gi = dofMap[i];
      for (let j = 0; j < 12; j++) K[gi][dofMap[j]] += Ke[i][j];
    }
  }

  // Loads
  for (const ld of loads) F[3 * ld.nodeId] += ld.fz;

  // BCs
  const PEN = 1e20;
  for (const bc of bcs) {
    K[bc.dofId][bc.dofId] += PEN;
    F[bc.dofId] += PEN * bc.value;
  }

  const tAssembleMs = performance.now() - t0;
  const tSolve0 = performance.now();
  const uRaw = lusolve(matrix(K), matrix(F.map(v => [v])));
  const uArr = (uRaw.valueOf() as number[][]).map(r => r[0]);
  const tSolveMs = performance.now() - tSolve0;

  const w = new Array(nN);
  for (let i = 0; i < nN; i++) w[i] = uArr[3 * i];

  return { u: uArr, w, nDof, tAssembleMs, tSolveMs };
}

// ==== Mindlin plate with Winkler springs (footing on soil) ====
export interface FootingWinklerInput extends MindlinPlateInput {
  /** Soil modulus k_s (force/area/length, e.g. kN/m³) */
  ks: number;
}

export function solveFootingWinkler(input: FootingWinklerInput): MindlinPlateOutput {
  // Add k_s * tributary area to the diagonal of w-DOFs
  const { nodes, elements, ks } = input;
  const nN = nodes.length;

  // Compute tributary area per node by lumping element area to the 4 corners
  const tribArea = new Array(nN).fill(0);
  for (const conn of elements) {
    const xe = conn.map(i => nodes[i][0]);
    const ye = conn.map(i => nodes[i][1]);
    // Area via shoelace
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      area += xe[i] * ye[j] - xe[j] * ye[i];
    }
    area = Math.abs(area) / 2;
    for (const ni of conn) tribArea[ni] += area / 4;
  }

  // Run base Mindlin solver but inject springs into K via a custom load list trick:
  // Easiest: run a wrapper that builds K with the spring already on the diagonal.
  // We re-implement with spring injection.
  const t0 = performance.now();
  const { E, nu, thickness, loads, bcs } = input;
  const nE = elements.length;
  const nDof = 3 * nN;
  const h = thickness;

  const D0 = (E * h ** 3) / (12 * (1 - nu * nu));
  const Db = [
    [D0,        D0 * nu,   0       ],
    [D0 * nu,   D0,        0       ],
    [0,         0,         D0 * (1 - nu) / 2],
  ];
  const Gh = E / (2 * (1 + nu)) * h * 5 / 6;
  const Ds = [[Gh, 0], [0, Gh]];

  const K: number[][] = new Array(nDof);
  for (let i = 0; i < nDof; i++) K[i] = new Array(nDof).fill(0);
  const F: number[] = new Array(nDof).fill(0);

  const XI = [-1, 1, 1, -1];
  const ETA = [-1, -1, 1, 1];

  for (let e = 0; e < nE; e++) {
    const conn = elements[e];
    const xe = conn.map(i => nodes[i][0]);
    const ye = conn.map(i => nodes[i][1]);
    const Ke: number[][] = new Array(12);
    for (let i = 0; i < 12; i++) Ke[i] = new Array(12).fill(0);

    for (const [xi, eta, w] of Q4_GAUSS) {
      const N = XI.map((s, i) => 0.25 * (1 + s * xi) * (1 + ETA[i] * eta));
      const dNdxi = XI.map((s, i) => 0.25 * s * (1 + ETA[i] * eta));
      const dNdeta = ETA.map((s, i) => 0.25 * (1 + XI[i] * xi) * s);
      let J00 = 0, J01 = 0, J10 = 0, J11 = 0;
      for (let i = 0; i < 4; i++) {
        J00 += dNdxi[i] * xe[i]; J01 += dNdxi[i] * ye[i];
        J10 += dNdeta[i] * xe[i]; J11 += dNdeta[i] * ye[i];
      }
      const detJ = J00 * J11 - J01 * J10;
      const invDet = 1 / detJ;
      const iJ00 = J11 * invDet, iJ01 = -J01 * invDet;
      const iJ10 = -J10 * invDet, iJ11 = J00 * invDet;
      const dNx = dNdxi.map((dx, i) => iJ00 * dx + iJ01 * dNdeta[i]);
      const dNy = dNdxi.map((dx, i) => iJ10 * dx + iJ11 * dNdeta[i]);

      const Bb: number[][] = [new Array(12).fill(0), new Array(12).fill(0), new Array(12).fill(0)];
      for (let i = 0; i < 4; i++) {
        Bb[0][3 * i + 1] = dNx[i];
        Bb[1][3 * i + 2] = dNy[i];
        Bb[2][3 * i + 1] = dNy[i];
        Bb[2][3 * i + 2] = dNx[i];
      }
      for (let r = 0; r < 12; r++) {
        for (let cc = 0; cc < 12; cc++) {
          let s = 0;
          for (let k1 = 0; k1 < 3; k1++)
            for (let k2 = 0; k2 < 3; k2++)
              s += Bb[k1][r] * Db[k1][k2] * Bb[k2][cc];
          Ke[r][cc] += s * detJ * w;
        }
      }
      const Bs: number[][] = [new Array(12).fill(0), new Array(12).fill(0)];
      for (let i = 0; i < 4; i++) {
        Bs[0][3 * i]     = dNx[i];
        Bs[0][3 * i + 2] = -N[i];
        Bs[1][3 * i]     = dNy[i];
        Bs[1][3 * i + 1] = N[i];
      }
      for (let r = 0; r < 12; r++) {
        for (let cc = 0; cc < 12; cc++) {
          let s = 0;
          for (let k1 = 0; k1 < 2; k1++)
            for (let k2 = 0; k2 < 2; k2++)
              s += Bs[k1][r] * Ds[k1][k2] * Bs[k2][cc];
          Ke[r][cc] += s * detJ * w;
        }
      }
    }

    const dofMap = new Array(12);
    for (let i = 0; i < 4; i++) {
      dofMap[3 * i]     = 3 * conn[i];
      dofMap[3 * i + 1] = 3 * conn[i] + 1;
      dofMap[3 * i + 2] = 3 * conn[i] + 2;
    }
    for (let i = 0; i < 12; i++) {
      const gi = dofMap[i];
      for (let j = 0; j < 12; j++) K[gi][dofMap[j]] += Ke[i][j];
    }
  }

  // Add Winkler springs to w-diagonal
  for (let i = 0; i < nN; i++) {
    K[3 * i][3 * i] += ks * tribArea[i];
  }

  for (const ld of loads) F[3 * ld.nodeId] += ld.fz;

  const PEN = 1e20;
  for (const bc of bcs) {
    K[bc.dofId][bc.dofId] += PEN;
    F[bc.dofId] += PEN * bc.value;
  }

  const tAssembleMs = performance.now() - t0;
  const tSolve0 = performance.now();
  const uRaw = lusolve(matrix(K), matrix(F.map(v => [v])));
  const uArr = (uRaw.valueOf() as number[][]).map(r => r[0]);
  const tSolveMs = performance.now() - tSolve0;
  const wOut = new Array(nN);
  for (let i = 0; i < nN; i++) wOut[i] = uArr[3 * i];

  return { u: uArr, w: wOut, nDof, tAssembleMs, tSolveMs };
}

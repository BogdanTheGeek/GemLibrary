'use strict';

import {
   loadSTL,
   loadGCS,
   loadASC,
   loadGEM,
   computeFacetNotesSummary,
   groupExternalFacetsForDesign,
} from './PerfectGem/loaders.js';
import fs from 'fs';
import path from 'path';

const shapeMap = {
   1: "Round",
   2: "Oval",
   3: "Navette Marquise",
   4: "Emerald",
   5: "Pear",
   6: "Rectangle",
   7: "Square Emerald",
   8: "Antique Cushion",
   9: "Square Antique Cushion",
   10: "Heart",
   11: "Square",
   12: "Baguette",
   13: "Cushion Triangle",
   14: "Triangle",
   15: "Old Mine",
   16: "Cut Corner Triangle",
   17: "Barrel",
   18: "Kite",
   19: "Keystone",
   20: "Seminavette",
   21: "Octagon",
   22: "Whistle",
   23: "Shield",
   24: "Trapeze",
   25: "Tapered Pentagon",
   26: "Calf's Head",
   27: "Epaulette",
   28: "Hexagon",
   29: "Lozenge",
   30: "Pentagon",
   31: "Bullet",
   32: "Fan",
   33: "Rhomboid",
   34: "Star",
   35: "Window",
   36: "Navette Oval",
   37: "Heptagon",
   38: "Nonagon",
   39: "Undecagon",
   40: "Hexagon",
   41: "Octagon",
   42: "Decagon",
   43: "Freeform",
   44: "Freeform",
   45: "Dodecagon",
   46: "Coffin",
};

function guessShape(metadata) {
   const maybeTrig = metadata.symmetries.includes(3);
   const maybeHex = metadata.symmetries.includes(6);
   const moreTrigThanHex = maybeTrig && (!maybeHex || metadata.symmetryCounts[3] > metadata.symmetryCounts[6]);
   if (moreTrigThanHex) {
      return 'Triangle';
   }
   if ((metadata.symmetries.includes(2) && metadata.girdleCount <= 8) || metadata.symmetries.includes(4)) {
      if (metadata.lw > 1.05) {
         return 'Rectangle';
      }
      return 'Square';
   }
   if (metadata.lw > 1.2) {
      return 'Oval';
   }
   if (metadata.symmetries.includes(5)) {
      return 'Pentagon';
   }
   if (maybeHex && metadata.girdleCount == 6) {
      return 'Hexagon';
   }
   if (metadata.symmetries.includes(8)) {
      return 'Octagon';
   }
   return 'Other';
}

async function extractInfo(filePath) {
   const ext = path.extname(filePath).toLowerCase();
   const raw = fs.readFileSync(filePath);
   const data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
   let stone;
   if (ext === '.stl') {
      stone = await loadSTL(data);
   } else if (ext === '.gcs') {
      stone = await loadGCS(data);
   } else if (ext === '.asc') {
      stone = await loadASC(data);
   } else if (ext === '.gem') {
      stone = await loadGEM(data);
   } else {
      throw new Error(`Unsupported file type: ${ext}`);
   }

   const metadata = {};

   const header = stone.metadata?.title || '';
   const comments = stone.metadata?.comments || '';
   const name = path.basename(filePath);
   metadata.name = name;
   metadata.header = header;
   metadata.comments = comments;

   const gear = stone.sourceGear;
   metadata.gear = gear;
   metadata.ri = stone.refractiveIndex;

   const grouped = groupExternalFacetsForDesign(stone.facets, gear);
   const symmetries = grouped.map(g => g.symmetry).filter(s => s >= 2);
   const symmetryCounts = {};
   for (const sym of symmetries) {
      symmetryCounts[sym] = (symmetryCounts[sym] || 0) + 1;
   }
   const uniqueSymmetries = [...new Set(symmetries)];
   metadata.symmetries = uniqueSymmetries;
   metadata.symmetryCounts = symmetryCounts;

   const summary = computeFacetNotesSummary(stone);
   metadata.lw = summary.lw;
   metadata.pw = summary.pw;
   metadata.cw = summary.cw;
   metadata.tw = summary.tw;
   metadata.uw = summary.uw;
   metadata.girdleCount = summary.girdleCount;
   metadata.facetCount = summary.totalCount;

   const match = name.match(/PC(\d{2})\d{3}[A-Z]?\.ASC/i);
   if (stone.metadata?.shape) {
      metadata.shape = stone.metadata.shape;
   } else if (match) {
      const shapeCode = parseInt(match[1], 10);
      metadata.shape = shapeMap[shapeCode] || 'Other';
   } else {
      metadata.shape = guessShape(metadata);
   }
   return metadata;
}

const args = process.argv.slice(2);
if (args.length === 0) {
   console.error('Usage: node organise.js <path_to_model_file>');
   process.exit(1);
}

// for every arg, if directory, get all files in directory
let filesToProcess = [];
for (const arg of args) {
   if (fs.existsSync(arg)) {
      const stat = fs.statSync(arg);
      if (stat.isDirectory()) {
         const files = fs.readdirSync(arg).map(f => path.join(arg, f));
         filesToProcess.push(...files);
      } else if (stat.isFile()) {
         filesToProcess.push(arg);
      }
   } else {
      console.error(`File or directory does not exist: ${arg}`);
   }
}

// filter files to only supported types
filesToProcess = filesToProcess.filter(f => {
   const ext = path.extname(f).toLowerCase();
   return ['.gcs', '.asc', '.gem'].includes(ext);
});

const db = [];

let lastPercet = -1;
for (const filePath of filesToProcess) {
   let data;
   try {
      data = await extractInfo(filePath);
   } catch (err) {
      console.error(`Error processing ${filePath}: ${err.message}`);
      continue;
   }
   db.push(data);
   const percent = Math.round((db.length / filesToProcess.length) * 100);
   if (percent !== lastPercet) {
      process.stdout.write('|');
      lastPercet = percent;
   }
}
process.stdout.write('\n');
const root = path.dirname(filesToProcess[0]);
const outputPath = path.join(root, 'metadata.json');
try {
   fs.writeFileSync(outputPath, JSON.stringify(db, null, 2));
   console.log(`Metadata extracted and saved to ${outputPath}`);
} catch (err) {
   console.error(`Error writing to file: ${err.message}`);
}
process.exit(0);

(async () => {
   for (const filePath of filesToProcess) {
      try {
         await extractInfo(filePath);
      } catch (err) {
         console.error(`Error processing ${filePath}: ${err.message}`);
      }
   }
})();

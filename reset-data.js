const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "data");
const seedFile = path.join(dataDir, "seed.json");
const storeFile = path.join(dataDir, "store.json");

if (!fs.existsSync(seedFile)) {
  console.error("Missing data/seed.json");
  process.exit(1);
}

fs.copyFileSync(seedFile, storeFile);
console.log("Mock city state reset from data/seed.json");

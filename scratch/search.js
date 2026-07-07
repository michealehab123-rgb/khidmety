import fs from 'fs';

const filePath = 'src/pages/ServantDashboard.jsx';
const query = process.argv[2];

if (!query) {
  console.log("Usage: node scratch/search.js <query>");
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');
let count = 0;

lines.forEach((line, index) => {
  if (line.toLowerCase().includes(query.toLowerCase())) {
    console.log(`${index + 1}: ${line.trim()}`);
    count++;
  }
});

console.log(`\nFound ${count} matches for "${query}"`);

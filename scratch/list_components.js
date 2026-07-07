import fs from 'fs';

const content = fs.readFileSync('src/pages/ServantDashboard.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('function ') && !line.includes('(') && !line.includes('=')) {
    console.log(`${idx + 1}: ${line}`);
  } else if (line.includes('export default function') || (line.includes('function') && line.includes('(') && (line.startsWith('function') || line.startsWith('export')))) {
    console.log(`${idx + 1}: ${line}`);
  } else if (line.includes('const') && line.includes('=>') && (line.includes('Page') || line.includes('Dashboard') || line.includes('Component') || line.includes('Console') || line.includes('Section') || line.includes('Tab'))) {
    console.log(`${idx + 1}: ${line}`);
  }
});
